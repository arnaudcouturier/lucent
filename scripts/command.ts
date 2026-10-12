import { execFile } from 'node:child_process'

export type Command = (executable: string, args: string[]) => Promise<string>
export const runCommand: Command = (executable, args) => new Promise((resolve, reject) => {
  const child = execFile(executable, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) reject(new Error(`${executable} failed: ${stderr.trim() || error.message}`))
    else resolve(stdout)
  })
  child.stdin?.end()
})
