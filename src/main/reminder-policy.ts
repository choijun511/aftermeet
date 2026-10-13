/** Suppress repeat prompts during one activity period; snooze spans device changes. */
export class ReminderPolicy {
  private activeSince: number | null = null
  private shown = false
  private snoozeUntil = 0
  activity(active: boolean, now: number): void {
    if (!active) { this.activeSince = null; this.shown = false }
    else if (this.activeSince === null) this.activeSince = now
  }
  shouldShow(now: number, available: boolean): boolean {
    return available && this.activeSince !== null && now - this.activeSince >= 4000 && !this.shown && now >= this.snoozeUntil
  }
  markShown(): void { this.shown = true }
  snooze(now: number): void { this.snoozeUntil = now + 10 * 60 * 1000; this.shown = true }
}
