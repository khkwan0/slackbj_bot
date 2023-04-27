const {Pool} = require('pg')
require('dotenv').config()
const {exec} = require('child_process')

const db = new Pool({
  user: process.env.DB_READ_USER,
  host: process.env.DB_READ_HOST,
  database: process.env.DB_READ_DB,
  password: process.env.DB_READ_PASSWORD,
  port: process.env.DB_READ_PORT,
})

const CreateReport = id => {
  return new Promise((resolve, reject) => {
    const command = `/usr/src/app/report_driver.sh ${id} 2022-01-18`
    exec(command, (err, stdout, stderr) => {
      if (err) {
        reject(err)
      } else if (stdout) {
        resolve()
      } else {
        reject()
      }
    })
  })
}

const CompressReport = (id, fileName) => {
  return new Promise((resolve, reject) => {
    const zipFile = `/tmp/${fileName}`
    const zipCommand = `/usr/bin/7z a ${zipFile} single/${id}/good/*`
    exec(zipCommand, (err, stdout, stderr) => {
      if (err) {
        console.log(err)
        reject('problem processing file')
      } else if (stdout) {
        resolve(zipFile)
      } else {
        reject()
      }
    })
  })
}

module.exports = {
  GetIdByEmail: async email => {
    try {
      const res = await db.query('select id from users where email=$1', [email])
      if (typeof res.rows !== 'undefined' && Array.isArray(res.rows) && res.rows.length === 1) {
        return res.rows[0].id
      } else {
        throw new Error(email + ' not found.')
      }
    } catch (e) {
      console.log(e)
      throw new Error(e)
    }
  },
  GenerateReport: async id => {
    try {
      await CreateReport(id)
      const fileName = `yieldapp_${id}_combined_statement_2201-01-18.zip`
      const res = await CompressReport(id, fileName)
      return {zipFile: res, filename: fileName} 
    } catch (e) {
      console.log('GenerateReport', e)
      throw e
    }
  }
}
