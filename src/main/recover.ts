// Recovery is discovery only: startup never submits audio or calls a paid model.
import { readdirSync, existsSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { transcriptsDir, listMeetings, upsertMeeting, deletedMeetingIds } from './store'
import type { Meeting } from '../shared/types'

function stampToMs(stamp: string): number | null {
  if (/^m_\d+$/.test(stamp)) return Number(stamp.slice(2))
  const m = stamp.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})$/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null
}
function parseArchive(path: string): { title: string; transcript: string; lastSec: number } {
  if (!existsSync(path)) return { title: '', transcript: '', lastSec: 0 }
  const lines = readFileSync(path, 'utf8').split('\n')
  let title = ''; let lastSec = 0
  const segs: string[] = []
  for (const line of lines) {
    if (!title && line.startsWith('# ') && !line.startsWith('# 开始')) { title = line.slice(2).trim(); continue }
    const m = line.match(/^\[(\d+):(\d{2})\]\s*(.*)$/)
    if (m) { lastSec = +m[1] * 60 + +m[2]; if (m[3].trim()) segs.push(m[3].trim()) }
  }
  return { title, transcript: segs.join('\n'), lastSec }
}
export function recoverOrphans(): string[] {
  const dir = transcriptsDir()
  const meetings = listMeetings()
  const deleted = new Set(deletedMeetingIds())
  const recovered = new Set<string>()
  const stamps = new Set<string>()
  for (const f of readdirSync(dir)) {
    const match = f.match(/^(?:audio-(.+)\.pcm|会中转写-(.+)\.txt)$/)
    if (match) stamps.add(match[1] || match[2])
  }
  for (const stamp of stamps) {
    const startedAt = stampToMs(stamp)
    if (!startedAt || deleted.has(`m_${startedAt}`)) continue
    const archPath = join(dir, `会中转写-${stamp}.txt`)
    const pcmPath = join(dir, `audio-${stamp}.pcm`)
    let m = meetings.find((m) => m.audioPath === pcmPath || m.transcriptPath === archPath || m.id === `m_${startedAt}`)
    // Old records used second-resolution filenames but millisecond-resolution IDs.
    if (!m && !stamp.startsWith('m_')) m = meetings.find((m) => Math.floor(m.startedAt / 1000) === Math.floor(startedAt / 1000))
    if (m && deleted.has(m.id)) continue
    if ([...deleted].some((id) => Math.floor(Number(id.slice(2)) / 1000) === Math.floor(startedAt / 1000))) continue
    const bytes = existsSync(pcmPath) ? statSync(pcmPath).size : 0
    const parsed = parseArchive(archPath)
    if (!m) {
      if (!bytes && !parsed.transcript) continue
      m = { id: `m_${startedAt}`, title: parsed.title || `恢复的会议 ${stamp}`, startedAt,
        durationSec: bytes / 32000 || parsed.lastSec, transcript: parsed.transcript,
        transcriptPath: existsSync(archPath) ? archPath : undefined, todos: [], notesSource: 'local',
        processing: { stage: 'saved', state: 'paused', message: '已找回录音/草稿，请选择转写方式继续处理', updatedAt: Date.now() } }
      meetings.push(m); recovered.add(m.title)
    }
    const before = JSON.stringify(m)
    if (bytes) {
      m.audioPath = pcmPath; m.audioFormat = 'pcm-s16le-16000-mono'; m.audioBytes = bytes
      if (!m.endedAt) m.durationSec = bytes / 32000
    }
    if (!m.transcript && parsed.transcript) m.transcript = parsed.transcript
    if (!m.endedAt || m.processing?.state === 'running') {
      const stage = m.processing?.stage === 'summarizing' ? 'summarizing' :
        m.processing?.stage === 'transcribing' ? 'transcribing' : 'saved'
      m.endedAt ||= m.startedAt + m.durationSec * 1000
      m.processing = { ...m.processing, stage, state: 'paused', updatedAt: Date.now(),
        message: stage === 'summarizing' ? '纪要生成已中断，转写已保存；可重新生成纪要' : '处理已中断，已保存的录音和分段结果可继续处理' }
      recovered.add(m.title)
    }
    if (!m.transcript.trim() && bytes && !m.processing) {
      m.processing = { stage: 'saved', state: 'paused', message: '录音已保留，尚无转写文字', updatedAt: Date.now() }
    }
    if (JSON.stringify(m) !== before || recovered.has(m.title)) upsertMeeting(m)
  }
  // Includes a job whose audio has since been moved or deleted.
  for (const m of meetings) {
    if (m.processing?.state === 'running') {
      m.processing.state = 'paused'; m.processing.updatedAt = Date.now()
      m.processing.message = '处理已中断；请核对录音文件后继续'
      upsertMeeting(m); recovered.add(m.title)
    }
  }
  return [...recovered]
}
