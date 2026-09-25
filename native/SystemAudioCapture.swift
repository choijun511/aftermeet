// SystemAudioCapture.swift
//
// 同时采集「系统输出音频」(会议对方/播放的声音,用 ScreenCaptureKit)和「麦克风」
// (你自己的声音,用 AVAudioEngine),混流成 16kHz / 单声道 / 16-bit s16le PCM 写到 stdout。
// Electron 主进程读取 stdout 切片喂 whisper。
//
// 为什么两路分别用不同 API:本机 CommandLineTools SDK 为 macOS 13.3,没有 SCStreamConfiguration
// 的 captureMicrophone(macOS 15+),所以麦克风走 AVAudioEngine(老 API,任意 SDK 可用)。
//
// 混流:两路各自重采样到 16k 单声道,按「到达时的单调时钟」放到同一条时间线上相加,
// 定时把足够旧(margin 之前)的部分刷出。对转写而言 100-300ms 级别的对齐误差无影响。
//
// 权限:系统音频需「屏幕录制」权限;麦克风需「麦克风」权限。任一被拒会降级为只采另一路。

import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

let TARGET_RATE: Double = 16000
let FLUSH_MARGIN_SEC: Double = 0.4
// 麦克风门限/增益:静音(底噪)不混入,有声时放大。系统音干净不动。
let MIC_GATE_RMS: Float = 0.015
let MIC_GAIN: Float = 3.0
let SYS_GAIN: Float = 1.5 // 降低以减少削波失真(过响会让 whisper 精转重复/出错)
// 默认只用系统音(对方/会议声,干净)。耳机模式下可混入麦克风(你自己),无回声。
let MIX_MIC = ProcessInfo.processInfo.environment["AFTERMEET_MIX_MIC"] == "1"

