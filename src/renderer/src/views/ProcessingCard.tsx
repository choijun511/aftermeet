import React, { useState } from 'react'
import type { Meeting, StatusEvent } from '../../../shared/types'

export default function ProcessingCard({ meeting: m, status, onChanged }: {
  meeting: Meeting; status: StatusEvent; onChanged: () => void
}): React.JSX.Element {
  const [engine, setEngine] = useState<'local' | 'qwen'>('local')
  const [allowResubmit, setAllowResubmit] = useState(false)
  const [restart, setRestart] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = !['idle', 'error'].includes(status.state)
  const active = busy && status.meetingId === m.id
  const p = m.processing
  const needsAttention = !m.transcript.trim() || p?.state === 'failed' || p?.state === 'paused' || m.notesStale || !!m.llmError
  const [expanded, setExpanded] = useState(false)
  const show = expanded || active || needsAttention
  const phases = { recording: '保存录音', saved: '录音已保存', transcribing: '转写录音', summarizing: '生成纪要', complete: '处理完成' }
  const states = { running: '处理中', paused: '已暂停，可继续', failed: '未完成，可重试', done: '已完成' }
  const run = async (): Promise<void> => {
    setError(''); setPending(true)
    try {
      const result = await window.api.retranscribe(m.id, { engine, allowResubmit, restart })
      if (!result.ok) setError(result.error || '转写失败，录音仍保留')
      onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : '转写失败') }
    finally { setPending(false); setAllowResubmit(false); setRestart(false) }
  }
  const cancel = async (): Promise<void> => {
    try {
      const result = await window.api.cancelProcessing(m.id)
      if (!result.ok) setError(result.error || '暂时无法取消')
    } catch (e) { setError(String(e)) }
  }
  return <details open={show} onToggle={(e) => setExpanded(e.currentTarget.open)} className="card processing-card" style={{ marginBottom: 16 }} aria-label="录音处理与恢复">
    <summary>录音处理与恢复 · {p ? `${phases[p.stage]} · ${states[p.state]}` : '历史会议'}</summary>
    <div className="processing-body">
    <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>

      {active && ['transcribing', 'summarizing'].includes(status.state) &&
        <button className="btn soft" onClick={cancel}>取消处理，保留录音</button>}
    </div>
    <div role="status" aria-live="polite" style={{ marginBottom: 12 }}>
      {active ? status.message || p?.message : p?.message}
      {!!p?.totalChunks && <div>已保存 {p.completedChunks || 0} / {p.totalChunks} 段转写</div>}
    </div>
    {m.notesStale && <p>转写已更新，当前纪要仍基于之前的文字。请核对后点击「重新生成纪要」。</p>}
    {m.audioPath ? <>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label htmlFor="transcription-engine">转写方式</label>
        <select id="transcription-engine" className="txt-input" style={{ width: 'auto' }}
          value={engine} disabled={busy || pending} onChange={(e) => { setEngine(e.target.value as 'local' | 'qwen'); setAllowResubmit(false) }}>
          <option value="local">本地 Whisper（不上传音频）</option>
          <option value="qwen">Qwen 云端（上传音频，可能计费）</option>
        </select>
        <button className="btn dark" disabled={busy || pending} onClick={run}>
          {pending ? '正在处理…' : '转写录音 / 继续处理'}
        </button>
      </div>
      <p style={{ margin: '12px 0' }}>默认复用已完成分段，云端已有任务优先查询。现有文字和纪要保留到新转写成功。</p>
      <details>
        <summary style={{ cursor: 'pointer' }}>重新识别选项</summary>
        <label style={{ display: 'block', marginTop: 12 }}>
          <input type="checkbox" checked={restart} disabled={busy || pending} onChange={(e) => setRestart(e.target.checked)} />
          重新识别全部，忽略已有进度{engine === 'qwen' ? '（将重新上传并可能再次计费）' : ''}
        </label>
        {engine === 'qwen' && <label style={{ display: 'block', marginTop: 12 }}>
          <input type="checkbox" checked={allowResubmit} disabled={busy || pending} onChange={(e) => setAllowResubmit(e.target.checked)} />
          允许重新提交结果未知或已失效的云端任务，我了解可能重复计费
        </label>}
      </details>
      {active && <p>取消会保留已完成结果；已提交的云端任务可能继续运行并计费。</p>}
    </> : <p>未找到关联录音，仍可用已有文字重新生成纪要。</p>}
    {error && <div className="banner err" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  </details>
}
