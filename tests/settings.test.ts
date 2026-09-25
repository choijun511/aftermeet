import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { transcriptionMode, transcriptionSettings, effectiveTranscriptionMode } from '../src/shared/transcription-mode'
import { setSetting, setSettings, getSetting } from '../src/main/store'

test('legacy two-switch combinations map to the actual recording behavior', () => {
  for (const cloudAsr of [false, true]) {
    assert.equal(transcriptionMode({ twoPass: false, cloudAsr }), 'live')
    assert.equal(effectiveTranscriptionMode({ twoPass: false, cloudAsr }, true), 'live')
  }
  assert.equal(transcriptionMode({ twoPass: true, cloudAsr: false }), 'local')
  assert.equal(transcriptionMode({ twoPass: true, cloudAsr: true }), 'qwen')
})
test('cloud configuration missing falls back to local without changing user preference', () => {
  const settings = transcriptionSettings('qwen')
  assert.equal(effectiveTranscriptionMode(settings, false), 'local')
  assert.equal(effectiveTranscriptionMode(settings, true), 'qwen')
  assert.equal(transcriptionMode(settings), 'qwen')
})
test('mode changes save both flags in one snapshot and retain unrelated settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aftermeet-settings-'))
  process.env.AFTERMEET_TEST_DATA = dir
  try {
    setSetting('autoStart', false); setSetting('autoMinutes', false)
    for (const mode of ['qwen', 'live', 'local'] as const) {
      const before = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
      setSettings(transcriptionSettings(mode))
      assert.deepEqual(JSON.parse(readFileSync(join(dir, 'settings.json.bak'), 'utf8')), before)
      assert.equal(transcriptionMode({ twoPass: getSetting('twoPass', true), cloudAsr: getSetting('cloudAsr', true) }), mode)
      assert.equal(getSetting('autoStart', true), false)
      assert.equal(getSetting('autoMinutes', true), false)
    }
  } finally { delete process.env.AFTERMEET_TEST_DATA; rmSync(dir, { recursive: true, force: true }) }
})
test('unsupported modes fail before settings are changed', () => {
  assert.throws(() => transcriptionSettings('unknown' as never), /无效/)
})
