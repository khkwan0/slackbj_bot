const {App} = require('@slack/bolt')
const {createClient} = require('redis')

const redisClient = createClient({url: process.env.REDIS_HOST})
;(async () => {
  await redisClient.connect()
  console.log("Redis HOST: " +  process.env.REDIS_HOST)
  console.log("Redis is: " + redisClient.isReady ? "Up": "Down")
})()

let quiet = false

const app = new App({
  token: process.env.SLACK_OAUTH_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
})

app.message(/^(hello|hey|sup|howdy|yo|yoyo|yoyoyo).*/, async ({message, say}) => {
  if (message.type === 'message') {
    if (!quiet) {
      /*
      await say({
        blocks: [{
          "type": "section",
          "text": {
            "type": "mrkdwn",
            "text": "Pick a date for me to remind you"
          },
          "accessory": {
            "type": "datepicker",
            "action_id": "datepicker_remind",
            "initial_date": "2019-04-28",
            "placeholder": {
              "type": "plain_text",
              "text": "Select a date"
            }
          }
        }]
      });
    }
    */
      await say(`Hello, ${message.user}`)
    }
  }
})

const bets = []
const dealt = []
const dealerCards = []
let timer = null
const maxTimeRemaining = 2
let timeRemaining = maxTimeRemaining
let countdown = false
let inGame = false
const numDecks = 1
const maxPlayers = 7
const reservedChannel='C054X464D4J'
let currentPlayerIdx = -1

async function GetUser(id) {
  return await app.client.users.profile.get({token: process.env.SLACK_USER_TOKEN, user: id})
}

async function SendChannelBlock(text, channel='C054X464D4J') {
  const block = [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": text,
      }
    }
  ]
  await app.client.chat.postMessage({token: process.env.SLACK_OAUTH_TOKEN, channel: channel, blocks: block, text: text})
}
async function SendChannel(text, channel='C054X464D4J') {
  await app.client.chat.postMessage({token: process.env.SLACK_OAUTH_TOKEN, channel: channel, text: text})
}

function GetSuit(cardNumber) {
  let suit = ''
  const rawSuit = cardNumber % 4
  if (rawSuit === 0) {
    suit = '\u2661'
  }
  if (rawSuit === 1) {
    suit = '\u2667'
  }
  if (rawSuit === 2) {
    suit = '\u2662'
  }
  if (rawSuit === 3) {
    suit = '\u2664'
  }
  return suit
}

function GetCard() {
  let face = ''
  let value = 0

  rawCard = GetRawCard()
  while (dealt.includes(rawCard)) {
    console.log('redraw')
    rawCard = GetRawCard()
  }
  dealt.push(rawCard)
  const cardNumber = rawCard % 52 % 13

  if (cardNumber < 9) {
    face = (cardNumber + 2).toString()
    value = cardNumber + 2
  } else if (cardNumber < 12) {
    if (cardNumber === 9) {
      face = 'J'
    } else if (cardNumber === 10) {
      face = 'Q'
    } else {
      face = 'K'
    }
    value = 10
  } else {
    face = 'A'
    value = 11
  }
  const suit = GetSuit(cardNumber)
  face += suit
  return {face, value}
}

function GetRawCard() {
  return Math.floor(Math.random() * 52 * numDecks)
}

function SetValues(playerIdx) {
  const total = GetCardTotals(bets[playerIdx].cards)
  let totalDisplay = 0
  let tempValue = 0
  if (total.total1 === 21 || total.total2 === 21) {
    tempValue = 21
    totalDisplay = 21
  } else if (total.total1 === total.total2) {
    totalDisplay = total.total1
    tempValue = total.total1
  } else if (total.total1 > 21 || total.total2 > 21) {
    totalDisplay = total.total1 < total.total2 ? total.total1 : total.total2
    tempValue = totalDisplay
  } else if (total.total2 < 21 && total.total2 < 21) {
    totalDisplay = total.total1 + ' or ' + total.total2
    tempValue = total.total1 > total.total2 ? total.total1 : total.total2
  }
  bets[playerIdx].tempValue = tempValue
  return {tempValue, totalDisplay}
}

async function DealNew() {
  let i = 0
  while (i < bets.length) {
    const card1 = GetCard()
    const card2 = GetCard()
    bets[i].cards = [card1, card2]
    const total = GetCardTotals(bets[i].cards)
    const {tempValue, totalDisplay} = SetValues(i)
    await SendChannelBlock(`${bets[i].name} got dealt: ${card1.face} ${card2.face}`)
    if (tempValue === 21) {
      await SendChannelBlock(`BLACKJACK! WOOHOO!`)
    }
    i++
  }
  const dealerCard1 = GetCard()
  const dealerCard2 = GetCard()
  dealerCards.push(dealerCard1)
  dealerCards.push(dealerCard2)
  await SendChannelBlock(`Dealer shows : ${dealerCard1.face} \ud83c\udca0`)
  const dealerTotal = GetCardTotals(dealerCards)
  let endRound = false
  if (dealerTotal.total1 === 21 || dealerTotal.total2 === 21) {
    await SendChannelBlock(`Dealer has BLACKJACK: ${dealerCard1.face} ${dealerCard2.face}`)
    endRound = true
    let j = 0
    while (j < bets.length) {
      if (bets[j].tempValue < 21) {
        await SendChannelBlock(`${bets[j].name} LOSES ${bets[j].amt} dollars.`)
        await redisClient.INCRBY('dealer', bets[j].amt)
      } else {
        await SendChannelBlock(`${bets[j].name} pushes.`)
      }
      j++
    }
  }
  return endRound
}

