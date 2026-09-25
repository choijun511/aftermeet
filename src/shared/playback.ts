import type { Meeting } from './types'

export type TimedSentence = NonNullable<Meeting['speakerSegments']>[number]
/** Never invent timing or align Feishu text with this computer's recording. */
export function playableSentences(meeting: Meeting, durationSec: number): TimedSentence[] {
  if (meeting.notesSource === 'feishu') return []
  return (meeting.speakerSegments || []).filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) &&
    s.startMs >= 0 && s.endMs > s.startMs && s.endMs <= durationSec * 1000 + 1000 &&
    s.startMs < durationSec * 1000 && typeof s.text === 'string' && !!s.text.trim())
    .sort((a, b) => a.startMs - b.startMs)
}
