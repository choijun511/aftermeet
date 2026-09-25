import { createReadStream, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { mkdtemp, open, rm, writeFile } from 'fs/promises'
import { createHash, randomUUID } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import { readJson, writeJson } from './atomic-json'
import { checkCancelled, pcmWav, qwenBase, qwenModel, QWEN_CHUNK_SECONDS, transcribeQwenPcm } from './qwen'
import type { CloudTranscript, QwenChunk } from './qwen'
import { transcribeFile } from './whisper'
import { toSimplified } from './textproc'
import { whisperModelPath } from './paths'
import type { Meeting, RetranscribeOptions } from '../shared/types'

export interface TranscriptionCheckpoint {
  version: 1
  fingerprint: string
  chunks: Record<string, QwenChunk>
}
export async function audioFingerprint(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) { checkCancelled(signal); hash.update(chunk) }
  checkCancelled(signal)
  return hash.digest('hex')
}
export function processingDirectory(): string {
  const dir = join(app.getPath('userData'), 'processing')
  mkdirSync(dir, { recursive: true })
  return dir
}
export function checkpointPath(id: string, engine: string): string {
  if (!/^m_[a-zA-Z0-9_-]+$/.test(id)) throw new Error('会议 ID 不合法')
  return join(processingDirectory(), `${id}-${engine}.json`)
}
export async function transcribeSavedAudio(
  meeting: Meeting, options: RetranscribeOptions, signal: AbortSignal,
  progress: (message: string, done: number, total: number) => void,
  localTranscribe = transcribeFile
): Promise<CloudTranscript> {
  if (!meeting.audioPath || !existsSync(meeting.audioPath)) throw new Error('找不到这场会议的录音文件，现有文字仍保留')
  progress('正在检查已保存的录音…', 0, 0)
  const language = process.env.AFTERMEET_LANG || 'auto'
  const localModel = whisperModelPath()
  const modelVersion = existsSync(localModel) ? `${statSync(localModel).size}:${statSync(localModel).mtimeMs}` : 'missing'
  const config = options.engine === 'qwen'
    ? `${qwenBase()}:${qwenModel()}:${createHash('sha256').update(process.env.DASHSCOPE_API_KEY || '').digest('hex')}`
    : `${localModel}:${modelVersion}:${language}`
  const fingerprint = `${await audioFingerprint(meeting.audioPath, signal)}:${config}`
  const path = checkpointPath(meeting.id, options.engine)
  let job = readJson<TranscriptionCheckpoint>(path, { version: 1, fingerprint, chunks: {} },
    (v) => v?.version === 1 && typeof v.fingerprint === 'string' && v.chunks && typeof v.chunks === 'object' &&
      Object.values(v.chunks).every((c: any) => ['submitting', 'submitted', 'failed', 'done'].includes(c.state) &&
        (c.state !== 'done' || (typeof c.result?.text === 'string' && Array.isArray(c.result?.sentences) && Array.isArray(c.result?.warnings)))))
  if (job.fingerprint !== fingerprint || options.restart) {
    if (existsSync(path)) renameSync(path, `${path}.previous-${randomUUID()}`)
    if (existsSync(`${path}.bak`)) renameSync(`${path}.bak`, `${path}.bak.previous-${randomUUID()}`)
    job = { version: 1, fingerprint, chunks: {} }
  }
  const handle = await open(meeting.audioPath, 'r')
  try {
    const { size } = await handle.stat()
    if (size < 32000 || size % 2) throw new Error('录音不足 1 秒或 PCM 数据不完整；已保留原文件')
    const chunkBytes = QWEN_CHUNK_SECONDS * 32000
    const total = Math.ceil(size / chunkBytes)
    let message = '准备转写…'
    const report = (): void => progress(message, Object.values(job.chunks).filter((c) => c.state === 'done').length, total)
    const save = (): void => { writeJson(path, job); report() }
    const setProgress = (value: string): void => { message = value; report() }
    save()
    const local = async (pcm: Buffer): Promise<string> => {
      checkCancelled(signal)
      const dir = await mkdtemp(join(tmpdir(), 'aftermeet-recovery-'))
      try {
        const wav = join(dir, 'chunk.wav')
        await writeFile(wav, pcmWav(pcm))
        const text = toSimplified(await localTranscribe(wav, language, signal)).trim()
        checkCancelled(signal)
        return text
      } finally { await rm(dir, { recursive: true, force: true }) }
    }
    if (options.engine === 'qwen') return await transcribeQwenPcm(meeting.audioPath, setProgress, local,
      { chunks: job.chunks, save, signal, allowResubmit: options.allowResubmit })
    const texts: string[] = []
    for (let index = 0; index < total; index++) {
      checkCancelled(signal)
      if (job.chunks[index]?.state === 'done' && job.chunks[index].result) {
        texts.push(job.chunks[index].result!.text); continue
      }
      setProgress(`本地 Whisper 正在转写（${index + 1}/${total}）…`)
      const offset = index * chunkBytes
      const pcm = Buffer.alloc(Math.min(chunkBytes, size - offset))
      let read = 0
      while (read < pcm.length) {
        const got = await handle.read(pcm, read, pcm.length - read, offset + read)
        if (!got.bytesRead) throw new Error('录音读取不完整')
        read += got.bytesRead
      }
      const text = await local(pcm)
      if (!text) throw new Error(`第 ${index + 1}/${total} 段未识别出文字，无法确认是否静音；请核对音频，原稿已保留`)
      job.chunks[index] = { state: 'done', result: { text, sentences: [], model: 'whisper-large-v3-turbo', warnings: [] } }
      save(); texts.push(text)
    }
    return { text: texts.join('\n\n'), sentences: [], model: 'whisper-large-v3-turbo', warnings: [] }
  } finally { await handle.close() }
}

/** Keep the prior complete text/notes before installing a successful new transcript. */
export function preserveMeetingVersion(meeting: Meeting): void {
  if (!meeting.transcript && !meeting.minutes) return
  writeJson(join(processingDirectory(), `${meeting.id}-before-transcription-${randomUUID()}.json`), meeting)
}
