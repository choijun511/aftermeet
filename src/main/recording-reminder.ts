import { BrowserWindow, screen, systemPreferences } from 'electron'
import { MicWatcher } from './micwatch'
import { ReminderPolicy } from './reminder-policy'
import { playbackActive } from './playback'
import { audioProbeRunning } from './permissions'
import { getSetting } from './store'
import type { Session } from './session'

export class RecordingReminder {
  private watcher: MicWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private panel: BrowserWindow | null = null
  private policy = new ReminderPolicy()
  constructor(private session: Session, private reveal: () => void, private notice: (text: string) => void) {}
  setEnabled(enabled: boolean): void {
    this.stop()
    if (!enabled) return
    this.policy = new ReminderPolicy()
    this.watcher = new MicWatcher({ audioActivity: true,
      onActive: () => this.policy.activity(true, Date.now()),
      onIdle: () => { this.policy.activity(false, Date.now()); this.close() }
    })
    this.watcher.start()
    this.timer = setInterval(() => this.check(), 1000)
  }
  private available(): boolean {
    return ['idle', 'error'].includes(this.session.getStatus().state) && !playbackActive() && !audioProbeRunning() && !getSetting('autoStart', true)
  }
  private check(): void {
    if (!this.available()) { this.close(); return }
    if (this.policy.shouldShow(Date.now(), true)) { this.policy.markShown(); this.show() }
  }
  private show(): void {
    if (this.panel) return
    const microphone = systemPreferences.getMediaAccessStatus('microphone') === 'granted'
    const system = systemPreferences.getMediaAccessStatus('screen') === 'granted'
    const hint = microphone && system ? '录音权限已就绪。点击后开始录音。' : '部分录音权限尚未就绪，可打开主窗口检查设置。'
    const bounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const panel = new BrowserWindow({ width: 370, height: 230, x: bounds.x + bounds.width - 386, y: bounds.y + 20,
      title: 'AfterMeet 录音提醒', frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    this.panel = panel
    panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    panel.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (url === 'aftermeet-reminder://start') {
        if (!this.available()) { this.close(); return }
        const result = this.session.start('')
        this.policy.snooze(Date.now()); this.close(); this.reveal()
        if (!result.ok) this.notice(result.error || '录制启动失败，请检查权限')
      } else if (url === 'aftermeet-reminder://settings') { this.policy.snooze(Date.now()); this.close(); this.reveal() }
      else if (url === 'aftermeet-reminder://later') { this.policy.snooze(Date.now()); this.close() }
    })
    panel.on('closed', () => { if (this.panel === panel) this.panel = null })
    panel.once('ready-to-show', () => { if (!panel.isDestroyed() && this.available()) panel.showInactive() })
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{margin:0;padding:22px;background:#f5f6f9;color:#17191d;font:14px -apple-system,sans-serif}h1{font-size:18px;margin:0 0 12px}p{line-height:1.5;color:#555}nav{display:flex;gap:12px;margin-top:18px}a{padding:10px 16px;border-radius:22px;background:#e6e8ec;color:#17191d;text-decoration:none}a:first-child{background:#17191d;color:white}a:focus-visible{outline:3px solid #39866a;outline-offset:3px}</style><h1>可能正在开会，要录音吗？</h1><p>检测到麦克风或系统音频设备正在使用。<br>${hint}</p><nav><a href="aftermeet-reminder://${microphone && system ? 'start' : 'settings'}">${microphone && system ? '开始录音' : '打开应用检查权限'}</a><a href="aftermeet-reminder://later">稍后（10 分钟）</a></nav></html>`
    void panel.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => this.close())
  }
  private close(): void { const panel = this.panel; this.panel = null; if (panel && !panel.isDestroyed()) panel.close() }
  stop(): void { this.watcher?.stop(); this.watcher = null; if (this.timer) clearInterval(this.timer); this.timer = null; this.close() }
}
