import { spawnSync } from 'node:child_process'
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, openSync, ftruncateSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readJson, writeJson } from '../src/main/atomic-json'
import { recoverOrphans } from '../src/main/recover'
import { upsertMeeting, getMeeting, listMeetings, transcriptsDir, deleteMeeting } from '../src/main/store'
import { transcribeQwenPcm, type QwenChunk } from '../src/main/qwen'
import { transcribeSavedAudio, checkpointPath } from '../src/main/processing'
import { Session } from '../src/main/session'
import type { Meeting } from '../src/shared/types'
let dir: string
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aftermeet-recovery-test-'))
  process.env.AFTERMEET_TEST_DATA = dir
  process.env.DASHSCOPE_API_KEY = 'test-key'
  process.env.DASHSCOPE_REGION = 'ap-southeast-1'
  delete process.env.DASHSCOPE_WORKSPACE_ID
})
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; rmSync(dir, { recursive: true, force: true }) })
const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status })
function meeting(): Meeting {
  return { id: 'm_1700000000000', title: '测试会议', startedAt: 1700000000000, endedAt: 1700000010000,
    durationSec: 10, transcript: '已有的会议文字。', todos: [{ id: 't1', text: '保留待办', done: true }] }
}
function pcm(seconds = 1, file = join(dir, 'audio.pcm')): string {
  const fd = openSync(file, 'w'); ftruncateSync(fd, seconds * 32000); closeSync(fd)
  return file
}
function cloudMock(calls: string[], fail?: (url: string) => Response | undefined): typeof fetch {
  return async (url) => {
    const u = String(url); calls.push(u)
    const failure = fail?.(u); if (failure) return failure
    if (u.includes('/uploads?')) return json({ data: { upload_host: 'https://sample.aliyuncs.com', upload_dir: 'private' } })
    if (u === 'https://sample.aliyuncs.com') return new Response('ok')
    if (u.endsWith('/transcription')) return json({ output: { task_id: 'task1' } })
    if (u.includes('/tasks/')) return json({ output: { task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://sample.aliyuncs.com/result' }] } })
    return json({ transcripts: [{ sentences: [{ text: '周五交付测试版本。', begin_time: 0, end_time: 1000 }] }] })
  }
}

test('atomic storage restores valid backup and preserves corrupt bytes; no empty overwrite', () => {
  const p = join(dir, 'data.json')
  writeJson(p, ['first']); writeJson(p, ['second'])
  writeFileSync(p, '{truncated')
  assert.deepEqual(readJson(p, [], Array.isArray), ['first'])
  assert(readdirSync(dir).some((n) => n.includes('.corrupt-')))
  writeFileSync(p, '{broken'); writeFileSync(p + '.bak', '{also broken')
  assert.throws(() => readJson(p, [], Array.isArray), /停止写入/)
  assert.throws(() => writeJson(p, []))
  assert.equal(readFileSync(p, 'utf8'), '{broken')
})

test('recovery finds audio without any subtitles, is idempotent and respects deletion', () => {
  const path = pcm(10, join(transcriptsDir(), 'audio-m_1700000000000.pcm'))
  assert.equal(recoverOrphans().length, 1)
  const m = listMeetings()[0]
  assert.equal(m.audioPath, path); assert.equal(m.transcript, '')
  assert.equal(m.processing?.state, 'paused')
  assert.equal(recoverOrphans().length, 0); assert.equal(listMeetings().length, 1)
  deleteMeeting(m.id); recoverOrphans(); assert.equal(listMeetings().length, 0)
  assert(existsSync(path))
})

test('legacy and pre-registered recordings resume instead of becoming duplicates; long timestamps survive', () => {
  const start = new Date(2026, 8, 25, 10, 0, 0).getTime()
  const path = join(transcriptsDir(), '会中转写-2026-09-25-100000.txt')
  writeFileSync(path, '# 旧会议\n[164:30] 很短\n')
  pcm(3, join(transcriptsDir(), 'audio-2026-09-25-100000.pcm'))
  upsertMeeting({ ...meeting(), id: `m_${start + 123}`, startedAt: start + 123, endedAt: undefined,
    transcript: '', transcriptPath: path, processing: { stage: 'recording', state: 'running', updatedAt: start } })
  recoverOrphans()
  assert.equal(listMeetings().length, 1)
  assert.equal(listMeetings()[0].transcript, '很短')
  assert.equal(listMeetings()[0].processing?.stage, 'saved')
  const textOnly = join(transcriptsDir(), '会中转写-2026-09-25-110000.txt')
  writeFileSync(textOnly, '# 长会\n[164:30] 短\n')
  recoverOrphans()
  assert.equal(listMeetings().find((m) => m.title === '长会')?.durationSec, 9870)
})

test('submitted Qwen task resumes querying without another upload or submission', async () => {
  const calls: string[] = []; globalThis.fetch = cloudMock(calls)
  const chunks: Record<string, QwenChunk> = { 0: { state: 'submitted', taskId: 'existing' } }
  let saved = 0
  const result = await transcribeQwenPcm(pcm(), () => {}, undefined, { chunks, save: () => saved++ })
  assert.match(result.text, /周五/); assert(saved)
  assert.equal(calls.length, 2); assert(calls[0].endsWith('/tasks/existing'))
})

test('unknown submission requires explicit consent, cancellation does not resubmit', async () => {
  const calls: string[] = []; globalThis.fetch = cloudMock(calls)
  const chunks: Record<string, QwenChunk> = { 0: { state: 'submitting' } }
  const file = pcm()
  await assert.rejects(transcribeQwenPcm(file, () => {}, undefined, { chunks, save: () => {} }), /可能重复计费/)
  assert.equal(calls.length, 0)
  await transcribeQwenPcm(file, () => {}, undefined, { chunks, save: () => {}, allowResubmit: true })
  assert.equal(calls.filter((u) => u.endsWith('/transcription')).length, 1)
})

test('durable intent and task ID survive separate reloads around network failure', async () => {
  const file = pcm(); const path = join(dir, 'checkpoint.json')
  let chunks: Record<string, QwenChunk> = {}
  const calls: string[] = []
  globalThis.fetch = cloudMock(calls, (u) => u.endsWith('/transcription') ? json({ message: 'connection lost' }, 503) : undefined)
  await assert.rejects(transcribeQwenPcm(file, () => {}, undefined, { chunks, save: () => writeJson(path, chunks) }))
  chunks = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(chunks[0].state, 'submitting')
  const count = calls.length
  await assert.rejects(transcribeQwenPcm(file, () => {}, undefined, { chunks, save: () => {} }), /提交结果未知/)
  assert.equal(calls.length, count)
})

test('local long audio resumes completed chunks after cancellation and invalidates changed content', async () => {
  const m = { ...meeting(), audioPath: pcm(1201) }
  const ctrl = new AbortController(); let runs = 0
  await assert.rejects(transcribeSavedAudio(m, { engine: 'local' }, ctrl.signal,
    (_message, done) => { if (done === 1) ctrl.abort() }, async () => { runs++; return '已完成片段' }), /取消/)
  assert.equal(runs, 1)
  const checkpoint = JSON.parse(readFileSync(checkpointPath(m.id, 'local'), 'utf8'))
  assert.equal(checkpoint.chunks[0].state, 'done')
  const result = await transcribeSavedAudio(m, { engine: 'local' }, new AbortController().signal, () => {}, async () => { runs++; return '后续片段' })
  assert.equal(runs, 2); assert.match(result.text, /已完成片段\n\n后续片段/)
  // Same path and size but different audio must not reuse earlier text.
  const fd = openSync(m.audioPath, 'r+'); writeFileSync(fd, Buffer.from([1, 0])); closeSync(fd)
  await transcribeSavedAudio(m, { engine: 'local' }, new AbortController().signal, () => {}, async () => { runs++; return '新的片段' })
  assert.equal(runs, 4)
})

test('audio over two hours is split and resumed without loading the whole file', async () => {
  const m = { ...meeting(), audioPath: pcm(7201) }; let count = 0
  await transcribeSavedAudio(m, { engine: 'local' }, new AbortController().signal, () => {}, async () => { count++; return '长会内容' })
  assert.equal(count, 7)
  await transcribeSavedAudio(m, { engine: 'local' }, new AbortController().signal, () => {}, async () => { throw new Error('must use saved chunks') })
})

test('missing audio and empty recognition preserve previous transcript and notes', async () => {
  const m = { ...meeting(), audioPath: join(dir, 'missing.pcm'), summary: '原纪要' }; upsertMeeting(m)
  const session = new Session(() => {})
  const result = await session.retranscribe(m.id, { engine: 'local' })
  assert.equal(result.ok, false); assert.equal(session.getStatus().state, 'idle')
  assert.equal(getMeeting(m.id)?.transcript, m.transcript); assert.equal(getMeeting(m.id)?.summary, '原纪要')
  await assert.rejects(transcribeSavedAudio({ ...m, audioPath: pcm() }, { engine: 'local' }, new AbortController().signal, () => {}, async () => ''), /未识别出文字/)
})

test('session retranscription preserves notes and completed todos, while recording is locked', async () => {
  const m = { ...meeting(), audioPath: pcm(), summary: '原纪要' }; upsertMeeting(m)
  const calls: string[] = []; globalThis.fetch = cloudMock(calls)
  const session = new Session(() => {})
  const pending = session.retranscribe(m.id, { engine: 'qwen' })
  assert.equal(session.start('cannot start').ok, false)
  assert.equal((await session.regenerate(m.id)).ok, false)
  assert.equal((await pending).ok, true)
  const next = getMeeting(m.id)!
  assert.match(next.transcript, /周五/); assert.equal(next.summary, '原纪要')
  assert.equal(next.todos[0].done, true); assert.equal(next.notesStale, true)
  assert.equal(next.processing?.state, 'done')
  assert(readdirSync(join(dir, 'processing')).some((n) => n.includes('before-transcription')))
})

test('cancelling in-flight cloud query keeps task ID and releases session lock', async () => {
  const m = { ...meeting(), audioPath: pcm() }; upsertMeeting(m)
  let queried!: () => void; const started = new Promise<void>((r) => queried = r)
  const calls: string[] = []; const mock = cloudMock(calls)
  globalThis.fetch = async (u, init) => {
    if (String(u).includes('/tasks/')) {
      queried()
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true }))
    }
    return mock(u, init)
  }
  const session = new Session(() => {})
  const pending = session.retranscribe(m.id, { engine: 'qwen' })
  await started
  assert.equal(session.cancelProcessing('m_other').ok, false)
  assert.equal(session.cancelProcessing(m.id).ok, true)
  assert.equal((await pending).ok, false)
  assert.equal(getMeeting(m.id)?.processing?.state, 'paused')
  assert.equal(session.getStatus().state, 'idle')
  assert.equal(JSON.parse(readFileSync(checkpointPath(m.id, 'qwen'), 'utf8')).chunks[0].taskId, 'task1')
  globalThis.fetch = cloudMock(calls)
  assert.equal((await session.retranscribe(m.id, { engine: 'qwen' })).ok, true)
  assert.equal(calls.filter((u) => u.endsWith('/transcription')).length, 1)
})

