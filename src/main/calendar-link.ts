import type { CalendarEvent, Meeting } from '../shared/types'
export function withCalendar(meeting: Meeting, event: CalendarEvent | null): Meeting {
  if (event !== null && (!event || typeof event.eventId !== 'string' || !event.eventId.trim() ||
    typeof event.title !== 'string' || !Number.isFinite(event.startTime) || !Number.isFinite(event.endTime) || event.endTime < event.startTime)) {
    throw new Error('日程数据无效，请重新加载后再选择')
  }
  return { ...meeting, calendar: event === null ? undefined : { ...event } }
}
