#!/usr/bin/env bash
# 把 brew 装的 whisper-cli 做成「自包含」目录 resources/whisper/,可随 .app 分发:
#   - 拷贝 whisper-cli + 它依赖的 dylib + ggml 运行时动态加载的后端 .so
#   - 把所有 install name 改写成 @loader_path/<同目录文件>
#   - install_name_tool 会破坏原 ad-hoc 签名,Apple Silicon 上会被内核杀掉 → 逐个重新 ad-hoc 签名
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="resources/whisper"
rm -rf "$DEST"; mkdir -p "$DEST"

WCLI="$(readlink -f "$(command -v whisper-cli)")"
WLIBDIR="$(cd "$(dirname "$WCLI")/../lib" && pwd)"
GGML_LIBDIR="$(cd /opt/homebrew/opt/ggml/lib && pwd)"
GGML_LIBEXEC="$(ls -d /opt/homebrew/Cellar/ggml/*/libexec | head -1)"

echo "[bundle] whisper-cli  = $WCLI"
echo "[bundle] whisper lib  = $WLIBDIR"
echo "[bundle] ggml lib     = $GGML_LIBDIR"
echo "[bundle] ggml backend = $GGML_LIBEXEC"

# 1) 主程序 + 核心 dylib(cp 跟随符号链接,落地为真实文件)
cp "$WCLI" "$DEST/whisper-cli"
cp "$WLIBDIR/libwhisper.1.dylib" "$DEST/"
[ -f "$WLIBDIR/libparakeet.1.dylib" ] && cp "$WLIBDIR/libparakeet.1.dylib" "$DEST/" || true
cp "$GGML_LIBDIR/libggml.0.dylib" "$DEST/"
cp "$GGML_LIBDIR/libggml-base.0.dylib" "$DEST/"
# OpenMP 运行时(ggml CPU 后端依赖)
LIBOMP="/opt/homebrew/opt/libomp/lib/libomp.dylib"
[ -f "$LIBOMP" ] && cp "$LIBOMP" "$DEST/" || true

# 2) ggml 运行时 dlopen 的后端(各芯片 CPU 变体 + metal + blas)
cp "$GGML_LIBEXEC"/*.so "$DEST/"

# 3) 改写 install name:把指向 homebrew / @rpath 且我们已自带的依赖,统一改成 @loader_path
fix() {
  local f="$1"
  install_name_tool -id "@loader_path/$(basename "$f")" "$f" 2>/dev/null || true
  # 让可执行文件能从自身目录找到 dylib
  install_name_tool -add_rpath @loader_path "$f" 2>/dev/null || true
  otool -L "$f" | awk 'NR>1{print $1}' | while read -r dep; do
    local base; base="$(basename "$dep")"
    if { [[ "$dep" == /opt/homebrew/* ]] || [[ "$dep" == @rpath/* ]]; } && [[ -f "$DEST/$base" ]]; then
      install_name_tool -change "$dep" "@loader_path/$base" "$f"
    fi
  done
}

for f in "$DEST"/*.dylib "$DEST"/*.so "$DEST/whisper-cli"; do
  [ -f "$f" ] && fix "$f"
done

# 4) 重新 ad-hoc 签名(install_name_tool 改过的二进制必须重签,否则被杀)
for f in "$DEST"/*.dylib "$DEST"/*.so "$DEST/whisper-cli"; do
  [ -f "$f" ] && codesign --force --sign - "$f" >/dev/null 2>&1 || true
done

echo "[bundle] 完成 -> $DEST"
ls -la "$DEST"
