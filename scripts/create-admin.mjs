/**
 * Create the first super administrator without ever hardcoding a password.
 *
 * Usage:
 *   npm run create-admin -- --email you@example.com --name "Your Name"
 *
 * The password is read from the ADMIN_PASSWORD environment variable, or you
 * will be prompted for it. It is never written to a file or printed.
 */
import readline from 'node:readline'
import { seed } from '../server/seed.js'
import { get, nowIso, run, transaction } from '../server/db.js'
import { hashPassword, passwordIssues } from '../server/auth.js'

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : undefined
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    process.stdout.write(question)
    const stdin = process.stdin
    let value = ''
    const onData = (char) => {
      char = char.toString()
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.removeListener('data', onData)
        process.stdout.write('\n')
        rl.close()
        resolve(value)
      } else if (char === '\u0003') {
        process.exit(1)
      } else {
        value += char
      }
    }
    stdin.on('data', onData)
  })
}

const email = (arg('email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase()
const name = (arg('name') || process.env.ADMIN_NAME || 'Platform Administrator').trim()
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Provide a valid --email value.')
  process.exit(1)
}

seed({ quiet: true })

let password = process.env.ADMIN_PASSWORD
if (!password) {
  password = await askHidden('Password (min 12 chars, mixed case, number, symbol): ')
  const confirm = await askHidden('Confirm password: ')
  if (password !== confirm) {
    console.error('Passwords do not match.')
    process.exit(1)
  }
}
const problems = passwordIssues(password, { email })
if (problems.length) {
  console.error('Password rejected:\n - ' + problems.join('\n - '))
  process.exit(1)
}

const existing = get(`SELECT id, email FROM users WHERE lower(email) = ?`, [email])
if (existing) {
  console.error(`An account already exists for ${email}. Use the admin dashboard to assign the super_admin role instead.`)
  process.exit(1)
}

const hash = await hashPassword(password)

transaction(() => {
  const result = run(
    `INSERT INTO users (name, email, password_hash, account_status, email_verified_at) VALUES (?, ?, ?, 'active', ?)`,
    [name, email, hash, nowIso()],
  )
  const id = Number(result.lastInsertRowid)
  const [first, ...rest] = name.split(' ')
  run(`INSERT INTO user_profiles (user_id, first_name, last_name) VALUES (?, ?, ?)`, [id, first, rest.join(' ') || '-'])
  run(`INSERT INTO notification_preferences (user_id) VALUES (?)`, [id])
  const role = get(`SELECT id FROM user_roles WHERE slug = 'super_admin'`)
  run(`INSERT INTO user_role_assignments (user_id, role_id, scope_type, status, reason) VALUES (?, ?, 'global', 'active', ?)`, [
    id,
    role.id,
    'Initial platform owner created during deployment setup',
  ])
  run(`INSERT INTO consent_records (user_id, consent_category, status, policy_version, source) VALUES (?, 'terms_of_use', 'granted', '1.0', 'admin_bootstrap')`, [id])
  run(`INSERT INTO audit_logs (user_id, action, module, entity_type, entity_id, result, new_values) VALUES (?, 'auth.admin_bootstrapped', 'users', 'user', ?, 'success', ?)`, [
    id,
    id,
    JSON.stringify({ role: 'super_admin', email }),
  ])
})

console.log(`Super administrator created for ${email}. Sign in and change your password if it was shared with anyone.`)
process.exit(0)
