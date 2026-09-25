import type { AppSettings } from './types'
export type TranscriptionMode = 'live' | 'local' | 'qwen'
export function transcriptionMode(settings: Pick<AppSettings, 'twoPass' | 'cloudAsr'>): TranscriptionMode {
  return !settings.twoPass ? 'live' : settings.cloudAsr ? 'qwen' : 'local'
}
export function transcriptionSettings(mode: TranscriptionMode): Pick<AppSettings, 'twoPass' | 'cloudAsr'> {
  if (!['live', 'local', 'qwen'].includes(mode)) throw new Error('无效的转写方式')
  return { twoPass: mode !== 'live', cloudAsr: mode === 'qwen' }
}
export function effectiveTranscriptionMode(settings: Pick<AppSettings, 'twoPass' | 'cloudAsr'>, qwenConfigured: boolean): TranscriptionMode {
  const mode = transcriptionMode(settings)
  return mode === 'qwen' && !qwenConfigured ? 'local' : mode
}
