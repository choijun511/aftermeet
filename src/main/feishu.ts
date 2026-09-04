// 飞书集成:通过 lark-cli 读取今日日历会议(用于「今日会议」展示与录制关联)。
// 只读日历,不改任何飞书数据。lark-cli 会自动刷新 token;刷新失败则报错让 UI 提示重新授权。

import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CalendarEvent } from '../shared/types'

const CANDIDATES = ['/usr/local/bin/lark-cli', '/opt/homebrew/bin/lark-cli']

function larkCliPath(): string {
  if (process.env.LARK_CLI && existsSync(process.env.LARK_CLI)) return process.env.LARK_CLI
  for (const p of CANDIDATES) if (existsSync(p)) return p
  return 'lark-cli'
}

export function feishuAvailable(): boolean {
  return existsSync('/usr/local/bin/lark-cli') || existsSync('/opt/homebrew/bin/lark-cli')
}

function runLark(args: string[], timeoutMs = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(larkCliPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('lark-cli 超时'))
    }, timeoutMs)
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || `lark-cli 退出码 ${code}`))
    })
  })
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

interface RawEvent {
  event_id?: string
  summary?: string
  start_time?: { datetime?: string }
  end_time?: { datetime?: string }
  event_organizer?: { display_name?: string }
  self_rsvp_status?: string
  vchat?: { meeting_url?: string }
}

function mapRaw(list: RawEvent[], onDay: Date): CalendarEvent[] {
  const events: CalendarEvent[] = []
  for (const e of list ?? []) {
    const startISO = e?.start_time?.datetime
    if (!startISO || !e.event_id) continue
    const st = new Date(startISO)
    if (Number.isNaN(st.getTime()) || !sameLocalDay(st, onDay)) continue
    const et = e?.end_time?.datetime ? new Date(e.end_time.datetime) : st
    const suffix = e.event_id.slice(e.event_id.lastIndexOf('_') + 1)
    events.push({
      eventId: e.event_id,
      title: e.summary || '(无标题会议)',
      startTime: st.getTime(),
      endTime: Number.isNaN(et.getTime()) ? st.getTime() : et.getTime(),
      organizer: e?.event_organizer?.display_name,
      rsvpStatus: e?.self_rsvp_status,
      meetingUrl: e?.vchat?.meeting_url,
      hasVchat: !!e?.vchat?.meeting_url,
      recurring: /^\d{6,}$/.test(suffix) // 时间戳后缀 = 周期性
    })
  }
  events.sort((a, b) => a.startTime - b.startTime)
  return events
}

export async function listTodayMeetings(): Promise<CalendarEvent[]> {
  const raw = await runLark(['calendar', '+agenda', '--format', 'json'])
  let parsed: { ok?: boolean; data?: RawEvent[]; error?: unknown }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('lark-cli 返回无法解析')
  }
  if (parsed.ok === false) throw new Error('飞书返回错误(可能需重新授权)')
  return mapRaw(parsed.data ?? [], new Date())
}

/** 指定日期(相对今天的偏移天数,0=今天,-1=昨天,1=明天)的会议。
 *  lark-cli agenda 默认返回一段日期范围,这里在本地按目标日筛选。 */
export async function listMeetingsByDate(dayOffset: number): Promise<CalendarEvent[]> {
  const target = new Date()
  target.setDate(target.getDate() + dayOffset)
  // 若 CLI 支持 --date 则用之;否则退回默认 agenda 再本地筛选。
  const y = target.getFullYear()
  const mo = String(target.getMonth() + 1).padStart(2, '0')
  const d = String(target.getDate()).padStart(2, '0')
  let raw: string
  try {
    raw = await runLark(['calendar', '+agenda', '--date', `${y}-${mo}-${d}`, '--format', 'json'])
  } catch {
    raw = await runLark(['calendar', '+agenda', '--format', 'json'])
  }
  let parsed: { ok?: boolean; data?: RawEvent[] }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('lark-cli 返回无法解析')
  }
  if (parsed.ok === false) throw new Error('飞书返回错误(可能需重新授权)')
  return mapRaw(parsed.data ?? [], target)
}

/** 飞书状态:CLI 是否存在 + 是否已授权(能成功拉一次 agenda)。 */
export async function feishuStatus(): Promise<{ available: boolean; authed: boolean }> {
  if (!feishuAvailable()) return { available: false, authed: false }
  try {
    await runLark(['calendar', '+agenda', '--format', 'json'], 12000)
    return { available: true, authed: true }
  } catch {
    return { available: true, authed: false }
  }
}

// ============ 飞书妙记(会议纪要逐字稿)============
// 妙记质量远高于本地 whisper(说话人分离+精确时间戳+商用级准确率),
// 有妙记的飞书会可优先用它生成纪要/待办。

/** 在指定 cwd 下跑 lark-cli(妙记 artifact 需要用相对 output-dir 落地) */
function runLarkIn(args: string[], cwd: string, timeoutMs = 40000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(larkCliPath(), args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('lark-cli 超时'))
    }, timeoutMs)
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    proc.on('exit', () => {
      clearTimeout(timer)
      resolve(out) // 即使非 0 也返回 stdout,由调用方解析 JSON 判断成败
    })
  })
}

