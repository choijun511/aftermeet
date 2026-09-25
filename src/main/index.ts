import { app, BrowserWindow, ipcMain, shell, systemPreferences, protocol } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, appendFileSync } from 'fs'
import { testSystemAudio, audioProbeRunning } from './permissions'
import { Session } from './session'
import { openaiAvailable, openaiModel } from './openai'
import { qwenAvailable, qwenModel } from './qwen'
import { playbackActive, playbackResponse, preparePlayback, releasePlayback, releasePlaybackOwner, setPlaybackActive } from './playback'
import { AutoStart } from './autostart'
import {
  listTodayMeetings,
  listMeetingsByDate,
  feishuAvailable,
  feishuStatus,
  searchMeetings,
  fetchMiaoji,
  extractMinuteToken
} from './feishu'
import {
  listMeetings,
  getMeeting,
  deleteMeeting,
  upsertMeeting,
  transcriptsDir,
  getSetting,
  setSetting
} from './store'
import { hasApiKey, askMeeting } from './llm'
import { buildMeetingPrep } from './prep'
import { storageWarnings } from './atomic-json'
import { recoverOrphans } from './recover'
import type { AppSettings, CalendarEvent } from '../shared/types'

function currentSettings(): AppSettings {
  return {
    cloudAsr: getSetting('cloudAsr', qwenAvailable()),
    autoStart: getSetting('autoStart', true),
    twoPass: getSetting('twoPass', true),
    autoMinutes: getSetting('autoMinutes', true)
  }
}

// 设定 app 名,使 userData = ~/Library/Application Support/AfterMeet(与设计稿一致)
protocol.registerSchemesAsPrivileged([{ scheme: 'aftermeet-audio', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
app.setName('AfterMeet')
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()

// 文件日志:把 console.log/error 同时写到 userData/debug.log,便于打包后诊断
// (无论 app 怎么启动都能读到日志,不依赖 stdout 捕获)。
try {
  const logPath = join(app.getPath('userData'), 'debug.log')
  const write = (tag: string, args: unknown[]): void => {
    try {
      appendFileSync(
        logPath,
        `${new Date().toISOString()} ${tag} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`
      )
    } catch {
      /* ignore */
    }
  }
  const origLog = console.log.bind(console)
  const origErr = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.log = (...a: unknown[]): void => {
    origLog(...a)
    write('LOG', a)
  }
  console.error = (...a: unknown[]): void => {
    origErr(...a)
    write('ERR', a)
  }
  console.warn = (...a: unknown[]): void => {
    origWarn(...a)
    write('WARN', a)
  }
  console.log('[boot] AfterMeet 启动,日志文件:', logPath)
} catch {
  /* ignore */
}

// 简易 .env 加载(dev 用项目根,打包后用 app 同级目录)
function loadEnv(): void {
  const candidates = [
    join(app.getPath('userData'), '.env'),
    join(app.getAppPath(), '.env'),
    join(process.cwd(), '.env'),
    join(process.resourcesPath || '', '.env')
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) {
      for (const line of readFileSync(p, 'utf-8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
        }
      }
    }
  }
}
loadEnv()

let win: BrowserWindow | null = null
let session: Session
let autoStart: AutoStart

function send(channel: string, payload: unknown): void {
  // 窗口/ webContents 可能已销毁(用户关窗但 app 仍在 macOS 后台运行,而录制定时器还在跑)
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    title: '会后秘书 AfterMeet',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f7f4',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const playbackOwner = win.webContents.id
  win.webContents.on('destroyed', () => releasePlaybackOwner(playbackOwner))
  win.webContents.on('render-process-gone', () => releasePlaybackOwner(playbackOwner))
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) releasePlaybackOwner(playbackOwner) })

  // 窗口关闭后置空引用,使 send() 短路,避免向已销毁的 webContents 推送而崩溃
  win.on('closed', () => {
    win = null
  })
}

