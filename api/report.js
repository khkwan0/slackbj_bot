const { Pool } = require('pg')
const moment = require('moment-timezone')
const BigNumber = require('bignumber.js')
const {program} = require('commander')
require('dotenv').config()
const btc_prices = require('./btc_historical.json')
const yld_prices = require('./yld_historical.json')
const eth_prices = require('./eth_historical.json')
const btcFix = require('./btcFix.json')

program
  .requiredOption('-u, --user <uid>', 'User ID')
  .option('-s, --start <start_date>', 'Start Date')
  .option('-e, --end <end_date>', 'End Date')
  .option('-n, --notime', 'date only')
  .option('-z, --zero <string>', 'Replace with zeroes or <string>')

program.parse(process.argv)

const opts = program.opts()

const historicPrices = {}
historicPrices['BTC'] = btc_prices
historicPrices['YLD'] = yld_prices

let zero = false
if (opts.zero) {
  zero = opts.zero
}

historicPrices['ETH'] = eth_prices

const GetPrice = (currency, day) => {
  if (typeof historicPrices[currency] !== 'undefined' && typeof historicPrices[currency][day] !== 'undefined') {
    return historicPrices[currency][day]
  } else if (currency === 'USDT' || currency === 'USDC') {
    return 1.0
  } else {
    console.error('ERROR - no price: ', currency, day)
    process.exit(1)
  }
}

const RenderRowBalances = (walletValues, currencies, trans, now, zero) => {
  let html = ''

  // ledger balances
  currencies.forEach((currency, idx) => {
    if (zero) {
      if ((currency === trans.ticker) || (trans.type === 'swap' && currency === 'YLD')) {
        let amt = walletValues[currency].toFixed(4)
        amt = amt === '-0.0000' ? '0.0000': amt
        if (idx === 0) {
          html += `<td class="leftb">${amt}</td>`
        } else {
          html += `<td>${amt}</td>`
        }
      } else {
        if (idx === 0) {
          html += `<td class="leftb zero">${zero}</td>`
        } else {
          html += `<td class="zero">${zero}</td>`
        }
      }
    } else {
      let amt = walletValues[currency].toFixed(3)
      amt = amt === '-0.000' ? '0.000': amt
      if (idx === 0) {
        html += `<td class="leftb">${amt}</td>`
      } else {
        html += `<td>${amt}</td>`
      }
    }
  })

	// ledger usd balances
  currencies.forEach((currency, idx) => {
    if (zero) {
      if ((currency === trans.ticker) || (trans.type === 'swap' && currency === 'YLD')) {
        let amt = (walletValues[currency] * GetPrice(currency, now.format('MMM DD, YYYY'))).toFixed(2)
        amt = amt === '-0.00' ? '0.00': amt
        if (idx === 0) {
          html += `<td class="leftb">${amt}</td>`
        } else {
          html += `<td>${amt}</td>`
        }
      } else {
        if (idx === 0) {
          html += `<td class="leftb zero">${zero}</td>`
        } else {
          html += `<td class="zero">${zero}</td>`
        }
      }
    } else {
			let amt = (walletValues[currency] * GetPrice(currency, now.format('MMM DD, YYYY'))).toFixed(2)
      amt = amt === '-0.00' ? '0.00': amt
      if (idx === 0) {
        html += `<td class="leftb">${amt}</td>`
      } else {
        html += `<td>${amt}</td>`
      }
    }
  })
  return html
}

const RenderMonthlyClose = (monthly = {}, currencies = []) => {
  let html = `<table>`
  html += `<tr>
    <th>Month</th>
  `
  currencies.forEach(currency => {
    html += `<th>${currency}</th>`
  })
  currencies.forEach(currency => {
    html += `<th>${currency}</th>`
  })
  html += `</tr>`

  Object.keys(monthly).forEach((month, idx) => {
    html += idx % 2 ? `<tr class="altrow">` : `<tr>`
    html += `<td>${month}</td>`
    html += monthly[month]
    html += `</tr>`
  })
  html += `</table>`
  return html
}

