import { randomBytes } from 'crypto'
import { open, realpath } from 'fs/promises'
import { relative, isAbsolute, extname } from 'path'
import { getMeeting, transcriptsDir } from './store'
import type { PlaybackInfo } from '../shared/types'

const RATE = 32000
const HEADER_BYTES = 44
const leases = new Map<string, { id: string; owner: number; activeUntil: number }>()
let cooloffUntil = 0
const generations = new Map<number, number>()
export function playbackActive(): boolean {
  return Date.now() < cooloffUntil || [...leases.values()].some((l) => l.activeUntil > Date.now())
}
export function releasePlayback(token: string, owner: number): void {
  const lease = leases.get(token)
  if (lease?.owner !== owner) return
  if (lease.activeUntil > Date.now()) cooloffUntil = Date.now() + 2000
  leases.delete(token)
}
export function releasePlaybackOwner(owner: number): void {
  generations.set(owner, (generations.get(owner) || 0) + 1)
  for (const [token, lease] of leases) if (lease.owner === owner) releasePlayback(token, owner)
}
export function setPlaybackActive(token: string, owner: number, active: boolean): boolean {
  const lease = leases.get(token)
  if (!lease || lease.owner !== owner) return false
  if (!active && lease.activeUntil > Date.now()) cooloffUntil = Date.now() + 2000
  lease.activeUntil = active ? Date.now() + 10000 : 0
  return true
}

async function authorizedAudio(id: string): Promise<string> {
  const meeting = getMeeting(id)
  if (!meeting?.audioPath) throw new Error('这场会议没有关联录音，仍可查看已有文字')
  if (meeting.audioFormat && meeting.audioFormat !== 'pcm-s16le-16000-mono') throw new Error('暂不支持此录音格式')
  const [root, path] = await Promise.all([realpath(transcriptsDir()), realpath(meeting.audioPath)])
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || extname(path) !== '.pcm') throw new Error('录音不在会议存档目录内，请核对文件位置')
  return path
}
function validateSize(size: number): void {
  if (!size || size % 2 || size > 0xffffffff - 36) throw new Error('录音为空、不完整或超出 WAV 播放大小限制')
}
export async function preparePlayback(id: string, owner: number): Promise<PlaybackInfo> {
  const generation = (generations.get(owner) || 0) + 1
  generations.set(owner, generation)
  try {
    const file = await open(await authorizedAudio(id), 'r')
    let size: number
    try { const stat = await file.stat(); if (!stat.isFile()) throw new Error('不是录音文件'); size = stat.size; validateSize(size) }
    finally { await file.close() }
    if (generations.get(owner) !== generation) return { ok: false, error: '已切换会议，请重新打开录音' }
    releasePlaybackOwner(owner)
    const token = randomBytes(24).toString('hex')
    leases.set(token, { id, owner, activeUntil: 0 })
    return { ok: true, token, url: `aftermeet-audio://recording/${token}`, durationSec: size / RATE }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return { ok: false, error: code === 'ENOENT' ? '录音文件已移动或删除；已有转写和纪要仍保留' : code ? '无法读取录音文件，请检查文件权限' : (e as Error).message }
  }
}
export function wavHeader(pcmBytes: number): Buffer {
  const h = Buffer.alloc(HEADER_BYTES)
  h.write('RIFF'); h.writeUInt32LE(pcmBytes + 36, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(RATE, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcmBytes, 40)
  return h
}
export function byteRange(range: string | null, size: number): { start: number; end: number } | null {
  if (!range) return { start: 0, end: size - 1 }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || (!match[1] && !match[2])) return null
  let start: number; let end: number
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return null; start = Math.max(0, size - suffix); end = size - 1 }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 }
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start ? { start, end } : null
}
/** Expose a virtual WAV using 64 KiB pulls, without duplicating or loading the PCM file. */
export async function playbackResponse(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const token = url.pathname.slice(1)
  const lease = leases.get(token)
  if (url.protocol !== 'aftermeet-audio:' || url.hostname !== 'recording' || url.search || !lease) return new Response(null, { status: 404 })
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
  let file: Awaited<ReturnType<typeof open>>
  try { file = await open(await authorizedAudio(lease.id), 'r') } catch { return new Response(null, { status: 404 }) }
  let handedOff = false
  try {
    const stat = await file.stat()
    if (!stat.isFile()) return new Response(null, { status: 404 })
    validateSize(stat.size)
    const total = stat.size + HEADER_BYTES
    const rangeHeader = request.headers.get('Range')
    const range = byteRange(rangeHeader, total)
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
    const headers: Record<string, string> = { 'Content-Type': 'audio/wav', 'Content-Length': String(range.end - range.start + 1),
      'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    if (rangeHeader) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total}`
    const status = rangeHeader ? 206 : 200
    if (request.method === 'HEAD') return new Response(null, { status, headers })
    const header = wavHeader(stat.size)
    let cursor = range.start; let closed = false
    const close = async (): Promise<void> => { if (!closed) { closed = true; await file.close() } }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (request.signal.aborted || !leases.has(token)) throw new Error('回放已关闭')
          if (cursor > range.end) { controller.close(); await close(); return }
          if (cursor < HEADER_BYTES) {
            const end = Math.min(HEADER_BYTES, range.end + 1)
            controller.enqueue(new Uint8Array(header.subarray(cursor, end))); cursor = end; return
          }
          const buffer = Buffer.alloc(Math.min(65536, range.end - cursor + 1))
          const { bytesRead } = await file.read(buffer, 0, buffer.length, cursor - HEADER_BYTES)
          if (!bytesRead) throw new Error('录音读取中断')
          cursor += bytesRead; controller.enqueue(new Uint8Array(buffer.subarray(0, bytesRead)))
        } catch (e) { controller.error(e); await close() }
      },
      cancel: close
    })
    handedOff = true
    return new Response(body, { status, headers })
  } catch { return new Response(null, { status: 422 }) }
  finally { if (!handedOff) await file.close() }
}