function registerIpc(): void {
  ipcMain.handle('playback:prepare', async (event, id: string) => {
    if (event.sender !== win?.webContents || event.senderFrame !== event.sender.mainFrame) return { ok: false, error: '不可用的播放器窗口' }
    if (['starting', 'recording'].includes(session.getStatus().state)) return { ok: false, error: '请先停止录制再回放，避免录入回放声音' }
    return preparePlayback(id, event.sender.id)
  })
  ipcMain.handle('playback:active', (event, token: string, active: boolean) => {
    if (active && ['starting', 'recording'].includes(session.getStatus().state)) return false
    return setPlaybackActive(token, event.sender.id, active === true)
  })
  ipcMain.handle('playback:release', (event, token: string) => releasePlayback(token, event.sender.id))
  const permissions = () => ({
    supported: process.platform === 'darwin',
    microphone: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'unknown' as const,
    screen: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unknown' as const
  })
  ipcMain.handle('permissions:get', permissions)
  ipcMain.handle('permissions:testSystemAudio', () => {
    if (!['idle', 'error'].includes(session.getStatus().state)) {
      return { ok: false, message: '请先停止录制并等待会议处理完成，再测试。' }
    }
    return testSystemAudio()
  })
  ipcMain.handle('permissions:microphone', async () => {
    if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone')
    return permissions()
  })
  ipcMain.handle('permissions:open', async (_e, kind: unknown) => {
    if (process.platform !== 'darwin') throw new Error('此功能仅适用于 macOS')
    if (kind !== 'microphone' && kind !== 'screen') throw new Error('未知权限类型')
    const pane = kind === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ScreenCapture'
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
  })
  ipcMain.handle('rec:start', (_e, title: string, calendar) => playbackActive() ? { ok: false, error: '请先暂停录音回放，稍候再开始录制' } : audioProbeRunning() ? { ok: false, error: '系统音频测试中，请稍后开始录制。' } : session.start(title, calendar))
  ipcMain.handle('rec:stop', () => session.stop())
  ipcMain.handle('feishu:agenda', async () => {
    try {
      const events = await listTodayMeetings()
      return { ok: true, events }
    } catch (e) {
      return { ok: false, events: [], error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('feishu:byDate', async (_e, dayOffset: number) => {
    const target = new Date()
    target.setDate(target.getDate() + dayOffset)
    const label = target.toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    })
    try {
      const events = await listMeetingsByDate(dayOffset)
      return { ok: true, events, label }
    } catch (e) {
      return { ok: false, events: [], label, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('feishu:available', () => feishuAvailable())
  ipcMain.handle('feishu:status', () => feishuStatus())
  ipcMain.handle('rec:state', () => session.getStatus())
  ipcMain.handle('meetings:list', () => listMeetings())
  ipcMain.handle('meetings:get', (_e, id: string) => getMeeting(id))
  ipcMain.handle('meetings:delete', (_e, id: string) => {
    if (session.getStatus().state !== 'idle') return { ok: false, error: '请等待录制或处理结束后删除' }
    deleteMeeting(id)
    return { ok: true }
  })
  ipcMain.handle('meetings:retranscribe', (_e, id: string, options) => audioProbeRunning() ? { ok: false, error: '系统音频测试中，请稍后处理' } : session.retranscribe(id, options))
  ipcMain.handle('meetings:cancelProcessing', (_e, id: string) => session.cancelProcessing(id))
  ipcMain.handle('meetings:regenerate', (_e, id: string, mode: string) => session.regenerate(id, mode === 'deep' ? 'deep' : 'standard'))
  ipcMain.handle('app:modelStatus', () => ({ openai: openaiAvailable(), qwen: qwenAvailable(), standard: openaiModel(), deep: openaiModel('deep'), asr: qwenModel() }))
  ipcMain.handle('meetings:toggleTodo', (_e, meetingId: string, todoId: string) => {
    const m = getMeeting(meetingId)
    if (!m) return { ok: false }
    if (session.getStatus().meetingId === meetingId && session.getStatus().state !== 'idle') return { ok: false }
    const todo = m.todos.find((t) => t.id === todoId)
    if (todo) {
      todo.done = !todo.done
      upsertMeeting(m)
    }
    return { ok: true }
  })
  ipcMain.handle('meetings:rename', (_e, id: string, title: string) => {
    const m = getMeeting(id)
    if (!m) return { ok: false }
    if (session.getStatus().meetingId === id && session.getStatus().state !== 'idle') return { ok: false }
    m.title = title.trim() || m.title
    upsertMeeting(m)
    send('meeting-updated', m)
    return { ok: true }
  })
  ipcMain.handle('feishu:searchNotes', async (_e, id: string) => {
    const m = getMeeting(id)
    if (!m) return { ok: false, candidates: [], error: '会议不存在' }
    try {
      // 用会议标题(去掉自动命名的「会议 时刻」)+ 开始时间做窗口搜索
      const q = /^会议\s+\d/.test(m.title) ? '' : m.title
      const candidates = await searchMeetings(q, m.startedAt)
      return { ok: true, candidates }
    } catch (e) {
      return { ok: false, candidates: [], error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(
    'feishu:applyNotes',
    async (_e, id: string, source: { feishuMeetingId?: string; minuteInput?: string }) => {
      let fetchOpts: { meetingId?: string; minuteToken?: string }
      if (source.minuteInput) {
        const token = extractMinuteToken(source.minuteInput)
        if (!token) return { ok: false, error: '无法从链接中识别妙记 token' }
        fetchOpts = { minuteToken: token }
      } else if (source.feishuMeetingId) {
        fetchOpts = { meetingId: source.feishuMeetingId }
      } else {
        return { ok: false, error: '缺少妙记来源' }
      }
      const res = await fetchMiaoji(fetchOpts)
      if (!res.ok || !res.transcript) return { ok: false, error: res.error || '拉取妙记失败' }
      return session.applyFeishuNotes(id, res.transcript, res.title)
    }
  )
  ipcMain.handle('feishu:useLocal', (_e, id: string) => session.useLocalNotes(id))
  ipcMain.handle('meeting:prep', async (_e, event: CalendarEvent) => {
    try {
      return await buildMeetingPrep(event)
    } catch (e) {
      return { hasPrev: false, openTodos: [], focus: [], error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('meetings:ask', async (_e, id: string, question: string) => {
    const m = getMeeting(id)
    if (!m) return { ok: false, answer: '', error: '会议不存在' }
    if (!m.transcript?.trim()) return { ok: false, answer: '', error: '本场会议没有转写内容' }
    try {
      const answer = await askMeeting(m.transcript, question)
      return { ok: true, answer }
    } catch (e) {
      return { ok: false, answer: '', error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('app:openTranscripts', () => shell.openPath(transcriptsDir()))
  ipcMain.handle('app:hasApiKey', () => hasApiKey())
  ipcMain.handle('app:storageInfo', () => ({ dir: transcriptsDir() }))
  ipcMain.handle('app:openPath', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('settings:get', () => currentSettings())
  ipcMain.handle('settings:set', (_e, key: keyof AppSettings, value: boolean) => {
    if (!['cloudAsr', 'autoStart', 'twoPass', 'autoMinutes'].includes(key) || typeof value !== 'boolean') throw new Error('设置参数无效')
    setSetting(key, value)
    if (key === 'autoStart') autoStart.setEnabled(value)
    return currentSettings()
  })
  ipcMain.handle('autostart:set', (_e, on: boolean) => {
    setSetting('autoStart', on) // 持久化用户偏好
    autoStart.setEnabled(on)
    return { ok: true, enabled: autoStart.enabled }
  })
  ipcMain.handle('autostart:get', () => autoStart.enabled)
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() } })

app.whenReady().then(() => {
  if (!hasInstanceLock) return
  protocol.handle('aftermeet-audio', playbackResponse)
  // dev 下 dock 用我们的图标(打包版由 .icns 提供)
  if (!app.isPackaged) {
    const devIcon = join(app.getAppPath(), 'build', 'icon.png')
    if (existsSync(devIcon)) app.dock?.setIcon(devIcon)
  }
  session = new Session(send)
  autoStart = new AutoStart(session, (msg) => send('notice', msg))
  // 按持久化偏好武装自动起录(默认开;用户关过就保持关)
  try { autoStart.setEnabled(getSetting('autoStart', true)) } catch (e) {
    storageWarnings.push(e instanceof Error ? e.message : String(e))
    autoStart.setEnabled(false)
  }
  // 崩溃/强退恢复:补建未入库的中断录制(在建窗前跑,窗口一开就能看到)
  let recovered: string[] = []
  try {
    recovered = recoverOrphans()
    if (recovered.length) console.log(`[recover] 恢复了 ${recovered.length} 场中断录制:`, recovered.join('、'))
  } catch (e) {
    console.error('[recover] 失败:', e instanceof Error ? e.message : e)
    storageWarnings.push(e instanceof Error ? e.message : String(e))
  }
  registerIpc()
  createWindow()
  // 窗口加载完再提示,确保渲染端已挂上监听
  if (storageWarnings.length && win) win.webContents.once('did-finish-load', () => send('notice', storageWarnings.join('；')))
  if (recovered.length && win) {
    win.webContents.once('did-finish-load', () => {
      send('notice', `已恢复 ${recovered.length} 场中断的录制,可在会议库查看`)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
