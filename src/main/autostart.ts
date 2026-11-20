// 自动起录控制器:开启后监听麦克风占用。
//   麦克风被占用(开会) → 若当前空闲则自动开始录制
//   麦克风空闲 → 若是「自动起录」的会议,宽限若干秒后自动停止并生成纪要
// 手动开始的会议不会被自动停止。

import { playbackActive } from './playback'
import { audioProbeRunning } from './permissions'
import { MicWatcher } from './micwatch'
import type { Session } from './session'

const STOP_GRACE_MS = 12000 // 麦克风空闲后等待这么久才自动停止(避免短暂静默误停)

export class AutoStart {
  private session: Session
  private watcher: MicWatcher | null = null
  private stopTimer: NodeJS.Timeout | null = null
  private autoMeetingId: string | null = null
  private notify: (msg: string) => void

  constructor(session: Session, notify: (msg: string) => void) {
    this.session = session
    this.notify = notify
  }

  get enabled(): boolean {
    return this.watcher?.running ?? false
  }

  setEnabled(on: boolean): void {
    if (on && !this.watcher) {
      this.watcher = new MicWatcher({
        onActive: () => this.handleActive(),
        onIdle: () => this.handleIdle()
      })
      this.watcher.start()
    } else if (!on && this.watcher) {
      this.watcher.stop()
      this.watcher = null
      this.clearStopTimer()
    }
  }

  private handleActive(): void {
    if (audioProbeRunning() || playbackActive()) return
    this.clearStopTimer()
    if (!this.session.isIdle()) return
    const result = this.session.start('') // 空标题 → 按时间自动命名
    if (result.ok && result.meetingId) {
      this.autoMeetingId = result.meetingId
      this.notify('检测到会议开始,已自动开始录制')
    } else {
      this.notify(`检测到会议开始,但自动录制启动失败:${result.error || '未知错误'}`)
    }
  }

  /** 只有本控制器自动开始、且仍在录制的那一场会议才允许被自动停止。 */
  private ownsCurrentRecording(): boolean {
    const st = this.session.getStatus()
    if (!this.autoMeetingId || st.meetingId !== this.autoMeetingId) {
      this.autoMeetingId = null // 用户已手动停止,或当前是另一场(手动开始的)会议
      return false
    }
    return st.state === 'recording' || st.state === 'starting'
  }

  private handleIdle(): void {
    if (!this.ownsCurrentRecording() || this.stopTimer) return
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null
      if (this.session.getStatus().state !== 'recording' || !this.ownsCurrentRecording()) return
      this.autoMeetingId = null
      this.notify('会议结束,已自动停止并生成纪要')
      void this.session.stop()
    }, STOP_GRACE_MS)
  }

  private clearStopTimer(): void {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
  }
}
