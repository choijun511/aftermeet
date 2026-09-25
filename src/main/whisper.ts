// 本地转写管线:接收 16k/mono/s16le PCM,按固定窗口切片,逐窗调用 whisper-cli。
//
// 关键处理:
//   - 固定窗口(WINDOW_SEC 秒)切片,响应及时、逻辑简单可靠。标点/断句由后续 LLM 润色补齐。
//   - 静音门限(RMS):近似静音的窗口直接跳过,避免 whisper 在静音/音乐上产生
//     「请不吝点赞订阅转发」之类的中文幻觉。
//   - 串行处理:同一时刻只跑一个 whisper-cli 进程,新窗口排队。

import { spawn } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { cpus } from 'os'
import {
  whisperCliPath,
  whisperModelPath,
  whisperCwd,
  whisperVadModelPath,
  whisperVadUsable
} from './paths'

const SAMPLE_RATE = 16000
const WINDOW_SEC = 5 // 每 5 秒切一段,首段延迟约 5-6 秒
const WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SEC
const SILENCE_RMS = 0.01 // 经验阈值,低于此视为静音(略高以躲开近静音时的字幕组幻觉)
const THREADS = Math.max(4, Math.min(8, cpus().length))

export interface WhisperOpts {
  onError?: (message: string) => void
  language?: string // 'auto' | 'zh' | 'en' ...
  onSegment: (seg: { t: number; text: string }) => void
}

function buildWavHeader(numSamples: number): Buffer {
  const dataSize = numSamples * 2 // 16-bit mono
  const buf = Buffer.alloc(44)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // PCM fmt chunk size
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24)
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

// 把 PCM 字节安全地转成 16 位样本数组(拷贝到独立、对齐的 ArrayBuffer,
// 避免 Node Buffer 池的任意 byteOffset 导致 Int16Array 对齐报错)。
function bufToInt16(buf: Buffer): Int16Array {
  const copy = new Uint8Array(buf) // 拷贝到新的 0 偏移 ArrayBuffer
  return new Int16Array(copy.buffer, 0, copy.byteLength >> 1)
}

function rms(int16: Int16Array): number {
  if (int16.length === 0) return 0
  let sum = 0
  for (let i = 0; i < int16.length; i++) {
    const v = int16[i] / 32768
    sum += v * v
  }
  return Math.sqrt(sum / int16.length)
}

// 会后两遍精转:对完整录音做一次「带完整上下文」的转写。
// 大模型在整段音频上(30s 窗口 + 上下文)远比 5s 孤立分块准确、且几乎不幻觉。
export function transcribeFile(wavPath: string, language = 'auto'): Promise<string> {
  return new Promise((resolve, reject) => {
    // 注意:不要用 -sns(suppress-non-speech)!实测它在长会议音频上会把 ~90% 的真实语音
    // 当非语音抑制掉(68分钟只剩 6946 字 vs 无此参数 72178 字)。整段带上下文转写不需要它。
    const args = [
      '-m', whisperModelPath(),
      '-f', wavPath,
      '-l', language,
      '-nt',
      '-np',
      '-t', String(THREADS)
    ]
    const proc = spawn(whisperCliPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: whisperCwd()
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err = (err + d.toString()).slice(-4000)))
    proc.on('error', (e) => {
      console.error('[whisper:full] spawn error', e.message)
      reject(new Error(`转写引擎启动失败：${e.message}`))
    })
    proc.on('close', (code, signal) => {
      if (code !== 0) {
        const message = `转写引擎退出（${code ?? signal}）：${err.slice(-1200)}`
        console.error('[whisper:full]', message)
        reject(new Error(message))
        return
      }
      const text = out
        .replace(/\r/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ')
        .trim()
      resolve(text)
    })
  })
}

export class Transcriber {
  private pending: Buffer[] = [] // 累积的原始 PCM 字节
  private pendingBytes = 0
  private processedSamples = 0 // 已切片处理的样本总数(用于时间偏移)
  private busy = false
  private stopped = false
  private opts: WhisperOpts
  private tmpSeq = 0

  constructor(opts: WhisperOpts) {
    this.opts = opts
  }

  pushPcm(chunk: Buffer): void {
    if (this.stopped) return
    this.pending.push(chunk)
    this.pendingBytes += chunk.length
    void this.maybeProcess(false)
  }

  /** 录制结束:把剩余不足一窗的音频也转写掉 */
  async flush(): Promise<void> {
    this.stopped = true
    // 若正忙,等它空出来再收尾
    while (this.busy) await new Promise((r) => setTimeout(r, 50))
    await this.maybeProcess(true)
  }

  private pendingSamples(): number {
    return this.pendingBytes / 2
  }

  /** 取一窗样本;forceAll 时取全部剩余,否则取满一窗;不足则返回 null。 */
  private takeWindow(forceAll: boolean): Int16Array | null {
    const avail = this.pendingSamples()
    let take: number
    if (forceAll) {
      if (avail === 0) return null
      take = avail
    } else {
      if (avail < WINDOW_SAMPLES) return null
      take = WINDOW_SAMPLES
    }
    const bytes = take * 2
    const merged = Buffer.concat(this.pending)
    const win = bufToInt16(merged.subarray(0, bytes))
    const rest = merged.subarray(bytes)
    this.pending = rest.length ? [Buffer.from(rest)] : []
    this.pendingBytes = rest.length
    return win
  }