const CheckForNegative = trans => {
  let pass = true
  Object.keys(trans).forEach(ticker => {
    if (trans[ticker] < -0.01) {
      console.error('(ERR) Negative Balance: ',trans[ticker], ticker)
      pass = false
    }
  })
  return pass
}

// main
if (opts.user) {
  const userId = opts.user

  let start = null
  let end = moment()
  if (opts.start) {
    start = moment(opts.start)
  }

  if (opts.end) {
    end = moment(opts.end)
  } else {
    end = moment()
  }

  const db = new Pool({
    user: process.env.DB_READ_USER,
    host: process.env.DB_READ_HOST,
    database: process.env.DB_READ_DB,
    password: process.env.DB_READ_PASSWORD,
    port: process.env.DB_READ_PORT,
  })

  const walletTrans = []
  const IWTrans = [] // investment wallet transactions
  const prices = {}
  const rewards1 = []
  const rewards2 = []

  let user = {}
  ;(async () => {
    try {
      user = (await (db.query('select * from users where id=$1', [userId]))).rows[0]
      const deposits = await db.query('select d.amount/10^c.decimals as amount, c.ticker as ticker, extract(epoch from d."updatedAt") as timestamp from deposits d, wallets w, users u, currencies c where d."currencyId"=c.id and d."walletId"=w.id and w."userId"=u.id and u.id=$1 and d."createdAt" < $2', [userId, end.format('YYYY-MM-DD HH:mm:ss')])
      deposits.rows.forEach(row => {
        const tran = {
          type: 'deposit',
          amount: row.amount,
          ticker: row.ticker,
          timestamp: row.timestamp,
        }
        walletTrans.push({...tran})
      })

      const withdrawals = await db.query('select wi.amount/10^c.decimals as amount, wi."feeAmount"/10^c.decimals as fee, c.ticker as ticker, extract(epoch from wi."updatedAt") as timestamp from withdrawal_requests wi, wallets w, users u, currencies c where wi."walletId"=w.id and w."userId"=u.id and u.id=$1 and wi."currencyId"=c.id and wi."createdAt"<$2 and wi.status=$3', [userId, end.format('YYYY-MM-DD HH:mm:ss'), 'sent'])
      withdrawals.rows.forEach(row => {
        const tran = {
          type: 'withdrawal',
          amount: row.amount,
          fee: row.fee,
          ticker: row.ticker,
          timestamp: row.timestamp,
        }
        walletTrans.push({...tran})
      })

      const swaps = await db.query('select et."sellCurrencyAmount"/10^c.decimals as "sellAmount", c.ticker as "sellTicker", et."purchaseCurrencyAmount"/10^c2.decimals as "purchaseAmount", c2.ticker as "purchaseTicker", extract(epoch from et."createdAt") as timestamp from exchange_transactions et, currencies c, currencies c2 where et."userId"=$1 and et."sellCurrencyId"=c.id and et."purchaseCurrencyId"=c2.id and et."createdAt"<$2', [userId, end.format('YYYY-MM-DD HH:mm:ss')])
      swaps.rows.forEach(row => {
        const tran = {
          type: 'swap',
          amount: row.sellAmount,
          purchaseAmount: row.purchaseAmount,
          ticker: row.sellTicker,
          purchaseTicker: row.purchaseTicker,
          timestamp: row.timestamp
        }
        walletTrans.push({...tran})
      })

      const rewards = await db.query('select sum(r.amount)/10^c.decimals as amount, c.ticker as ticker, r."planId" as "planId", date_trunc($2, r."createdAt") as timestamp from rewards r, currencies c where r."userId"=$1 and r."currencyId"=c.id and r."createdAt" < $3 group by timestamp, ticker, "planId", c.decimals', [userId, 'day', end.format('YYYY-MM-DD HH:mm:ss')])
      rewards.rows.forEach(row => {
        const timestamp = parseFloat(moment(row.timestamp).endOf('day').format('x'))/1000.00
        const tran = {
          type: 'reward',
          amount: row.amount,
          ticker: row.ticker,
          timestamp: timestamp,
        }
        if (row.planId == 2) {
          walletTrans.push({...tran})
        } else {
          IWTrans.push({...tran})
        }

      })

      const investments = await db.query('select i.amount/10^c.decimals as amount, c.ticker, extract(epoch from i."createdAt") as timestamp from investments i, currencies c where i."planId"=1 and i."userId"=$1 and i."currencyId"=c.id and i.type=$2 and i."createdAt" < $3' , [userId, 'enter', end.format('YYYY-MM-DD HH:mm:ss')])
      investments.rows.forEach(row => {
        const tran = {
          type: 'investment',
          amount: row.amount,
          ticker: row.ticker,
          timestamp: row.timestamp,
        }
        walletTrans.push({...tran})
        IWTrans.push({...tran})
      })

      const redemptions = await db.query('select r.amount/10^c.decimals as amount, c.ticker, extract(epoch from r."createdAt") as timestamp from redemptions r, currencies c where r."userId"=$1 and r."currencyId"=c.id and r."planId"=1 and r."createdAt"<$2', [userId, end.format('YYYY-MM-DD HH:mm:ss')])
      redemptions.rows.forEach(row => {
        const tran = {
          type: 'unstake',
          amount: row.amount,
          ticker: row.ticker,
          timestamp: row.timestamp,
        }
        walletTrans.push({...tran})
        IWTrans.push({...tran})
      })

      const redeemedRewards = await db.query('select data, extract(epoch from "createdAt") as timestamp from user_actions where "userId"=$1 and type=$2 and "createdAt"<$3', [userId, 'redeemedRewards', end.format('YYYY-MM-DD HH:mm:ss')])
      redeemedRewards.rows.forEach(row => {
        let ticker = ''
        let decimals = 0
        switch (row.data.wallet.currencyId) {
          case 1: ticker = 'YLD'; decimals = 18; break;
          case 2: ticker = 'USDT'; decimals = 6; break;
          case 3: ticker = 'USDC'; decimals = 6; break;
          case 4: ticker = 'ETH'; decimals = 18; break;
          case 5: ticker = 'BTC'; decimals = 8; break;
          default: break;
        }
        const amt = BigNumber(row.data.redemptionAmount).div(BigNumber(10).pow(decimals)).toNumber()
        const tran = {
          type: 'redeem',
          amount: amt,
          ticker: ticker,
          timestamp: row.timestamp,
        }
        walletTrans.push({...tran})
        IWTrans.push({...tran})
      })

      if (typeof btcFix[userId.toString()] !== 'undefined') {
        const fix = btcFix[userId.toString()]
        const _ts = moment.tz(fix.timestamp, 'utc').valueOf()/1000
        const _tran = {
          type: 'redeem',
          amount: fix.amount,
          ticker: 'BTC',
          timestamp: _ts
        }
        walletTrans.push({..._tran})
        IWTrans.push({..._tran})
      }

    
      const _prices = await db.query('select c.ticker as ticker, cp.price as price, c.decimals as decimals from currency_prices cp, currencies c where cp."currencyId"=c.id')
      _prices.rows.forEach(row => {prices[row.ticker] = { price: row.price, decimals: row.decimals}})
    } catch(e) {
      console.error(e)
    } finally {
      db.end()
    }

    walletTrans.sort((a, b) => {
      return a.timestamp < b.timestamp ? -1 : 1
    })
    IWTrans.sort((a, b) => {
      return a.timestamp < b.timestamp ? -1 : 1
    })

  const walletValues = {
    YLD: 0,
    USDT: 0,
    USDC: 0,
    ETH: 0,
    BTC: 0
  }

  const walletUSDValues = {
    YLD: 0,
    USDT: 0,
    USDC: 0,
    ETH: 0,
    BTC: 0
  }

  const IWValues = {
    YLD: 0,
    USDT: 0,
    USDC: 0,
    ETH: 0,
    BTC: 0
  }

  if (walletTrans.length === 0) {
    process.exit(5)
  }
  if (!start) {
    if (walletTrans[0].timestamp) {
      start = moment(parseInt(walletTrans[0].timestamp) * 1000).startOf('month')
    } else {
      start = moment(0)
    }
  }
  let html = `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        @media print {
          html, body {
            height: 8.5in;
            width: 11in;
            padding: 10px;
          }
        }
        body {
          display: flex;
          flex-direction: column;
          font-family: sans_serif, arial, helvetica;
          -webkit-print-color-adjust: exact !important;
        }
        .header {
          font-weight: bold;
        }
        .leftb {
          border-left: 1px solid #000;
        }
        .zero {
          text-align: center;
        }
        th {
          min-width: 100px;
          text-align: center;
        /*
          text-align: left;
        */
        }
        td {
          font-size: 10pt;
          padding: 5px;
        }
        #header {
          display: flex;
          flex: 1;
          flex-direction: row;
          justify-content: space-between;
        }
        #subheader {
          margin-top:50px;
          flex:3;
        }
        #data {
          /*
          display:flex;
          justify-content: center;
          */
          flex: 6;
        }
        #footer {
          flex: 2
                  display: flex;
          align-items: flex-end;
          text-align: center;
        }
        .altrow {
          background-color: #0000ff10;
        }
      </style>
    </head>
    <body>
      <div id="header">
        <div>
          <svg width="157px" height="55px" viewBox="0 0 157 55" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
              <title>Group 10</title>
              <defs>
                  <pattern id="pattern-1" width="1" height="1" x="-1" y="-1" patternUnits="userSpaceOnUse">
                      <use xlink:href="#image-2"></use>
                  </pattern>
                  <image id="image-2" width="1" height="1" xlink:href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAABGdBTUEAALGOfPtRkwAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAAC0lEQVQIHWNgAAIAAAUAAY27m/MAAAAASUVORK5CYII="></image>
                  <pattern id="pattern-3" width="1" height="1" x="16.5652174" y="11.9398907" patternUnits="userSpaceOnUse">
                      <use xlink:href="#image-4"></use>
                  </pattern>
                  <image id="image-4" width="1" height="1" xlink:href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAABGdBTUEAALGOfPtRkwAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAAC0lEQVQIHWNgAAIAAAUAAY27m/MAAAAASUVORK5CYII="></image>
              </defs>
              <g id="Web-App-Desktop" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
                  <g id="V4-F" transform="translate(-36.000000, -24.000000)" fill-rule="nonzero">
                      <g id="Group-10" transform="translate(36.000000, 24.000000)">
                          <g id="texture4" fill="#0F367F">
                              <ellipse id="Oval" cx="27.2335281" cy="27.4703175" rx="27.2335281" ry="27.4703175"></ellipse>
                              <path d="M72.6406284,39.8095238 L66.9889746,39.8095238 L66.9889746,30.7301587 L57.7991951,14.0677778 L64.5500221,14.0677778 L69.9160639,24.9909524 L75.4223153,14.0677778 L81.8044432,14.0677778 L72.6406284,30.7301587 L72.6406284,39.8095238 Z M83.9023925,14.0677778 L89.5540463,14.0677778 L89.5540463,39.8095238 L83.9023925,39.8095238 L83.9023925,14.0677778 Z M93.644355,14.0677778 L111.438842,14.0677778 L111.438842,19.031746 L99.2960088,19.031746 L99.2960088,24.4444444 L109.616119,24.4444444 L109.616119,29.4084127 L99.2960088,29.4084127 L99.2960088,34.8525397 L111.438842,34.8525397 L111.438842,39.8095238 L93.646086,39.8095238 L93.644355,14.0677778 Z M115.08602,14.0677778 L120.737674,14.0677778 L120.737674,34.8455556 L132.880507,34.8455556 L132.880507,39.8095238 L115.08602,39.8095238 L115.08602,14.0677778 Z M156.85806,30.4804762 C156.85806,36.6596825 152.847376,39.8234921 146.64527,39.8234921 L136.512106,39.8234921 L136.512106,14.0677778 L146.724895,14.0677778 C152.850838,14.0677778 156.861521,17.2315873 156.861521,23.4107937 L156.85806,30.4804762 Z M151.206406,23.4195238 C151.206406,20.512381 149.420033,19.0422222 146.721433,19.0422222 L142.16376,19.0422222 L142.16376,34.8577778 L146.648732,34.8577778 C149.418302,34.8577778 151.206406,33.387619 151.206406,30.4804762 L151.206406,23.4195238 Z" id="Shape"></path>
                          </g>
                          <g id="Group-9" transform="translate(10.000000, 11.000000)">
                              <rect id="Rectangle" fill="url(#pattern-1)" x="0" y="0" width="18.6086957" height="19.0601093"></rect>
                              <polygon id="Path" fill="#FFFFFF" points="22.6086957 23.775575 19.6173091 13.8831509 17.4899396 6.81967213 13.3913043 8.04974297 14.992277 13.3208794 15.8544788 16.1850007 16.9272394 19.7343281 18.5282121 25.0054645"></polygon>
                              <path d="M34.0869565,1.79725814 C34.0869565,1.79725814 31.7245606,0.776700902 26.7017602,5.22883647 L14.3443347,16.2622951 L12,12.6899816 L23.4977157,2.28992216 C29.1165334,-2.1622134 34.0869565,1.79725814 34.0869565,1.79725814 Z" id="Path" fill="#FFFFFF"></path>
                              <rect id="Rectangle" fill="url(#pattern-3)" x="17.5652174" y="12.9398907" width="18.4347826" height="19.0601093"></rect>
                              <path d="M1.91304348,30.0278785 C1.91304348,30.0278785 4.27640706,31.0486173 9.29896104,26.5964817 L21.6539742,15.5628415 L24,19.1351551 L12.4847882,29.5352144 C6.88430636,33.98735 1.91304348,30.0278785 1.91304348,30.0278785 Z" id="Path" fill="#FFFFFF"></path>
                              <polygon id="Path" fill="#FFFFFF" points="17.7391304 7.57874593 14.2211118 10.6666667 13.3913043 8.02735427 17.5093376 6.81967213"></polygon>
                              <polygon id="Path" fill="#FFFFFF" points="15.4782609 15.3283579 19.0309308 12.2404372 19.826087 14.8797496 15.7262912 16.0874317"></polygon>
                              <polygon id="Path" fill="#FFFFFF" points="20.5217391 16.6682501 16.9873067 19.7595628 16.173913 17.1148538 20.2737088 15.9125683"></polygon>
                              <polygon id="Path" fill="#FFFFFF" points="18.2608696 24.2465687 21.795302 21.1584699 22.6086957 23.7979604 18.5088999 25.0054645"></polygon>
                              <path d="M12.2273758,12.5983714 C11.5108629,13.1801986 10.3424787,13.7443781 9.36492456,13.7443781 C7.02815616,13.7443781 5.12705644,11.8227838 5.12705644,9.46017965 C5.12705644,7.09775747 7.02815616,5.17598116 9.36492456,5.17598116 C11.3362354,5.17598116 12.5586281,6.09275015 13.4137629,8.1027648 L17.5652174,7.15070047 C17.0071294,5.33481016 15.1060297,0.87431694 9.34872201,0.87431694 C4.67338491,0.87431694 0.869565217,4.71768763 0.869565217,9.44253198 C0.869565217,14.1852059 4.67338491,18.010929 9.34872201,18.010929 C11.1976135,18.010929 12.9240857,17.411636 14.3211059,16.388981 L12.2273758,12.5983714 Z" id="Path" fill="#FFFFFF"></path>
                              <path d="M23.7725666,19.4015711 C24.4890718,18.8197501 25.6574434,18.2555766 26.634987,18.2555766 C28.9717302,18.2555766 30.8728094,20.1771505 30.8728094,22.5397296 C30.8728094,24.9021267 28.9717302,26.8238826 26.634987,26.8238826 C24.6636975,26.8238826 23.4413179,25.9071233 22.5861923,23.89713 L18.4347826,24.8491842 C18.9928646,26.6650553 20.8939438,31.1256831 26.6511894,31.1256831 C31.3264761,31.1256831 35.1304348,27.2821712 35.1304348,22.557377 C35.1304348,17.8147534 31.3264761,13.989071 26.6511894,13.989071 C24.8023178,13.989071 23.0758643,14.5883576 21.6788591,15.6110017 L23.7725666,19.4015711 Z" id="Path" fill="#FFFFFF"></path>
                          </g>
                      </g>
                  </g>
              </g>
          </svg>
        </div>
        <div>
          Yield App Limited<br />
          F2-04, Oceanic House<br />
          Providence Estate<br />
          Mahe Seychelles<br />
          224887<br />
        </div>
      </div>
      <div>
        <h2>CONFIDENTIAL</h2>
      </div>
      <div id="subheader">
        <p>Account statement generated on ${moment().format('DDMMMYY HH:mm:ss').toUpperCase()}</p>
        <p>Statement period: ${start.format('DDMMMYY').toUpperCase()} - ${end.subtract(1,'day').format('DDMMMYY').toUpperCase()}</p>
        <p>Account ID: ${userId}</p>
        <p>${user.firstName ?? ''} ${user.middleName ?? ''} ${user.lastName ?? ''}</p>
      </div>
      <div id="data">
  `
  let count = 0
  end.add(1, 'day')
  let runningMonth = ''
  let cursorMonth = ''
  const currencies = [
    'YLD',
    'USDT',
    'USDC',
    'ETH',
    'BTC'
  ]
  let validBalances = true
  const walletCloseMonthly = {}
  const IWalletCloseMonthly = {}
  const timestampFormat = opts.notime ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss'
  walletTrans.forEach((trans, idx) => {
    const now = moment(parseInt(trans.timestamp)*1000)
    cursorMonth = now.format('YYYY-MMMM')
    if (now.isSameOrAfter(start) && now.isBefore(end)) {
      if (trans.type === 'swap') {
        walletValues[trans.purchaseTicker] += trans.purchaseAmount
      }

      // end of month, show closing balance
      if (runningMonth !== cursorMonth) {
        if (runningMonth) {
          html += `
            <tr>
              <td colSpan="6">Closing Balance</td>
              `
          const closingBalances = RenderRowBalances(walletValues, currencies, trans, now.subtract(1, 'day') ,false)
          if (validBalances) {
            validBalances = CheckForNegative(walletValues)          
          }
          walletCloseMonthly[now.format('MM/DD/YYYY')] = closingBalances
          html += closingBalances
          html += `</tr></table></div>`
        }
        runningMonth = cursorMonth
        count = 0
        html += `
        <div><h3>${runningMonth} (Wallet)</h3>
          <table>
						 <tr>
								<th colspan="6">&nbsp;</th>
								<th colspan="5">Ledger Balance</th>
								<th colspan="5">USD Ledger Balance</th>
							</tr>
							<tr>
								<th>Timestamp</th>
								<th>Transaction</th>
								<th>Amount</th>
								<th>Amount USD</th>
								<th>Currency</th>
								<th>USD Rate</th>
        `
        currencies.forEach(currency => {
          html += `<th>${currency}</th>`
        })
        currencies.forEach(currency => {
          html += `<th>${currency}</th>`
        })
        html += `</tr>`
      }
			const transTime = moment.tz(parseInt(trans.timestamp) * 1000, 'utc')
      const currPrice = (trans.ticker !== 'USDC' && trans.ticker !== 'USDT') ? GetPrice(trans.ticker, transTime.format('MMM DD, YYYY')).toFixed(2) : '1.00'
      walletValues[trans.ticker] += (trans.type === 'deposit' || trans.type === 'unstake' || trans.type === 'redeem' || trans.type === 'reward') ? trans.amount : -1 * trans.amount

      /*
      // redemption btc fix
      if (trans.ticker === 'BTC' && walletValues['BTC'] < -0.0001) {

        walletValues['BTC'] += walletTrans[idx - 1].amount
        btcAdjust[transTime.format(timestampFormat)] = walletTrans[idx - 1].amount
        html += count%2 ? `<tr class="altrow">` : `<tr>`
        html += `
          <td>${transTime.format(timestampFormat)}</td>
          <td>REDEEM</td>
          <td>${walletTrans[idx - 1].amount.toFixed(4)}</td>
          <td>${(walletTrans[idx - 1].amount * GetPrice(trans.ticker, transTime.format('MMM DD, YYYY'))).toFixed(2)}</td>
          <td>${trans.ticker}</td>
          <td>${currPrice}</td>
        `
        html += RenderRowBalances(walletValues, currencies, trans, now, zero)
        html += `</tr>`
        count++
      }
      */
      html += count%2 ? `<tr class="altrow">` : `<tr>`
      html += `
				<td>${transTime.format(timestampFormat)}</td>
				<td>${trans.type.toUpperCase()}</td>
				<td>${trans.amount.toFixed(4)}</td>
				<td>${(trans.amount * GetPrice(trans.ticker, transTime.format('MMM DD, YYYY'))).toFixed(2)}</td>
				<td>${trans.ticker}</td>
				<td>${currPrice}</td>
			`
      html += RenderRowBalances(walletValues, currencies, trans, now, zero)
      count++

      // handle fee
      if (typeof trans.fee !== 'undefined') {
        html += count%2 ? `<tr class="altrow">` : `<tr>`
        walletValues[trans.ticker] -= trans.fee
        html += `
					<td>${moment.tz(parseInt(trans.timestamp)*1000, 'utc').format(timestampFormat)}</td>
					<td>${trans.type.toUpperCase()} - FEE</td>
					<td>${trans.fee}</td>
					<td>${trans.fee * GetPrice(trans.ticker, transTime.format('MMM DD, YYYY')).toFixed(2)}</td>
					<td>${trans.ticker}</td>
					<td>${GetPrice(trans.ticker, transTime.format('MMM DD, YYYY')).toFixed(2)}</td>
          `
        html += RenderRowBalances(walletValues, currencies, trans, now, zero)
        count++
      }
      html += `</tr>`
    }
  })
  html += `<tr>`
  html += `<td colSpan="6">Closing Balance</td>`
  let last = walletTrans[walletTrans.length - 1]
  let lastTime = moment.tz(parseInt(last.timestamp) * 1000, 'utc')
  let closingBalances = RenderRowBalances(walletValues, currencies, last, lastTime, false)
  walletCloseMonthly[lastTime.format('MM/DD/YYYY')] = closingBalances
  html += closingBalances
  html += `</tr>`
  html += `</table></div>`


  const walletUSD = {
    YLD: walletValues.YLD * prices.YLD.price/100.0,
    USDT: walletValues.USDT,
    USDC: walletValues.USDC,
    ETH: walletValues.ETH * prices.ETH.price/100.0,
    BTC: walletValues.BTC * prices.BTC.price/100.0,
  }

  // investment wallet
  html += `<h2>Portfolio</h2>`
  count = 0
  runningMonth = ''
  cursorMonth = ''
  if (IWTrans.length > 0) {
  IWTrans.forEach(trans => {
    const now = moment(parseInt(trans.timestamp)*1000)
    cursorMonth = now.format('YYYY-MMMM')
    if (now.isSameOrAfter(start) && now.isBefore(end)) {
      if (runningMonth !== cursorMonth) {
        if (runningMonth) {
          html += `
            <tr>
              <td colSpan="6">Closing Balance</td>
          `
          const closingBalances = RenderRowBalances(IWValues, currencies, trans, now.subtract(1, 'day'), false)
          IWalletCloseMonthly[now.format('MM/DD/YYYY')] = closingBalances
          html += closingBalances
          html += `</table></div>`
        }
        runningMonth = cursorMonth
        count = 0

        // header
        html += `<div><h3>${runningMonth}</h3><table>
								 <tr>
										<th colspan="6">&nbsp;</th>
										<th colspan="5">Ledger Balance</th>
										<th colspan="5">USD Ledger Balance</th>
									</tr>
									<tr>
										<th>Timestamp</th>
										<th>Transaction</th>
										<th>Amount</th>
										<th>Amount USD</th>
										<th>Currency</th>
										<th>USD Rate</th>
        `
        currencies.forEach(currency => {
          html += `<th>${currency}</th>`
        })
        currencies.forEach(currency => {
          html += `<th>${currency}</th>`
        })
				html += `</tr>`
      }
      IWValues[trans.ticker] += (trans.type === 'investment' || trans.type === 'reward') ? trans.amount : -1 * trans.amount
      html += count%2 ? `<tr class="altrow">` : `<tr>`
			const transTime = moment.tz(parseInt(trans.timestamp) * 1000, 'utc')
      const currPrice = (trans.ticker !== 'USDC' && trans.ticker !== 'USDT') ? GetPrice(trans.ticker, transTime.format('MMM DD, YYYY')).toFixed(2) : '1.00'
      html += `
				<td>${transTime.format('YYYY-MM-DD')}</td>
				<td>${trans.type.toUpperCase()}</td>
				<td>${trans.amount.toFixed(4)}</td>
				<td>${(trans.amount * GetPrice(trans.ticker, transTime.format('MMM DD, YYYY'))).toFixed(2)}</td>
				<td>${trans.ticker}</td>
				<td>${currPrice}</td>
			`
      html += RenderRowBalances(IWValues, currencies, trans, now, zero)
      html += `</tr>`
      count++
    }
  })
  const IWUSD = {
    YLD: IWValues.YLD * prices.YLD.price/100.0,
    USDT: IWValues.USDT,
    USDC: IWValues.USDC,
    ETH: IWValues.ETH * prices.ETH.price/100.0,
    BTC: IWValues.BTC * prices.BTC.price/100.0,
  }
  html += `
    <tr>
      <td colSpan="6">Closing Balance</td>
  `
  last = IWTrans[IWTrans.length - 1]
  lastTime = moment.tz(parseInt(last.timestamp) * 1000, 'utc')
  closingBalances = RenderRowBalances(IWValues, currencies, last, lastTime, false)
  IWalletCloseMonthly[lastTime.format('MM/DD/YYYY')] = closingBalances
  html += closingBalances

  html += `
        </table>
      </div>
  `
  }

  html += `<div style="margin-top: 30px;">`
  html += `<h3>Monthly Summary</h3>`
  html += `</div>`
  html += `<div>`
  html += `<h4>Wallet</h4>`
  html += RenderMonthlyClose(walletCloseMonthly, currencies)
  html += `</div>`
  html += `<div style="margin-top: 10px;">`
  html += `<h4>Investment Wallet (Closing Balances)</h4>`
  html += RenderMonthlyClose(IWalletCloseMonthly, currencies)
  html += `</div>`

  html += `
    </body>
  </html>
  `

  console.log(html)
  if (validBalances) {
    process.exit(0)
  } else {
    process.exit(2)
  }
  })()
}
