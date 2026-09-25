import Switch from '../components/Switch'
import React from 'react'
import { useState } from 'react'
import type { Meeting } from '../../../shared/types'
import { fmtWhen } from '../util'
import { IcCheck, IcCheckSquare, IcChevronRight } from '../icons'

interface Props {
  meetings: Meeting[]
  onChanged: () => void
  onOpen: (id: string) => void
}

export default function TodosView({ meetings, onChanged, onOpen }: Props): React.JSX.Element {
  const [hideDone, setHideDone] = useState(false)

  const groups = meetings
    .map((m) => ({ m, todos: hideDone ? m.todos.filter((t) => !t.done) : m.todos }))
    .filter((g) => g.todos.length > 0)

  const totalOpen = meetings.reduce((n, m) => n + m.todos.filter((t) => !t.done).length, 0)

  const toggle = async (mid: string, tid: string): Promise<void> => {
    await window.api.toggleTodo(mid, tid)
    onChanged()
  }

  return (
    <div className="content">
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <div className="page-h">待办</div>
          <div className="page-sub">{totalOpen} 项未完成,按会议分组</div>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            隐藏已完成
          </span>
          <Switch label="隐藏已完成" checked={hideDone} onChange={setHideDone} />
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card pad-lg">
          <div className="empty-state">
            <IcCheckSquare size={28} />
            <div style={{ marginTop: 10 }}>没有待办事项 🎉</div>
          </div>
        </div>
      ) : (
        <div className="grid2">
          {groups.map(({ m, todos }) => (
            <div key={m.id} className="card pad">
              <a href="#meeting" className="row meeting-link" style={{ marginBottom: 12 }} onClick={(e) => { e.preventDefault(); onOpen(m.id) }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    className="card-title"
                    style={{
                      fontSize: 14,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {m.title}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {fmtWhen(m.startedAt)}
                  </div>
                </div>
                <IcChevronRight size={16} className="muted" />
              </a>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {todos.map((t) => (
                  <div key={t.id} className={`todo-item${t.done ? ' done' : ''}`}>
                    <input type="checkbox" className="todo-check" checked={t.done}
                      aria-label={`完成待办：${t.text}`} onChange={() => toggle(m.id, t.id)} />
                    <div className="tx">
                      {t.text}
                      {(t.owner || t.due) && (
                        <span className="muted">
                          {' · '}
                          {[t.owner, t.due].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
