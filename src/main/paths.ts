// 统一解析运行时资源路径(dev 与 打包后 不同)。

import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

function resourcesRoot(): string {
  // 打包后 extraResources 解到 process.resourcesPath;dev 时用项目根的 resources/
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}

export function audioHelperPath(): string {
  return join(resourcesRoot(), 'bin', 'SystemAudioCapture')
}

export function micWatcherPath(): string {
  return join(resourcesRoot(), 'bin', 'MicWatcher')
}

// 流式运行时(venv + 模型 + 脚本)放在 userData/streaming 下,不进 .app bundle。
// 原因:venv 含系统 python 符号链接 + 第三方 .so,放进签名的 .app 会导致 codesign 深度校验失败。
// dev 时回退到项目 resources/。
function streamingRoot(): string {
  const ud = join(app.getPath('userData'), 'streaming')
  if (existsSync(ud)) return ud
  return resourcesRoot()
}

export function streamPythonPath(): string {
  if (process.env.AFTERMEET_PYTHON && existsSync(process.env.AFTERMEET_PYTHON)) {
    return process.env.AFTERMEET_PYTHON
  }
  return join(streamingRoot(), 'pyenv', 'bin', 'python')
}

export function streamScriptPath(): string {
  return join(streamingRoot(), 'stream_recognizer.py')
}

/** 流式 ASR 模型目录(sherpa-onnx 双语 zipformer);缺失返回 null → 降级 whisper 实时 */
export function streamModelDir(): string | null {
  const dir = join(
    streamingRoot(),
    'models',
    'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20'
  )
  return existsSync(dir) && existsSync(streamScriptPath()) && existsSync(streamPythonPath())
    ? dir
    : null
}

export function whisperModelPath(): string {
  if (process.env.WHISPER_MODEL && existsSync(process.env.WHISPER_MODEL)) {
    return process.env.WHISPER_MODEL
  }
  const dir = join(resourcesRoot(), 'models')
  // 优先 large-v3-turbo(准确率高、单块 ~2s 仍能实时);缺失则回退 small
  const turbo = join(dir, 'ggml-large-v3-turbo.bin')
  if (existsSync(turbo)) return turbo
  return join(dir, 'ggml-small.bin')
}

/** VAD 模型(silero):有则启用,只转人声段,根治大模型在静音上的幻觉。 */
export function whisperVadModelPath(): string | null {
  const p = join(resourcesRoot(), 'models', 'ggml-silero-v5.1.2.bin')
  return existsSync(p) ? p : null
}

function bundledCli(): string {
  return join(resourcesRoot(), 'whisper', 'whisper-cli')
}

const BREW_CLIS = [
  '/opt/homebrew/bin/whisper-cli',
  '/usr/local/bin/whisper-cli',
  '/opt/homebrew/bin/whisper-cpp',
  '/usr/local/bin/whisper-cpp'
]

/**
 * whisper-cli 解析:env > 系统 brew 版 > 自包含 bundle > PATH。
 * 注意:优先系统 brew 版,因为**包内 bundle 的 whisper.cpp 用 --vad 会段错误崩溃**
 * (打包重写 dylib 路径破坏了 VAD 的 ggml 组件)。brew 版 VAD 稳定。
 */
export function whisperCliPath(): string {
  if (process.env.WHISPER_CLI && existsSync(process.env.WHISPER_CLI)) {
    return process.env.WHISPER_CLI
  }
  for (const c of BREW_CLIS) if (existsSync(c)) return c
  const bundled = bundledCli()
  if (existsSync(bundled)) return bundled
  return 'whisper-cli' // 退而求其次:依赖 PATH
}

/** VAD 是否可用:仅当使用的不是「包内 bundle」时才启用(bundle 的 VAD 崩溃),且 VAD 模型存在。 */
export function whisperVadUsable(): boolean {
  return whisperCliPath() !== bundledCli() && whisperVadModelPath() !== null
}

/** spawn 的 cwd:仅在用「包内 bundle」时设为 bundle 目录(让 ggml 后端按可执行文件目录定位);
 * 用 brew 版时不设,让它用自己的 ggml。 */
export function whisperCwd(): string | undefined {
  if (whisperCliPath() !== bundledCli()) return undefined
  const dir = join(resourcesRoot(), 'whisper')
  return existsSync(dir) ? dir : undefined
}
