// 系统音频采集:spawn Swift helper,读取其 stdout 的 16k/mono/s16le PCM 流。
// 对外提供 start/stop + onData(PCM) + onError。

import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { existsSync, chmodSync } from 'fs'
import { audioHelperPath } from './paths'

export class AudioCapture {
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null
  private onData: (chunk: Buffer) => void
  private onError: (msg: string) => void

  constructor(opts: { onData: (chunk: Buffer) => void; onError: (msg: string) => void }) {
    this.onData = opts.onData
    this.onError = opts.onError
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

    proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString().trim()
      if (!s) return
      // helper 把诊断信息打到 stderr;含「权限」「失败」时上报为错误
      if (/无屏幕录制权限|启动采集失败|流意外停止|找不到显示器/.test(s)) {
        this.onError(s)
      }
      console.log('[audio-helper]', s)
    })
    proc.on('error', (err) => this.onError(`无法启动采集进程:${err.message}`))
    proc.on('exit', (code, signal) => {
      console.log(`[audio-helper] exited code=${code} signal=${signal}`)
      this.proc = null
    })
    return { ok: true }
  }

  stop(): void {
    if (!this.proc) return
    // 发 SIGINT,helper 内部会优雅 stopCapture 后退出
    this.proc.kill('SIGINT')
    // 兜底:1.5s 后仍未退出则强杀
    const p = this.proc
    setTimeout(() => {
      if (p && !p.killed) p.kill('SIGKILL')
    }, 1500)
    this.proc = null
  }

  get running(): boolean {
    return this.proc !== null
  }
}
