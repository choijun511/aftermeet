import React from 'react'
import { useEffect, useState, useCallback } from 'react'
import type {
  AppSettings,
  CalendarEvent,
  Meeting,
  MeetingPrep,
  StatusEvent
} from '../../../shared/types'
import { fmtWhen, fmtDuration, hhmm, initials } from '../util'
import {
  IcChevronLeft,
  IcChevronRight,
  IcRefresh,
  IcCalendar,
  IcCheck,
  IcMic,
  IcSparkles,
  IcX,
  IcAlert,
  IcDoc
} from '../icons'

interface Props {
  meetings: Meeting[]
  status: StatusEvent
  settings: AppSettings
  hasKey: boolean
  onOpen: (id: string) => void
  onStart: (title?: string, calendar?: CalendarEvent | null) => void
  onToggleAutoStart: (v: boolean) => void
  onGoLive: () => void
}

export default function HomeView({
  meetings,
  status,
  settings,
  hasKey,
  onOpen,
  onStart,
  onToggleAutoStart
}: Props): React.JSX.Element {
  const [offset, setOffset] = useState(0)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [label, setLabel] = useState('今天')
  const [loading, setLoading] = useState(false)
  const [feishuOk, setFeishuOk] = useState<boolean | null>(null)
  const [prepEvent, setPrepEvent] = useState<CalendarEvent | null>(null)
  const [prep, setPrep] = useState<MeetingPrep | null>(null)
  const [prepLoading, setPrepLoading] = useState(false)
  const recording = status.state === 'recording' || status.state === 'starting'

  const openPrep = useCallback(async (ev: CalendarEvent) => {
    setPrepEvent(ev)
    setPrep(null)
    setPrepLoading(true)
    try {
      setPrep(await window.api.getMeetingPrep(ev))
    } catch (e) {
      setPrep({ hasPrev: false, openTodos: [], focus: [], error: e instanceof Error ? e.message : String(e) })
    } finally {
      setPrepLoading(false)
    }
  }, [])

  const load = useCallback(async (off: number) => {
    setLoading(true)
    try {
      const r = await window.api.listMeetingsByDate(off)
      setEvents(r.ok ? r.events : [])
      setLabel(off === 0 ? '今天' : r.label)
      setFeishuOk(r.ok)
    } catch {
      setFeishuOk(false)
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(offset)
  }, [offset, load])

  const now = Date.now()
  const nextIdx = events.findIndex((e) => e.endTime >= now)
  const undone = meetings.flatMap((m) =>
    m.todos.filter((t) => !t.done).map((t) => ({ t, m }))
  )
  const recent = meetings.slice(0, 4)

  // 首次使用:没有任何会议记录 → 引导清单
  if (meetings.length === 0 && !recording) {
    return (
      <FirstUse
        hasKey={hasKey}
        feishuOk={feishuOk}
        onStart={() => onStart()}
      />
    )
  }

  return (
    <div className="content cols">
      {/* 左:今日日程 */}
      <div style={{ flex: '1.5', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="card pad-lg">
          <div className="row" style={{ marginBottom: 16 }}>
            <div>
              <div className="card-title lg">日程</div>
              <div className="page-sub">{label}的会议安排</div>
            </div>
            <div className="spacer" />
            <div className="date-switch">
              <span className="arw" onClick={() => setOffset((o) => o - 1)}>
                <IcChevronLeft size={14} />
              </span>
              <span className="cur" onClick={() => setOffset(0)}>
                {offset === 0 ? '今天' : label}
              </span>
              <span className="arw" onClick={() => setOffset((o) => o + 1)}>
                <IcChevronRight size={14} />
              </span>
            </div>
            <button className="refresh-btn" onClick={() => load(offset)} title="刷新">
              <IcRefresh size={15} className={loading ? 'spin-ic' : ''} />
            </button>
          </div>

          {feishuOk === false && (
            <div className="banner warn">
              未能读取飞书日历。请确认已安装并授权 lark-cli(在设置中查看)。
            </div>
          )}

          {events.length === 0 && feishuOk !== false ? (
            <div className="empty-state" style={{ padding: '40px 0' }}>
              <IcCalendar size={30} />
              <div style={{ marginTop: 10 }}>{label}没有会议安排</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {events.map((e, i) => {
                const done = e.endTime < now
                const isNext = i === nextIdx
                return (
                  <div key={e.eventId} className={`agenda-row${done ? ' done' : ''}${isNext ? ' next' : ''}`}>
                    <div className="time tnum">
                      {hhmm(e.startTime)}–{hhmm(e.endTime)}
                    </div>
                    <div className="body">
                      <div className="t">
                        {e.title}
                        {e.recurring && (
                          <span className="chip gray" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                            周期
                          </span>
                        )}
                      </div>
                      <div className="s">
                        {e.organizer ? `${e.organizer} · ` : ''}
                        {e.hasVchat ? '视频会议' : '线下'}
                      </div>
                    </div>
                    {e.recurring && !done && (
                      <button
                        className={isNext ? 'rec-here' : 'link'}
                        style={
                          isNext
                            ? { border: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }
                            : { display: 'inline-flex', alignItems: 'center', gap: 5 }
                        }
                        onClick={() => openPrep(e)}
                      >
                        <IcDoc size={13} /> 会前简报
                      </button>
                    )}
                    {isNext && offset === 0 && !recording && (
                      <a className="rec-here" onClick={() => onStart(e.title, e)}>
                        ● 在此录制
                      </a>
                    )}
                    {done && <span className="chip gray">已结束</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 右:自动录制 + 待办 + 最近会议 */}
      <div style={{ flex: '1', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="card pad">
          <div className="row">
            <div style={{ flex: 1 }}>
              <div className="card-title">自动录制</div>
              <div className="page-sub" style={{ marginTop: 3 }}>
                检测到会议开始,自动录制
              </div>
            </div>
            <div
              className={`toggle${settings.autoStart ? ' on' : ''}`}
              onClick={() => onToggleAutoStart(!settings.autoStart)}
            >
              <div className="knob" />
            </div>
          </div>
        </div>

        <div className="card pad">
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="card-title">未完成待办</div>
            <div className="spacer" />
            {undone.length > 0 && <span className="chip coral">{undone.length}</span>}
          </div>
          {undone.length === 0 ? (
            <div className="muted" style={{ fontSize: 13, padding: '6px 0' }}>
              没有未完成待办 🎉
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {undone.slice(0, 5).map(({ t, m }) => (
                <div key={t.id} className="todo-item" onClick={() => onOpen(m.id)} style={{ cursor: 'pointer' }}>
                  <div className="check" />
                  <div className="tx">
                    {t.text}
                    {t.owner && <span className="muted"> · {t.owner}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card pad">
          <div className="card-title" style={{ marginBottom: 10 }}>
            最近会议
          </div>
          {recent.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>
              还没有录制过会议
            </div>
          ) : (
            recent.map((m) => (
              <a key={m.id} className="recent-row" onClick={() => onOpen(m.id)}>
                <div className="avatar">{initials(m.title)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.title}
                  </div>
                  <div className="s">
                    {fmtWhen(m.startedAt)} · {fmtDuration(m.durationSec)}
                  </div>
                </div>
                {m.minutes ? (
                  <span className="chip green">
                    <IcCheck size={11} /> 已生成
                  </span>
                ) : m.llmError ? (
                  <span className="chip gray">仅转写</span>
                ) : (
                  <span className="chip gray">处理中</span>
                )}
              </a>
            ))
          )}
        </div>
      </div>

      {prepEvent && (
        <PrepModal
          event={prepEvent}
          prep={prep}
          loading={prepLoading}
          onClose={() => setPrepEvent(null)}
          onRecord={() => {
            const ev = prepEvent
            setPrepEvent(null)
            if (ev) onStart(ev.title, ev)
          }}
          canRecord={offset === 0 && !recording}
        />
      )}
    </div>
  )
}

// ---- 会前简报弹窗 ----
function PrepModal({
  event,
  prep,
  loading,
  onClose,
  onRecord,
  canRecord
}: {
  event: CalendarEvent
  prep: MeetingPrep | null
  loading: boolean
  onClose: () => void
  onRecord: () => void
  canRecord: boolean
}): React.JSX.Element {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 4 }}>
          <div className="chip coralsolid">会前简报</div>
          <div className="spacer" />
          <button className="back-btn" onClick={onClose}>
            <IcX size={16} />
          </button>
        </div>
        <div className="card-title lg" style={{ marginTop: 6 }}>
          {event.title}
        </div>
        <div className="page-sub" style={{ marginBottom: 16 }}>
          {hhmm(event.startTime)}–{hhmm(event.endTime)} · {event.hasVchat ? '视频会议' : '线下'}
        </div>

        {loading ? (
          <div className="tile" style={{ padding: 26, textAlign: 'center' }}>
            <span className="spin" />{' '}
            <span className="muted">正在汇总上次纪要、生成本场关注…</span>
          </div>
        ) : !prep || !prep.hasPrev ? (
          <div className="tile" style={{ padding: 20, fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>还没有上次记录</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {prep?.error
                ? `读取失败:${prep.error}`
                : '这是本系列第一次、或上次没有录制/妙记。录完这场后,下次开会就有简报了。'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 本场关注 */}
            {prep.focus.length > 0 && (
              <div className="dark-card" style={{ padding: '16px 18px' }}>
                <div className="row" style={{ marginBottom: 10 }}>
                  <IcSparkles size={15} />
                  <div className="card-title" style={{ color: '#fff', fontSize: 14 }}>
                    本场需要关注
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {prep.focus.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline', fontSize: 13.5, lineHeight: 1.5 }}>
                      <span style={{ color: 'var(--coral)', fontWeight: 800 }}>{i + 1}</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 遗留待办 */}
            {prep.openTodos.length > 0 && (
              <div>
                <div className="row" style={{ marginBottom: 8 }}>
                  <IcAlert size={15} className="muted" />
                  <div className="card-title" style={{ fontSize: 14 }}>
                    上次遗留待办
                  </div>
                  <span className="chip coral">{prep.openTodos.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {prep.openTodos.map((t, i) => (
                    <div key={i} className="todo-item">
                      <div className="check" />
                      <div className="tx">
                        {t.text}
                        {t.owner && <span className="muted"> · {t.owner}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 上次重点 */}
            <div>
              <div className="row" style={{ marginBottom: 8 }}>
                <IcDoc size={15} className="muted" />
                <div className="card-title" style={{ fontSize: 14 }}>
                  上次会议重点
                </div>
                <div className="spacer" />
                <span className="chip gray">{prep.source === 'feishu' ? '飞书妙记' : '本地录制'}</span>
              </div>
              {prep.last?.minutes.topic && (
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>
                  {prep.last.minutes.topic}
                </div>
              )}
              <div className="mins-list">
                {prep.last?.minutes.keyPoints.slice(0, 5).map((k, i) => (
                  <div key={i} className="li">
                    <span className="bullet-dot" />
                    <span>{k}</span>
                  </div>
                ))}
                {prep.last?.minutes.decisions.slice(0, 3).map((d, i) => (
                  <div key={'d' + i} className="li">
                    <span className="bullet-check">
                      <IcCheck size={14} />
                    </span>
                    <span>{d}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {canRecord && (
          <button
            className="btn coral-lg"
            style={{ width: '100%', justifyContent: 'center', marginTop: 18 }}
            onClick={onRecord}
          >
            <span className="rec-dot" style={{ color: '#fff' }}>
              ●
            </span>
            开始录制本场
          </button>
        )}
      </div>
    </div>
  )
}

// ---- 首次使用引导(1G)----
function FirstUse({
  hasKey,
  feishuOk,
  onStart
}: {
  hasKey: boolean
  feishuOk: boolean | null
  onStart: () => void
}): React.JSX.Element {
  const steps = [
    { done: true, title: '安装完成', desc: 'AfterMeet 已就绪,音频与转写全部在本地处理' },
    {
      done: hasKey,
      title: '配置 Gemini API Key',
      desc: hasKey ? '已检测到密钥,可生成会议纪要' : '在设置 · 纪要生成中填入密钥后即可自动生成纪要'
    },
    {
      done: feishuOk === true,
      title: '连接飞书日历(可选)',
      desc: feishuOk === true ? '已连接,可在首页查看当日会议并一键录制' : '安装 lark-cli 后可展示日程并关联录制'
    },
    { done: false, title: '开始第一场录制', desc: '点击下方按钮,或让自动录制在会议开始时替你开录' }
  ]
  return (
    <div className="content" style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 560, marginTop: 30 }}>
        <div className="card pad-lg" style={{ textAlign: 'center', padding: '34px 32px' }}>
          <div
            className="brand"
            style={{ justifyContent: 'center', marginBottom: 8 }}
          >
            <div className="logo" style={{ width: 44, height: 44, borderRadius: 14 }}>
              <IcMic size={22} />
            </div>
          </div>
          <div className="page-h" style={{ marginTop: 6 }}>
            欢迎使用 AfterMeet
          </div>
          <div className="page-sub" style={{ fontSize: 13.5, marginBottom: 22 }}>
            本地转写 · AI 纪要 · 音频不出网
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
            {steps.map((s, i) => (
              <div key={i} className="opt-tile" style={{ cursor: 'default' }}>
                <div className={`check${s.done ? ' done' : ''}`} style={{ width: 22, height: 22 }}>
                  {s.done && <IcCheck size={13} />}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {s.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            className="btn coral-lg"
            style={{ marginTop: 24, width: '100%', justifyContent: 'center' }}
            onClick={onStart}
          >
            <IcSparkles size={16} /> 开始第一场录制
          </button>
        </div>
      </div>
    </div>
  )
}
