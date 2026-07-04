// Production entry point. Run with an env file so LICENSE_PRIVATE_KEY et al. are
// present:  node --env-file=.env src/server.js  (npm start does this in Docker via
// the compose env). Loads config, opens the real DB, and listens.
import { loadConfig } from './config.js'
import { openDb } from './db.js'
import { buildApp } from './app.js'

const config = loadConfig()
const db = openDb(config.dbPath)
const app = buildApp({ db, privateKey: config.privateKey, logger: true })

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then((addr) => app.log.info(`pos-platform listening on ${addr}`))
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
