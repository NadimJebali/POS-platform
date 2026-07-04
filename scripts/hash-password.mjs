// Generates a scrypt hash for the admin password to paste into ADMIN_PASSWORD_HASH.
//
//   npm run hash-password -- 'your long unique password'
//
// Reads the password from argv (or stdin if omitted) so it needn't touch disk.
import { hashPassword } from '../src/auth.js'
import { createInterface } from 'node:readline'

async function readPassword() {
  const fromArgv = process.argv.slice(2).join(' ').trim()
  if (fromArgv) return fromArgv
  const rl = createInterface({ input: process.stdin })
  process.stdout.write('Password: ')
  for await (const line of rl) return line.trim()
  return ''
}

const password = await readPassword()
if (!password) {
  console.error('No password provided. Usage: npm run hash-password -- \'your password\'')
  process.exit(1)
}
console.log('\nADMIN_PASSWORD_HASH=' + hashPassword(password))
