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
  .option('-n, --notime', 'End Date')
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
  let csv = ''

  // ledger balances
  currencies.forEach((currency, idx) => {
    if (zero) {
      if ((currency === trans.ticker) || (trans.type === 'swap' && currency === 'YLD')) {
        let amt = walletValues[currency]
        csv += ',' + amt
      } else {
        csv += ',' + zero

      }
    } else {
      let amt = walletValues[currency]
      csv += ',' + amt
    }
  })

	// ledger usd balances
  currencies.forEach((currency, idx) => {
    if (zero) {
      if ((currency === trans.ticker) || (trans.type === 'swap' && currency === 'YLD')) {
        let amt = (walletValues[currency] * GetPrice(currency, now.format('MMM DD, YYYY')))
        csv += ',' + amt
      } else {
        csv += ',' + zero
      }
    } else {
			let amt = (walletValues[currency] * GetPrice(currency, now.format('MMM DD, YYYY')))
      csv += ',' + amt
    }
  })
  csv += '\n'
  return csv
}

const RenderMonthlyClose = (monthly = {}, currencies = []) => {
  let csv = '"Month"'
  currencies.forEach(currency => {
    csv += `,"${currency}"`
  })
  currencies.forEach(currency => {
    csv += `,"${currency}"`
  })

  csv += '\n'

  Object.keys(monthly).forEach((month, idx) => {
    csv += `"${month}"`
    csv += monthly[month]
  })
  return csv
}

const CheckForNegative = trans => {
  let pass = true
  Object.keys(trans).forEach(ticker => {
    if (parseFloat(trans[ticker].toFixed(4)) < -0.01) {
      console.error('(ERR) Negative Balance: ',trans[ticker], ticker)
      pass = false
    }
  })
  return pass
}

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

  const IWTrans = [] // investment wallet transactions
  const prices = {}
  const rewards1 = []
  const rewards2 = []

  let user = {}
  ;(async () => {
    try {
      user = (await (db.query('select * from users where id=$1', [userId]))).rows[0]

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
        IWTrans.push({..._tran})
      }

    
      const _prices = await db.query('select c.ticker as ticker, cp.price as price, c.decimals as decimals from currency_prices cp, currencies c where cp."currencyId"=c.id')
      _prices.rows.forEach(row => {prices[row.ticker] = { price: row.price, decimals: row.decimals}})
    } catch(e) {
      console.error(e)
    } finally {
      db.end()
    }

    IWTrans.sort((a, b) => {
      return a.timestamp < b.timestamp ? -1 : 1
    })

  const IWValues = {
    YLD: 0,
    USDT: 0,
    USDC: 0,
    ETH: 0,
    BTC: 0
  }

  if (IWTrans.length === 0) {
    process.exit(5)
  }
  if (!start) {
    if (IWTrans[0].timestamp) {
      start = moment(parseInt(IWTrans[0].timestamp) * 1000).startOf('month')
    } else {
      start = moment(0)
    }
  }

  // investment wallet
  runningMonth = ''
  cursorMonth = ''
  const currencies = [
    'YLD',
    'USDT',
    'USDC',
    'ETH',
    'BTC'
  ]
  let validBalances = true
  const IWalletCloseMonthly = []
  const timestampFormat = opts.notime ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss'
  IWTrans.forEach((trans, idx) => {
    const now = moment(parseInt(trans.timestamp)*1000)
    cursorMonth = now.format('YYYY-MMMM')
    if (now.isSameOrAfter(start) && now.isBefore(end)) {
      if (runningMonth !== cursorMonth) {
        if (runningMonth) {
          const closingBalances = RenderRowBalances(IWValues, currencies, trans, now.subtract(1, 'day'), false)
          if (validBalances) {
            validBalances = CheckForNegative(IWValues)          
          }
          const prev = moment(parseInt(IWTrans[idx - 1].timestamp) * 1000)
          IWalletCloseMonthly[prev.endOf('month').format('MM/DD/YYYY')] = closingBalances
        }
        runningMonth = cursorMonth
      }
      IWValues[trans.ticker] += (trans.type === 'investment' || trans.type === 'reward') ? trans.amount : -1 * trans.amount
    }
  })
  last = IWTrans[IWTrans.length - 1]
  lastTime = moment.tz(parseInt(last.timestamp) * 1000, 'utc')
  closingBalances = RenderRowBalances(IWValues, currencies, last, lastTime, false)
  IWalletCloseMonthly[lastTime.format('MM/DD/YYYY')] = closingBalances
  let csv = RenderMonthlyClose(IWalletCloseMonthly, currencies)
  console.log(csv)
  if (validBalances) {
    process.exit(0)
  } else {
    process.exit(2)
  }
  })()
}
