// 流式 ASR:spawn sherpa-onnx 的 Python 识别器,喂 16k/mono/s16le PCM,
// 实时拿到 partial(更新中)/ final(定稿)结果。像飞书字幕一样边听边吐字。

import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Writable, Readable } from 'stream'
import { streamPythonPath, streamScriptPath, streamModelDir } from './paths'

export interface StreamingOpts {
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onReady?: () => void
  onError?: (msg: string) => void
}

/** 清理流式输出的碎片:去掉 SIL/BLANK 之类的特殊 token,压空白 */
export function cleanStreamText(t: string): string {
  return t
    .replace(/\bSIL\b/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export class StreamingRecognizer {
  private proc: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  private buf = ''
  private opts: StreamingOpts

  constructor(opts: StreamingOpts) {
    this.opts = opts
  }

  static available(): boolean {
    return streamModelDir() !== null
  }

  start(): boolean {
    const model = streamModelDir()
    if (!model) return false
    const proc = spawn(streamPythonPath(), [streamScriptPath(), model], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.proc = proc

    proc.stdout.on('data', (d: Buffer) => {
      this.buf += d.toString()
      let i: number
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (!line) continue
        this.handle(line)
      }
    })
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString().trim()
      if (s) console.log('[stream]', s.slice(0, 200))
    })
    proc.on('error', (e) => this.opts.onError?.(`流式识别启动失败:${e.message}`))
    proc.on('exit', (code) => {
      console.log('[stream] exited', code)
      this.proc = null
    })
    return true
  }

  private handle(line: string): void {
    let msg: { type?: string; text?: string }
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    const text = cleanStreamText(msg.text || '')
    switch (msg.type) {
      case 'ready':
        this.opts.onReady?.()
        break
      case 'partial':
        if (text) this.opts.onPartial(text)
        break
      case 'final':
        if (text) this.opts.onFinal(text)
        break
      case 'error':
        this.opts.onError?.(msg.text || 'stream error')
        break
      default:
        break
    }
  }

  write(pcm: Buffer): void {
    if (this.proc && this.proc.stdin.writable) {
      this.proc.stdin.write(pcm)
    }
  }

  /** 结束输入,等 Python 收尾后退出 */
  async stop(): Promise<void> {
    const p = this.proc
    if (!p) return
    try {
      p.stdin.end()
    } catch {
      /* */
    }
    // 等它自然退出(最多 3s),否则强杀
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          p.kill('SIGKILL')
        } catch {
          /* */
        }
        resolve()
      }, 3000)
      p.on('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.proc = null
  }

  get running(): boolean {
    return this.proc !== null
  }
}
