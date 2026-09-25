import React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { Meeting, StatusEvent } from '../../../shared/types'
import { renderMarkdown } from '../md'
import { fmtWhen, fmtDuration } from '../util'
import {
  IcArrowLeft,
  IcEdit,
  IcRefresh,
  IcTrash,
  IcFolder,
  IcCheck,
  IcAlert,
  IcSparkles,
  IcSend,
  IcDoc,
  IcX,
  IcVideo
} from '../icons'

interface Props {
  meeting: Meeting | null
  status: StatusEvent
  onBack: () => void
  onChanged: () => void
}

type ChatMsg = { role: 'user' | 'ai'; text: string; pending?: boolean }

export default function MeetingDetailView({
  meeting,
  status,
  onBack,
  onChanged
}: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [chat, setChat] = useState<ChatMsg[]>([])
  const [q, setQ] = useState('')
  const [asking, setAsking] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  // 飞书妙记
  const [feishuModal, setFeishuModal] = useState(false)
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<{ meetingId: string; title: string; info: string }[]>([])
  const [minuteInput, setMinuteInput] = useState('')
  const [applying, setApplying] = useState(false)
  const [feishuErr, setFeishuErr] = useState('')

  useEffect(() => {
    setChat([])
    setEditing(false)
    setFeishuModal(false)
    setFeishuErr('')
    setMinuteInput('')
    setCandidates([])
  }, [meeting?.id])
  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat])

  if (!meeting) {
    return (
      <div className="content">
        <button className="back-btn" onClick={onBack}>
          <IcArrowLeft size={17} />
        </button>
        <div className="empty-state">会议不存在或已删除</div>
      </div>
    )
  }

  const m = meeting
  const processing =
    !m.minutes && !m.llmError && (status.state === 'summarizing' || status.state === 'transcribing')

  const saveTitle = async (): Promise<void> => {
    if (title.trim() && title.trim() !== m.title) {
      await window.api.renameMeeting(m.id, title.trim())
      onChanged()
    }
    setEditing(false)
  }
  const regen = async (mode: 'standard' | 'deep' = 'standard'): Promise<void> => {
    setGenerationError('')
    setRegenerating(true)
    try {
      const result = await window.api.regenerate(m.id, mode)
      if (!result.ok) setGenerationError(result.error || '生成失败')
      onChanged()
    } catch (e) { setGenerationError(e instanceof Error ? e.message : '生成失败') } finally { setRegenerating(false) }
  }
  const del = async (): Promise<void> => {
    if (!confirm(`删除会议「${m.title}」?此操作不可恢复。`)) return
    await window.api.deleteMeeting(m.id)
    onChanged()
    onBack()
  }
  const toggleTodo = async (tid: string): Promise<void> => {
    await window.api.toggleTodo(m.id, tid)
    onChanged()
  }
  const openFeishu = async (): Promise<void> => {
    setFeishuModal(true)
    setFeishuErr('')
    setCandidates([])
    setSearching(true)
    try {
      const r = await window.api.feishuSearchNotes(m.id)
      setCandidates(r.ok ? r.candidates : [])
      if (!r.ok && r.error) setFeishuErr(r.error)
    } catch (e) {
      setFeishuErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }
  const applyFeishu = async (source: { feishuMeetingId?: string; minuteInput?: string }): Promise<void> => {
    setApplying(true)
    setFeishuErr('')
    try {
      const r = await window.api.applyFeishuNotes(m.id, source)
      if (r.ok) {
        setFeishuModal(false)
        onChanged()
      } else {
        setFeishuErr(r.error || '拉取妙记失败')
      }
    } finally {
      setApplying(false)
    }
  }
  const switchLocal = async (): Promise<void> => {
    if (m.notesSource !== 'feishu') return
    setApplying(true)
    await window.api.useLocalNotes(m.id)
    onChanged()
    setApplying(false)
  }
  const source = m.notesSource || 'local'
  const activeTranscript = source === 'feishu' && m.feishuTranscript ? m.feishuTranscript : m.transcript
  const ask = async (): Promise<void> => {
    const question = q.trim()
    if (!question || asking) return
    setQ('')
    setChat((c) => [...c, { role: 'user', text: question }, { role: 'ai', text: '', pending: true }])
    setAsking(true)
    try {
      const r = await window.api.askMeeting(m.id, question)
      setChat((c) => {
        const next = [...c]
        next[next.length - 1] = {
          role: 'ai',
          text: r.ok ? r.answer : `出错了:${r.error || '未知错误'}`
        }
        return next
      })
    } catch (e) {
      setChat((c) => {
        const next = [...c]
        next[next.length - 1] = { role: 'ai', text: `出错了:${e instanceof Error ? e.message : e}` }
        return next
      })
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="content">
      {/* 头部 */}
      <div className="row" style={{ marginBottom: 18 }}>
        <button className="back-btn" onClick={onBack}>
          <IcArrowLeft size={17} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              className="txt-input"
              style={{ fontSize: 18, fontWeight: 800, width: '100%', maxWidth: 480 }}
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
            />
          ) : (
            <div
              className="page-h"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              onClick={() => {
                setTitle(m.title)
                setEditing(true)
              }}
            >
              {m.title}
              <IcEdit size={15} className="muted" />
            </div>
          )}
          <div className="page-sub">
            {fmtWhen(m.startedAt)} · {fmtDuration(m.durationSec)} · {m.transcript.length} 字
          </div>
        </div>
        <button className="btn ghost" onClick={() => regen()} disabled={regenerating || processing}>
          {regenerating ? <span className="spin" /> : <IcRefresh size={14} />} 重新生成
        </button>
        <button className="btn soft" onClick={() => regen('deep')} disabled={regenerating || processing || !m.transcript.trim()}>
          Sol 深度分析
        </button>
        <button className="btn ghost" onClick={() => window.api.openTranscriptsFolder()}>
          <IcFolder size={14} />
        </button>
        <button className="btn ghost" onClick={del}>
          <IcTrash size={14} />
        </button>
      </div>

      {(m.notesModel || m.transcriptionModel) && <div className="muted" style={{ marginBottom: 12 }}>
        转写：{m.transcriptionModel || '本地实时字幕'} · 纪要：{m.notesModel || '尚未生成'}
      </div>}
      {m.transcriptionWarning && <div className="banner err" style={{ marginBottom: 12 }}>{m.transcriptionWarning}</div>}
      {generationError && <div className="banner err" style={{ marginBottom: 12 }}>{generationError}</div>}
      {m.llmError && (
        <div className="banner err" style={{ marginBottom: 16 }}>
          纪要生成未完成:{m.llmError}。转写已保存,可点「重新生成」重试。
        </div>
      )}

      {/* 纪要来源切换:本地录制 / 飞书妙记 */}
      <div className="row" style={{ marginBottom: 16, gap: 10 }}>
        <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
          纪要来源
        </span>
        <div className="filter-group">
          <span className={source === 'local' ? 'on' : ''} onClick={switchLocal}>
            本地录制
          </span>
          <span
            className={source === 'feishu' ? 'on' : ''}
            onClick={() => (source === 'feishu' && m.feishuTranscript ? undefined : openFeishu())}
          >
            飞书妙记
          </span>
        </div>
        {source === 'feishu' && (
          <span className="chip green">
            <IcSparkles size={11} /> 妙记质量更高
          </span>
        )}
        {m.feishuTranscript && (
          <span className="link" onClick={openFeishu}>
            重新拉取
          </span>
        )}
        {applying && <span className="spin" />}
      </div>

      <div className="cols" style={{ display: 'flex', gap: 20 }}>
        {/* 左:纪要 + 转写 */}
        <div style={{ flex: '1.5', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {m.minutes?.topic && (
            <div className="topic-card">
              <div className="topic-kicker">会议主题</div>
              <div className="topic-text">{m.minutes.topic}</div>
            </div>
          )}

          {processing && (
            <div className="card pad-lg" style={{ textAlign: 'center' }}>
              <span className="spin" /> <span className="muted">正在生成会议纪要…</span>
            </div>
          )}

          {m.summary && (
            <div className="mins-card">
              <div className="card-title" style={{ marginBottom: 10 }}>
                会后总结
              </div>
              <div
                className="md-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.summary) }}
              />
            </div>
          )}

          {m.minutes && (
            <div className="mins-card">
              <Section title="要点" items={m.minutes.keyPoints} kind="dot" />
              <Section title="决议" items={m.minutes.decisions} kind="check" />
              <Section title="风险 / 待确认" items={m.minutes.risks} kind="bang" />
            </div>
          )}

          <div className="mins-card">
            <div className="row" style={{ marginBottom: 10 }}>
              <IcDoc size={16} className="muted" />
              <div className="card-title">完整转写</div>
              <div className="spacer" />
              <span className="chip gray">{source === 'feishu' ? '飞书妙记' : '本地录制'}</span>
            </div>
            {activeTranscript ? (
              <div className="tr-plain">{activeTranscript}</div>
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>
                无转写内容
              </div>
            )}
          </div>
        </div>

        {/* 右:待办 + 问 AI */}
        <div style={{ flex: '1', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card pad">
            <div className="row" style={{ marginBottom: 12 }}>
              <IcCheck size={16} className="muted" />
              <div className="card-title">待办</div>
              <div className="spacer" />
              {m.todos.length > 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {m.todos.filter((t) => !t.done).length}/{m.todos.length}
                </span>
              )}
            </div>
            {m.todos.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                没有提取到待办
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {m.todos.map((t) => (
                  <div key={t.id} className={`todo-item${t.done ? ' done' : ''}`}>
                    <div className={`check${t.done ? ' done' : ''}`} onClick={() => toggleTodo(t.id)}>
                      {t.done && <IcCheck size={12} />}
                    </div>
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
            )}
          </div>

          {/* 问 AI */}
          <div className="card pad" style={{ display: 'flex', flexDirection: 'column', minHeight: 300 }}>
            <div className="row" style={{ marginBottom: 12 }}>
              <IcSparkles size={16} className="muted" />
              <div className="card-title">问 AI</div>
            </div>
            <div
              ref={chatRef}
              style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}
            >
              {chat.length === 0 && (
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                  就这场会议提问,答案只基于本场转写。例如:
                  <br />「有哪些没定下来的事?」「谁负责跟进?」
                </div>
              )}
              {chat.map((c, i) =>
                c.role === 'user' ? (
                  <div key={i} className="ai-bubble-user">
                    {c.text}
                  </div>
                ) : (
                  <div key={i} className="ai-bubble-ai">
                    {c.pending ? <span className="spin" /> : c.text}
                  </div>
                )
              )}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="ai-input"
                placeholder="输入问题…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
                disabled={!m.transcript}
              />
              <button className="ai-send" onClick={ask} disabled={asking || !q.trim() || !m.transcript}>
                <IcSend size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {feishuModal && (
        <div className="modal-scrim" onClick={() => !applying && setFeishuModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ marginBottom: 4 }}>
              <div className="card-title lg">用飞书妙记生成纪要</div>
              <div className="spacer" />
              <button className="back-btn" onClick={() => !applying && setFeishuModal(false)}>
                <IcX size={16} />
              </button>
            </div>
            <div className="page-sub" style={{ marginBottom: 14 }}>
              妙记质量远高于本地录制(说话人分离、精准标点)。选一场匹配的会议,或直接粘贴妙记链接。
            </div>

            {feishuErr && <div className="banner err" style={{ marginBottom: 12 }}>{feishuErr}</div>}

            {/* 自动搜索结果 */}
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              自动匹配的会议
            </div>
            {searching ? (
              <div className="tile" style={{ padding: 16, textAlign: 'center' }}>
                <span className="spin" /> <span className="muted">正在搜索…</span>
              </div>
            ) : candidates.length === 0 ? (
              <div className="tile" style={{ padding: 14, fontSize: 12.5 }}>
                <span className="muted">没搜到匹配的会议,试试下面粘贴妙记链接。</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
                {candidates.map((c) => (
                  <div key={c.meetingId} className="opt-tile" style={{ cursor: applying ? 'default' : 'pointer' }} onClick={() => !applying && applyFeishu({ feishuMeetingId: c.meetingId })}>
                    <IcVideo size={16} className="muted" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.title}
                      </div>
                      <div className="muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.info.split('\n').slice(1).join(' ').slice(0, 60) || c.meetingId}
                      </div>
                    </div>
                    <span className="chip gray">用这个</span>
                  </div>
                ))}
              </div>
            )}

            {/* 粘贴链接 */}
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, margin: '16px 0 8px' }}>
              或粘贴妙记链接
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="txt-input"
                style={{ flex: 1, background: 'var(--tile)' }}
                placeholder="https://…larkoffice.com/minutes/xxxx"
                value={minuteInput}
                onChange={(e) => setMinuteInput(e.target.value)}
                disabled={applying}
              />
              <button
                className="btn dark"
                onClick={() => applyFeishu({ minuteInput })}
                disabled={applying || !minuteInput.trim()}
              >
                {applying ? <span className="spin" /> : '生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  items,
  kind
}: {
  title: string
  items: string[]
  kind: 'dot' | 'check' | 'bang'
}): React.JSX.Element | null {
  if (!items || items.length === 0) return null
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="card-title" style={{ fontSize: 13.5, marginBottom: 8 }}>
        {title}
      </div>
      <div className="mins-list">
        {items.map((it, i) => (
          <div key={i} className="li">
            {kind === 'dot' && <span className="bullet-dot" />}
            {kind === 'check' && (
              <span className="bullet-check">
                <IcCheck size={15} />
              </span>
            )}
            {kind === 'bang' && (
              <span className="bullet-bang">
                <IcAlert size={14} />
              </span>
            )}
            <span>{it}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