export interface MiaojiCandidate {
  meetingId: string
  title: string
  info: string
}

/** 从妙记链接里提取 minute token(形如 .../minutes/<token>) */
export function extractMinuteToken(input: string): string | null {
  const s = input.trim()
  const m = s.match(/minutes\/([A-Za-z0-9]+)/)
  if (m) return m[1]
  // 也允许直接粘 token
  if (/^[A-Za-z0-9]{16,}$/.test(s)) return s
  return null
}

/** 按标题关键词 + 时间窗搜索会议记录(用于自动匹配妙记) */
export async function searchMeetings(
  query: string,
  aroundMs: number
): Promise<MiaojiCandidate[]> {
  return searchMeetingsRange(query, aroundMs - 24 * 3600 * 1000, aroundMs + 24 * 3600 * 1000)
}

/** 在指定时间范围内按关键词搜会议(会前简报找上一次同系列会用) */
export async function searchMeetingsRange(
  query: string,
  startMs: number,
  endMs: number
): Promise<MiaojiCandidate[]> {
  const start = new Date(startMs).toISOString().slice(0, 10)
  const end = new Date(endMs).toISOString().slice(0, 10)
  const args = ['vc', '+search', '--start', start, '--end', end, '--page-size', '30', '--format', 'json']
  if (query.trim()) args.push('--query', query.trim())
  const raw = await runLark(args, 20000)
  let parsed: { ok?: boolean; data?: { items?: { id?: string; display_info?: string }[] } }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('lark-cli 搜索返回无法解析')
  }
  const items = parsed?.data?.items ?? []
  return items
    .filter((it) => it.id)
    .map((it) => {
      const info = (it.display_info ?? '').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      const title = info.split('\n')[0] || '(无标题会议)'
      return { meetingId: it.id!, title, info }
    })
}

/** 把妙记 transcript.txt 解析成「说话人: 文本」逐轮稿(喂 Gemini + 展示都好用) */
function parseMiaojiTranscript(raw: string): string {
  const lines = raw.split('\n')
  const turns: { speaker: string; text: string }[] = []
  let cur: { speaker: string; text: string } | null = null
  let started = false
  const head = /^说话人\s*(\d+)\s+[\d:.]+\s*$/
  for (const line of lines) {
    const m = line.match(head)
    if (m) {
      started = true
      if (cur && cur.text.trim()) turns.push(cur)
      cur = { speaker: `说话人${m[1]}`, text: '' }
      continue
    }
    if (!started) continue // 跳过头部(日期/时长/关键词)
    if (cur) cur.text += (cur.text ? ' ' : '') + line.trim()
  }
  if (cur && cur.text.trim()) turns.push(cur)
  return turns
    .filter((t) => t.text.trim())
    .map((t) => `${t.speaker}：${t.text.trim()}`)
    .join('\n')
}

/** 拉取妙记逐字稿。可用 meetingId 或 minuteToken 定位。 */
export async function fetchMiaoji(opts: {
  meetingId?: string
  minuteToken?: string
}): Promise<{ ok: boolean; title?: string; transcript?: string; error?: string }> {
  const workDir = join(tmpdir(), `aftermeet-miaoji-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  try {
    const args = ['vc', '+notes', '--output-dir', 'out', '--overwrite', '--format', 'json']
    if (opts.minuteToken) args.push('--minute-tokens', opts.minuteToken)
    else if (opts.meetingId) args.push('--meeting-ids', opts.meetingId)
    else return { ok: false, error: '缺少 meetingId 或 minuteToken' }

    const raw = await runLarkIn(args, workDir)
    let parsed: {
      data?: { notes?: { error?: string; title?: string; artifacts?: { transcript_file?: string } }[] }
    }
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, error: '妙记返回无法解析' }
    }
    const note = parsed?.data?.notes?.[0]
    if (!note) return { ok: false, error: '未返回妙记数据' }
    if (note.error) {
      return { ok: false, error: note.error === 'no notes available for this meeting' ? '这场会议没有妙记' : note.error }
    }
    // 读落地的 transcript 文件
    const outDir = join(workDir, 'out')
    let transcriptPath = ''
    if (note.artifacts?.transcript_file) {
      // CLI 返回的是相对 workDir 的路径
      transcriptPath = join(workDir, note.artifacts.transcript_file)
    }
    if (!transcriptPath || !existsSync(transcriptPath)) {
      // 兜底:在 out 下找 transcript.txt
      if (existsSync(outDir)) {
        for (const sub of readdirSync(outDir)) {
          const p = join(outDir, sub, 'transcript.txt')
          if (existsSync(p)) {
            transcriptPath = p
            break
          }
        }
      }
    }
    if (!transcriptPath || !existsSync(transcriptPath)) {
      return { ok: false, error: '妙记转写文件未找到' }
    }
    const rawTxt = readFileSync(transcriptPath, 'utf-8')
    const transcript = parseMiaojiTranscript(rawTxt)
    if (!transcript.trim()) return { ok: false, error: '妙记转写为空' }
    return { ok: true, title: note.title, transcript }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
