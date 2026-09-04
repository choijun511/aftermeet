// MicWatcher.swift
//
// 监测「默认输入设备是否正在被占用」(kAudioDevicePropertyDeviceIsRunningSomewhere)。
// 某个 App 真正在用麦克风(开会通话)时为 true;仅打开 App 不通话则为 false。
// 状态变化时往 stdout 打印一行:active / idle。Electron 主进程据此自动起录/停录。
//
// 只读 CoreAudio 属性,不采集音频,不需要任何 TCC 权限,不弹窗。
// 编译: swiftc -O MicWatcher.swift -o MicWatcher

import Foundation
import CoreAudio

setvbuf(stdout, nil, _IONBF, 0) // 关闭缓冲,保证每行即时送达

func defaultInputDevice() -> AudioDeviceID {
  var id = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultInputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
  return id
}

func isRunningSomewhere(_ dev: AudioDeviceID) -> Bool {
  guard dev != 0 else { return false }
  var val = UInt32(0)
  var size = UInt32(MemoryLayout<UInt32>.size)
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  let st = AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &val)
  return st == noErr && val != 0
}

var last: Bool? = nil
print("watching") // 启动握手
while true {
  if getppid() == 1 { exit(0) } // 父进程已退出,避免僵尸
  let dev = defaultInputDevice()
  let active = isRunningSomewhere(dev)
  if active != last {
    last = active
    print(active ? "active" : "idle")
  }
  Thread.sleep(forTimeInterval: 1.0)
}
