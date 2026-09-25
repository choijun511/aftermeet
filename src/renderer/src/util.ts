import type { Meeting } from '../../shared/types'

// 渲染层通用小工具:时间/日期格式化。

export function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const pad = (n: number): string => (n < 10 ? '0' + n : '' + n)
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

// 秒 → mm:ss(转写时间戳)
export function fmtTs(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const pad = (n: number): string => (n < 10 ? '0' + n : '' + n)
  return `${pad(m)}:${pad(s)}`
}

// 时长(秒)→ 「1 小时 12 分」/「8 分钟」
export function fmtDuration(sec: number): string {
  if (!sec || sec < 60) return `${Math.max(1, Math.round(sec / 1))} 秒`
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h} 小时 ${rm} 分` : `${h} 小时`
}

// 时间戳 → 「今天 14:30」/「昨天 09:15」/「8月26日 16:00」
export function fmtWhen(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (sameDay(d, now)) return `今天 ${t}`
  if (sameDay(d, y)) return `昨天 ${t}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${t}`
}

export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 名字取首字/双字作头像
export function initials(name?: string): string {
  if (!name) return '?'
  const s = name.trim()
  if (/[一-龥]/.test(s)) return s.slice(-2)
  const parts = s.split(/\s+/).filter(Boolean)
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
}

/** Durable task state, not absence of notes, determines whether work is running. */
export function meetingStatus(m: Meeting): string {
  if (m.processing?.state === 'running') return m.processing.stage === 'recording' ? '录制中' : '处理中'
  if (m.processing?.state === 'paused') return '待继续'
  if (m.processing?.state === 'failed') return '待重试'
  if (m.notesStale) return '纪要待更新'
  if (m.minutes) return '已生成'
  return m.transcript.trim() ? '仅转写' : '待转写'
}
