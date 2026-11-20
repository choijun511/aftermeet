// 本地存储:会议元数据存 meetings.json,实时转写存档为 transcripts/*.txt。
// 不引入 sqlite(避免 Electron 原生模块重编译),用 JSON 文件足够。

import { app } from 'electron'
import { basename, join, resolve, sep } from 'path'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { readJson, writeJson } from './atomic-json'
import type { Meeting } from '../shared/types'

function dataDir(): string {
  // app 名设为 AfterMeet,故 userData = ~/Library/Application Support/AfterMeet
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function transcriptsDir(): string {
  const dir = join(dataDir(), 'transcripts')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function dbPath(): string {
  return join(dataDir(), 'meetings.json')
}

// ---- 轻量设置持久化(settings.json)----
function settingsPath(): string {
  return join(dataDir(), 'settings.json')
}
function loadSettings(): Record<string, unknown> {
  return readJson(settingsPath(), {}, (v) => v && typeof v === 'object' && !Array.isArray(v))
}
export function getSetting<T>(key: string, def: T): T {
  const s = loadSettings()
  return key in s ? s[key] as T : def
}
export function setSetting(key: string, val: unknown): void {
  setSettings({ [key]: val })
}
export function setSettings(values: Record<string, unknown>): void {
  writeJson(settingsPath(), { ...loadSettings(), ...values })
}
function load(): Meeting[] {
  return readJson(dbPath(), [], (v) => Array.isArray(v) && v.every((m) =>
    typeof m.id === 'string' && typeof m.title === 'string' && typeof m.startedAt === 'number' &&
    typeof m.transcript === 'string' && Array.isArray(m.todos)))
}
export function deletedMeetingIds(): string[] {
  return readJson(join(dataDir(), 'deleted-meetings.json'), [], (v) => Array.isArray(v) && v.every((id) => typeof id === 'string'))
}
export function listMeetings(): Meeting[] {
  return [...load()].sort((a, b) => b.startedAt - a.startedAt)
}

export function getMeeting(id: string): Meeting | null {
  return load().find((m) => m.id === id) ?? null
}

export function upsertMeeting(m: Meeting): void {
  const all = load()
  const i = all.findIndex((x) => x.id === m.id)
  if (i >= 0) all[i] = m
  else all.unshift(m)
  writeJson(dbPath(), all)
}

/**
 * 删除会议记录及其本地文件：录音、会中转写、转写断点与转写前快照。
 * 界面承诺「不可恢复」，因此 meetings.json.bak 也会刷新为不含该会议的版本。
 * 返回未能删除的文件（记录本身已删除），供界面提示。
 */
export function deleteMeeting(id: string): { failed: string[] } {
  const all = load()
  const target = all.find((m) => m.id === id)
  const remaining = all.filter((m) => m.id !== id)
  writeJson(join(dataDir(), 'deleted-meetings.json'), [...new Set([...deletedMeetingIds(), id])])
  writeJson(dbPath(), remaining)
  writeJson(dbPath(), remaining) // 第二次写入把 .bak 也替换成不含该会议的版本

  const files = new Set<string>()
  const transcripts = transcriptsDir()
  // 只删除应用数据目录内的文件，避免异常记录指向其它位置时误删。
  for (const path of [target?.audioPath, target?.transcriptPath, join(transcripts, `audio-${id}.pcm`), join(transcripts, `会中转写-${id}.txt`)]) {
    if (path && resolve(path).startsWith(resolve(dataDir()) + sep)) files.add(resolve(path))
  }
  const processing = join(dataDir(), 'processing')
  if (/^m_[a-zA-Z0-9_-]+$/.test(id) && existsSync(processing)) {
    for (const name of readdirSync(processing)) if (name.startsWith(`${id}-`)) files.add(join(processing, name))
  }
  const failed: string[] = []
  for (const path of files) {
    try { rmSync(path, { force: true }) } catch { failed.push(basename(path)) }
  }
  return { failed }
}