  private async maybeProcess(forceAll: boolean): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const win = this.takeWindow(forceAll)
        if (!win) break
        const tStart = this.processedSamples / SAMPLE_RATE
        this.processedSamples += win.length
        const level = rms(win)
        if (level >= SILENCE_RMS) {
          const text = await this.runWhisper(win)
          console.log(`[whisper] rms=${level.toFixed(4)} → ${text ? '"' + text.slice(0, 50) + '"' : '(丢弃/空)'}`)
          if (text) this.opts.onSegment({ t: tStart, text })
        } else {
          console.log(`[whisper] rms=${level.toFixed(4)} (静音跳过)`)
        }
        if (forceAll) break // 收尾一次取全部
      }
    } finally {
      this.busy = false
    }
    // 处理期间可能又攒够一窗
    if (!forceAll && this.pendingSamples() >= WINDOW_SAMPLES) {
      void this.maybeProcess(false)
    }
  }

  private runWhisper(samples: Int16Array): Promise<string> {
    return new Promise((resolve) => {
      const wavPath = join(tmpdir(), `aftermeet-${process.pid}-${this.tmpSeq++}.wav`)
      const header = buildWavHeader(samples.length)
      const body = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
      writeFileSync(wavPath, Buffer.concat([header, body]))

      const lang = this.opts.language || 'auto'
      const args = [
        '-m', whisperModelPath(),
        '-f', wavPath,
        '-l', lang,
        '-nt', // 不要时间戳
        '-np', // 不要多余打印
        '-t', String(THREADS),
        '-sns', // 抑制非语音 token,减少幻觉
        '-nth', '0.6', // no-speech 阈值
        '-et', '2.8', // 熵阈值:更容易判定解码失败→输出空,压幻觉
        '-lpt', '-0.8' // logprob 阈值:低置信直接丢
      ]
      // 注:whisper 的 --vad 在真实混音上会把大量真实语音误抹成空,已弃用(改用上面的 RMS 门限)。
      const proc = spawn(whisperCliPath(), args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: whisperCwd()
      })
      let out = ''
      let err = ''
      proc.stdout.on('data', (d) => (out += d.toString()))
      proc.stderr.on('data', (d) => (err += d.toString()))
      proc.on('error', (e) => {
        console.error('[whisper] spawn error', e.message)
        try { unlinkSync(wavPath) } catch { /* */ }
        resolve('')
      })
      proc.on('close', (code, signal) => {
        try { unlinkSync(wavPath) } catch { /* */ }
        if (code !== 0) {
          const message = `实时转写失败（${code ?? signal}）：${err.trim().slice(-1000)}`
          console.error('[whisper]', message)
          this.opts.onError?.(message)
          resolve('')
          return
        }
        resolve(this.cleanText(out))
      })
    })
  }

  private cleanText(raw: string): string {
    let t = raw.replace(/\r/g, '').trim()
    // 去掉 whisper 偶发的 [_BEG_]/[BLANK_AUDIO] 之类标记
    t = t.replace(/\[[^\]]*\]/g, '').trim()
    // 常见中文幻觉(静音/音乐/近静音时 whisper 会编造字幕组署名、拟声词等)兜底过滤
    const hallucinations = [
      /^请不吝点赞/,
      /字幕|subtitle|志愿者/i, // 字幕組/字幕製作/中文字幕:XXX 等署名幻觉
      /优优独播剧场|yoyo television|MyGO/i, // large-v3 台标水印幻觉
      /明镜|订阅|关注我|点赞|转发|打赏/, // YouTube 频道署名类幻觉
      /^by\s+\w+$/i, // 「by bwd6」类署名
      /^(thank you|thanks(\s+for\s+watching)?|bye+|you|okay|ok|please\s+subscribe|subscribe)[.!\s]*$/i, // 英文孤立块幻觉
      /^[（(【[][^）)】\]]*[)）】\]]$/, // 整段被括号包住:(音乐)(嘟嘟)(掌声) 等
      /^(谢谢(观看|大家|收看)|下期(再见|见)|感谢(观看|收看))[。!！.\s]*$/,
      /^(嘟|哔|滴|啊|嗯|哈){3,}[。!！.\s]*$/, // 拟声词重复
      /^([一-鿿])([、,，。\s]*\1){2,}[。!！.、\s]*$/, // 单字重复(「一、一、一」「我我我」)
      /^[\s。,，、!！?？.…·]*$/ // 纯标点/空
    ]
    if (hallucinations.some((re) => re.test(t))) return ''
    const joined = t.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
    // 5 秒窗口只吐出 ≤1 个「实义字符」= 那段基本是静音/底噪,丢弃(如「好」「我」「在」)
    const content = joined.replace(/[\s。,，、!！?？.…·"'“”—\-()（）]/g, '')
    if (content.length <= 1) return ''
    return joined
  }
}