test('summary failure is resumable without ASR and keeps prior notes', async () => {
  const m = { ...meeting(), summary: '已有纪要' }; upsertMeeting(m)
  process.env.OPENAI_API_KEY = 'test-key'
  let calls = 0
  globalThis.fetch = async (u) => { assert(String(u).includes('/responses')); calls++; return json({ status: 'incomplete' }) }
  const session = new Session(() => {})
  assert.equal((await session.regenerate(m.id)).ok, false)
  assert.equal(calls, 1); assert.equal(getMeeting(m.id)?.summary, '已有纪要')
  assert.equal(getMeeting(m.id)?.processing?.stage, 'summarizing')
  assert.equal(getMeeting(m.id)?.processing?.state, 'failed')
  assert.equal(session.getStatus().state, 'idle')
})


test('a killed process resumes the saved remote task in a fresh process without duplicate submission', () => {
  const m = { ...meeting(), audioPath: pcm(1, join(transcriptsDir(), 'audio-m_1700000000000.pcm')) }
  upsertMeeting(m)
  const worker = process.env.AFTERMEET_TEST_WORKER!
  const first = spawnSync(process.execPath, [worker, 'crash'], { env: process.env, encoding: 'utf8' })
  assert.equal(first.signal, 'SIGKILL', first.stderr)
  assert.equal(getMeeting(m.id)?.processing?.state, 'running')
  const second = spawnSync(process.execPath, [worker, 'resume'], { env: process.env, encoding: 'utf8' })
  assert.equal(second.status, 0, second.stderr)
  assert.match(getMeeting(m.id)!.transcript, /崩溃恢复/)
  assert.equal(getMeeting(m.id)?.processing?.state, 'done')
  const calls = readFileSync(join(dir, 'calls.txt'), 'utf8').split('\n')
  assert.equal(calls.filter((u) => u.endsWith('/transcription')).length, 1)
  assert.equal(listMeetings().length, 1)
})


