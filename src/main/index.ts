import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, appendFileSync } from 'fs'
import { Session } from './session'
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
import { recoverOrphans } from './recover'
import type { AppSettings, CalendarEvent } from '../shared/types'

function currentSettings(): AppSettings {
  return {
    autoStart: getSetting('autoStart', true),
    twoPass: getSetting('twoPass', true),
    autoMinutes: getSetting('autoMinutes', true)
  }
}

// 设定 app 名,使 userData = ~/Library/Application Support/AfterMeet(与设计稿一致)
app.setName('AfterMeet')

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
      break
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

  // 窗口关闭后置空引用,使 send() 短路,避免向已销毁的 webContents 推送而崩溃
  win.on('closed', () => {
    win = null
  })
}

function registerIpc(): void {
  ipcMain.handle('rec:start', (_e, title: string, calendar) => session.start(title, calendar))
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
    deleteMeeting(id)
    return { ok: true }
  })
  ipcMain.handle('meetings:regenerate', (_e, id: string) => session.regenerate(id))
  ipcMain.handle('meetings:toggleTodo', (_e, meetingId: string, todoId: string) => {
    const m = getMeeting(meetingId)
    if (!m) return { ok: false }
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

app.whenReady().then(() => {
  // dev 下 dock 用我们的图标(打包版由 .icns 提供)
  if (!app.isPackaged) {
    const devIcon = join(app.getAppPath(), 'build', 'icon.png')
    if (existsSync(devIcon)) app.dock?.setIcon(devIcon)
  }
  session = new Session(send)
  autoStart = new AutoStart(session, (msg) => send('notice', msg))
  // 按持久化偏好武装自动起录(默认开;用户关过就保持关)
  autoStart.setEnabled(getSetting('autoStart', true))
  // 崩溃/强退恢复:补建未入库的中断录制(在建窗前跑,窗口一开就能看到)
  let recovered: string[] = []
  try {
    recovered = recoverOrphans()
    if (recovered.length) console.log(`[recover] 恢复了 ${recovered.length} 场中断录制:`, recovered.join('、'))
  } catch (e) {
    console.error('[recover] 失败:', e instanceof Error ? e.message : e)
  }
  registerIpc()
  createWindow()
  // 窗口加载完再提示,确保渲染端已挂上监听
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
