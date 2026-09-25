import React, { useEffect, useRef, useState } from 'react'
import type { Meeting, PlaybackInfo, StatusEvent } from '../../../shared/types'
import { playableSentences } from '../../../shared/playback'
import { fmtClock } from '../util'

const PAGE_SIZE = 50
export default function RecordingPlayer({ meeting, status }: { meeting: Meeting; status: StatusEvent }): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const lease = useRef<string | null>(null)
  const intent = useRef(0)
  const [info, setInfo] = useState<PlaybackInfo | null>(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [time, setTime] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  const recording = ['starting', 'recording'].includes(status.state)
  const duration = info?.ok ? info.durationSec : 0
  const sentences = playableSentences(meeting, duration)
  const pages = Math.max(1, Math.ceil(sentences.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages - 1)

  const pause = (): void => {
    intent.current++
    audioRef.current?.pause()
    setPlaying(false)
    if (lease.current) void window.api.setPlaybackActive(lease.current, false).catch(() => {})
  }
  useEffect(() => {
    let disposed = false
    const audio = audioRef.current
    setInfo(null); setReady(false); setError(''); setTime(0); setPlaying(false)
    if (!recording) {
      window.api.preparePlayback(meeting.id).then((result) => {
        if (disposed) { if (result.ok) void window.api.releasePlayback(result.token); return }
        if (result.ok) lease.current = result.token
        setInfo(result)
      }).catch(() => { if (!disposed) setError('无法打开录音，请重试') })
    }
    return () => {
      disposed = true; intent.current++
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
      if (lease.current) { void window.api.releasePlayback(lease.current).catch(() => {}); lease.current = null }
    }
  }, [meeting.id, meeting.audioPath, meeting.audioBytes, recording, reload])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      const token = lease.current
      if (token) void window.api.setPlaybackActive(token, true).then((ok) => {
        if (!ok) { pause(); setError('回放已停止，请重新打开录音') }
      }).catch(() => { pause(); setError('回放连接中断，请重试') })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [playing])

  const play = async (at?: number): Promise<void> => {
    const audio = audioRef.current; const token = lease.current
    if (!audio || !token || !ready || recording) return
    const request = ++intent.current
    setError('')
    try {
      if (!await window.api.setPlaybackActive(token, true)) throw new Error('请先停止录制再回放，或重新打开录音')
      if (request !== intent.current) return
      if (at !== undefined) audio.currentTime = Math.max(0, Math.min(at, Math.max(0, duration - 0.01)))
      else if (audio.ended) audio.currentTime = 0
      audio.playbackRate = speed
      await audio.play()
    } catch (e) {
      if (request !== intent.current) return
      pause(); setError(e instanceof Error ? e.message : '无法播放录音')
    }
  }
  const seek = (at: number): void => {
    if (!audioRef.current || !ready) return
    const next = Math.max(0, Math.min(duration, at))
    audioRef.current.currentTime = next; setTime(next)
  }
  const disabled = !ready || recording || !info?.ok
  return <section className="card recording-player" style={{ marginBottom: 12 }} aria-label="录音回放">
    <h2 className="card-title" style={{ margin: '0 0 8px' }}>录音回放</h2>
    <audio ref={audioRef} src={info?.ok ? info.url : undefined} preload="metadata"
      onLoadedMetadata={() => { setReady(true); if (audioRef.current) audioRef.current.playbackRate = speed }}
      onTimeUpdate={() => setTime(audioRef.current?.currentTime || 0)}
      onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); if (lease.current) void window.api.setPlaybackActive(lease.current, false).catch(() => {}) }}
      onEnded={pause}
      onError={() => { if (lease.current) { pause(); setReady(false); setError('录音无法播放，文件可能已移动、损坏或不可访问') } }} />
    {recording ? <p>录制期间暂停回放，避免录入回放声音。</p> : <>
      {!info && !error && <p role="status">正在读取录音信息…</p>}
      {info && !info.ok && <p role="status">{info.error}</p>}
      {info?.ok && <>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn dark" disabled={disabled} onClick={() => playing ? pause() : void play()}>{playing ? '暂停' : '播放'}</button>
          <button className="btn soft" disabled={disabled} onClick={() => seek(time - 10)}>后退 10 秒</button>
          <button className="btn soft" disabled={disabled} onClick={() => seek(time + 10)}>前进 10 秒</button>
          <span className="tnum" aria-live="off">{fmtClock(time)} / {fmtClock(duration)}</span>
          <label htmlFor="playback-speed">倍速</label>
          <select id="playback-speed" className="txt-input" style={{ width: 90, flex: 'none' }} value={speed} onChange={(e) => {
            const value = Number(e.target.value); setSpeed(value); if (audioRef.current) audioRef.current.playbackRate = value
          }}>{[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select>
        </div>
        <input type="range" aria-label="录音播放进度" aria-valuetext={`${fmtClock(time)}，共 ${fmtClock(duration)}`}
          min={0} max={duration} step={0.1} value={time} disabled={disabled} onChange={(e) => seek(Number(e.target.value))}
          style={{ width: '100%', margin: '10px 0 4px', accentColor: 'var(--green, #2b8057)' }} />
        <p style={{ margin: '0', fontSize: 12 }}>{playing ? '正在本地回放，自动起录暂时暂停。' : '音频仅在本机播放，不上传。'}</p>
      </>}
      {error && <p className="banner err" role="alert">{error}</p>}
      {(error || (info && !info.ok)) && <button className="btn soft" onClick={() => setReload((v) => v + 1)}>重新检查录音</button>}
      {info?.ok && (sentences.length ? <details className="playback-segments">
        <summary>转写片段回听（{sentences.length} 段）</summary>

        <p style={{ fontSize: 13 }}>时间来自转写服务，可能有偏差。未标注时间的本地补转内容请在完整转写中查看；说话人编号不代表真实姓名。</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', padding: 4 }}>
          {sentences.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((s, index) => {
            const active = time * 1000 >= s.startMs && time * 1000 < s.endMs
            return <button key={`${currentPage}-${index}`} className="btn soft" disabled={disabled}
              aria-current={active ? 'true' : undefined} aria-label={`从 ${fmtClock(s.startMs / 1000)} 回听：${s.speaker}，${s.text}`}
              onClick={() => void play(s.startMs / 1000)}
              style={{ textAlign: 'left', justifyContent: 'flex-start', whiteSpace: 'normal', lineHeight: 1.7,
                border: active ? '2px solid var(--green, #2b8057)' : '2px solid transparent', display: 'block' }}>
              <span className="tnum">{fmtClock(s.startMs / 1000)}</span> · {s.speaker}{active ? ' · 当前片段' : ''}<br />{s.text}
            </button>
          })}
        </div>
        {pages > 1 && <div className="row" style={{ gap: 12, marginTop: 12 }}>
          <button className="btn soft" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页片段</button>
          <span>{currentPage + 1} / {pages}</span>
          <button className="btn soft" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页片段</button>
        </div>}
      </details> : <p style={{ fontSize: 12, margin: '4px 0 0' }}>{meeting.notesSource === 'feishu'
        ? '当前为飞书妙记文字，与本机录音未对齐，仅支持整段回放。'
        : '这份转写没有可用的逐句时间信息，可拖动进度条回听整段录音。'}</p>)}
    </>}
  </section>
}