func logErr(_ s: String) {
  FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

func now() -> Double { ProcessInfo.processInfo.systemUptime }

// 每路独立的线性重采样器 → 16k 单声道 float(保留跨 buffer 连续性)
final class Resampler {
  private let outRate = TARGET_RATE
  private var pos: Double = 0
  private var carry: Float = 0
  private var hasCarry = false

  func process(_ mono: [Float], inRate: Double) -> [Float] {
    guard !mono.isEmpty, inRate > 0 else { return [] }
    let ratio = inRate / outRate
    var out = [Float]()
    out.reserveCapacity(Int(Double(mono.count) / ratio) + 2)
    let last = mono.count - 1
    func at(_ i: Int) -> Float {
      if i < 0 { return hasCarry ? carry : mono[0] }
      return mono[i > last ? last : i]
    }
    var p = pos
    while p <= Double(last) {
      let i = Int(floor(p))
      let frac = Float(p - Double(i))
      let a = at(i)
      let b = at(i + 1)
      out.append(a + (b - a) * frac)
      p += ratio
    }
    pos = p - Double(mono.count)
    carry = mono[last]
    hasCarry = true
    return out
  }
}

// 按「样本计数」对齐的两路混音器(替代原墙钟混音器)。
//
// 关键修复:两路(系统音 SCStream、麦克风 AVAudioEngine)各自是连续的 16k 单声道流,
// 到达节奏不同(系统音大块、麦克风小块)。原实现按 buffer 到达的墙上时钟摆放样本,
// 时钟抖动会把样本挤进过窄/过宽的时间窗 → 变调/忽快忽慢/噪声。
//
// 正确做法:各路样本按到达顺序原样追加到自己的队列;每次 flush 取两队列已对齐的
// 前 min(sys, mic) 个样本相加输出。每个样本被原样输出且仅一次 → 时长/音高绝不改变。
// 两路的对齐误差 = 各自首帧到达时刻之差(一个小常量,约几十~几百 ms),对转写无影响。
final class Mixer {
  private var sysBuf: [Float] = []
  private var micBuf: [Float] = []
  private var sysActive = false
  private var micActive = false
  private let lock = NSLock()
  private let out = FileHandle.standardOutput

  func addSys(_ s: [Float]) {
    guard !s.isEmpty else { return }
    lock.lock(); sysActive = true; sysBuf.append(contentsOf: s); lock.unlock()
  }
  // 麦克风:恒定追加相同样本数以保持与系统音同步;低于门限的静音段补零(降底噪、不丢同步)
  func addMic(_ s: [Float], gated: Bool) {
    guard !s.isEmpty else { return }
    lock.lock(); micActive = true
    if gated { micBuf.append(contentsOf: repeatElement(0, count: s.count)) }
    else { micBuf.append(contentsOf: s) }
    lock.unlock()
  }

  private func emit(_ vals: ArraySlice<Float>) {
    var pcm = [Int16](); pcm.reserveCapacity(vals.count)
    for v in vals { pcm.append(Int16(max(-1.0, min(1.0, v)) * 32767)) }
    out.write(pcm.withUnsafeBufferPointer { Data(buffer: $0) })
  }

  func flush() {
    lock.lock(); defer { lock.unlock() }
    if sysActive && micActive {
      var n = min(sysBuf.count, micBuf.count)
      if n == 0 {
        // 一路暂时停滞:若另一路积压 > 0.5s,按静音补齐,避免输出卡住
        let backlog = max(sysBuf.count, micBuf.count)
        if backlog > 8000 {
          if sysBuf.count < micBuf.count {
            sysBuf.append(contentsOf: repeatElement(0, count: micBuf.count - sysBuf.count))
          } else {
            micBuf.append(contentsOf: repeatElement(0, count: sysBuf.count - micBuf.count))
          }
          n = min(sysBuf.count, micBuf.count)
        } else { return }
      }
      var mixed = [Float](); mixed.reserveCapacity(n)
      for i in 0..<n { mixed.append(sysBuf[i] + micBuf[i]) }
      emit(mixed[...])
      sysBuf.removeFirst(n); micBuf.removeFirst(n)
    } else if sysActive {
      let n = sysBuf.count
      if n > 0 { emit(sysBuf[...]); sysBuf.removeAll(keepingCapacity: true) }
    } else if micActive {
      let n = micBuf.count
      if n > 0 { emit(micBuf[...]); micBuf.removeAll(keepingCapacity: true) }
    }
  }
}

// 从系统音频 CMSampleBuffer 提取单声道 float + 采样率
func extractMono(_ sampleBuffer: CMSampleBuffer) -> (mono: [Float], rate: Double)? {
  guard let fmt = CMSampleBufferGetFormatDescription(sampleBuffer),
        let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(fmt) else { return nil }
  let asbd = asbdPtr.pointee
  let inRate = asbd.mSampleRate
  let channels = Int(asbd.mChannelsPerFrame)
  let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
  let isInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0
  guard isFloat else { return nil }

  var needed = 0
  let sizing = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
    sampleBuffer, bufferListSizeNeededOut: &needed, bufferListOut: nil,
    bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
    flags: 0, blockBufferOut: nil)
  guard sizing == noErr, needed > 0 else { return nil }
  let storage = UnsafeMutableRawPointer.allocate(
    byteCount: needed, alignment: MemoryLayout<AudioBufferList>.alignment)
  defer { storage.deallocate() }
  let abl = storage.bindMemory(to: AudioBufferList.self, capacity: 1)
  var blockBuffer: CMBlockBuffer?
  let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
    sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: abl,
    bufferListSize: needed, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
    flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
    blockBufferOut: &blockBuffer)
  guard status == noErr else { return nil }
  let buffers = UnsafeMutableAudioBufferListPointer(abl)

  var mono = [Float]()
  if isInterleaved {
    guard let b = buffers.first, let data = b.mData else { return nil }
    let count = Int(b.mDataByteSize) / MemoryLayout<Float>.size
    let ptr = data.bindMemory(to: Float.self, capacity: count)
    let frames = channels > 0 ? count / channels : count
    mono.reserveCapacity(frames)
    for f in 0..<frames {
      var sum: Float = 0
      for c in 0..<channels { sum += ptr[f * channels + c] }
      mono.append(channels > 0 ? sum / Float(channels) : sum)
    }
  } else {
    let chBuffers = Array(buffers).filter { $0.mData != nil }
    guard let first = chBuffers.first else { return nil }
    let frames = Int(first.mDataByteSize) / MemoryLayout<Float>.size
    let ptrs = chBuffers.map { $0.mData!.bindMemory(to: Float.self, capacity: frames) }
    mono.reserveCapacity(frames)
    for f in 0..<frames {
      var sum: Float = 0
      for p in ptrs { sum += p[f] }
      mono.append(sum / Float(ptrs.count))
    }
  }
  return (mono, inRate)
}

