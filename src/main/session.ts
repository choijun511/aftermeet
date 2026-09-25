// 录制会话编排:把 音频采集 → 实时转写 → 落盘存档 → 推送渲染进程 串起来,
// 停止时持久化会议并调用 Claude 生成纪要/总结/待办。

import {
  mkdtempSync,
  rmSync,
  createWriteStream,
  WriteStream,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  unlinkSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { transcribeQwenPcm, qwenAvailable, pcmWav } from './qwen'
import { safeError } from './cloud-http'
import type { AnalysisMode } from './openai'
import { AudioCapture } from './audio'
import { Transcriber, transcribeFile } from './whisper'
import { StreamingRecognizer } from './streaming'
import { transcriptsDir, upsertMeeting, getMeeting, getSetting } from './store'
import { generateNotes, hasApiKey, cleanTranscript } from './llm'
import { Polisher } from './polish'
import { toSimplified } from './textproc'
import type {
  CalendarEvent,
  Meeting,
  RecState,
  StatusEvent,
  TranscriptSegment
} from '../shared/types'

type Send = (channel: string, payload: unknown) => void

// 把 raw s16le/16k/mono PCM 文件转成 WAV(加 44 字节头)
function pcmToWav(pcmPath: string, wavPath: string): void {
  const pcm = readFileSync(pcmPath)
  const rate = 16000
  const dataSize = pcm.length
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + dataSize, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(dataSize, 40)
  writeFileSync(wavPath, Buffer.concat([h, pcm]))
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
}
function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`
}
function clock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export class Session {
  private send: Send
  private audio: AudioCapture | null = null
  private transcriber: Transcriber | null = null
  private streaming: StreamingRecognizer | null = null
  private archive: WriteStream | null = null
  private audioRaw: WriteStream | null = null // 完整混音 PCM(诊断 + 会后两遍精转用)
  private audioRawPath = ''

  private state: RecState = 'idle'
  private meeting: Meeting | null = null
  private segCount = 0
  private startMs = 0
  private timer: NodeJS.Timeout | null = null
  private polisher: Polisher | null = null
  private segments: TranscriptSegment[] = []
  private polishChain: Promise<void> = Promise.resolve()
  private captureWarning = ''
  private stopping = false

  constructor(send: Send) {
    this.send = send
  }

  getStatus(): StatusEvent {
    return {
      state: this.state,
      durationSec: this.startMs ? Math.floor((Date.now() - this.startMs) / 1000) : 0,
      active: !!this.audio?.health && (this.audio.health.system.rms > 0.003 || (this.audio.health.micIncluded && this.audio.health.microphone.rms > 0.015)),
      audioHealth: this.audio?.health,
      meetingId: this.meeting?.id
    }
  }

  private emitStatus(message?: string): void {
    const s = this.getStatus()
    if (this.captureWarning) s.message = this.captureWarning
    if (message) s.message = message
    this.send('status', s)
  }

  start(
    title: string,
    calendar?: CalendarEvent | null
  ): { ok: boolean; meetingId?: string; error?: string } {
    if (this.meeting || this.stopping || !['idle', 'error'].includes(this.state)) {
      return { ok: false, error: '已有会议正在录制' }
    }
    const now = new Date()
    const id = `m_${now.getTime()}`
    const fileName = `会中转写-${stamp(now)}.txt`
    const filePath = join(transcriptsDir(), fileName)

    // 标题优先级:手动填的 > 关联的飞书会议标题 > 按时间自动命名
    const resolvedTitle = title?.trim() || calendar?.title || `会议 ${clock(now)}`
    this.meeting = {
      id,
      title: resolvedTitle,
      startedAt: now.getTime(),
      durationSec: 0,
      transcript: '',
      transcriptPath: filePath,
      todos: [],
      calendar: calendar || undefined
    }
    upsertMeeting(this.meeting)

    this.archive = createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' })
    this.archive.write(`# ${this.meeting.title}\n# 开始:${now.toLocaleString('zh-CN')}\n\n`)

    this.segCount = 0
    this.captureWarning = ''
    this.segments = []
    this.polishChain = Promise.resolve()
    this.polisher = new Polisher()
    this.startMs = Date.now()
    this.state = 'starting'
    this.emitStatus()

    // 实时引擎:优先 sherpa-onnx 流式(像飞书字幕,边听边吐字);
    // 缺失(未装 python/模型)则降级 whisper 5s 分块。最终权威转写始终由 whisper 两遍精转产出。
    this.streaming = null
    this.transcriber = null
    if (StreamingRecognizer.available()) {
      this.streaming = new StreamingRecognizer({
        onPartial: (text) => this.onStreamPartial(text),
        onFinal: (text, correction) => this.onStreamFinal(text, correction),
        onError: (msg) => {
          console.warn('[stream]', msg)
          if (this.stopping || this.transcriber) return
          void this.streaming?.stop()
          this.streaming = null
          this.startWhisperFallback()
          this.send('notice', '实时字幕引擎不可用，已切换为每 5 秒转写。')
        }
      })
      this.streaming.start()
    } else {
      this.startWhisperFallback()
    }

    // 完整混音 PCM 落盘(raw s16le 16k mono),用于会后两遍精转
    this.audioRawPath = join(transcriptsDir(), `audio-${stamp(now)}.pcm`)
    this.audioRaw = createWriteStream(this.audioRawPath)

    // 音频采集:PCM 喂实时引擎 + 存完整混音
    this.audio = new AudioCapture({
      onData: (chunk) => {
        if (this.state === 'starting') {
          this.state = 'recording'
          this.emitStatus()
        }
        if (this.streaming) this.streaming.write(chunk)
        else this.transcriber?.pushPcm(chunk)
        this.audioRaw?.write(chunk)
      },
      onError: (msg) => this.onAudioError(msg),
      onWarning: (msg) => {
        this.captureWarning = msg
        this.emitStatus()
      }
    })
    const res = this.audio.start()
    if (!res.ok) {
      this.state = 'error'
      this.emitStatus(res.error)
      this.cleanup()
      return { ok: false, error: res.error }
    }

    this.emitStatus('正在等待音频输入…')
    this.timer = setInterval(() => this.emitStatus(), 1000)
    return { ok: true, meetingId: id }
  }

  private streamElapsed(): number {
    return this.startMs ? (Date.now() - this.startMs) / 1000 : 0
  }

  private startWhisperFallback(): void {
    this.transcriber = new Transcriber({
      language: process.env.AFTERMEET_LANG || 'auto',
      onSegment: ({ t, text }) => this.onSegment(t, text),
      onError: (message) => { this.captureWarning = message; this.emitStatus() }
    })
  }

  // 流式 partial:更新中的一行(固定 id 'live',渲染端原地更新)
  private onStreamPartial(text: string): void {
    if (!this.meeting) return
    const simp = toSimplified(text)
    const seg: TranscriptSegment = { id: 'live', t: this.streamElapsed(), text: simp, final: false }
    this.send('segment', seg)
  }

  // 流式 final:一句定稿
  private onStreamFinal(text: string, correction?: Promise<string>): void {
    if (!this.meeting) return
    const simp = toSimplified(text).trim()
    if (!simp) return
    this.segCount += 1
    const seg: TranscriptSegment = {
      id: `s_${this.segCount}`,
      t: this.streamElapsed(),
      text: simp,
      final: !correction
    }
    if (correction) {
      this.polishChain = this.polishChain.then(async () => {
        const corrected = await correction.catch(() => simp)
        seg.originalText = simp
        seg.text = toSimplified(corrected)
        seg.final = true
        this.send('segment', { ...seg })
      })
    }
    this.segments.push(seg)
    this.archive?.write(`[${formatT(seg.t)}] ${simp}\n`)
    this.send('segment', seg)
    // 清空 partial 行
    this.send('segment', { id: 'live', t: seg.t, text: '', final: false })
  }

  private onSegment(t: number, raw: string): void {
    if (!this.meeting) return
    // ① 繁→简(本地、瞬时)
    const simp = toSimplified(raw)
    if (!simp.trim()) return
    this.segCount += 1
    // ② 初稿立即显示(final=false)+ 即时存档(防丢)
    const seg: TranscriptSegment = { id: `s_${this.segCount}`, t, text: simp, final: false }
    const idx = this.segments.length
    this.segments.push(seg)
    this.archive?.write(`[${formatT(t)}] ${simp}\n`)
    this.send('segment', seg)
    // ③ 异步润色,完成后用终稿替换(同 id 覆盖)
    this.enqueuePolish(seg, idx)
  }

  private enqueuePolish(seg: TranscriptSegment, idx: number): void {
    if (!this.polisher?.enabled) {
      seg.final = true
      this.send('segment', seg)
      return
    }
    // 关键:整段包 try/catch,任何一段润色出错都不能中断链条,也要把该段标记为 final。
    this.polishChain = this.polishChain.then(async () => {
      try {
        const prev = idx > 0 ? this.segments[idx - 1]?.text ?? '' : ''
        const polished = await this.polisher!.polish(seg.text, prev)
        if (polished && polished !== seg.text) seg.text = polished
      } catch (e) {
        console.warn('[polish] 段落润色异常,保留初稿:', e instanceof Error ? e.message : e)
      } finally {
        seg.final = true
        this.send('segment', seg)
      }
    })
  }

  private onAudioError(msg: string): void {
    console.error('[capture]', msg)
    this.captureWarning = msg
    this.send('notice', msg)
    this.emitStatus(msg)
    if (!this.stopping) void this.stop()
  }

  async stop(): Promise<{ ok: boolean; meetingId?: string; error?: string }> {
    if (!this.meeting) return { ok: false, error: '当前没有进行中的会议' }
    if (this.stopping) return { ok: false, error: '正在结束录制，请稍候' }
    this.stopping = true
    const meeting = this.meeting
    meeting.endedAt = Date.now()
    meeting.durationSec = Math.floor((meeting.endedAt - meeting.startedAt) / 1000)
    if (this.timer) clearInterval(this.timer)
    this.timer = null

    this.state = 'transcribing'
    await this.audio?.stop()
    this.emitStatus('正在处理收尾音频…')

    // 收尾实时引擎
    if (this.streaming) {
      await this.streaming.stop()
      this.streaming = null
    } else {
      await this.transcriber?.flush()
      this.emitStatus('正在校对转写…')
      await this.polishChain
    }
    await this.polishChain
    // 先用实时片段拼一个粗稿(作为兜底;下面会被 whisper 两遍精转覆盖)
    meeting.transcript = this.segments.map((s) => s.text).join(' ')
    // 清掉渲染端的 partial 行
    this.send('segment', { id: 'live', t: 0, text: '', final: false })

    // 关闭存档与完整音频(等音频流真正写完再精转)
    this.archive?.end(`\n# 结束:${new Date().toLocaleString('zh-CN')}\n`)
    this.archive = null
    if (this.audioRaw) {
      const s = this.audioRaw
      this.audioRaw = null
      await new Promise<void>((r) => s.end(() => r()))
    }

    // ★ 两遍精转:对完整录音整段转写(带上下文,远好于 5s 分块),作为权威转写
    await this.fullTranscribe(meeting)

    upsertMeeting(meeting)

    // 生成纪要(异步,失败不影响转写已保存);用户可在设置关闭自动生成
    if (getSetting('autoMinutes', true)) {
      this.state = 'summarizing'
      this.emitStatus('正在生成会议纪要…')
      await this.runLlm(meeting)
    }

    this.state = 'idle'
    this.startMs = 0
    this.meeting = null
    this.transcriber = null
    this.audio = null
    this.stopping = false
    const error = meeting.llmError
    this.captureWarning = ''
    this.emitStatus()
    if (error) this.send('notice', error)
    return { ok: !error, meetingId: meeting.id, error }
  }

  /** 两遍精转:整段录音带上下文转写,覆盖实时粗稿 */
  private async fullTranscribe(meeting: Meeting): Promise<void> {
    try {
      // 用户可在设置关闭「停止后高精度重转」;关掉则只整理实时稿(补标点分段)
      if (!getSetting('twoPass', true)) {
        const draftLen = meeting.transcript.length
        if (draftLen >= 4) {
          this.emitStatus('正在整理转写(补标点、分段)…')
          const cleaned = await cleanTranscript(meeting.transcript)
          if (cleaned && cleaned.length >= draftLen * 0.6) meeting.transcript = cleaned
        }
        return
      }
      if (!this.audioRawPath || !existsSync(this.audioRawPath)) return
      if (statSync(this.audioRawPath).size < 32000) return // < ~1s,不值当
      this.state = 'transcribing'
      if (getSetting('cloudAsr', qwenAvailable()) && qwenAvailable()) {
        try {
          const cloud = await transcribeQwenPcm(this.audioRawPath, (message) => this.emitStatus(message), async (pcm) => {
            const dir = mkdtempSync(join(tmpdir(), 'aftermeet-qwen-fallback-'))
            try {
              const wav = join(dir, 'chunk.wav')
              writeFileSync(wav, pcmWav(pcm))
              return toSimplified(await transcribeFile(wav, process.env.AFTERMEET_LANG || 'auto'))
            } finally { rmSync(dir, { recursive: true, force: true }) }
          })
          meeting.transcript = cloud.text
          meeting.speakerSegments = cloud.sentences
          meeting.transcriptionModel = cloud.model
          meeting.transcriptionWarning = cloud.warnings.length ? cloud.warnings.join('；') : undefined
          console.log(`[qwen] 完成：${cloud.sentences.length} 段，${cloud.text.length} 字`)
          return
        } catch (e) {
          meeting.transcriptionWarning = `Qwen 精转失败，已回退本地 Whisper：${safeError(e)}`
          console.warn('[qwen]', meeting.transcriptionWarning)
          this.send('notice', meeting.transcriptionWarning)
        }
      }
      meeting.transcriptionModel = 'whisper-large-v3-turbo'
      this.emitStatus('正在使用本地 Whisper 精转全程录音…')
      const wav = this.audioRawPath.replace(/\.pcm$/, '.wav')
      pcmToWav(this.audioRawPath, wav)
      const full = await transcribeFile(wav, process.env.AFTERMEET_LANG || 'auto')
      try {
        unlinkSync(wav)
      } catch {
        /* */
      }
      // 防御:精转结果远短于实时流式稿时,说明精转异常丢了内容 → 保留更完整的流式稿,
      // 绝不用残缺结果覆盖(这正是 70 分钟会只剩 3500 字 bug 的直接原因)。
      const draftLen = meeting.transcript.length
      if (full && full.length >= 4 && (full.length >= draftLen * 0.6 || draftLen < 80)) {
        // whisper 精转 → 繁转简 → Gemini 整理(补标点、分段、去 ASR 重复、修错字,不改原意)
        this.emitStatus('正在整理转写(补标点、分段)…')
        const cleaned = await cleanTranscript(toSimplified(full))
        meeting.transcript = cleaned || toSimplified(full)
        console.log(`[full] 精转+整理完成:${meeting.transcript.length} 字(精转原始 ${full.length}, 流式稿 ${draftLen})`)
      } else {
        console.warn(
          `[full] 精转结果(${full?.length || 0}字)远短于流式稿(${draftLen}字),保留流式稿并整理`
        )
        // 仍对流式稿做一次整理(补标点分段),提升可读性
        if (draftLen >= 4) {
          const cleaned = await cleanTranscript(meeting.transcript)
          if (cleaned && cleaned.length >= draftLen * 0.6) meeting.transcript = cleaned
        }
      }
    } catch (e) {
      meeting.transcriptionWarning = `精转失败，已保留实时稿：${safeError(e)}`
      console.error('[full]', meeting.transcriptionWarning)
    }
  }

  private async runLlm(meeting: Meeting): Promise<void> {
    await this.runLlmFrom(meeting, meeting.transcript)
  }

  /** 对已有会议重新生成纪要(用其 notesSource 对应的转写) */
  async regenerate(id: string, mode: AnalysisMode = 'standard'): Promise<{ ok: boolean; error?: string }> {
    if (this.state !== 'idle' || this.meeting) return { ok: false, error: '请等待当前录制或处理完成' }
    const meeting = getMeeting(id)
    if (!meeting) return { ok: false, error: '会议不存在' }
    const text =
      meeting.notesSource === 'feishu' && meeting.feishuTranscript
        ? meeting.feishuTranscript
        : meeting.transcript
    this.state = 'summarizing'
    this.send('status', { state: 'summarizing', durationSec: 0, active: false, meetingId: id })
    try { await this.runLlmFrom(meeting, text, mode) } finally { this.state = 'idle'; this.send('status', this.getStatus()) }
    if (meeting.llmError) return { ok: false, error: meeting.llmError }
    return { ok: true }
  }

  /** 用指定转写文本生成纪要/待办(供本地/飞书妙记两路复用) */
  private async runLlmFrom(meeting: Meeting, transcript: string, mode: AnalysisMode = 'standard'): Promise<void> {
    if (!transcript.trim()) {
      meeting.llmError = '转写为空,跳过纪要生成'
      upsertMeeting(meeting)
      this.send('meeting-updated', meeting)
      return
    }
    if (!hasApiKey()) {
      meeting.llmError = '未配置 OPENAI_API_KEY，无法生成 AI 纪要。'
      upsertMeeting(meeting)
      this.send('meeting-updated', meeting)
      return
    }
    try {
      const res = await generateNotes(transcript, mode)
      meeting.notesModel = res.model
      meeting.analysisMode = mode
      meeting.minutes = res.minutes
      meeting.summary = res.summary
      meeting.todos = res.todos.map((t, i) => ({
        id: `t_${meeting.id}_${i}`,
        text: t.text,
        owner: t.owner,
        due: t.due,
        done: meeting.todos.find((old) => old.text === t.text && old.owner === t.owner)?.done || false
      }))
      meeting.llmError = undefined
    } catch (e) {
      meeting.llmError = safeError(e)
    }
    upsertMeeting(meeting)
    this.send('meeting-updated', meeting)
  }

  /** 用飞书妙记逐字稿生成纪要/待办(缓存妙记稿,切换来源为 feishu) */
  async applyFeishuNotes(
    id: string,
    feishuTranscript: string,
    feishuTitle?: string
  ): Promise<{ ok: boolean; error?: string }> {
    const meeting = getMeeting(id)
    if (!meeting) return { ok: false, error: '会议不存在' }
    meeting.feishuTranscript = feishuTranscript
    meeting.feishuTitle = feishuTitle
    meeting.notesSource = 'feishu'
    upsertMeeting(meeting)
    this.send('status', { state: 'summarizing', durationSec: 0, active: false, meetingId: id })
    await this.runLlmFrom(meeting, feishuTranscript)
    this.send('status', this.getStatus())
    if (meeting.llmError) return { ok: false, error: meeting.llmError }
    return { ok: true }
  }

  /** 切回本地录制转写生成纪要 */
  async useLocalNotes(id: string): Promise<{ ok: boolean; error?: string }> {
    const meeting = getMeeting(id)
    if (!meeting) return { ok: false, error: '会议不存在' }
    meeting.notesSource = 'local'
    upsertMeeting(meeting)
    this.send('status', { state: 'summarizing', durationSec: 0, active: false, meetingId: id })
    await this.runLlmFrom(meeting, meeting.transcript)
    this.send('status', this.getStatus())
    if (meeting.llmError) return { ok: false, error: meeting.llmError }
    return { ok: true }
  }

  private cleanup(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.archive?.end()
    this.archive = null
    this.audioRaw?.end()
    this.audioRaw = null
    void this.streaming?.stop()
    void this.audio?.stop()
    this.streaming = null
    this.audio = null
    this.transcriber = null
    this.startMs = 0
    this.meeting = null
  }
}

function formatT(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${pad(m)}:${pad(s)}`
}
