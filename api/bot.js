const {App} = require('@slack/bolt')
const {createClient} = require('redis')

console.log(process.env.REDIS_HOST, createClient)
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

app.message(/^(hi|hello|hey).*/, async ({message, say}) => {
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
let timer = null
let timeRemaining = 10
let countdown = false
let inGame = false

async function tick() {
  timeRemaining--
  if (timeRemaining > 0) {
    console.log(timeRemaining)
    await app.client.chat.postMessage({token: process.env.SLACK_OAUTH_TOKEN, channel: 'C054X464D4J', text: "Bets close in " + timeRemaining + " seconds"}) 
    setTimeout(tick, 1000)
  } else {
    countdown = false
    inGame = true
    await app.client.chat.postMessage({token: process.env.SLACK_OAUTH_TOKEN, channel: 'C054X464D4J', text: "Bets closed"})
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
            await say(`<@${message.user}> placed a ${amt} net`)
            timeRemaining = 10
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