final class Capturer: NSObject, SCStreamOutput, SCStreamDelegate {
  let mixer = Mixer()
  let sysResampler = Resampler()
  let micResampler = Resampler()
  var stream: SCStream?
  let audioEngine = AVAudioEngine()
  var loggedSys = false
  private let sourceLock = NSLock()
  private var systemAvailable = false
  private func setSystemAvailable(_ value: Bool) {
    sourceLock.lock(); systemAvailable = value; sourceLock.unlock()
  }
  private func shouldMixMic() -> Bool {
    sourceLock.lock(); defer { sourceLock.unlock() }
    return MIX_MIC || !systemAvailable
  }
  private var levels: [String: Float] = [:]
  private var seen: [String: Double] = [:]
  private var healthTime = 0.0
  private func meter(_ source: String, _ samples: [Float]) {
    guard !samples.isEmpty else { return }
    let rms = (samples.reduce(Float(0)) { $0 + $1 * $1 } / Float(samples.count)).squareRoot()
    sourceLock.lock()
    levels[source] = max(levels[source] ?? 0, rms)
    seen[source] = now()
    sourceLock.unlock()
  }
  private func reportHealth() {
    sourceLock.lock()
    let time = now()
    guard time - healthTime >= 0.5 else { sourceLock.unlock(); return }
    healthTime = time
    var info: [String: Any] = ["type": "audio-health", "micIncluded": MIX_MIC || !systemAvailable]
    for source in ["system", "microphone"] {
      info[source] = ["rms": levels[source] ?? 0, "receiving": time - (seen[source] ?? 0) < 3]
    }
    levels.removeAll()
    sourceLock.unlock()
    if let data = try? JSONSerialization.data(withJSONObject: info), let line = String(data: data, encoding: .utf8) { logErr(line) }
  }
  var flushTimer: DispatchSourceTimer?
  let sampleQueue = DispatchQueue(label: "audio.sample")
  // 诊断:分别把 mic-only / system-only 原始重采样流写文件
  var micDebug: FileHandle?
  var sysDebug: FileHandle?

  func start() async {
    if ProcessInfo.processInfo.environment["AFTERMEET_DEBUG_SPLIT"] != nil {
      FileManager.default.createFile(atPath: "/tmp/aftermeet_mic.pcm", contents: nil)
      FileManager.default.createFile(atPath: "/tmp/aftermeet_sys.pcm", contents: nil)
      micDebug = FileHandle(forWritingAtPath: "/tmp/aftermeet_mic.pcm")
      sysDebug = FileHandle(forWritingAtPath: "/tmp/aftermeet_sys.pcm")
      logErr("[helper] 诊断分轨已开启 -> /tmp/aftermeet_{mic,sys}.pcm")
    }
    startFlushTimer()
    startSystemAudio()
    startMicrophone()
  }

  func writeDebug(_ fh: FileHandle?, _ samples: [Float]) {
    guard let fh = fh, !samples.isEmpty else { return }
    var pcm = [Int16](); pcm.reserveCapacity(samples.count)
    for v in samples { pcm.append(Int16(max(-1.0, min(1.0, v)) * 32767)) }
    fh.write(pcm.withUnsafeBufferPointer { Data(buffer: $0) })
  }