test('authentication errors stop immediately; transient task queries retry without resubmission', async () => {
  const path = pcm(); let queries = 0
  globalThis.fetch = async () => { queries++; return json({ message: 'unauthorized' }, 401) }
  const chunks: Record<string, QwenChunk> = { 0: { state: 'submitted', taskId: 'existing' } }
  await assert.rejects(transcribeQwenPcm(path, () => {}, undefined, { chunks, save: () => {} }), /401/)
  assert.equal(queries, 1)
  const calls: string[] = []; const mock = cloudMock(calls)
  queries = 0
  globalThis.fetch = async (u, init) => {
    if (String(u).includes('/tasks/') && ++queries === 1) throw new Error('offline')
    return mock(u, init)
  }
  const r = await transcribeQwenPcm(path, () => {}, undefined, { chunks, save: () => {} })
  assert.match(r.text, /周五/); assert.equal(queries, 2)
  assert.equal(calls.filter((u) => u.endsWith('/transcription')).length, 0)
})

test('summary crash status becomes paused on startup even without an audio file', () => {
  const m: Meeting = { ...meeting(), processing: { stage: 'summarizing', state: 'running', updatedAt: Date.now() } }
  upsertMeeting(m); recoverOrphans()
  assert.equal(getMeeting(m.id)?.processing?.state, 'paused')
  assert.equal(getMeeting(m.id)?.processing?.stage, 'summarizing')
})

