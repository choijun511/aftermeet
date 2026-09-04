// 麦克风占用监测:spawn MicWatcher,解析其 stdout 的 active/idle 行。

import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { existsSync, chmodSync } from 'fs'
import { micWatcherPath } from './paths'

export class MicWatcher {
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null
  private onActive: () => void
  private onIdle: () => void
  private buf = ''

  constructor(opts: { onActive: () => void; onIdle: () => void }) {
    this.onActive = opts.onActive
    this.onIdle = opts.onIdle
  }

  start(): void {
    if (this.proc) return
    const bin = micWatcherPath()
    if (!existsSync(bin)) {
      console.warn('[micwatch] MicWatcher 不存在:', bin)
      return
    }
    try {
      chmodSync(bin, 0o755)
    } catch {
      /* */
    }
    const proc = spawn(bin, [], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    proc.stdout.on('data', (d: Buffer) => {
      this.buf += d.toString()
      let i: number
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (line === 'active') this.onActive()
        else if (line === 'idle') this.onIdle()
      }
    })
    proc.on('exit', () => {
      this.proc = null
    })
  }

  stop(): void {
    this.proc?.kill('SIGTERM')
    this.proc = null
  }

  get running(): boolean {
    return this.proc !== null
  }
}
