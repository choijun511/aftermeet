import Switch from '../components/Switch'
import { transcriptionMode, effectiveTranscriptionMode, type TranscriptionMode } from '../../../shared/transcription-mode'
import React from 'react'
import { useEffect, useState } from 'react'
import type { AppSettings, AfterMeetApi } from '../../../shared/types'
import PermissionCard from './PermissionCard'
import { IcMic, IcSparkles, IcCalendar, IcFolder, IcCheck, IcX } from '../icons'

interface Props {
  settings: AppSettings
  hasKey: boolean
  onChange: (key: keyof AppSettings, value: boolean) => Promise<void>
  onModeChange: (mode: TranscriptionMode) => Promise<void>
}

export default function SettingsView({ settings, onChange, onModeChange }: Props): React.JSX.Element {
  const [feishu, setFeishu] = useState<{ available: boolean; authed: boolean } | null>(null)
  const [models, setModels] = useState<Awaited<ReturnType<AfterMeetApi['modelStatus']>> | null>(null)
  const [dir, setDir] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async (change: () => Promise<void>): Promise<void> => {
    setSaving(true); setError('')
    try { await change() } catch { setError('设置未保存，请重试。原设置仍然有效。') } finally { setSaving(false) }
  }
  const mode = transcriptionMode(settings)
  const modeLabels = { live: '仅实时字幕', local: '本地 Whisper 精转', qwen: 'Qwen 云端精转' }

  useEffect(() => {
    window.api.modelStatus().then(setModels).catch(() => setError('无法读取模型配置，请重新打开设置'))
    window.api.feishuStatus().then(setFeishu)
    window.api.storageInfo().then((r) => setDir(r.dir))
  }, [])

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <div className="page-h">设置</div>
        <div className="page-sub">录音权限、转写、纪要与存储</div>
      </div>

      {error && <p className="banner err" role="alert">{error}</p>}
      {saving && <p role="status">正在保存设置…</p>}
      <PermissionCard />
      <div className="grid2">
        {/* 转写 */}
        <div className="set-card">
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="brand-ic">
              <IcMic size={16} />
            </div>
            <div className="card-title">转写</div>
          </div>
          <label htmlFor="transcription-mode" className="card-title">录制结束后的转写方式</label>
          <select id="transcription-mode" aria-describedby="transcription-mode-help" className="txt-input" style={{ width: '100%', marginTop: 10 }}
            value={mode} disabled={saving} onChange={(e) => void save(() => onModeChange(e.target.value as TranscriptionMode))}>
            <option value="live">仅实时字幕</option>
            <option value="local">本地精转（不上传音频）</option>
            <option value="qwen">云端精转（上传至阿里云，可能计费）</option>
          </select>
          <p id="transcription-mode-help" className="muted" style={{ fontSize: 13 }}>
            {mode === 'live' ? '保留会中实时字幕，停止后不重新识别完整录音。' : mode === 'local'
              ? '停止后使用本地 Whisper 重新识别完整录音。'
              : '停止后上传录音至 Qwen 精转；云端不可用时尝试本地 Whisper。长录音自动分段，说话人编号在各段内独立。'}
          </p>
          <div className="tile" role="status" style={{ padding: '12px 14px', fontSize: 13 }}>
            <strong>当前生效：{models ? modeLabels[effectiveTranscriptionMode(settings, models.qwen)] : '正在读取配置…'}</strong>
            {mode === 'qwen' && models && <div style={{ marginTop: 6 }}>
              {models.qwen ? '已检测到 Qwen 密钥；尚未验证服务连接，实际结果以转写任务为准。'
                : '未检测到 Qwen 密钥，将使用本地精转。配置密钥并重启后，云端选项才会生效。'}
            </div>}
            <div className="muted" style={{ marginTop: 6 }}>会中实时字幕始终在本机运行；自动生成纪要由右侧单独控制。</div>
          </div>
        </div>

        {/* 纪要生成 */}
        <div className="set-card">
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="brand-ic">
              <IcSparkles size={16} />
            </div>
            <div className="card-title">纪要生成</div>
          </div>
          <ToggleRow
            title="录制结束自动生成纪要"
            desc="默认 Luna 生成纪要；会议详情可点 Sol 深度分析"
            on={settings.autoMinutes}
            disabled={saving}
            onToggle={() => void save(() => onChange('autoMinutes', !settings.autoMinutes))}
          />
          <div className="opt-tile" style={{ marginTop: 12, cursor: 'default', borderColor: models?.openai ? 'var(--green)' : 'transparent' }}>
            <StatusDot ok={!!models?.openai} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>OpenAI API Key</div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {models === null ? '读取配置中…' : models.openai ? `已检测到密钥：${models.standard} / ${models.deep}；尚未验证服务连接` : '未配置，请在本机 .env 中填写 OPENAI_API_KEY'}
              </div>
            </div>
          </div>
        </div>

        {/* 自动化 */}
        <div className="set-card">
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="brand-ic">
              <IcCalendar size={16} />
            </div>
            <div className="card-title">自动化</div>
          </div>
          <ToggleRow
            title="自动录制"
            desc="检测到会议音频活跃时,自动开始录制"
            on={settings.autoStart}
            disabled={saving}
            onToggle={() => void save(() => onChange('autoStart', !settings.autoStart))}
          />
          <div
            className="opt-tile"
            style={{
              marginTop: 12,
              cursor: 'default',
              borderColor: feishu?.authed ? 'var(--green)' : 'transparent'
            }}
          >
            <StatusDot ok={!!feishu?.authed} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>飞书日历</div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {feishu === null
                  ? '检测中…'
                  : feishu.authed
                    ? '已连接,首页可看日程并关联录制'
                    : feishu.available
                      ? '已安装 lark-cli,但未授权 —— 请运行 lark-cli 登录'
                      : '未安装 lark-cli,无法读取日历'}
              </div>
            </div>
          </div>
        </div>

        {/* 存储 */}
        <div className="set-card">
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="brand-ic">
              <IcFolder size={16} />
            </div>
            <div className="card-title">存储</div>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
            转写与音频存档目录
          </div>
          <div
            className="tile"
            style={{
              padding: '11px 14px',
              fontSize: 11.5,
              wordBreak: 'break-all',
              fontFamily: 'ui-monospace, monospace'
            }}
          >
            {dir || '…'}
          </div>
          <button
            className="btn soft"
            style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
            onClick={() => window.api.openTranscriptsFolder()}
          >
            <IcFolder size={14} /> 打开文件夹
          </button>
        </div>
      </div>
    </div>
  )
}

function ToggleRow({
  title,
  desc,
  on,
  onToggle,
  disabled
}: {
  title: string
  desc: string
  on: boolean
  onToggle: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {desc}
        </div>
      </div>
      <Switch label={title} checked={on} disabled={disabled} onChange={onToggle} />
    </div>
  )
}

function StatusDot({ ok }: { ok: boolean }): React.JSX.Element {
  return (
    <div
      className="check"
      style={{
        background: ok ? 'var(--green)' : 'var(--coral-tint)',
        borderColor: ok ? 'var(--green)' : 'var(--coral-tint)',
        color: ok ? '#fff' : 'var(--coral-ink)'
      }}
    >
      {ok ? <IcCheck size={12} /> : <IcX size={11} />}
    </div>
  )
}
