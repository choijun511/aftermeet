// A disposable process for the kill/restart regression. All data and network are fixtures.
import { appendFileSync } from 'fs'
import { join } from 'path'
import { Session } from '../src/main/session'
import { recoverOrphans } from '../src/main/recover'
const mode = process.argv[2]
const json = (v: unknown): Response => new Response(JSON.stringify(v))
globalThis.fetch = async (url) => {
  const u = String(url)
  appendFileSync(join(process.env.AFTERMEET_TEST_DATA!, 'calls.txt'), u + '\n')
  if (u.includes('/uploads?')) return json({ data: { upload_host: 'https://sample.aliyuncs.com', upload_dir: 'test' } })
  if (u === 'https://sample.aliyuncs.com') return new Response('ok')
  if (u.endsWith('/transcription')) return json({ output: { task_id: 'crash-task' } })
  if (u.includes('/tasks/')) {
    if (mode === 'crash') process.kill(process.pid, 'SIGKILL')
    return json({ output: { task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://sample.aliyuncs.com/result' }] } })
  }
  return json({ transcripts: [{ text: '崩溃恢复后的会议记录。' }] })
}
async function main(): Promise<void> {
  recoverOrphans()
  const session = new Session(() => {})
  const result = await session.retranscribe('m_1700000000000', { engine: 'qwen' })
  if (!result.ok) throw new Error(result.error)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
