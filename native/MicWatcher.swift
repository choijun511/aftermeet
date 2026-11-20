// MicWatcher.swift
//
// 监测「默认输入设备是否正在被占用」(kAudioDevicePropertyDeviceIsRunningSomewhere)。
// 某个 App 真正在用麦克风(开会通话)时为 true;仅打开 App 不通话则为 false。
// 状态变化时往 stdout 打印一行:active / idle。Electron 主进程据此自动起录/停录。
//
// AfterMeet 自己录音时也会占用输入设备,单看设备状态会让「会议结束」永远检测不到。
// macOS 14+ 逐个检查正在采集输入的进程,排除 AfterMeet 自己(父进程及其子进程);
// 更早的系统无法区分,退回只看设备状态。
//
// 只读 CoreAudio 属性,不采集音频,不需要任何 TCC 权限,不弹窗。
// 编译: swiftc -O MicWatcher.swift -o MicWatcher

import Foundation
import CoreAudio

setvbuf(stdout, nil, _IONBF, 0) // 关闭缓冲,保证每行即时送达

func defaultDevice(_ output: Bool = false) -> AudioDeviceID {
  var id = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var addr = AudioObjectPropertyAddress(
    mSelector: output ? kAudioHardwarePropertyDefaultOutputDevice : kAudioHardwarePropertyDefaultInputDevice,
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

let ownerPid = getppid() // AfterMeet 主进程;采集 helper 等都是它的子进程

func parentPid(_ pid: pid_t) -> pid_t {
  var info = kinfo_proc()
  var size = MemoryLayout<kinfo_proc>.stride
  var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
  guard sysctl(&mib, 4, &info, &size, nil, 0) == 0, size > 0 else { return 0 }
  return info.kp_eproc.e_ppid
}

func isOwnProcess(_ pid: pid_t) -> Bool {
  pid == getpid() || pid == ownerPid || parentPid(pid) == ownerPid
}

func readUInt32(_ obj: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
  var val = UInt32(0)
  var size = UInt32(MemoryLayout<UInt32>.size)
  var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  return AudioObjectGetPropertyData(obj, &addr, 0, nil, &size, &val) == noErr ? val : nil
}

/// 是否有 AfterMeet 以外的进程正在采集输入。nil 表示系统不支持或读取失败。
func otherProcessCapturingInput() -> Bool? {
  guard #available(macOS 14.0, *) else { return nil }
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyProcessObjectList,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  let system = AudioObjectID(kAudioObjectSystemObject)
  var size = UInt32(0)
  guard AudioObjectGetPropertyDataSize(system, &addr, 0, nil, &size) == noErr else { return nil }
  var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(system, &addr, 0, nil, &size, &objects) == noErr else { return nil }
  for obj in objects {
    guard readUInt32(obj, kAudioProcessPropertyIsRunningInput) == 1 else { continue }
    var pid = pid_t(0)
    var pidSize = UInt32(MemoryLayout<pid_t>.size)
    var pidAddr = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyPID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    guard AudioObjectGetPropertyData(obj, &pidAddr, 0, nil, &pidSize, &pid) == noErr else { continue }
    if !isOwnProcess(pid) { return true }
  }
  return false
}

func microphoneInUseByOthers() -> Bool {
  guard isRunningSomewhere(defaultDevice()) else { return false }
  return otherProcessCapturingInput() ?? true
}

if CommandLine.arguments.contains("--probe") {
  let others = otherProcessCapturingInput()
  print("device=\(isRunningSomewhere(defaultDevice())) others=\(others.map { String($0) } ?? "unsupported") active=\(microphoneInUseByOthers())")
  exit(0)
}

var last: Bool? = nil
print("watching") // 启动握手
while true {
  if getppid() == 1 { exit(0) } // 父进程已退出,避免僵尸
  let active = microphoneInUseByOthers() || (CommandLine.arguments.contains("--audio-activity") && isRunningSomewhere(defaultDevice(true)))
  if active != last {
    last = active
    print(active ? "active" : "idle")
  }
  Thread.sleep(forTimeInterval: 1.0)
}
