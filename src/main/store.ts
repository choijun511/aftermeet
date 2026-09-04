// 本地存储:会议元数据存 meetings.json,实时转写存档为 transcripts/*.txt。
// 不引入 sqlite(避免 Electron 原生模块重编译),用 JSON 文件足够。

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
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
let settingsCache: Record<string, unknown> | null = null
function loadSettings(): Record<string, unknown> {
  if (settingsCache) return settingsCache
  try {
    settingsCache = existsSync(settingsPath())
      ? (JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Record<string, unknown>)
      : {}
  } catch {
    settingsCache = {}
  }
  return settingsCache!
}
export function getSetting<T>(key: string, def: T): T {
  const s = loadSettings()
  return key in s ? (s[key] as T) : def
}
export function setSetting(key: string, val: unknown): void {
  const s = loadSettings()
  s[key] = val
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf-8')
}

let cache: Meeting[] | null = null

function load(): Meeting[] {
  if (cache) return cache
  const p = dbPath()
  if (!existsSync(p)) {
    cache = []
    return cache
  }
  try {
    cache = JSON.parse(readFileSync(p, 'utf-8')) as Meeting[]
  } catch {
    cache = []
  }
  return cache!
}

function persist(): void {
  writeFileSync(dbPath(), JSON.stringify(cache ?? [], null, 2), 'utf-8')
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
  persist()
}

export function deleteMeeting(id: string): void {
  cache = load().filter((m) => m.id !== id)
  persist()
}
