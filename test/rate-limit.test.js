// Confirms the public write endpoints are rate limited per IP.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'
import { testKeys, seedDb } from './helpers.js'

test('activate returns 429 once the per-IP limit is exceeded', async () => {
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({
    db,
    privateKey,
    rateLimits: { activate: { max: 3, timeWindow: '1 minute' }, rebind: { max: 3, timeWindow: '1 minute' }, renew: { max: 3, timeWindow: '1 minute' } }
  })
  // trustProxy is on, so X-Forwarded-For is what keys the limiter (as Caddy sets it).
  const hit = () =>
    app.inject({ method: 'POST', url: '/activate', headers: { 'x-forwarded-for': '9.9.9.9' }, payload: { code: 'x', machineId: 'M' } })
  // First 3 are allowed through to the handler (they 404 on the bogus code)...
  for (let i = 0; i < 3; i++) assert.notEqual((await hit()).statusCode, 429)
  // ...the 4th within the window is throttled.
  assert.equal((await hit()).statusCode, 429)
})

test('/health is never rate limited', async () => {
  const db = seedDb()
  const { privateKey } = testKeys()
  const app = buildApp({ db, privateKey, rateLimits: { activate: { max: 1, timeWindow: '1 minute' }, rebind: { max: 1, timeWindow: '1 minute' }, renew: { max: 1, timeWindow: '1 minute' } } })
  for (let i = 0; i < 5; i++) {
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200)
  }
})
