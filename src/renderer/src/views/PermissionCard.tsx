import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioPermissionProbe, PermissionStatus, RecordingPermission } from '../../../shared/types'
import { IcMic } from '../icons'

const labels: Record<RecordingPermission, string> = {
  granted: '系统报告已授权', denied: '未授权', 'not-determined': '尚未授权',
  restricted: '受到系统限制', unknown: '无法确认'
}

export default function PermissionCard(): React.JSX.Element {
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null)
  const [probe, setProbe] = useState<AudioPermissionProbe | null>(null)
  const [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [checked, setChecked] = useState('')
  const pending = useRef(false)
  const refresh = useCallback(async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setProbe(null)
    try {
      const [result, status] = await Promise.all([window.api.getPermissions(), window.api.getState()])
      setPermissions(result)
      setNotice(status.message || '')
      setChecked(new Date().toLocaleTimeString('zh-CN'))
    } catch {
      setError('权限检查失败，请重试。也可以直接在系统设置 → 隐私与安全性中查看。')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void refresh()
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    const unsubscribe = window.api.onStatus((status) => setNotice(status.message || ''))
    return () => { window.removeEventListener('focus', focus); unsubscribe() }
  }, [refresh])
  const test = async () => {
    setTesting(true)
    setProbe(null)
    try { setProbe(await window.api.testSystemAudio()) }
    catch { setProbe({ ok: false, message: '测试失败，请稍后重试。' }) }
    finally { setTesting(false) }
  }
  const open = async (kind: 'microphone' | 'screen') => {
    try { await window.api.openPermissionSettings(kind) }
    catch { setError('无法打开系统设置，请手动进入「隐私与安全性」查看对应权限。') }
  }
  const request = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try { setPermissions(await window.api.requestMicrophonePermission()) }
    catch { setError('未能请求麦克风权限，请前往系统设置开启。') }
    finally { pending.current = false; setBusy(false) }
  }
  return (
    <section className="set-card" style={{ marginBottom: 18 }} aria-label="录音权限检查">
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="brand-ic"><IcMic size={16} /></div>
        <div className="card-title" style={{ flex: 1 }}>录音权限检查</div>
        <button className="btn soft" disabled={busy} onClick={() => void refresh()}>{busy ? '检查中…' : '重新检查'}</button>
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
        读取当前系统授权状态，不会开始录音。返回此页时自动刷新。{checked && ` 上次检查：${checked}`}
      </div>
      {permissions?.supported === false && <p role="status">此权限检查仅支持 macOS。</p>}
      <div className="grid2">
        {(['microphone', 'screen'] as const).map((kind) => {
          const status = permissions?.[kind]
          return <div className="tile" key={kind} style={{ padding: 16 }}>
            <div style={{ fontWeight: 700 }}>{kind === 'microphone' ? '麦克风' : '录屏与系统录音'}</div>
            <div style={{ marginTop: 6, color: status === 'granted' ? 'var(--green)' : 'var(--coral-ink)' }}>
              {kind === 'screen' && status === 'denied' ? '当前进程未确认授权，需实际测试' : status ? labels[status] : '等待检查'}
            </div>
            <p className="muted" style={{ fontSize: 12.5 }}>
              {kind === 'microphone' ? '用于录下你说的话。' : '用于采集会议中其他人的声音；AfterMeet 不保存屏幕画面。'}
            </p>
            {kind === 'screen' && <p className="muted" style={{ fontSize: 12.5 }}>此状态不等同于系统设置中的开关。若开关已开启，请测试实际采集。</p>}
            {status === 'restricted' && <p className="muted">权限可能由设备管理策略限制，请联系管理员。</p>}
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {kind === 'screen' && <button className="btn soft" disabled={testing || permissions?.supported === false} onClick={() => void test()}>{testing ? '测试中…' : '测试系统音频'}</button>}
              {kind === 'microphone' && status === 'not-determined' && <button className="btn soft" disabled={busy} onClick={() => void request()}>请求麦克风授权</button>}
              <button className="btn soft" disabled={permissions?.supported === false} onClick={() => void open(kind)}>前往系统设置</button>
            </div>
          </div>
        })}
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>「测试系统音频」会短暂启动实际采集组件，不保存或上传音频，也不会生成会议。</p>
      {probe && <p role="status" style={{ color: probe.ok ? 'var(--green)' : 'var(--coral-ink)' }}>{probe.message}</p>}
      {error && <p role="alert" style={{ color: 'var(--coral-ink)' }}>{error}</p>}
      {notice && <p role="status" style={{ color: 'var(--coral-ink)' }}>当前录制提示：{notice}</p>}
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8, marginTop: 14 }}>
        授权状态不代表实际采集一定成功。开启权限后，请先停止录制并等待处理完成，再按 ⌘Q 完全退出并重新打开 AfterMeet，录一小段确认。
      </div>
      <details style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.8 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>开关已开启，仍提示系统音频不可用？</summary>
        <p className="muted">应用更新后，旧授权可能未对当前版本生效。可按以下步骤重新授权：</p>
        <ol style={{ paddingLeft: 22 }}>
          <li>停止录制并等待处理完成，按 ⌘Q 完全退出 AfterMeet。</li>
          <li>打开系统设置 → 隐私与安全性 → 录屏与系统录音。</li>
          <li>选中 AfterMeet，点「−」移除旧条目。</li>
          <li>点「＋」，重新添加「应用程序」中的 AfterMeet，开启开关。</li>
          <li>重新打开 AfterMeet；若系统要求退出重开，请照提示操作。</li>
        </ol>
        <p className="muted">再次录制时仍失败，请保留录制提示以便排查。权限需要你在 macOS 中确认，应用无法替你开启。</p>
      </details>
    </section>
  )
}
