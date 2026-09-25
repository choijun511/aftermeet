import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

/** A temp file is flushed before atomic replacement. Never truncate the live file. */
function replace(path: string, text: string): void {
  const temp = `${path}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(temp, 'wx', 0o600)
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    renameSync(temp, path)
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (existsSync(temp)) unlinkSync(temp)
  }
}
export const storageWarnings: string[] = []
export function readJson<T>(path: string, fallback: T, valid: (value: any) => boolean): T {
  if (!existsSync(path) && !existsSync(`${path}.bak`)) return structuredClone(fallback)
  const parse = (p: string): T => {
    const value = JSON.parse(readFileSync(p, 'utf8'))
    if (!valid(value)) throw new Error('数据格式不正确')
    return value
  }
  try { return parse(path) } catch {
    try {
      const backup = parse(`${path}.bak`)
      if (existsSync(path)) renameSync(path, `${path}.corrupt-${randomUUID()}`)
      replace(path, JSON.stringify(backup, null, 2))
      const message = '检测到本地数据损坏，已从备份恢复；损坏文件已保留，请核对最近的会议。'
      if (!storageWarnings.includes(message)) storageWarnings.push(message)
      return backup
    } catch {
      throw new Error('本地数据文件及备份无法读取，已停止写入以保护原始资料。请先备份应用数据目录。')
    }
  }
}
export function writeJson(path: string, value: unknown): void {
  // Refuse to turn corrupt data into an apparently valid empty database.
  if (existsSync(path)) {
    const old = readFileSync(path, 'utf8')
    JSON.parse(old)
    replace(`${path}.bak`, old)
  }
  replace(path, JSON.stringify(value, null, 2))
}
