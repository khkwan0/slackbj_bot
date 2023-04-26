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
  console.log(message)
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
      await say(`Hello, <@${message.user}>`)
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

async function SendChannelBlock(text) {
  const block = [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": text,
      }
    }
  ]
  await app.client.chat.postMessage({token: process.env.SLACK_OAUTH_TOKEN, channel: 'C054X464D4J', blocks: block})
}
async function SendChannel(text) {
  await app.client.chat.postMessage({token: process.env.SLACK_OAUTH_TOKEN, channel: 'C054X464D4J', text: text})
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
  console.log('raw', rawCard)
  while (dealt.includes(rawCard)) {
    console.log('redraw')
    rawCard = GetRawCard()
  }
  dealt.push(rawCard)
  const cardNumber = rawCard % 52 % 13
  console.log('number', cardNumber)

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

let currentPlayerIdx = -1
async function DealNew() {
  let i = 0
  while (i < bets.length) {
    const card1 = GetCard()
    const card2 = GetCard()
    bets[i].cards = [card1, card2]
    await SendChannel(`<@${bets[i].uid}> got dealt: ${card1.face} ${card2.face}`)
    i++
  }
  const dealerCard1 = GetCard()
  const dealerCard2 = GetCard()
  dealerCards.push(dealerCard1)
  dealerCards.push(dealerCard2)
  await SendChannelBlock(`Dealer show : ${dealerCard1.face} \ud83c\udca0`)
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
  const text = `Dealer shows: ${cards} total=${total}`
  await SendChannelBlock(text)
  let mustHit = false
  if (total < 17) {
    mustHit = true 
  } else if (total === 17 && hasAce) {
    mustHit = true
  }
  console.log('musthit', mustHit)
  while (mustHit) {
    const newCard = GetCard()
    cards += newCard.face
    total += newCard.value
    const text = `Dealer shows: ${cards} total=${total}`
    await SendChannelBlock(text)
    mustHit = false
    if (total < 17) {
      mustHit = true 
    } else if (total === 17 && hasAce) {
      mustHit = true
    }
  }
}

  async function NextPlayer() {
    currentPlayerIdx++
    if (currentPlayerIdx >= bets.length) {
      currentPlayerIdx = -1 // the dealer
      await SendChannelBlock("Dealer's turn.")
      await DealerTurn()
    }
  }

  async function HandleHit() {
    const newCard = GetCard()
    bets[currentPlayerIdx].cards.push(newCard)
    let cards = ''
    bets[currentPlayerIdx].cards.forEach(card => {
      cards += card.face + ' '
    })
    const total = GetCardTotals(bets[currentPlayerIdx].cards)
    console.log(total)
    let totalDisplay = 0
    let tempValue = 0
    if (total.total1 === 21 || total.total2 === 21) {
      tempValue = 21
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
    let status = 'OK'
    bets[currentPlayerIdx].tempValue = tempValue
    if (tempValue > 21) {
      status = 'BUST'
    }
    await SendChannel(`<@${bets[currentPlayerIdx].uid}> has: ${cards} = ${totalDisplay} ${status}`)
    if (tempValue >= 21) {
      NextPlayer()
    }
  }

  async function HandleStay() {
    NextPlayer()
  }

async function Play() {
  await DealNew()
  inGame = true
  currentPlayerIdx = 0
  const total = GetCardTotals(bets[currentPlayerIdx].cards)
  console.log(total)
  if (total.total1 === total.total2) {
    await SendChannel(`<@${bets[currentPlayerIdx].uid}>'s turn: ${total.total1}`)
  } else if (total.total1 > 21) {
    await SendChannel(`<@${bets[currentPlayerIdx].uid}>'s turn: ${total.total2}`)
  } else if (total.total2 > 21) {
    await SendChannel(`<@${bets[currentPlayerIdx].uid}>'s turn: ${total.total1}`)
  } else {
    await SendChannel(`<@${bets[currentPlayerIdx].uid}>'s turn: ${total.total1} or ${total.total2}`)
  }
}

async function tick() {
  timeRemaining--
  if (timeRemaining > 0) {
    await app.client.chat.postMessage({token: process.env.SLACK_OAUTH_TOKEN, channel: 'C054X464D4J', text: "Bets closes in " + timeRemaining + " seconds"}) 
    setTimeout(tick, 1000)
  } else {
    countdown = false
    await app.client.chat.postMessage({token: process.env.SLACK_OAUTH_TOKEN, channel: 'C054X464D4J', text: "Bets closed"})
    await Play()
  }
}

app.message('bet', async({message, say}) => {
  if (!inGame) {
    console.log(message)
    const msg = message.text
    const parts = msg.split(' ')
    if (parts[0].toLowerCase() === 'bet') {
      try {
        const amt = parseInt(parts[1])
        const balance = await redisClient.GET(message.user)
        if (balance > amt) {
          if (bets.length < 7) {
            const new_amount = await redisClient.DECRBY(message.user, amt)
            bets.push({uid: message.user, amt: amt})
            await say(`<@${message.user}> placed a ${amt} dollar bet`)
            timeRemaining = maxTimeRemaining
            if (!countdown) {
              countdown = true
              timer = setTimeout(tick, 1000)
            }
          } else {
            await say("too many bets <@" + message.user + ">")
          }
        }
      } catch (e) {
        console.log(e)
      }
    }
  } else {
    console.log('in play')
  }
})

app.message('hit', async({message, say}) => {
  const uid = message.user
  console.log(uid)
  if (currentPlayerIdx >= 0) {
    console.log(bets[currentPlayerIdx].uid)
    if (bets[currentPlayerIdx].uid === uid) {
      HandleHit()
    }
  }
})

app.message('stay', async({message, say}) => {
  const uid = message.user
  console.log(uid)
  if (currentPlayerIdx >= 0) {
    console.log(bets[currentPlayerIdx].uid)
    if (bets[currentPlayerIdx].uid === uid) {
      HandleStay()
    }
  }
})

app.message('gimme', async ({message, say}) => {
  console.log(message)
  const amount = 1000
  const key = message.user
  await redisClient.INCRBY(key, amount)
  await say("ok, here are " + amount + " DJT's for you <@" + message.user + ">")
})

app.command('/quiet', async ({command, ack, respond, say}) => {
  console.log(command)

  await ack()
  await respond('ok')
  quiet = true
})

app.command('/talk', async ({command, ack, respond, say}) => {
  await ack()
  await say("I'm back!")
  quiet = false
})

app.command('/balance', async ({command, ack, respond, say}) => {
  await ack()
  console.log(command)
  const userId = command.user_id
  const key = userId
  const userBalance = await redisClient.get(key)
  if (userBalance) {
    await respond('balance: ' + userBalance)
  } else {
    await respond('balance: 0')
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
