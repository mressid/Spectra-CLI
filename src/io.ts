/** What the commands need from the terminal, so they can be tested without one. */
import { createInterface } from 'node:readline/promises'

export interface Io {
  stdout: (text: string) => void
  stderr: (text: string) => void
  readStdin: () => Promise<string>
  /** Ask a question; `hidden` does not echo the answer (passwords). */
  prompt: (question: string, options?: { hidden?: boolean }) => Promise<string>
  /** A person is at the keyboard: stdin is a terminal. */
  interactive: boolean
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/** Reads a line without echoing it (raw mode); Backspace edits, Ctrl-C aborts. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process
    stdout.write(question)
    let answer = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const finish = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      stdout.write('\n')
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish()
          resolve(answer)
          return
        }
        if (char === '\u0003') {
          finish()
          reject(new Error('Cancelled'))
          return
        }
        if (char === '\u007f' || char === '\b') answer = answer.slice(0, -1)
        else answer += char
      }
    }
    stdin.on('data', onData)
  })
}

export const terminalIo: Io = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  readStdin: () => readAll(process.stdin),
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  async prompt(question, options) {
    if (options?.hidden) return promptHidden(question)
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      return await rl.question(question)
    } finally {
      rl.close()
    }
  },
}
