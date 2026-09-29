import React, { useEffect, useState } from 'react'
import type { CalendarEvent, Meeting } from '../../../shared/types'
import Modal from '../components/Modal'

function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function dayNumber(value: string): number { return Date.parse(`${value}T00:00:00Z`) / 86400000 }
export default function CalendarLink({ meeting, busy, onChanged }: { meeting: Meeting; busy: boolean; onChanged: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(localDate(meeting.startedAt))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setError(''); setEvents([])
    const offset = dayNumber(date) - dayNumber(localDate(Date.now()))
    if (!Number.isFinite(offset)) { setLoading(false); return }
    window.api.listMeetingsByDate(offset).then(result => {
      if (cancelled) return
      if (!result.ok) setError(result.error || '日历读取失败，请重试')
      else setEvents(result.events)
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '日历读取失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, date, retry])
  async function save(event: CalendarEvent | null): Promise<void> {
    setSaving(true); setError('')
    try {
      const result = await window.api.linkCalendar(meeting.id, event)
      if (!result.ok) throw new Error(result.error || '关联未保存，请重试')
      onChanged(); setOpen(false)
    } catch (e) { setError(e instanceof Error ? e.message : '关联失败') }
    finally { setSaving(false) }
  }
  return <>
    <div className="row" style={{ gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
      <span className="muted">飞书日历：{meeting.calendar ? `${meeting.calendar.title} · ${new Date(meeting.calendar.startTime).toLocaleString('zh-CN')}` : '未关联日程'}</span>
      <button className="btn soft" disabled={busy} onClick={() => { setDate(localDate(meeting.startedAt)); setOpen(true) }}>{meeting.calendar ? '更换日程' : '关联日历日程'}</button>
    </div>
    {open && <div className="modal-scrim" onClick={() => !saving && setOpen(false)}><Modal label="关联飞书日历日程" onClose={() => !saving && setOpen(false)}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}><h2 style={{ margin: 0 }}>关联飞书日历日程</h2><button className="btn soft" disabled={saving} onClick={() => setOpen(false)}>关闭</button></div>
      <p className="muted">选择这段录音对应的日程，仅保存关联，不修改转写、纪要或飞书日历。</p>
      <div className="row" style={{ gap: 12, marginBottom: 16 }}><label htmlFor="calendar-link-date">日程日期</label><input id="calendar-link-date" type="date" className="txt-input" style={{ width: 'auto' }} value={date} disabled={saving} onChange={e => setDate(e.target.value)} /><button className="btn soft" disabled={loading || saving || !date} onClick={() => setRetry(r => r+1)}>刷新</button></div>
      {error && <p className="banner err" role="alert">{error}</p>}
      {loading ? <p role="status">正在读取日历…</p> : !error && <div style={{ maxHeight: 320, overflowY: 'auto', display: 'grid', gap: 10 }}>
        {events.length === 0 && <p>这一天没有日程，可选择其他日期。</p>}
        {events.map(event => <button key={event.eventId} className="opt-tile plain-button" disabled={saving || busy} onClick={() => void save(event)}>
          <strong>{event.title}</strong><span className="muted">{new Date(event.startTime).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}–{new Date(event.endTime).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}{event.eventId === meeting.calendar?.eventId ? ' · 当前关联' : ''}</span>
        </button>)}
      </div>}
      {meeting.calendar && <button className="btn soft" style={{ marginTop: 16 }} disabled={saving || busy} onClick={() => void save(null)}>解除关联</button>}
      {saving && <p role="status">正在保存关联…</p>}
    </Modal></div>}
  </>
}