function GetCardTotals(cards = []) {
  let i = 0
  let total1 = 0
  let total2 = 0
  while (i < cards.length) {
    const value = cards[i].value
    if (value === 11) {
      total1 += value
      total2 += 1
      if (total1 > 21) {
        total1 -= 10
      }
    } else {
      total1 += value
      total2 += value
    }
    i++
  }
  return {total1, total2}
}

async function DealerTurn() {
  let cards = ''
  let hasAce = false
  let total = 0
  dealerCards.forEach(card => {
    if (card.value === 11) {
      hasAce = true
    }
    cards += card.face + ' '
    total += card.value
  })
  if (total > 21 && hasAce) {
    total -= 10
  }
  const text = `Dealer shows: ${cards} total = ${total}`
  await SendChannelBlock(text)
  let mustHit = false
  if (total < 17) {
    mustHit = true 
  } else if (total === 17 && hasAce) {
    mustHit = true
  }
  while (mustHit) {
    const newCard = GetCard()
    cards += newCard.face
    total += newCard.value
    const text = `Dealer shows: ${cards} total = ${total}`
    await SendChannelBlock(text)
    mustHit = false
    if (total < 17) {
      mustHit = true 
    } else if (total === 17 && hasAce) {
      mustHit = true
    }
  }
  if (total > 21) {
    let i = 0
    await SendChannelBlock(`Dealer BUSTS`)
    while (i < bets.length) {
      if (bets[i].tempValue <= 21) {
        if ((bets[i].cards.length === 2) && (bets[i].tempValue === 21)) {
          const key = bets[i].uid
          const winnings = bets[i].amt * 2 + bets[i].amt
          await SendChannelBlock(`${name} got BLACKJACK and WON ${winnings} dollars.`)
          await redisClient.INCRBY(key, winnings)
          await redisClient.DECRBY('dealer', winnings)
        } else {
          const amt = bets[i].amt
          const key = bets[i].uid
          const name = bets[i].name
          await SendChannelBlock(`${name} WON ${amt} dollars.`)
          await redisClient.INCRBY(key, amt * 2)
        }
      } else {
        const amt = bets[i].amt
        redisClient.INCRBY('dealer', amt)
      }
      i++
    }
  } else {
    let i = 0
    while (i < bets.length) {
      const key = bets[i].uid
      const amt = bets[i].amt
      const name = bets[i].name
      if (bets[i].tempValue <= 21 && total < bets[i].tempValue) {

        // dealer loses by value
        await SendChannelBlock(`${name} WON ${amt} dollars.`)
        await redisClient.INCRBY(key, amt * 2)
        await redisClient.DECRBY('dealer', amt)
      } else if (bets[i].tempValue === total) {
        await SendChannelBlock(`${name} pushed`)
        await redisClient.INCRBY(key, amt)
      } else {
        await SendChannelBlock(`${name} LOST ${amt} dollars.`)
        await redisClient.INCRBY('dealer', amt)
      }
      i++
    }
  }
  EndRound()
}

async function EndRound() {
  inGame = false
  bets.length = 0
  dealerCards.length = 0
  dealt.length = 0
  await SendChannelBlock(`Betting is OPEN`)
}

async function NextPlayer() {
  currentPlayerIdx++
  if (currentPlayerIdx >= bets.length) {
    currentPlayerIdx = -1 // the dealer
    await SendChannelBlock("Dealer's turn.")
    await DealerTurn()
  } else {
    if (bets[currentPlayerIdx].tempValue === 21) {
      // player has blackjack on the deal already...next...
      NextPlayer()
    } else {
      const name = bets[currentPlayerIdx].name
      const total = GetCardTotals(bets[currentPlayerIdx].cards)
      let cards = ''
      bets[currentPlayerIdx].cards.forEach(card => {
        cards += card.face + ' '
      })
      if (total.total1 === 21 || total.total2 === 21) {
        await SendChannelBlock(`${name} has BLACKJACK!`)
        bets[currentPlayerIdx].tempValue = 21
        NextPlayer()
      } else if (total.total1 === total.total2) {
        let status = `"hit" or "stay"`
        if (bets[currentPlayerIdx].cards.length === 2) {
          status += ` "double"`
        }
        await SendChannelBlock(`${name}'s turn ${cards} = ${total.total1}, ${status}`)
      } else {
        let status = `"hit" or "stay"`
        if (bets[currentPlayerIdx].cards.length === 2) {
          status += ` "double"`
        }
        await SendChannelBlock(`${name}'s turn: ${total.total1} or ${total.total2}, ${status}`)
      }
    }
  }
}

