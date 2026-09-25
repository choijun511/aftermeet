import React from 'react'
import { useEffect, useState } from 'react'
import type { AppSettings, AfterMeetApi } from '../../../shared/types'
import PermissionCard from './PermissionCard'
import { IcMic, IcSparkles, IcCalendar, IcFolder, IcCheck, IcX } from '../icons'

interface Props {
  settings: AppSettings
  hasKey: boolean
  onChange: (key: keyof AppSettings, value: boolean) => void
}

export default function SettingsView({ settings, onChange }: Props): React.JSX.Element {
  const [feishu, setFeishu] = useState<{ available: boolean; authed: boolean } | null>(null)
  const [models, setModels] = useState<Awaited<ReturnType<AfterMeetApi['modelStatus']>> | null>(null)
  const [dir, setDir] = useState('')

  useEffect(() => {
    window.api.modelStatus().then(setModels)
    window.api.feishuStatus().then(setFeishu)
    window.api.storageInfo().then((r) => setDir(r.dir))
  }, [])

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <div className="page-h">设置</div>
        <div className="page-sub">录音权限、转写、纪要与存储</div>
      </div>

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
          <ToggleRow
            title="停止后高精度重转"
            desc="录制结束重新处理完整录音；云端不可用时回退本地 Whisper"
            on={settings.twoPass}
            onToggle={() => onChange('twoPass', !settings.twoPass)}
          />
          <ToggleRow
            title="Qwen 云端精转"
            desc="开启后将录音上传至阿里云转写并区分说话人；关闭后仅使用本地 Whisper。需同时开启高精度重转。"
            on={settings.cloudAsr}
            onToggle={() => onChange('cloudAsr', !settings.cloudAsr)}
          />
          <div className="tile" style={{ padding: '12px 14px', marginTop: 12, fontSize: 12.5 }}>
            <span className="muted">引擎</span>
            <div style={{ fontWeight: 600, marginTop: 2 }}>
              本地实时字幕 + {settings.cloudAsr ? 'Qwen 云端精转' : 'Whisper 本地精转'}
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>
              {models?.qwen ? 'Qwen 密钥已配置' : 'Qwen 密钥未配置，将使用本地精转'}。长录音自动分段；不同分段的说话人编号独立。
            </div>
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
            onToggle={() => onChange('autoMinutes', !settings.autoMinutes)}
          />
          <div className="opt-tile" style={{ marginTop: 12, cursor: 'default', borderColor: models?.openai ? 'var(--green)' : 'transparent' }}>
            <StatusDot ok={!!models?.openai} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>OpenAI API Key</div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                {models?.openai ? `已配置：${models.standard} / ${models.deep}` : '未配置，请在本机 .env 中填写 OPENAI_API_KEY'}
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
            onToggle={() => onChange('autoStart', !settings.autoStart)}
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
  onToggle
}: {
  title: string
  desc: string
  on: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {desc}
        </div>
      </div>
      <div className={`toggle${on ? ' on' : ''}`} onClick={onToggle}>
        <div className="knob" />
      </div>
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
