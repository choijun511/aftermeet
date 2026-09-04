#!/usr/bin/env bash
# 编译 ScreenCaptureKit 系统音频采集 helper。
# 产物放到 resources/bin/SystemAudioCapture,运行时由 Electron 主进程 spawn。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p resources/bin
echo "[build:helper] 编译 SystemAudioCapture.swift …"
swiftc -O \
  -framework ScreenCaptureKit \
  -framework AVFoundation \
  -framework CoreMedia \
  native/SystemAudioCapture.swift \
  -o resources/bin/SystemAudioCapture
echo "[build:helper] 完成 -> resources/bin/SystemAudioCapture"

echo "[build:helper] 编译 MicWatcher.swift …"
swiftc -O \
  -framework CoreAudio \
  native/MicWatcher.swift \
  -o resources/bin/MicWatcher
echo "[build:helper] 完成 -> resources/bin/MicWatcher"
