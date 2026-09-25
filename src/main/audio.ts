// 系统音频采集:spawn Swift helper,读取其 stdout 的 16k/mono/s16le PCM 流。
// 对外提供 start/stop + onData(PCM) + onError。

import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { existsSync, chmodSync } from 'fs'
import type { AudioHealth } from '../shared/types'
import { audioHelperPath } from './paths'

export class AudioCapture {
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null
  private onData: (chunk: Buffer) => void
  private onError: (msg: string) => void
  private onWarning: (msg: string) => void
  private watchdog: NodeJS.Timeout | null = null
  private stopping = false
  private healthValue?: AudioHealth
  private healthAt = 0
  private lastSound = Date.now()
  get health(): AudioHealth | undefined {
    if (!this.healthValue) return undefined
    const stale = Date.now() - this.healthAt > 3000
    return { ...this.healthValue,
      system: stale ? { rms: 0, receiving: false } : this.healthValue.system,
      microphone: stale ? { rms: 0, receiving: false } : this.healthValue.microphone,
      silenceSeconds: Math.floor((Date.now() - this.lastSound) / 1000) }
  }

  constructor(opts: { onData: (chunk: Buffer) => void; onError: (msg: string) => void; onWarning?: (msg: string) => void }) {
    this.onData = opts.onData
    this.onError = opts.onError
    this.onWarning = opts.onWarning || (() => {})
  }

  start(): { ok: boolean; error?: string } {
    const bin = audioHelperPath()
    if (!existsSync(bin)) {
      return { ok: false, error: `音频采集 helper 不存在:${bin}(请先 npm run build:helper)` }
    }
    try {
      chmodSync(bin, 0o755)
    } catch {
      /* ignore */
    }

    const proc = spawn(bin, [], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    let lastData = Date.now()
    this.watchdog = setInterval(() => {
      if (Date.now() - lastData > 10000) {
        if (this.watchdog) clearInterval(this.watchdog)
        this.onError('连续 10 秒未收到音频，录制已停止。请授权屏幕与系统录音，并检查麦克风。')
      }
    }, 1000)

    proc.stdout.on('data', (chunk: Buffer) => { lastData = Date.now(); this.onData(chunk) })
    let diagnostics = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (data: string) => {
      diagnostics += data
      let newline: number
      while ((newline = diagnostics.indexOf('\n')) >= 0) {
        const line = diagnostics.slice(0, newline).trim()
        diagnostics = diagnostics.slice(newline + 1)
        if (!line) continue
        try {
          const h = JSON.parse(line)
          if (h.type === 'audio-health' && typeof h.system?.rms === 'number' && typeof h.microphone?.rms === 'number') {
            this.healthValue = h
            this.healthAt = Date.now()
            if (h.system.rms > 0.003 || (h.micIncluded && h.microphone.rms > 0.015)) this.lastSound = Date.now()
            continue
          }
        } catch { /* Human-readable helper diagnostic. */ }
        if (/系统音频启动失败|流意外停止|找不到显示器/.test(line)) {
          this.onWarning('系统音频不可用，目前仅尝试录制麦克风。请前往设置页检查录音权限。')
        } else if (line.includes('系统音频采集已启动')) this.onWarning('')
        console.log('[audio-helper]', line)
      }
    })
    proc.on('error', (err) => this.onError(`无法启动采集进程:${err.message}`))
    proc.on('exit', (code, signal) => {
      if (this.watchdog) clearInterval(this.watchdog)
      console.log(`[audio-helper] exited code=${code} signal=${signal}`)
      this.proc = null
      if (!this.stopping) this.onError(`音频采集意外退出（${code ?? signal}），请检查录音权限。`)
    })
    return { ok: true }
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.watchdog) clearInterval(this.watchdog)
    const p = this.proc
    if (!p) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL')
      }, 1500)
      p.once('close', () => { clearTimeout(timer); resolve() })
      p.kill('SIGINT')
    })
    this.proc = null
  }

  get running(): boolean {
    return this.proc !== null
  }
}
