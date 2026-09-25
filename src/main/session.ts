import { effectiveTranscriptionMode } from '../shared/transcription-mode'
// 录制会话编排:把 音频采集 → 实时转写 → 落盘存档 → 推送渲染进程 串起来,
// 停止时持久化会议并调用 Claude 生成纪要/总结/待办。

import { createWriteStream, WriteStream, existsSync, statSync } from 'fs'
import { join } from 'path'
import { finished } from 'stream/promises'
import { qwenAvailable, checkCancelled } from './qwen'
import { preserveMeetingVersion, transcribeSavedAudio } from './processing'
import { safeError } from './cloud-http'
import type { AnalysisMode } from './openai'
import { AudioCapture } from './audio'
import { Transcriber } from './whisper'
import { StreamingRecognizer } from './streaming'
import { transcriptsDir, upsertMeeting, getMeeting, getSetting } from './store'
import { generateNotes, hasApiKey } from './llm'
import { Polisher } from './polish'
import { toSimplified } from './textproc'
import type {
  ProcessingStatus,
  RetranscribeOptions,
  CalendarEvent,
  Meeting,
  RecState,
  StatusEvent,
  TranscriptSegment
} from '../shared/types'

type Send = (channel: string, payload: unknown) => void

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n
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
  private processingId: string | null = null
  private processingAbort: AbortController | null = null
  private lastMessage = ''

  constructor(send: Send) {
    this.send = send
  }

  getStatus(): StatusEvent {
    return {
      state: this.state,
      durationSec: this.startMs ? Math.floor((Date.now() - this.startMs) / 1000) : 0,
      active: !!this.audio?.health && (this.audio.health.system.rms > 0.003 || (this.audio.health.micIncluded && this.audio.health.microphone.rms > 0.015)),
      audioHealth: this.audio?.health,
      message: this.lastMessage || undefined,
      meetingId: this.meeting?.id || this.processingId || undefined
    }
  }

  private emitStatus(message?: string): void {
    const s = this.getStatus()
    if (this.captureWarning) s.message = this.captureWarning
    if (message) { s.message = message; this.lastMessage = message }
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
    const fileName = `会中转写-${id}.txt`
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
      audioPath: join(transcriptsDir(), `audio-${id}.pcm`),
      audioFormat: 'pcm-s16le-16000-mono',
      processing: { stage: 'recording', state: 'running', updatedAt: now.getTime(), message: '正在保存录音' },
      todos: [],
      calendar: calendar || undefined
    }
    try { upsertMeeting(this.meeting) } catch (error) {
      this.meeting = null
      return { ok: false, error: safeError(error) }
    }

    this.archive = createWriteStream(filePath, { flags: 'a', encoding: 'utf-8', flush: true })
    this.archive.on('error', (error) => this.onAudioError(`转写存档失败：${safeError(error)}`))
    this.archive.write(`# ${this.meeting.title}\n# 开始:${now.toLocaleString('zh-CN')}\n\n`)

    this.segCount = 0
    this.captureWarning = ''
    this.lastMessage = ''
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
    this.audioRawPath = this.meeting!.audioPath!
    this.audioRaw = createWriteStream(this.audioRawPath, { flags: 'wx', flush: true })
    this.audioRaw.on('error', (error) => this.onAudioError(`录音写入失败：${safeError(error)}`))

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
      this.updateProcessing(this.meeting!, { stage: 'saved', state: 'failed', message: res.error })
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
    if (!this.stopping) void this.stop().catch((error) => this.send('notice', safeError(error)))
  }

  private updateProcessing(meeting: Meeting, status: Omit<ProcessingStatus, 'updatedAt'>): void {
    const previous = meeting.processing && { ...meeting.processing, updatedAt: undefined }
    if (JSON.stringify(previous) === JSON.stringify({ ...status, updatedAt: undefined })) {
      this.emitStatus(status.message); return
    }
    meeting.processing = { ...status, updatedAt: Date.now() }
    upsertMeeting(meeting)
    this.send('meeting-updated', meeting)
    this.emitStatus(status.message)
  }

  private releaseProcessing(): void {
    this.processingId = null; this.processingAbort = null
    this.state = 'idle'; this.lastMessage = ''; this.captureWarning = ''
    this.emitStatus()
  }

  cancelProcessing(id: string): { ok: boolean; error?: string } {
    if (this.processingId !== id || !this.processingAbort) return { ok: false, error: '该会议当前没有可取消的处理任务' }
    this.processingAbort.abort()
    this.emitStatus('正在取消…录音和已完成分段会保留；已提交的云任务可能仍会计费')
    return { ok: true }
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
    this.processingId = meeting.id
    this.processingAbort = new AbortController()
    const signal = this.processingAbort.signal
    try {
      await this.audio?.stop()
      this.emitStatus('正在保存录音…')
      // Close audio BEFORE waiting for recognizers or any network processing.
      const audio = this.audioRaw; this.audioRaw = null
      if (audio) {
        const closed = finished(audio)
        audio.end()
        await closed
      }
      meeting.audioBytes = meeting.audioPath && existsSync(meeting.audioPath) ? statSync(meeting.audioPath).size : 0
      this.updateProcessing(meeting, { stage: 'saved', state: 'running', message: '录音已保存，正在收尾字幕…' })
      if (this.streaming) { await this.streaming.stop(); this.streaming = null }
      else await this.transcriber?.flush()
      await this.polishChain
      meeting.transcript = this.segments.map((s) => s.text).join(' ')
      this.archive?.end(`\n# 结束:${new Date().toLocaleString('zh-CN')}\n`)
      this.archive = null
      this.send('segment', { id: 'live', t: 0, text: '', final: false })
      upsertMeeting(meeting)
      checkCancelled(signal)
      const mode = effectiveTranscriptionMode({ twoPass: getSetting('twoPass', true), cloudAsr: getSetting('cloudAsr', true) }, qwenAvailable())
      if (mode !== 'live') {
        const engine = mode
        try { await this.fullTranscribe(meeting, { engine }, signal) } catch (error) {
          checkCancelled(signal)
          if (engine !== 'qwen') throw error
          const warning = `Qwen 处理未完成，已改用本地 Whisper；云端进度仍保留。${safeError(error)}`
          await this.fullTranscribe(meeting, { engine: 'local' }, signal)
          meeting.transcriptionWarning = warning
          upsertMeeting(meeting)
        }
      }
      checkCancelled(signal)
      this.updateProcessing(meeting, { stage: 'saved', state: 'done', message: '录音与转写已保存' })
      if (getSetting('autoMinutes', true)) await this.runLlm(meeting)
      return { ok: !meeting.llmError, meetingId: meeting.id, error: meeting.llmError }
    } catch (error) {
      const message = safeError(error)
      this.updateProcessing(meeting, { ...meeting.processing!, stage: meeting.processing?.stage === 'recording' ? 'saved' : meeting.processing?.stage || 'saved',
        state: signal.aborted ? 'paused' : 'failed', message })
      this.send('notice', message)
      return { ok: false, meetingId: meeting.id, error: message }
    } finally {
      this.archive?.end(); this.archive = null
      this.audioRaw?.end(); this.audioRaw = null
      await this.audio?.stop()
      await this.streaming?.stop()
      this.streaming = null; this.transcriber = null; this.audio = null
      this.startMs = 0; this.meeting = null; this.stopping = false
      this.releaseProcessing()
    }
  }

  private async fullTranscribe(meeting: Meeting, options: RetranscribeOptions, signal: AbortSignal): Promise<void> {
    this.state = 'transcribing'
    const result = await transcribeSavedAudio(meeting, options, signal, (message, completedChunks, totalChunks) => {
      this.updateProcessing(meeting, { stage: 'transcribing', state: 'running', engine: options.engine,
        completedChunks, totalChunks, message })
    })
    checkCancelled(signal)
    if (!result.text.trim()) throw new Error('转写未返回文字，已保留原稿')
    if (meeting.transcript.length >= 80 && result.text.length < meeting.transcript.length * 0.6) {
      throw new Error('新转写明显短于原稿，已保留原稿；分段结果已保存，请先核对录音')
    }
    preserveMeetingVersion(meeting)
    meeting.notesStale = meeting.notesSource !== 'feishu' && (!!meeting.minutes || !!meeting.summary)
    meeting.transcript = result.text
    meeting.speakerSegments = result.sentences
    meeting.transcriptionModel = result.model
    meeting.transcriptionWarning = result.warnings.join('；') || undefined
    // Existing notes remain associated with their original source until explicitly regenerated.
    upsertMeeting(meeting)
    this.send('meeting-updated', meeting)
  }

  async retranscribe(id: string, options: RetranscribeOptions): Promise<{ ok: boolean; error?: string }> {
    if (this.state !== 'idle' || this.meeting || this.processingId) return { ok: false, error: '请等待当前录制或处理完成' }
    if (!options || !['local', 'qwen'].includes(options.engine)) return { ok: false, error: '请选择转写方式' }
    if (options.engine === 'qwen' && !qwenAvailable()) return { ok: false, error: '未配置 Qwen 密钥，请选择本地 Whisper' }
    const meeting = getMeeting(id)
    if (!meeting) return { ok: false, error: '会议不存在' }
    this.processingId = id; this.processingAbort = new AbortController()
    const signal = this.processingAbort.signal
    this.state = 'transcribing'
    try {
      await this.fullTranscribe(meeting, options, signal)
      this.updateProcessing(meeting, { ...meeting.processing!, stage: 'saved', state: 'done', message: '转写已保存；可重新生成纪要，原纪要仍保留' })
      return { ok: true }
    } catch (error) {
      const message = safeError(error)
      this.updateProcessing(meeting, { ...meeting.processing!, stage: 'transcribing', engine: options.engine,
        state: signal.aborted ? 'paused' : 'failed', message })
      return { ok: false, error: message }
    } finally { this.releaseProcessing() }
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
    this.processingId = id
    this.processingAbort = new AbortController()
    try { await this.runLlmFrom(meeting, text, mode) } finally { this.releaseProcessing() }
    if (meeting.llmError) return { ok: false, error: meeting.llmError }
    return { ok: true }
  }

  /** 用指定转写文本生成纪要/待办(供本地/飞书妙记两路复用) */
  private async runLlmFrom(meeting: Meeting, transcript: string, mode: AnalysisMode = 'standard'): Promise<void> {
    this.state = 'summarizing'
    this.updateProcessing(meeting, { stage: 'summarizing', state: 'running', message: '正在生成纪要…' })
    if (!transcript.trim()) {
      meeting.llmError = '转写为空,跳过纪要生成'
      this.updateProcessing(meeting, { stage: 'summarizing', state: 'failed', message: meeting.llmError })
      return
    }
    if (!hasApiKey()) {
      meeting.llmError = '未配置 OPENAI_API_KEY，无法生成 AI 纪要。'
      this.updateProcessing(meeting, { stage: 'summarizing', state: 'failed', message: meeting.llmError })
      return
    }
    try {
      const res = await generateNotes(transcript, mode, this.processingAbort?.signal)
      checkCancelled(this.processingAbort?.signal)
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
      meeting.notesStale = false
    } catch (e) {
      meeting.llmError = safeError(e)
    }
    this.updateProcessing(meeting, { stage: meeting.llmError ? 'summarizing' : 'complete',
      state: this.processingAbort?.signal.aborted ? 'paused' : meeting.llmError ? 'failed' : 'done',
      message: meeting.llmError || '纪要已生成' })
  }

  /** 用飞书妙记逐字稿生成纪要/待办(缓存妙记稿,切换来源为 feishu) */
  async applyFeishuNotes(
    id: string,
    feishuTranscript: string,
    feishuTitle?: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.state !== 'idle' || this.processingId || this.meeting) return { ok: false, error: '请等待当前处理完成' }
    const meeting = getMeeting(id)
    if (!meeting) return { ok: false, error: '会议不存在' }
    this.processingId = id; this.processingAbort = new AbortController()
    meeting.feishuTranscript = feishuTranscript
    meeting.feishuTitle = feishuTitle
    meeting.notesSource = 'feishu'
    upsertMeeting(meeting)
    this.send('status', { state: 'summarizing', durationSec: 0, active: false, meetingId: id })
    try { await this.runLlmFrom(meeting, feishuTranscript) } finally { this.releaseProcessing() }
    if (meeting.llmError) return { ok: false, error: meeting.llmError }
    return { ok: true }
  }

  /** 切回本地录制转写生成纪要 */
  async useLocalNotes(id: string): Promise<{ ok: boolean; error?: string }> {
    if (this.state !== 'idle' || this.processingId || this.meeting) return { ok: false, error: '请等待当前处理完成' }
    const meeting = getMeeting(id)
    if (!meeting) return { ok: false, error: '会议不存在' }
    this.processingId = id; this.processingAbort = new AbortController()
    meeting.notesSource = 'local'
    upsertMeeting(meeting)
    this.send('status', { state: 'summarizing', durationSec: 0, active: false, meetingId: id })
    try { await this.runLlmFrom(meeting, meeting.transcript) } finally { this.releaseProcessing() }
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
