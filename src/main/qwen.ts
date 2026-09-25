import { open } from 'fs/promises'
import { randomUUID } from 'crypto'
import { cloudFetch } from './cloud-http'

const SAMPLE_BYTES_PER_SECOND = 32000
export const QWEN_CHUNK_SECONDS = 20 * 60
export function qwenAvailable(): boolean { return !!process.env.DASHSCOPE_API_KEY?.trim() }
export function qwenModel(): string { return process.env.ASR_CLOUD_MODEL || 'qwen-audio-3.0-asr-flash-filetrans' }
export function qwenBase(): string {
  const region = process.env.DASHSCOPE_REGION || 'ap-southeast-1'
  if (!['ap-southeast-1', 'cn-beijing'].includes(region)) throw new Error('Qwen 地域必须为 ap-southeast-1 或 cn-beijing')
  const workspace = process.env.DASHSCOPE_WORKSPACE_ID
  if (workspace && !/^[a-zA-Z0-9-]+$/.test(workspace)) throw new Error('百炼 Workspace ID 格式不正确')
  return workspace ? `https://${workspace}.${region}.maas.aliyuncs.com/api/v1`
    : `https://${region === 'cn-beijing' ? 'dashscope' : 'dashscope-intl'}.aliyuncs.com/api/v1`
}
const auth = (): Record<string, string> => ({ Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' })
async function request(path: string, body?: unknown): Promise<any> {
  const res = await cloudFetch(qwenBase() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...auth(), ...(body === undefined ? {} : { 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const data = await res.json() as { code?: string; message?: string }
  if (!res.ok || data.code) throw new Error(`Qwen ${res.status}: ${data.message || data.code || '请求失败'}`)
  return data
}
export function pcmWav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
function trustedOss(url: string): void {
  const u = new URL(url)
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.aliyuncs.com')) throw new Error('百炼返回了非预期的文件服务地址')
}
async function upload(wav: Buffer): Promise<string> {
  const { data: policy } = await request(`/uploads?action=getPolicy&model=${encodeURIComponent(qwenModel())}`)
  if (!policy?.upload_host || !policy.upload_dir) throw new Error('百炼上传凭证缺少必要字段')
  trustedOss(policy.upload_host)
  if (policy.max_file_size_mb && wav.length > Number(policy.max_file_size_mb) * 1024 * 1024) throw new Error('录音分段超过百炼上传大小限制')
  const name = `aftermeet-${randomUUID()}.wav`
  const key = `${policy.upload_dir}/${name}`
  const form = new FormData()
  const fields = { OSSAccessKeyId: policy.oss_access_key_id, Signature: policy.signature, policy: policy.policy,
    'x-oss-object-acl': policy.x_oss_object_acl, 'x-oss-forbid-overwrite': policy.x_oss_forbid_overwrite,
    key, success_action_status: '200' }
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v))
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), name)
  const res = await cloudFetch(policy.upload_host, { method: 'POST', body: form }, 180000)
  if (!res.ok) throw new Error(`百炼录音上传失败：HTTP ${res.status}`)
  return `oss://${key}`
}
export interface CloudSentence { startMs: number; endMs: number; text: string; speaker: string }
export interface CloudTranscript { text: string; sentences: CloudSentence[]; model: string; warnings: string[] }
export type QwenChunkFallback = (pcm: Buffer, index: number) => Promise<string>
export async function transcribeQwenPcm(pcmPath: string, progress: (message: string) => void = () => {}, fallback?: QwenChunkFallback): Promise<CloudTranscript> {
  if (!qwenAvailable()) throw new Error('未配置 DASHSCOPE_API_KEY')
  const file = await open(pcmPath, 'r')
  const sentences: CloudSentence[] = []
  const texts: string[] = []
  const warnings: string[] = []
  try {
    const { size } = await file.stat()
    if (size < SAMPLE_BYTES_PER_SECOND || size % 2) throw new Error('录音过短或 PCM 数据不完整')
    const chunkBytes = QWEN_CHUNK_SECONDS * SAMPLE_BYTES_PER_SECOND
    const count = Math.ceil(size / chunkBytes)
    for (let index = 0; index < count; index++) {
      const offset = index * chunkBytes
      const pcm = Buffer.alloc(Math.min(chunkBytes, size - offset))
      let read = 0
      while (read < pcm.length) {
        const result = await file.read(pcm, read, pcm.length - read, offset + read)
        if (!result.bytesRead) throw new Error('录音读取不完整')
        read += result.bytesRead
      }
      try {
      progress(`正在上传录音到 Qwen（${index + 1}/${count}）…`)
      const url = await upload(pcmWav(pcm))
      const submitted = await request('/services/audio/asr/transcription', {
        model: qwenModel(), input: { file_urls: [url] }, parameters: { channel_id: [0], diarization_enabled: true }
      })
      const task = submitted.output?.task_id
      if (!task) throw new Error('Qwen 未返回转写任务 ID')
      const deadline = Date.now() + 15 * 60000
      let result: any
      while (Date.now() < deadline) {
        result = await request(`/tasks/${encodeURIComponent(task)}`)
        const status = result.output?.task_status
        if (status === 'SUCCEEDED') break
        if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(status)) throw new Error(`Qwen 转写失败：${result.output?.code || status} ${result.output?.message || ""}`)
        progress(`Qwen 正在转写（${index + 1}/${count}）…`)
        await new Promise((r) => setTimeout(r, 3000))
      }
      if (result?.output?.task_status !== 'SUCCEEDED') throw new Error('Qwen 转写等待超时；将使用本地精转')
      const item = result.output.results?.[0]
      if (item?.subtask_status !== 'SUCCEEDED' || !item.transcription_url) throw new Error(`Qwen 文件转写失败：${item?.code || ''} ${item?.message || '无结果'}`)
      trustedOss(item.transcription_url)
      const response = await cloudFetch(item.transcription_url)
      if (!response.ok) throw new Error(`转写结果读取失败：HTTP ${response.status}`)
      const transcript = await response.json() as { transcripts?: { text?: string; sentences?: { text: string; speaker_id?: number; begin_time: number; end_time: number }[] }[] }
      const blocks = transcript.transcripts || []
      let segmentText = ''
      for (const block of blocks) {
        if (block.sentences?.length) {
          for (const sentence of block.sentences) {
            if (!sentence.text?.trim()) continue
            const speaker = count > 1 ? `分段${index + 1}-说话人${Number(sentence.speaker_id ?? 0) + 1}` : `说话人${Number(sentence.speaker_id ?? 0) + 1}`
            sentences.push({ startMs: offset / 32 + sentence.begin_time, endMs: offset / 32 + sentence.end_time, text: sentence.text.trim(), speaker })
            segmentText += `${speaker}：${sentence.text.trim()}\n\n`
          }
        } else { segmentText += block.text || '' }
      }
      if (!segmentText.trim()) throw new Error('Qwen 返回空转写；将保留本地录音并精转')
      texts.push(segmentText.trim())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Empty recognition is not evidence of silent audio. Recover this chunk
        // locally, retaining Qwen results and continuing the remaining chunks.
        if (!fallback || !/ASR_RESPONSE_HAVE_NO_WORDS|Qwen 返回空转写/.test(message)) {
          throw new Error(`第 ${index + 1}/${count} 段（${offset / SAMPLE_BYTES_PER_SECOND} 秒起）：${message}`)
        }
        progress(`Qwen 第 ${index + 1}/${count} 段未返回文字，正在本地补转…`)
        const local = (await fallback(pcm, index)).trim()
        if (!local) throw new Error(`第 ${index + 1}/${count} 段云端与本地均未返回文字，不能确认是否静音；保留原稿`)
        texts.push(`【第 ${index + 1} 段 · 本地补转，未区分说话人】\n${local}`)
        warnings.push(`第 ${index + 1}/${count} 段云端未返回文字，已由本地 Whisper 补转`)
        console.log(`[qwen] 第 ${index + 1}/${count} 段本地补转完成：${local.length} 字`)
      }
    }
    return { text: texts.join('\n\n'), sentences, model: warnings.length ? `${qwenModel()} + whisper-large-v3-turbo` : qwenModel(), warnings }
  } finally { await file.close() }
}
