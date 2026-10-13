import MaintenanceView from './views/MaintenanceView'
import React from 'react'
import { useEffect, useState, useCallback, useRef } from 'react'
import type {
  AppSettings,
  CalendarEvent,
  Meeting,
  StatusEvent,
  TranscriptSegment
} from '../../shared/types'
import HomeView from './views/HomeView'
import LiveView from './views/LiveView'
import LibraryView from './views/LibraryView'
import MeetingDetailView from './views/MeetingDetailView'
import TodosView from './views/TodosView'
import SettingsView from './views/SettingsView'
import { fmtClock } from './util'
import { IcHome, IcLibrary, IcCheckSquare, IcSettings, IcMic, IcSearch, IcStop } from './icons'

type Route = 'home' | 'live' | 'library' | 'todos' | 'settings' | 'detail' | 'maintenance'

const NAV: { key: Route; label: string; Icon: typeof IcHome }[] = [
  { key: 'home', label: '首页', Icon: IcHome },
  { key: 'library', label: '会议库', Icon: IcLibrary },
  { key: 'todos', label: '待办', Icon: IcCheckSquare },
  { key: 'settings', label: '设置', Icon: IcSettings }
]

export default function App(): React.JSX.Element {
  const startLock = useRef(false)
  const [startPending, setStartPending] = useState(false)
  const [route, setRoute] = useState<Route>('home')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusEvent>({ state: 'idle', durationSec: 0, active: false })
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [hasKey, setHasKey] = useState(true)
  const [settings, setSettings] = useState<AppSettings>({
    recordingReminder: true,
    cloudAsr: true,
    autoStart: true,
    twoPass: true,
    autoMinutes: true
  })
  const [storageError, setStorageError] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [librarySearch, setLibrarySearch] = useState('')
  const librarySearchFocus = useRef(false)

  const recording = status.state === 'recording' || status.state === 'starting'
  const busy = status.state === 'transcribing' || status.state === 'summarizing'

  const refreshMeetings = useCallback(async () => {
    try { setMeetings(await window.api.listMeetings()); setStorageError('') }
    catch (e) { setStorageError(e instanceof Error ? e.message : '本地会议数据无法读取，已保留原文件') }
  }, [])

  useEffect(() => {
    let statusReceived = false
    window.api.getState().then(s => { if (!statusReceived) setStatus(s) }).catch(() => setNotice('录制状态读取失败，请重新打开应用'))
    window.api.hasApiKey().then(setHasKey)
    window.api.getSettings().then(setSettings).catch((e) => setStorageError(String(e)))
    refreshMeetings()

    const offStatus = window.api.onStatus((s) => {
      statusReceived = true
      setStatus(s)
      if (s.state === 'idle' || s.state === 'starting') refreshMeetings()
    })
    const offSeg = window.api.onSegment((seg) =>
      setSegments((prev) => {
        const i = prev.findIndex((s) => s.id === seg.id)
        if (i >= 0) {
          const next = [...prev]
          next[i] = seg
          return next
        }
        return [...prev, seg]
      })
    )
    const offUpd = window.api.onMeetingUpdated(() => refreshMeetings())
    const offNotice = window.api.onNotice((msg) => {
      setNotice(msg)
      window.setTimeout(() => setNotice(null), 5000)
    })
    return () => {
      offStatus()
      offSeg()
      offUpd()
      offNotice()
    }
  }, [refreshMeetings])

  // ⌘K → 会议库搜索
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest('[role=dialog]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        librarySearchFocus.current = true
        setRoute('library')
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const totalTodos = meetings.reduce((n, m) => n + m.todos.filter((t) => !t.done).length, 0)

  const startRecording = async (title = '', calendar?: CalendarEvent | null): Promise<void> => {
    if (startLock.current || !['idle', 'error'].includes(status.state)) return
    startLock.current = true; setStartPending(true); setSegments([])
    try {
      const result = await window.api.startRecording(title, calendar)
      if (!result.ok) { setNotice(result.error || '录制启动失败'); return }
      setRoute('live')
    } catch (e) { setNotice(e instanceof Error ? e.message : '录制启动失败') }
    finally { startLock.current = false; setStartPending(false) }
  }
  const stopRecording = async (): Promise<void> => {
    try {
      const result = await window.api.stopRecording()
      if (!result.ok) setNotice(result.error || '录制处理失败')
    } catch (e) { setNotice(e instanceof Error ? e.message : '停止录制失败') }
  }

  const openMeeting = (id: string): void => {
    setDetailId(id)
    setRoute('detail')
  }

  const goRecord = (): void => {
    if (recording) setRoute('live')
    else startRecording()
  }

  const detail = detailId ? meetings.find((m) => m.id === detailId) ?? null : null

  return (
    <div className="app">
      <div className="topbar" />
      <header className="topnav">
        <div className="brand">
          <div className="logo">
            <IcMic size={16} />
          </div>
          <div className="name">AfterMeet</div>
        </div>

        <nav className="nav">
          {NAV.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={route === key || (key === 'settings' && route === 'maintenance') ? 'active' : ''}
              aria-current={route === key || (key === 'settings' && route === 'maintenance') ? 'page' : undefined}
              onClick={() => setRoute(key)}
            >
              <Icon size={16} strokeWidth={route === key ? 2.4 : 2} />
              <span>{label}</span>
              {key === 'todos' && totalTodos > 0 && <span className="badge">{totalTodos}</span>}
            </button>
          ))}
        </nav>

        <div className="right">
          <button
            className="search-pill"
            onClick={() => {
              librarySearchFocus.current = true
              setRoute('library')
            }}
          >
            <IcSearch size={14} />
            <span>搜索</span>
            <span className="kbd">⌘K</span>
          </button>
          <button className={`btn ${recording ? 'coral' : 'dark'}`}
            disabled={startPending || status.state === 'starting' || busy}
            onClick={goRecord} title={recording ? '查看当前录制' : undefined}>
            <span aria-hidden="true">{recording ? '●' : busy || startPending ? '◌' : '●'}</span>
            {startPending || status.state === 'starting' ? '正在启动录制…' : status.state === 'recording'
              ? <>录制中 <span className="tnum">{fmtClock(status.durationSec)}</span></>
              : status.state === 'transcribing' ? '正在保存与转写…' : status.state === 'summarizing' ? '正在生成纪要…' : '开始录制'}
          </button>
        </div>
      </header>

      {storageError && <div className="banner err" role="alert">{storageError}</div>}
      {route === 'home' && (
        <HomeView
          meetings={meetings}
          status={status}
          settings={settings}
          hasKey={hasKey}
          onOpen={openMeeting}
          onStart={startRecording}
          onToggleAutoStart={async (v) => setSettings(await window.api.setSetting('autoStart', v))}
          onGoLive={() => setRoute('live')}
        />
      )}
      {route === 'live' && (
        <LiveView
          status={status}
          segments={segments}
          meetings={meetings}
          hasKey={hasKey}
          onStart={startRecording}
          onStop={stopRecording}
          onAssociate={async (mid, ev) => {
            const result = await window.api.linkCalendar(mid, ev)
            if (!result.ok) setNotice(result.error || '关联日程失败')
            refreshMeetings()
          }}
          onOpen={openMeeting}
        />
      )}
      {route === 'library' && (
        <LibraryView
          meetings={meetings}
          onOpen={openMeeting}
          search={librarySearch}
          onSearch={setLibrarySearch}
          autoFocus={librarySearchFocus}
        />
      )}
      {route === 'todos' && (
        <TodosView meetings={meetings} onChanged={refreshMeetings} onOpen={openMeeting} />
      )}
      {route === 'maintenance' && <MaintenanceView onBack={() => setRoute('settings')} />}
      {route === 'settings' && (
        <SettingsView
          onOpenMaintenance={() => setRoute('maintenance')}
          settings={settings}
          hasKey={hasKey}
          onChange={async (k, v) => setSettings(await window.api.setSetting(k, v))}
          onModeChange={async (mode) => setSettings(await window.api.setTranscriptionMode(mode))}
        />
      )}
      {route === 'detail' && (
        <MeetingDetailView
          meeting={detail}
          status={status}
          onBack={() => setRoute('library')}
          onChanged={refreshMeetings}
        />
      )}

      {/* 录制中在非 live 页展示浮动迷你条 */}
      {recording && route !== 'live' && (
        <div className="minibar-wrap">
          <div className="minibar">
            <span className="dot" />
            <span style={{ fontWeight: 700, fontSize: 13 }}>{status.state === 'starting' ? '正在启动录制' : '录制中'}</span>
            <span className="tnum muted" style={{ fontSize: 12.5 }}>
              {fmtClock(status.durationSec)}
            </span>
            <button className="btn soft" style={{ padding: '6px 14px' }} onClick={() => setRoute('live')}>
              查看
            </button>
            <button className="btn stop-mini" onClick={stopRecording}>
              <IcStop size={12} /> 停止
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="toast" role="status">
          <span className="d" />
          {notice}
        </div>
      )}
    </div>
  )
}
