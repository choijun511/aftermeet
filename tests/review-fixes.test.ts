import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, openSync, ftruncateSync, closeSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { upsertMeeting, getMeeting, transcriptsDir, deleteMeeting } from '../src/main/store'
import { transcribeSavedAudio, checkpointPath } from '../src/main/processing'
import { transcribeQwenPcm } from '../src/main/qwen'
import { Session } from '../src/main/session'
import { AutoStart } from '../src/main/autostart'
import type { Meeting, StatusEvent } from '../src/shared/types'

let dir: string
const originalEnv = { ...process.env }
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aftermeet-review-test-'))
  process.env.AFTERMEET_TEST_DATA = dir
})
afterEach(() => { process.env = { ...originalEnv }; rmSync(dir, { recursive: true, force: true }) })

function meeting(id = 'm_1700000000000'): Meeting {
  return { id, title: '测试会议', startedAt: 1700000000000, endedAt: 1700000010000, durationSec: 10, transcript: '已有文字', todos: [] }
}
function pcm(seconds: number, file = join(dir, 'audio.pcm')): string {
  const fd = openSync(file, 'w'); ftruncateSync(fd, seconds * 32000); closeSync(fd)
  return file
}

test('a failed recording start does not lock delete, regenerate or retranscribe', async () => {
  const session: any = new Session(() => {})
  // 模拟 start() 中 audio.start() 失败后的状态：state='error'，cleanup 已清空 meeting。
  session.state = 'error'; session.meeting = null
  assert.equal(session.isIdle(), true)
  upsertMeeting({ ...meeting(), audioPath: join(dir, 'missing.pcm') })
  const result = await session.retranscribe('m_1700000000000', { engine: 'local' })
  assert.doesNotMatch(result.error || '', /请等待/)
  session.state = 'recording'; session.meeting = meeting('m_2')
  assert.equal(session.isIdle(), false)
})

test('one silent 20-minute chunk is skipped with a warning instead of failing the meeting', async () => {
  const m = { ...meeting(), audioPath: pcm(1203) } // 第 2 段只有 3 秒
  let call = 0
  const result = await transcribeSavedAudio(m, { engine: 'local' }, new AbortController().signal, () => {}, async () => (call++ === 0 ? '前二十分钟内容' : ''))
  assert.equal(result.text, '前二十分钟内容')
  assert.match(result.warnings.join(), /第 2\/2 段.*按静音跳过/)
  assert.ok(existsSync(checkpointPath(m.id, 'local')))
  // 全部分段无字仍然报错并保留原稿
  await assert.rejects(transcribeSavedAudio({ ...m, audioPath: pcm(2, join(dir, 'b.pcm')) }, { engine: 'local', restart: true }, new AbortController().signal, () => {}, async () => ''), /所有分段均未识别出文字/)
})

test('Qwen path tolerates one no-words chunk when another chunk has text', async () => {
  process.env.DASHSCOPE_API_KEY = 'test-key'; process.env.DASHSCOPE_REGION = 'ap-southeast-1'
  const file = pcm(1203)
  let task = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    const u = String(url)
    const json = (v: unknown): Response => new Response(JSON.stringify(v))
    if (u.includes('/uploads?')) return json({ data: { upload_host: 'https://sample.aliyuncs.com', upload_dir: 'private' } })
    if (u === 'https://sample.aliyuncs.com') return new Response('ok')
    if (u.endsWith('/transcription')) return json({ output: { task_id: `task${++task}` } })
    if (u.includes('/tasks/task2')) return json({ output: { task_status: 'FAILED', code: 'ASR_RESPONSE_HAVE_NO_WORDS' } })
    if (u.includes('/tasks/task1')) return json({ output: { task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/r.json' }] } })
    if (u.includes('r.json')) return json({ transcripts: [{ sentences: [{ text: '第一段', begin_time: 0, end_time: 1000, speaker_id: 0 }] }] })
    throw new Error(`unexpected ${u}`)
  }) as typeof fetch
  try {
    const result = await transcribeQwenPcm(file, () => {}, async () => '')
    assert.match(result.text, /第一段/)
    assert.match(result.warnings.join(), /按静音跳过/)
  } finally { globalThis.fetch = originalFetch }
})

test('deleting a meeting removes its audio, transcript, checkpoints and backup copy', () => {
  const id = 'm_1700000000000'
  const audio = join(transcriptsDir(), `audio-${id}.pcm`)
  const archive = join(transcriptsDir(), `会中转写-${id}.txt`)
  writeFileSync(audio, Buffer.alloc(320)); writeFileSync(archive, '会议原文')
  mkdirSync(join(dir, 'processing'), { recursive: true })
  const checkpoint = join(dir, 'processing', `${id}-local.json`)
  const snapshot = join(dir, 'processing', `${id}-before-transcription-x.json`)
  const other = join(dir, 'processing', 'm_17000000000001-local.json')
  for (const f of [checkpoint, snapshot, other]) writeFileSync(f, '{}')
  const outside = join(tmpdir(), `aftermeet-outside-${process.pid}.pcm`); writeFileSync(outside, 'x')
  upsertMeeting({ ...meeting(id), audioPath: audio, transcriptPath: archive })
  upsertMeeting({ ...meeting('m_2'), audioPath: outside })
  try {
    assert.deepEqual(deleteMeeting(id).failed, [])
    for (const f of [audio, archive, checkpoint, snapshot]) assert.equal(existsSync(f), false, f)
    assert.equal(existsSync(other), true)
    assert.equal(getMeeting(id), null)
    assert.doesNotMatch(readFileSync(join(dir, 'meetings.json.bak'), 'utf8'), new RegExp(id))
    deleteMeeting('m_2')
    assert.equal(existsSync(outside), true, 'files outside the data dir are never removed')
  } finally { rmSync(outside, { force: true }) }
})

function fakeSession() {
  const s = {
    status: { state: 'idle', durationSec: 0, active: false } as StatusEvent,
    nextStart: { ok: true, meetingId: 'm_auto' } as { ok: boolean; meetingId?: string; error?: string },
    stops: 0,
    isIdle: () => ['idle', 'error'].includes(s.status.state),
    getStatus: () => s.status,
    start: () => {
      if (s.nextStart.ok) s.status = { state: 'recording', durationSec: 0, active: true, meetingId: s.nextStart.meetingId }
      return s.nextStart
    },
    stop: async () => { s.stops++; s.status = { state: 'idle', durationSec: 0, active: false }; return { ok: true } }
  }
  return s
}

test('auto-start only auto-stops the meeting it started, and reports start failures', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const session = fakeSession(); const notices: string[] = []
  const auto: any = new AutoStart(session as any, (m) => notices.push(m))

  auto.handleActive(); auto.handleIdle()
  t.mock.timers.tick(12000)
  assert.equal(session.stops, 1, 'auto-started meeting stops after the grace period')

  // 用户手动停止自动会议后，手动开始的会议不能被自动停止
  auto.handleActive()
  session.status = { state: 'idle', durationSec: 0, active: false }
  session.status = { state: 'recording', durationSec: 0, active: true, meetingId: 'm_manual' }
  auto.handleIdle(); t.mock.timers.tick(20000)
  assert.equal(session.stops, 1)

  session.status = { state: 'idle', durationSec: 0, active: false }
  session.nextStart = { ok: false, error: 'helper 不存在' }
  auto.handleActive()
  assert.match(notices.at(-1)!, /自动录制启动失败.*helper 不存在/)
})
