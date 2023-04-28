const {App} = require('@slack/bolt')
const {createClient} = require('redis')
const lookup = require('./lookup_email')
const fs = require('fs')

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
let countdown = false
let inGame = false
const reservedChannel='C054X464D4J'
let currentPlayerIdx = -1
const rules = {
  maxPlayers: 7,
  maxTimeRemaining: 2,
  numDecks: 1,
  dealerStop: 17,
  minBet: 10,
  maxBet: 1000,
  reshuffleFactor: 5, // if there are 8 players (including dealer), then reshuffle if there is less than 8 * reshuffleFactor cards left
}
let timeRemaining = rules.maxTimeRemaining

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
  const suit = GetSuit(rawCard)
  face += suit
  return {face, value}
}

function GetRawCard() {
  return Math.floor(Math.random() * 52 * rules.numDecks)
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
  const DEALER_STOP = rules.dealerStop
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
  if (total < DEALER_STOP) {
    mustHit = true 
  } else if (total === DEALER_STOP && hasAce) {
    mustHit = true
  }
  while (mustHit) {
    const newCard = GetCard()
    cards += newCard.face
    total += newCard.value
    const text = `Dealer shows: ${cards} total = ${total}`
    await SendChannelBlock(text)
    mustHit = false
    if (total < DEALER_STOP) {
      mustHit = true 
    } else if (total === DEALER_STOP && hasAce) {
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
          const name = bets[i].name
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
        if (bets[i].tempValue === 21 && bets[i].cards.length === 2) {
          // payout blackjack 
          const winnings = amt * 3
          await SendChannelBlock(`${name} got BLACKJACK and WON ${winnings} dollars.`)
          await redisClient.INCRBY(key, winnings)
          await redisClient.DECRBY('dealer', winnings)
        } else {
          // payout normal
          await SendChannelBlock(`${name} WON ${amt} dollars.`)
          await redisClient.INCRBY(key, amt * 2)
          await redisClient.DECRBY('dealer', amt)
        }
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
    const amt = bets[currentPlayerIdx].amt
    await redisClient.INCRBY('dealer', amt)
  }
  await SendChannelBlock(`${bets[currentPlayerIdx].name} has: ${cards} = ${totalDisplay} ${status}`)
  if (tempValue > 21) {
    await SendChannelBlock(`${bets[currentPlayerIdx].name} LOST ${bets[currentPlayerIdx].amt}.`)
  }
  if (tempValue >= 21 || _double) {
    NextPlayer()
  }
}

async function HandleStay() {
  NextPlayer()
}

async function Play() {
  // check if we need to reshuffle
  const cardsLeft = rules.numDecks * 52 - dealt.length
  const minimumCards = (bets.length + 1) * rules.reshuffleFactor
  if (cardsLeft < minimumCards) {
    dealt.length = 0
    await SendChannelBlock('RESHUFFLE')
  }
  const endRound = await DealNew()
  if (endRound) {
    // dealer hit blackjack on the deal
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
          if (amt >= rules.minBet && amt <= rules.maxBet) {
            const balance = await redisClient.GET(message.user)
            if (balance > amt) {
              if (bets.length <= rules.maxPlayers) {
                const new_amount = await redisClient.DECRBY(message.user, amt)
                bets.push({uid: message.user, amt: amt, name: user.profile.display_name})
                await SendChannelBlock(`${user.profile.display_name} placed a ${amt} dollar bet`)
                timeRemaining = rules.maxTimeRemaining
                if (!countdown) {
                  countdown = true
                  timer = setTimeout(tick, 1000)
                }
              } else {
                await say("Too many bets.  Please wait.")
              }
            } else {
              await say(`${user.profile.display_name} Sorry, insufficent funds`)
            }
          } else {
            await say(`${user.profile.display_name}.  Min bet is ${rules.minBet} and Max bet is ${rules.maxBet}`)
          }
        } catch (e) {
          console.log(e)
        }
      }
    } else {
      await say(`Bets are closed.`)
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
          await redisClient.DECRBY(key, bets[currentPlayerIdx].amt)
          bets[currentPlayerIdx].amt = bets[currentPlayerIdx].amt * 2
          const _double = true
          HandleHit(_double)
        } else {
          await say(`${message.user} Sorry, insufficent funds`)
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
    const user = await GetUser(message.user)
    const key = message.user
    const timerKey = `timeout_${key}`
    const res = await redisClient.GET(timerKey)
    if (!res) {
      const amount = 1000
      await redisClient.INCRBY(key, amount)
      const timeout = 24 * 3600 * 2
      const toStore = {timestamp: Date.now(), timeout: timeout}
      await redisClient.SET(timerKey, JSON.stringify(toStore), {EX: timeout})
      await say("ok, here are " + amount + " dollars for you " + user.profile.display_name + ".")
    } else {
      const timerData = JSON.parse(res)
      console.log(timerData)
      const timeLeftHours = (timerData.timeout - (Date.now() - timerData.timestamp)/1000) / 3600
      const hours = timerData.timeout / 3600
      await say(`Sorry ${user.profile.display_name}, you can only get money every ${hours} hours.\nYou have ${timeLeftHours} hours until you can get more money.`)
    }
  }
})

app.command('/quiet', async ({command, ack, respond, say}) => {
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

app.message(async ({message, say}) => {
  const text = message.text.trim()
  const channel = message.channel
  if (/^\<mailto:/.test(text)) {
    const _email = text.split('|')[1]
    const email = _email.substr(0, _email.length - 1)
    await SendChannelBlock('Email address detected: ' + email, channel)
    try {
      const id = await lookup.GetIdByEmail(email)
      await SendChannelBlock(`V1 id = ${id} for ${email}`, channel)
      await SendChannelBlock(`Processing...`, channel)
      const {zipFile, filename} = await lookup.GenerateReport(id)
      const fileInfo = {
        token: process.env.SLACK_OAUTH_TOKEN,
        file: zipFile,
        filename: filename,
        intitial_commet: filename,
        channel_id: channel
      }
      await app.client.files.uploadV2(fileInfo)
    } catch (e) {
      console.log(e)
      await SendChannelBlock(e)
    }
  }
})

;(async () => {
  await app.start(3000)
  console.log('bolt is up')
})()
