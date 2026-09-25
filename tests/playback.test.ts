import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, openSync, closeSync, ftruncateSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { preparePlayback, playbackResponse, byteRange, releasePlaybackOwner, releasePlayback, playbackActive, setPlaybackActive } from '../src/main/playback'
import { transcriptsDir, upsertMeeting, deleteMeeting } from '../src/main/store'
import { playableSentences } from '../src/shared/playback'
import type { Meeting } from '../src/shared/types'
let dir: string
const owner = 500
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aftermeet-playback-')); process.env.AFTERMEET_TEST_DATA = dir })
afterEach(() => { releasePlaybackOwner(owner); rmSync(dir, { recursive: true, force: true }); delete process.env.AFTERMEET_TEST_DATA })
function meeting(path: string): Meeting {
  return { id: 'm_123', title: '测试', startedAt: 123, durationSec: 1, audioPath: path, audioFormat: 'pcm-s16le-16000-mono', transcript: '文字', todos: [] }
}
async function fixture(seconds = 1) {
  const path = join(transcriptsDir(), 'audio-m_123.pcm')
  const fd = openSync(path, 'w'); ftruncateSync(fd, seconds * 32000); closeSync(fd)
  upsertMeeting(meeting(path))
  const info = await preparePlayback('m_123', owner)
  assert(info.ok)
  return { path, info }
}
test('virtual WAV supports header, PCM and cross-header ranges with exact length', async () => {
  const { path, info } = await fixture()
  const pcm = Buffer.alloc(32000); pcm.writeInt16LE(12345, 0); pcm.writeInt16LE(-100, 2); writeFileSync(path, pcm)
  const response = await playbackResponse(new Request(info.url, { headers: { Range: 'bytes=0-47' } }))
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-47/32044')
  const data = Buffer.from(await response.arrayBuffer())
  assert.equal(data.length, 48); assert.equal(data.toString('ascii', 0, 4), 'RIFF')
  assert.equal(data.readUInt32LE(40), 32000); assert.equal(data.readInt16LE(44), 12345)
  const suffix = await playbackResponse(new Request(info.url, { headers: { Range: 'bytes=-2' } }))
  assert.equal((await suffix.arrayBuffer()).byteLength, 2)
  const head = await playbackResponse(new Request(info.url, { method: 'HEAD' }))
  assert.equal(head.headers.get('Content-Length'), '32044'); assert.equal(await head.text(), '')
})
test('invalid, multipart and out-of-bounds ranges return 416', async () => {
  const { info } = await fixture()
  for (const range of ['bytes=999999-', 'bytes=2-1', 'bytes=-0', 'bytes=0-2,4-6', 'bytes=-', 'bytes=999999999999999999-']) {
    const result = await playbackResponse(new Request(info.url, { headers: { Range: range } }))
    assert.equal(result.status, 416, range)
  }
  assert.deepEqual(byteRange('bytes=0-99999', 40), { start: 0, end: 39 })
})
test('two-hour seek reads only the requested PCM bytes with correct sample offset', async () => {
  const { path, info } = await fixture(7201)
  const offset = 7200 * 32000
  const fd = openSync(path, 'r+'); const { writeSync } = await import('fs')
  writeSync(fd, Buffer.from([0x34, 0x12]), 0, 2, offset); closeSync(fd)
  assert.equal(info.durationSec, 7201)
  const result = await playbackResponse(new Request(info.url, { headers: { Range: `bytes=${44 + offset}-${45 + offset}` } }))
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), Buffer.from([0x34, 0x12]))
  const full = await playbackResponse(new Request(info.url))
  const reader = full.body!.getReader()
  assert.equal((await reader.read()).value!.length, 44)
  assert((await reader.read()).value!.length <= 65536)
  await reader.cancel()
})
test('no arbitrary file access, invalid tokens and revoked/deleted meetings cannot stream', async () => {
  const outside = join(dir, 'private.pcm'); writeFileSync(outside, Buffer.alloc(32000))
  const link = join(transcriptsDir(), 'audio-link.pcm'); symlinkSync(outside, link)
  upsertMeeting(meeting(link)); assert.equal((await preparePlayback('m_123', owner)).ok, false)
  assert.equal((await playbackResponse(new Request('aftermeet-audio://recording/not-a-token'))).status, 404)
  const { info } = await fixture()
  releasePlayback(info.token, owner + 1) // another renderer cannot revoke it
  assert.equal((await playbackResponse(new Request(info.url, { method: 'HEAD' }))).status, 200)
  deleteMeeting('m_123')
  assert.equal((await playbackResponse(new Request(info.url))).status, 404)
  releasePlayback(info.token, owner)
  assert.equal((await playbackResponse(new Request(info.url))).status, 404)
})
test('missing files and incomplete PCM return user-readable errors', async () => {
  const path = join(transcriptsDir(), 'absent.pcm'); upsertMeeting(meeting(path))
  const missing = await preparePlayback('m_123', owner)
  assert(!missing.ok); assert.match(missing.error, /移动或删除/)
  writeFileSync(path, Buffer.alloc(3)); const odd = await preparePlayback('m_123', owner)
  assert(!odd.ok); assert.match(odd.error, /不完整/)
})
test('active playback blocks auto recording and tokens are owner scoped', async () => {
  const { info } = await fixture()
  assert.equal(setPlaybackActive(info.token, owner + 1, true), false)
  assert.equal(setPlaybackActive(info.token, owner, true), true)
  assert.equal(playbackActive(), true)
  releasePlaybackOwner(owner)
  assert.equal(setPlaybackActive(info.token, owner, true), false)
})
test('only valid local recording timestamps are clickable; source text is never fabricated', () => {
  const m = meeting('unused')
  m.speakerSegments = [
    { startMs: 2000, endMs: 3000, text: '第二句', speaker: '说话人1' },
    { startMs: 0, endMs: 1000, text: '第一句', speaker: '说话人1' },
    { startMs: -1, endMs: 1, text: '错误', speaker: '' },
    { startMs: 1, endMs: NaN, text: '错误', speaker: '' },
    { startMs: 6000, endMs: 8000, text: '越界', speaker: '' }
  ]
  assert.deepEqual(playableSentences(m, 5).map((s) => s.text), ['第一句', '第二句'])
  m.notesSource = 'feishu'; assert.equal(playableSentences(m, 5).length, 0)
  delete m.speakerSegments; assert.equal(playableSentences(m, 5).length, 0)
})
