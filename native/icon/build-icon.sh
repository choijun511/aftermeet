#!/usr/bin/env bash
# 生成 1024 PNG → 组装 .iconset(各尺寸,含 @2x)→ iconutil 打成 build/icon.icns
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP="$(mktemp -d)"
PNG="$TMP/icon_1024.png"
ICONSET="$TMP/AfterMeet.iconset"
mkdir -p "$ICONSET" build

echo "[icon] 渲染 1024 PNG"
swift native/icon/generate-icon.swift "$PNG"

echo "[icon] 生成各尺寸"
gen() { sips -z "$1" "$1" "$PNG" --out "$ICONSET/$2" >/dev/null; }
gen 16   icon_16x16.png
gen 32   icon_16x16@2x.png
gen 32   icon_32x32.png
gen 64   icon_32x32@2x.png
gen 128  icon_128x128.png
gen 256  icon_128x128@2x.png
gen 256  icon_256x256.png
gen 512  icon_256x256@2x.png
gen 512  icon_512x512.png
cp "$PNG" "$ICONSET/icon_512x512@2x.png"

echo "[icon] iconutil 打包"
iconutil -c icns "$ICONSET" -o build/icon.icns
# 也存一份 PNG 供 dev 窗口/dock 用
cp "$PNG" build/icon.png
echo "[icon] 完成 -> build/icon.icns"
ls -la build/icon.icns build/icon.png
rm -rf "$TMP"
