// 崩溃/强退恢复:录制中若 app 被杀,stop() 没跑完 → 会议不会入库,但
// 实时存档(会中转写-<stamp>.txt)与完整音频(audio-<stamp>.pcm)已在磁盘。
// 启动时扫描这些"孤儿",为没有对应会议记录的补建条目(用实时草稿,不臆造纪要)。

import { readdirSync, existsSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { transcriptsDir, listMeetings, upsertMeeting } from './store'
import type { Meeting } from '../shared/types'

// 文件名戳 YYYY-MM-DD-HHMMSS → 起始毫秒(本地时区,与 session 生成规则一致)
function stampToMs(stamp: string): number | null {
  const m = stamp.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})$/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
}

// 从实时存档解析:标题(首行 "# xxx")+ 草稿正文 + 末段秒数
function parseArchive(raw: string): { title: string; transcript: string; lastSec: number } {
  const lines = raw.split('\n')
  let title = ''
  const segs: string[] = []
  let lastSec = 0
  for (const line of lines) {
    if (!title && line.startsWith('# ') && !line.startsWith('# 开始')) {
      title = line.slice(2).trim()
      continue
    }
    const m = line.match(/^\[(\d{1,2}):(\d{2})\]\s*(.*)$/)
    if (m) {
      lastSec = +m[1] * 60 + +m[2]
      const t = m[3].trim()
      if (t) segs.push(t)
    }
  }
  return { title, transcript: segs.join('\n'), lastSec }
}

/** 扫描并恢复孤儿录制,返回恢复的会议标题列表 */
export function recoverOrphans(): string[] {
  const dir = transcriptsDir()
  if (!existsSync(dir)) return []
  const meetings = listMeetings()
  const recovered: string[] = []

  for (const f of readdirSync(dir)) {
    const mm = f.match(/^会中转写-(\d{4}-\d{2}-\d{2}-\d{6})\.txt$/)
    if (!mm) continue
    const stamp = mm[1]
    const startedAt = stampToMs(stamp)
    if (!startedAt) continue

    const archPath = join(dir, f)
    // 已有对应会议(transcriptPath 指向它,或起始时间相近)→ 非孤儿,跳过
    const already = meetings.some(
      (m) => m.transcriptPath === archPath || Math.abs(m.startedAt - startedAt) < 5000
    )
    if (already) continue

    const pcmPath = join(dir, `audio-${stamp}.pcm`)
    const durFromPcm = existsSync(pcmPath) ? Math.floor(statSync(pcmPath).size / 32000) : 0

    let parsed: { title: string; transcript: string; lastSec: number }
    try {
      parsed = parseArchive(readFileSync(archPath, 'utf-8'))
    } catch {
      continue
    }
    const durationSec = durFromPcm || parsed.lastSec
    // 没有实质转写内容(空存档/中断/静音)不恢复,避免污染会议库;
    // 音频文件仍保留在磁盘,日后需要可手动处理。
    if (parsed.transcript.trim().length < 30) continue

    const meeting: Meeting = {
      id: `m_${startedAt}`,
      title: parsed.title || `恢复的会议 ${stamp}`,
      startedAt,
      endedAt: startedAt + durationSec * 1000,
      durationSec,
      transcript: parsed.transcript,
      transcriptPath: archPath,
      todos: [],
      llmError: '从中断的录制恢复(实时草稿);点「重新生成」可出纪要,或用「飞书妙记」换高质量转写',
      notesSource: 'local'
    }
    upsertMeeting(meeting)
    recovered.push(meeting.title)
  }
  return recovered
}
