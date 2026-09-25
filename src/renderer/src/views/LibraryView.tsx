import React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Meeting } from '../../../shared/types'
import { fmtWhen, fmtDuration, initials, meetingStatus } from '../util'
import { IcSearch, IcCheck, IcLibrary } from '../icons'

type Filter = 'all' | 'week' | 'minutes'

interface Props {
  meetings: Meeting[]
  onOpen: (id: string) => void
  search: string
  onSearch: (v: string) => void
  autoFocus: React.MutableRefObject<boolean>
}

export default function LibraryView({
  meetings,
  onOpen,
  search,
  onSearch,
  autoFocus
}: Props): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus.current) {
      inputRef.current?.focus()
      autoFocus.current = false
    }
  }, [autoFocus])

  const rows = useMemo(() => {
    const weekAgo = Date.now() - 7 * 864e5
    const q = search.trim().toLowerCase()
    return meetings.filter((m) => {
      if (filter === 'week' && m.startedAt < weekAgo) return false
      if (filter === 'minutes' && !m.minutes) return false
      if (q && !(`${m.title} ${m.transcript}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [meetings, filter, search])

  return (
    <div className="content">
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <div className="page-h">会议库</div>
          <div className="page-sub">共 {meetings.length} 场会议</div>
        </div>
        <div className="spacer" />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <IcSearch size={15} className="muted" style={{ position: 'absolute', left: 14 }} />
          <input
            ref={inputRef}
            className="search-input"
            style={{ paddingLeft: 38 }}
            aria-label="搜索标题或转写内容"
            placeholder="搜索标题或转写内容…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="row" style={{ marginBottom: 6 }}>
        <div className="filter-group">
          {(
            [
              ['all', '全部'],
              ['week', '本周'],
              ['minutes', '有纪要']
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} aria-pressed={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card pad-lg" style={{ marginTop: 12 }}>
        <div className="tbl-head">
          <span style={{ flex: 1 }}>会议</span>
          <span style={{ width: 150 }}>时间</span>
          <span style={{ width: 90 }}>时长</span>
          <span style={{ width: 90 }}>待办</span>
          <span style={{ width: 100 }}>状态</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <IcLibrary size={28} />
            <div style={{ marginTop: 10 }}>
              {search ? '没有匹配的会议' : '还没有录制过会议'}
            </div>
          </div>
        ) : (
          rows.map((m) => {
            const undone = m.todos.filter((t) => !t.done).length
            return (
              <a href="#meeting" key={m.id} className="tbl-row" onClick={(e) => { e.preventDefault(); onOpen(m.id) }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div className="avatar">{initials(m.title)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {m.title}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {m.minutes?.topic || (m.transcript ? m.transcript.slice(0, 40) : '无转写')}
                    </div>
                  </div>
                </div>
                <span style={{ width: 150, fontSize: 12.5 }} className="muted">
                  {fmtWhen(m.startedAt)}
                </span>
                <span style={{ width: 90, fontSize: 12.5 }} className="muted tnum">
                  {fmtDuration(m.durationSec)}
                </span>
                <span style={{ width: 90 }}>
                  {undone > 0 ? (
                    <span className="chip coral">{undone} 待办</span>
                  ) : m.todos.length > 0 ? (
                    <span className="chip green">
                      <IcCheck size={11} /> 完成
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>
                      —
                    </span>
                  )}
                </span>
                <span style={{ width: 100 }}>
                  <span className={`chip ${meetingStatus(m) === '已生成' ? 'green' : 'gray'}`}>{meetingStatus(m)}</span>
                </span>
              </a>
            )
          })
        )}
      </div>
    </div>
  )
}
