import type { AudioHealth } from '../../../shared/types'

export default function AudioHealthCard({ health, busy }: { health?: AudioHealth; busy: boolean }): React.JSX.Element {
  return <section className="card pad" aria-label="录音健康状态">
    <div className="card-title">录音健康状态</div>
    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>音量表示声音强弱，不代表语音识别结果。</div>
    {(['system', 'microphone'] as const).map((source) => {
      const h = health?.[source]
      const label = source === 'system' ? '系统声音' : '麦克风'
      const level = h?.receiving ? Math.max(0, Math.min(100, (20 * Math.log10(Math.max(h.rms, 0.000001)) + 60) / 60 * 100)) : 0
      const included = source === 'system' || health?.micIncluded
      return <div key={source} style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
          <strong>{label}</strong>
          <span>{busy ? '采集已结束' : !h ? '等待采集' : !h.receiving ? '未收到数据' : h.rms > 0.003 ? '有声音' : '当前安静'}</span>
        </div>
        <div role="meter" aria-label={`${label}音量`} aria-valuenow={busy ? 0 : Math.round(level)} aria-valuemin={0} aria-valuemax={100} style={{ height: 8, background: 'var(--tile)', borderRadius: 4, marginTop: 8, overflow: 'hidden' }}>
          <div style={{ width: `${busy ? 0 : level}%`, height: '100%', background: 'var(--green)', transition: 'width 200ms' }} />
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{included ? '纳入录音' : '仅监测；系统声音正常时不混入麦克风'}</div>
      </div>
    })}
    {!busy && health && !health.system.receiving && <p role="status" style={{ color: 'var(--coral-ink)', fontSize: 12 }}>系统声音未收到数据。若正在播放声音，请检查输出设备及录音权限。</p>}
    {!busy && health && health.silenceSeconds >= 30 && <p role="status" style={{ color: 'var(--coral-ink)', fontSize: 12 }}>已连续 {health.silenceSeconds} 秒未检测到明显声音。若会议正在讲话，请检查音源；安静时不会停止录制。</p>}
  </section>
}