test('stop saves and closes the recording before a failed subtitle drain; next recording is not locked', async () => {
  const { createWriteStream } = await import('node:fs')
  const path = join(transcriptsDir(), 'audio-m_1700000000000.pcm')
  const m = { ...meeting(), audioPath: path }
  upsertMeeting(m)
  const session: any = new Session(() => {})
  session.meeting = m; session.state = 'recording'
  session.audioRaw = createWriteStream(path, { flush: true })
  session.audioRaw.write(Buffer.alloc(32000))
  session.audio = { stop: async () => {} }
  session.transcriber = { flush: async () => { throw new Error('字幕引擎中断') } }
  const result = await session.stop()
  assert.equal(result.ok, false)
  assert.equal(readFileSync(path).length, 32000)
  assert.equal(getMeeting(m.id)?.audioBytes, 32000)
  assert.equal(getMeeting(m.id)?.processing?.state, 'failed')
  assert.equal(session.getStatus().state, 'idle')
  assert.equal(session.meeting, null)
})


test('paused or failed recordings are never labelled as currently processing', async () => {
  const { meetingStatus } = await import('../src/renderer/src/util')
  const m = meeting()
  assert.equal(meetingStatus(m), '仅转写')
  m.processing = { stage: 'saved', state: 'paused', updatedAt: 0 }
  assert.equal(meetingStatus(m), '待继续')
  m.processing.state = 'failed'; assert.equal(meetingStatus(m), '待重试')
  m.processing.state = 'running'; assert.equal(meetingStatus(m), '处理中')
})
