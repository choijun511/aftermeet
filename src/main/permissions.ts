import { execFile } from 'child_process'
import { audioHelperPath } from './paths'
import type { AudioPermissionProbe } from '../shared/types'

let running: Promise<AudioPermissionProbe> | null = null
export const audioProbeRunning = (): boolean => running !== null

export function testSystemAudio(): Promise<AudioPermissionProbe> {
  if (running) return running
  running = new Promise<AudioPermissionProbe>((resolve) => {
    execFile(audioHelperPath(), ['--check-system-audio'], { timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 16384 }, (error, stdout) => {
      if (!error && stdout.trim() === 'AFTERMEET_PROBE_OK') {
        resolve({ ok: true, message: '系统音频采集可启动。此测试不验证音量或转写效果；可播放声音后录一小段确认。' })
      } else if (/SCStreamErrorDomain -3801/.test(stdout)) {
        resolve({ ok: false, message: '实际采集仍被 macOS 拒绝。若开关已开启，请按下方步骤移除旧授权、重新添加应用并重启。' })
      } else {
        resolve({ ok: false, message: error?.killed ? '测试超时；若出现系统授权弹窗，请处理后重试。' : '采集测试未通过，请重试。诊断：' + (stdout.trim().slice(0, 200) || error?.code || '未返回结果') })
      }
    })
  }).finally(() => { running = null })
  return running
}
