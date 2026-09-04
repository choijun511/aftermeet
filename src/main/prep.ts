// 会前简报:周期性飞书会议开会前,汇总「上次同系列会议的重点纪要 + 遗留待办 + 本场关注」。
// 上次记录来源:优先本地录制(已有纪要,快),兜底飞书妙记(搜过去同标题会→拉妙记→生成纪要)。

import { listMeetings } from './store'
import { searchMeetingsRange, fetchMiaoji } from './feishu'
import { generateNotes, generateMeetingFocus } from './llm'
import type { CalendarEvent, MeetingPrep } from '../shared/types'

/** event_id = <系列UUID>_<后缀>;后缀是时间戳=周期性实例,_0=单次会 */
export function eventSeriesId(eventId?: string): string | null {
  if (!eventId) return null
  const i = eventId.lastIndexOf('_')
  return i > 0 ? eventId.slice(0, i) : eventId
}
export function isRecurringEvent(eventId?: string): boolean {
  if (!eventId) return false
  const i = eventId.lastIndexOf('_')
  const suffix = i > 0 ? eventId.slice(i + 1) : ''
  return /^\d{6,}$/.test(suffix) // 时间戳后缀 = 周期性
}

export async function buildMeetingPrep(event: CalendarEvent): Promise<MeetingPrep> {
  const sid = eventSeriesId(event.eventId)
  const title = event.title.trim()

  // ---- 1) 本地:同系列(eventId 前缀)或同标题,且早于本场,取最近一次 ----
  const local = listMeetings().find((m) => {
    if (m.startedAt >= event.startTime) return false
    if (!m.minutes) return false
    const ms = eventSeriesId(m.calendar?.eventId)
    if (sid && ms && ms === sid) return true
    return !!title && m.title.trim() === title
  })

  if (local && local.minutes) {
    const openTodos = local.todos.filter((t) => !t.done).map((t) => ({ text: t.text, owner: t.owner }))
    const focus = await generateMeetingFocus(event.title, local.minutes, openTodos)
    return {
      hasPrev: true,
      source: 'local',
      last: { title: local.title, when: local.startedAt, minutes: local.minutes },
      openTodos,
      focus
    }
  }

  // ---- 2) 飞书兜底:搜过去 60 天同标题会 → 拉妙记 → 生成纪要 ----
  if (title) {
    try {
      const cands = await searchMeetingsRange(
        title,
        event.startTime - 60 * 864e5,
        event.startTime - 60 * 1000
      )
      // 标题匹配、非本场;搜索结果通常按时间倒序,取第一条有妙记的
      for (const c of cands.slice(0, 6)) {
        if (!c.title.includes(title) && !title.includes(c.title)) continue
        const mj = await fetchMiaoji({ meetingId: c.meetingId })
        if (!mj.ok || !mj.transcript) continue
        const notes = await generateNotes(mj.transcript)
        const openTodos = notes.todos.map((t) => ({ text: t.text, owner: t.owner }))
        const focus = await generateMeetingFocus(event.title, notes.minutes, openTodos)
        return {
          hasPrev: true,
          source: 'feishu',
          last: { title: mj.title || c.title, when: 0, minutes: notes.minutes },
          openTodos,
          focus
        }
      }
    } catch (e) {
      return { hasPrev: false, openTodos: [], focus: [], error: e instanceof Error ? e.message : String(e) }
    }
  }

  return { hasPrev: false, openTodos: [], focus: [] }
}