async function HandleHit(_double = false) {
  const newCard = GetCard()
  bets[currentPlayerIdx].cards.push(newCard)
  let cards = ''
  bets[currentPlayerIdx].cards.forEach(card => {
    cards += card.face + ' '
  })
  const {tempValue, totalDisplay} = SetValues(currentPlayerIdx)
  if (_double) {
    await SendChannelBlock(`${bets[currentPlayerIdx].name} DOUBLES`)
  }
  let status = ''
  if (!_double && tempValue !== 21) {
    status = '"hit" or "stay"'
  }
  if (tempValue > 21) {
    status = 'BUST'
  }
  await SendChannelBlock(`${bets[currentPlayerIdx].name} has: ${cards} = ${totalDisplay} ${status}`)
  if (tempValue >= 21 || _double) {
    NextPlayer()
  }
}

async function HandleStay() {
  NextPlayer()
}

async function Play() {
  const endRound = await DealNew()
  if (endRound) {
    EndRound()
  } else {
    inGame = true
    currentPlayerIdx = -1
    NextPlayer()
  }
}

async function tick() {
  timeRemaining--
  if (timeRemaining > 0) {
    const text = `Bets close in ${timeRemaining} seconds.`
    await SendChannelBlock(text)
    setTimeout(tick, 1000)
  } else {
    countdown = false
    await SendChannelBlock("Bets closed.  Good luck!")
    await Play()
  }
}

app.message('bet', async({message, say}) => {
  if (typeof message.channel !== 'undefined' && message.channel === reservedChannel) {
    if (!inGame) {
      console.log(message)
      const user = await GetUser(message.user)
      const msg = message.text
      const parts = msg.split(' ')
      if (parts[0].toLowerCase() === 'bet') {
        try {
          const amt = parseInt(parts[1])
          const balance = await redisClient.GET(message.user)
          if (balance > amt) {
            if (bets.length <= maxPlayers) {
              const new_amount = await redisClient.DECRBY(message.user, amt)
              bets.push({uid: message.user, amt: amt, name: user.profile.display_name})
              await SendChannelBlock(`${user.profile.display_name} placed a ${amt} dollar bet`)
              timeRemaining = maxTimeRemaining
              if (!countdown) {
                countdown = true
                timer = setTimeout(tick, 1000)
              }
            } else {
              await say("too many bets " + message.user + ".")
            }
          } else {
            await say('${message.user} Sorry, insufficent funds')
          }
        } catch (e) {
          console.log(e)
        }
      }
    } else {
      await say(`${message.user} bets are closed.`)
    }
  }
})

app.message('hit', async({message, say}) => {
  if (typeof message.channel !== 'undefined' && message.channel === reservedChannel) {
    const uid = message.user
    console.log(message)
    if (currentPlayerIdx >= 0) {
      if (bets[currentPlayerIdx].uid === uid) {
        HandleHit()
      }
    }
  }
})

app.message('double', async ({message, say}) => {
  if (typeof message.channel !== 'undefined' && message.channel === reservedChannel) {
    const uid = message.user
    if (currentPlayerIdx >= 0) {
      if (bets[currentPlayerIdx].uid === uid) {
        const key = uid
        const balance = await redisClient.get(key)
        if (balance >= bets[currentPlayerIdx].amt) {
          bets[currentPlayerIdx].amt = bets[currentPlayerIdx].amt * 2
          const _double = true
          HandleHit(_double)
        } else {
          await say('<@${message.user}> Sorry, insufficent funds')
        }
      }
    }
  }
})

app.message('stay', async({message, say}) => {
  if (typeof message.channel !== 'undefined' && message.channel === reservedChannel) {
    const uid = message.user
    if (currentPlayerIdx >= 0) {
      if (bets[currentPlayerIdx].uid === uid) {
        HandleStay()
      }
    }
  }
})

app.message('gimme', async ({message, say}) => {
  if (typeof message.channel !== 'undefined' && message.channel === reservedChannel) {
    console.log(message)
    const amount = 1000
    const key = message.user
    await redisClient.INCRBY(key, amount)
    await say("ok, here are " + amount + " DJT's for you <@" + message.user + ">")
  }
})

app.command('/quiet', async ({command, ack, respond, say}) => {
  console.log(command)

  await ack()
  await respond('ok')
  quiet = true
})

app.command('/talk', async ({command, ack, respond, say}) => {
  await ack()
  await respond("I'm back!")
  quiet = false
})

app.command('/balance', async ({command, ack, respond, say}) => {
  await ack()
  if (typeof command.channel_id !== 'undefined' && command.channel_id === reservedChannel) {
    const userId = command.user_id
    const key = userId
    const userBalance = await redisClient.get(key)
    if (userBalance) {
      await respond('balance: ' + userBalance)
    } else {
      await respond('balance: 0')
    }
  }
})


app.action('datepicker_remind', async ({action, ack, respond}) => {
  await ack()
  await respond('ok')
  console.log(action)
})

;(async () => {
  await app.start(3000)
  console.log('bolt is up')
})()
