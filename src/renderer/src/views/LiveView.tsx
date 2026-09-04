import React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { CalendarEvent, Meeting, StatusEvent, TranscriptSegment } from '../../../shared/types'
import { fmtClock, fmtTs, hhmm } from '../util'
import { IcStop, IcMic, IcCalendar, IcFolder, IcSparkles, IcChevronRight } from '../icons'

interface Props {
  status: StatusEvent
  segments: TranscriptSegment[]
  meetings: Meeting[]
  hasKey: boolean
  onStart: (title?: string, calendar?: CalendarEvent | null) => void
  onStop: () => void
  onAssociate: (meetingId: string, ev: CalendarEvent) => void
  onOpen: (id: string) => void
}

export default function LiveView({
  status,
  segments,
  meetings,
  hasKey,
  onStart,
  onStop,
  onAssociate,
  onOpen
}: Props): React.JSX.Element {
  const recording = status.state === 'recording' || status.state === 'starting'
  const busy = status.state === 'transcribing' || status.state === 'summarizing'

  if (!recording && !busy) {
    return <StartPanel hasKey={hasKey} onStart={onStart} />
  }
  return (
    <LiveRecording
      status={status}
      segments={segments}
      meetings={meetings}
      busy={busy}
      onStop={onStop}
      onAssociate={onAssociate}
      onOpen={onOpen}
    />
  )
}

