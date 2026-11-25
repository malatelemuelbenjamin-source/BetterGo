import { spawn } from 'node:child_process'

const children = []
let shuttingDown = false

function run(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  })
  child.on('exit', (code) => {
    if (shuttingDown) return
    console.log(`[dev] ${name} exited with code ${code}`)
    shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('api', process.execPath, ['--watch', 'server/index.js'])
run('web', process.execPath, ['node_modules/vite/bin/vite.js'])