  private func startFlushTimer() {
    let t = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "mix.flush"))
    t.schedule(deadline: .now() + 0.1, repeating: 0.1)
    t.setEventHandler { [weak self] in self?.mixer.flush(); self?.reportHealth() }
    t.resume()
    flushTimer = t
  }

  // ---- 系统输出音频:ScreenCaptureKit ----
  private func startSystemAudio() {
    Task {
      if !CGPreflightScreenCaptureAccess() {
        logErr("[helper] 无屏幕录制权限,正在请求…(系统设置>隐私与安全性>屏幕录制 勾选 AfterMeet 后重启)")
        CGRequestScreenCaptureAccess()
      }
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
          logErr("[helper] 找不到显示器,系统音频不可用"); return
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = Int(TARGET_RATE)
        config.channelCount = 1
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.queueDepth = 6
        let s = SCStream(filter: filter, configuration: config, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)
        try await s.startCapture()
        self.stream = s
        self.setSystemAvailable(true)
        logErr("[helper] 系统音频采集已启动")
      } catch {
        logErr("[helper] 系统音频启动失败(将仅用麦克风): \(error)")
      }
    }
  }

  // ---- 麦克风:AVAudioEngine ----
  private func startMicrophone() {
    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    let inRate = format.sampleRate
    let channels = Int(format.channelCount)
    guard inRate > 0, channels > 0 else {
      logErr("[helper] 麦克风格式异常,跳过麦克风采集"); return
    }
    input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buf, _ in
      guard let self = self, let ch = buf.floatChannelData else { return }
      let frames = Int(buf.frameLength)
      if frames == 0 { return }
      var mono = [Float](); mono.reserveCapacity(frames)
      if buf.stride == 1 && channels == 1 {
        let p = ch[0]
        for f in 0..<frames { mono.append(p[f]) }
      } else {
        for f in 0..<frames {
          var sum: Float = 0
          for c in 0..<channels { sum += ch[c][f * buf.stride] }
          mono.append(sum / Float(channels))
        }
      }
      self.meter("microphone", mono)
      let rs = self.micResampler.process(mono, inRate: inRate)
      self.writeDebug(self.micDebug, rs)
      // 仅「耳机/线下模式」(env AFTERMEET_MIX_MIC=1)混入麦克风。
      guard self.shouldMixMic() else { return }
      var sum: Float = 0
      for v in rs { sum += v * v }
      let micRms = rs.isEmpty ? 0 : (sum / Float(rs.count)).squareRoot()
      // 低于门限视为静音 → 补零(保持与系统音的样本对齐);有声则放大后混入
      if micRms > MIC_GATE_RMS {
        let boosted = rs.map { max(-1.0, min(1.0, $0 * MIC_GAIN)) }
        self.mixer.addMic(boosted, gated: false)
      } else {
        self.mixer.addMic(rs, gated: true)
      }
    }
    do {
      try audioEngine.start()
      logErr("[helper] 麦克风采集已启动 (\(Int(inRate))Hz, \(channels)ch)")
    } catch {
      logErr("[helper] 麦克风启动失败(将仅用系统音频): \(error)")
    }
  }

  func stop() {
    flushTimer?.cancel()
    audioEngine.stop()
    mixer.flush()
    if let s = stream {
      Task { try? await s.stopCapture(); logErr("[helper] 采集已停止"); exit(0) }
    } else {
      logErr("[helper] 采集已停止"); exit(0)
    }
  }

  // SCStreamDelegate
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    setSystemAvailable(false)
    logErr("[helper] 系统音频流意外停止: \(error)")
  }

  // SCStreamOutput(系统音频)
  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio, CMSampleBufferDataIsReady(sampleBuffer) else { return }
    guard let (mono, inRate) = extractMono(sampleBuffer) else { return }
    if !loggedSys {
      loggedSys = true
      logErr("[helper] 系统音频格式: \(inRate)Hz")
    }
    meter("system", mono)
    let rs = sysResampler.process(mono, inRate: inRate)
    writeDebug(sysDebug, rs)
    // 系统音干净但偏小,轻度放大(帮助流式 ASR),线性+限幅
    let boosted = rs.map { max(-1.0, min(1.0, $0 * SYS_GAIN)) }
    // 统一走「样本对齐」混音器:只有系统音时它原样输出系统音(等价直通),
    // 开麦克风混入时按样本序号正确相加。绝不改变时长/音高。
    mixer.addSys(boosted)
  }
}

// Diagnostic uses the same executable and ScreenCaptureKit path as recording,
// but never starts the microphone, writes audio, or invokes transcription.
final class PermissionProbe: NSObject, SCStreamOutput {
  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {}
}
if CommandLine.arguments.contains("--check-system-audio") {
  Task {
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
      guard let display = content.displays.first else {
        throw NSError(domain: "AfterMeet", code: 1, userInfo: [NSLocalizedDescriptionKey: "没有可用于采集的显示器"])
      }
      let config = SCStreamConfiguration()
      config.capturesAudio = true
      config.excludesCurrentProcessAudio = true
      config.sampleRate = 16000
      config.channelCount = 1
      config.width = 2
      config.height = 2
      let sink = PermissionProbe()
      let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: config, delegate: nil)
      try stream.addStreamOutput(sink, type: .audio, sampleHandlerQueue: DispatchQueue(label: "permission-probe"))
      try await stream.startCapture()
      try await stream.stopCapture()
      print("AFTERMEET_PROBE_OK")
      exit(0)
    } catch {
      let error = error as NSError
      print("AFTERMEET_PROBE_ERROR \(error.domain) \(error.code)")
      exit(1)
    }
  }
  RunLoop.main.run()
  exit(1)
}

let capturer = Capturer()

let sigQueue = DispatchQueue(label: "signal")
var sources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
  signal(sig, SIG_IGN)
  let src = DispatchSource.makeSignalSource(signal: sig, queue: sigQueue)
  src.setEventHandler { capturer.stop() }
  src.resume()
  sources.append(src)
}

// 父进程死亡看门狗:主 app 退出/崩溃后本进程会被 launchd 收养(getppid==1),此时自动退出,
// 避免遗留僵尸进程抢占 ScreenCaptureKit(多个 SCStream 冲突会报 -3805)。
let ppidWatch = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "ppid"))
ppidWatch.schedule(deadline: .now() + 2, repeating: 2)
ppidWatch.setEventHandler {
  if getppid() == 1 {
    logErr("[helper] 父进程已退出,自动结束")
    exit(0)
  }
}
ppidWatch.resume()

Task { await capturer.start() }
RunLoop.main.run()