// ---- 录制中 ----
function LiveRecording({
  status,
  segments,
  meetings,
  busy,
  onStop,
  onAssociate,
  onOpen
}: {
  status: StatusEvent
  segments: TranscriptSegment[]
  meetings: Meeting[]
  busy: boolean
  onStop: () => void
  onAssociate: (meetingId: string, ev: CalendarEvent) => void
  onOpen: (id: string) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const finals = segments.filter((s) => s.id !== 'live')
  const pending = segments.find((s) => s.id === 'live' && s.text.trim())
  const words = finals.reduce((n, s) => n + s.text.length, 0)
  const current = meetings.find((m) => m.id === status.meetingId) || null

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [segments])

  const [showAssoc, setShowAssoc] = useState(false)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  useEffect(() => {
    if (showAssoc && events.length === 0) {
      window.api.listMeetingsByDate(0).then((r) => setEvents(r.ok ? r.events : []))
    }
  }, [showAssoc, events.length])

  return (
    <div className="content cols">
      {/* 左:实时转写 */}
      <div style={{ flex: '1.6', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="row">
          <span className="rec-live-dot" />
          <div>
            <div className="page-h" style={{ fontSize: 19 }}>
              {busy ? '正在生成纪要…' : '录制中'}
            </div>
            <div className="page-sub">{current?.title || '未命名会议'}</div>
          </div>
          <div className="spacer" />
          <div className="tnum" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {fmtClock(status.durationSec)}
          </div>
        </div>

        <div
          className="card pad-lg"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="card-title">实时转写</div>
            <div className="spacer" />
            <span className="muted" style={{ fontSize: 12 }}>
              {finals.length} 句 · {words} 字
            </span>
          </div>
          <div ref={scrollRef} className="tr-list" style={{ flex: 1 }}>
            {finals.length === 0 && !pending && (
              <div className="empty-state" style={{ padding: '48px 0' }}>
                <IcMic size={26} />
                <div style={{ marginTop: 10 }}>正在聆听…开始说话后字幕会实时出现</div>
              </div>
            )}
            {finals.map((s) => (
              <div key={s.id} className="live-row">
                <div className="ts tnum">{fmtTs(s.t)}</div>
                <p className="tx">{s.text}</p>
              </div>
            ))}
            {pending && (
              <div className="live-row pending">
                <div className="ts tnum">{fmtTs(pending.t)}</div>
                <p className="tx">{pending.text}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 右:控制 + 关联 + 统计 */}
      <div style={{ flex: '1', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <button
          className="btn stop"
          style={{ justifyContent: 'center', width: '100%', padding: '15px' }}
          onClick={onStop}
          disabled={busy}
        >
          <IcStop size={16} /> {busy ? '处理中…' : '停止并生成纪要'}
        </button>

        {/* 关联会议(黑卡) */}
        <div className="dark-card" style={{ padding: '18px 20px' }}>
          <div className="row" style={{ marginBottom: current?.calendar ? 8 : 0 }}>
            <IcCalendar size={16} />
            <div className="card-title" style={{ color: '#fff', fontSize: 14 }}>
              关联会议
            </div>
            <div className="spacer" />
            {status.meetingId && (
              <span
                className="link"
                style={{ color: '#b9bdc9' }}
                onClick={() => setShowAssoc((v) => !v)}
              >
                {showAssoc ? '收起' : '选择'}
              </span>
            )}
          </div>
          {current?.title && !showAssoc && (
            <div style={{ fontSize: 14, fontWeight: 700 }}>{current.title}</div>
          )}
          {showAssoc && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {events.length === 0 && (
                <div style={{ fontSize: 12, color: '#b9bdc9' }}>今天没有可关联的日程</div>
              )}
              {events.map((e) => (
                <div
                  key={e.eventId}
                  className="chip dark-tint"
                  style={{ cursor: 'pointer', padding: '7px 12px', justifyContent: 'space-between' }}
                  onClick={() => {
                    if (status.meetingId) onAssociate(status.meetingId, e)
                    setShowAssoc(false)
                  }}
                >
                  <span>
                    {hhmm(e.startTime)} · {e.title}
                  </span>
                  <IcChevronRight size={13} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 统计 */}
        <div className="card pad">
          <div className="card-title" style={{ marginBottom: 12 }}>
            本场统计
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Stat label="时长" value={fmtClock(status.durationSec)} />
            <Stat label="句数" value={String(finals.length)} />
            <Stat label="字数" value={String(words)} />
            <Stat label="状态" value={status.active ? '收音中' : '静音'} />
          </div>
        </div>

        <button className="btn ghost" style={{ justifyContent: 'center' }} onClick={() => window.api.openTranscriptsFolder()}>
          <IcFolder size={14} /> 打开转写存档
        </button>

        {busy && current && (
          <button className="btn soft" style={{ justifyContent: 'center' }} onClick={() => onOpen(current.id)}>
            <IcSparkles size={14} /> 查看会议详情
          </button>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="tile" style={{ padding: '12px 14px' }}>
      <div className="muted" style={{ fontSize: 11.5 }}>
        {label}
      </div>
      <div className="tnum" style={{ fontWeight: 800, fontSize: 17, marginTop: 2 }}>
        {value}
      </div>
    </div>
  )
}

// ---- 待录制(空闲进入 live)----
function StartPanel({
  hasKey,
  onStart
}: {
  hasKey: boolean
  onStart: (title?: string, calendar?: CalendarEvent | null) => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  useEffect(() => {
    window.api.listMeetingsByDate(0).then((r) => setEvents(r.ok ? r.events : []))
  }, [])

  return (
    <div className="content" style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 520, marginTop: 28 }}>
        <div className="card pad-lg" style={{ padding: '30px 30px' }}>
          <div className="brand" style={{ justifyContent: 'center', marginBottom: 10 }}>
            <div className="logo" style={{ width: 46, height: 46, borderRadius: 15 }}>
              <IcMic size={22} />
            </div>
          </div>
          <div className="page-h" style={{ textAlign: 'center' }}>
            准备录制
          </div>
          <div className="page-sub" style={{ textAlign: 'center', marginBottom: 20 }}>
            系统音频与麦克风将在本地转写
          </div>

          <input
            className="txt-input"
            style={{ width: '100%', marginBottom: 14, background: 'var(--tile)' }}
            placeholder="会议标题(可留空,稍后可改名)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {events.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                关联今日日程
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {events.slice(0, 4).map((e) => (
                  <div
                    key={e.eventId}
                    className="opt-tile"
                    onClick={() => onStart(e.title, e)}
                  >
                    <IcCalendar size={16} className="muted" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{e.title}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {hhmm(e.startTime)}–{hhmm(e.endTime)}
                      </div>
                    </div>
                    <IcChevronRight size={14} className="muted" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            className="btn coral-lg"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => onStart(title)}
          >
            <span className="rec-dot" style={{ color: '#fff' }}>
              ●
            </span>
            开始录制
          </button>
          {!hasKey && (
            <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 12 }}>
              未配置 Gemini Key,将只转写、不自动生成纪要
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
