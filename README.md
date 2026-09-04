# 会后秘书 AfterMeet

> 本地实时转写 + AI 会议纪要的 macOS 桌面应用。**音频全程在本地处理,不出网** —— 只有「转写后的文字」会发给大模型生成纪要。

AfterMeet 采集系统音频(会议对方的声音)与麦克风(你自己的声音),在本地实时转写成字幕;会议结束后用 whisper 对整段录音精转,再交给 Gemini 生成结构化纪要、会后总结与待办。可选接入飞书日历(展示日程、一键关联录制)、飞书妙记(用商用级逐字稿生成纪要)、周期会议的会前简报。

---

## ✨ 特性

- **实时字幕**:边开会边出字(sherpa-onnx 流式,可选)
- **高精度转写**:停止后用 whisper large-v3-turbo 带上下文重转全程
- **AI 纪要**:主题 / 要点 / 决议 / 风险 / 会后总结 / 待办(Gemini)
- **问 AI**:就本场会议提问,答案只基于本场转写
- **隐私优先**:音频只在本地,只发送文字给模型;可完全离线录音+转写(不生成纪要)
- **飞书集成(可选)**:今日日程、录制关联会议、拉取飞书妙记逐字稿、周期会议会前简报
- **崩溃恢复**:录制中意外退出,下次启动自动找回

## 🖥 系统要求

- **macOS 13.3+,Apple Silicon(M 系列)** —— 依赖 ScreenCaptureKit 采集系统音频
- [Homebrew](https://brew.sh/)
- Xcode Command Line Tools(`xcode-select --install`)—— 编译 Swift 采集 helper
- Node.js 18+
- 一个 Gemini API Key(免费额度即可):<https://aistudio.google.com/apikey>

---

## 🚀 从源码构建

### 1) 克隆与安装依赖

```bash
git clone https://github.com/choijun511/aftermeet.git
cd aftermeet
npm install          # postinstall 会自动编译 Swift 采集 helper
```

### 2) 安装 whisper.cpp(转写引擎)

```bash
brew install whisper-cpp
```

### 3) 下载模型到 `resources/models/`

必需 —— whisper 精转模型(约 1.6GB):

```bash
mkdir -p resources/models
# whisper large-v3-turbo
curl -L -o resources/models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
# 静音检测(VAD,减少幻觉)
curl -L -o resources/models/ggml-silero-v5.1.2.bin \
  https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin
```

可选 —— 实时字幕引擎(sherpa-onnx 流式,不装则实时字幕降级用 whisper):

```bash
# 双语流式模型
curl -L -o /tmp/sherpa.tar.bz2 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2
tar xjf /tmp/sherpa.tar.bz2 -C resources/models/
# Python 运行时(供流式脚本调用)
python3 -m venv resources/pyenv
resources/pyenv/bin/pip install sherpa-onnx soundfile numpy
```

### 4) 配置密钥

```bash
cp .env.example .env
# 编辑 .env,填入你的 GEMINI_API_KEY
```

### 5) 运行 / 打包

```bash
npm run dev          # 开发模式(热更新)

# 或打包成 .app / .dmg:
bash native/make-signing-cert.sh   # 首次:创建稳定的自签名证书(见下方「为什么要自签名」)
npm run dist:mac                   # 产物在 dist/
```

打包后把 `dist/mac-arm64/AfterMeet.app` 拖到 `/Applications`。

> **为什么要自签名证书**:macOS 的「屏幕录制」权限按 app 的代码签名指纹绑定。用一个**稳定的自签名证书**签名,重新打包后指纹不变,权限才不会每次都失效。`make-signing-cert.sh` 会创建名为 `AfterMeet Local Signing` 的证书,`electron-builder.yml` 已配置用它签名。

---

## 🔐 首次运行:授权(重要)

AfterMeet 需要两个权限:

1. **屏幕录制**(用于采集系统音频)—— 系统设置 › 隐私与安全性 › 屏幕录制与系统录音
2. **麦克风** —— 系统设置 › 隐私与安全性 › 麦克风

**授权后必须完全退出 App(⌘Q)再重开,屏幕录制权限才生效。**

> ⚠️ **重新打包后权限「显示开着却不生效」怎么办**:如果你改了代码重新打包,签名指纹可能变了,导致系统设置里开关是开的、实际却被拒(日志报 `-3801`)。解决:在系统设置里**选中 AfterMeet 条目点「−」删掉 → ⌘Q 退出 → 重开 → 重新授权 → 再重启一次**。用稳定自签名证书能大幅减少此问题。

---

## 📖 使用

- **开始录制**:点右上角「● 开始录制」,或在首页日程里对某场会点「在此录制」
- **实时字幕**:录制中左侧实时出字;右侧可看统计、关联会议
- **停止**:点「停止并生成纪要」→ 自动精转全程 + 生成纪要
- **会议详情**:查看主题/要点/决议/风险/待办/完整转写,可改名、重新生成、问 AI
- **会议库 / 待办 / 设置**:顶部导航切换

### 音频模式(重要)

设置 › 转写里,或通过环境变量 `AFTERMEET_MIX_MIC` 控制是否混入麦克风:

- **线上会议**:建议**戴耳机**,让系统音录到对方的数字原声(最干净)。外放时若开麦克风混入,麦会把扬声器的声音又收一遍造成回声。
- **线下会议**:靠麦克风收全场,**需要开麦克风混入**。尽量把笔记本放在离说话人近的位置,远场音质会明显影响转写。

### 飞书集成(可选)

安装并登录 [lark-cli](https://github.com/) 后可用:

- **今日日程**:首页展示当天会议,可一键关联录制
- **飞书妙记**:会议详情 › 纪要来源 › 飞书妙记 —— 拉取商用级逐字稿(说话人分离+精准标点),质量远高于本地远场录音
- **会前简报**:周期性会议开会前,汇总上次重点纪要 + 遗留待办 + 本场关注点

---

## 🧩 技术架构

```
系统音频(ScreenCaptureKit) ┐
                            ├─ 样本对齐混音 → 16k PCM ─┬─ 实时:sherpa-onnx 流式字幕
麦克风(AVAudioEngine)      ┘                          └─ 存档:完整录音
                                                              │
停止 → whisper large-v3-turbo 整段精转 → Gemini 整理(标点/分段)→ 权威转写
                                                              │
                                              Gemini 生成 纪要 / 总结 / 待办
```

- **Electron 33 + React 19 + Vite + TypeScript**
- 采集 helper:Swift(`native/SystemAudioCapture.swift`),两路各自重采样到 16k 后**按样本计数对齐相加**(不用墙钟,避免变调/噪声)
- 转写:whisper.cpp(brew)+ sherpa-onnx(可选流式)
- 纪要:Gemini REST(`gemini-2.5-flash`,`thinkingBudget:0`)

---

## ❓ 常见问题

**转写全是乱码/变调/噪声?**
先确认音频本身干净:录一小段,到 `~/Library/Application Support/AfterMeet/transcripts/` 找 `audio-*.pcm`,加 WAV 头播放听听。若是清晰人声但转写差 → 模型/语言问题;若回放本身就是噪声 → 采集问题。

**线下远场会议转写差?**
笔记本麦克风收整个会议室先天困难(距离、混响、多人)。把笔记本挪近说话人,或接 USB 会议麦;线上会优先用飞书妙记。

**没生成纪要?**
检查 `.env` 里的 `GEMINI_API_KEY`。设置 › 纪要生成里能看到密钥状态。

**录制文件在哪?**
`~/Library/Application Support/AfterMeet/`(`meetings.json` 元数据、`transcripts/` 音频与转写、`debug.log` 日志)。

---

## 📄 License

[MIT](./LICENSE)

> 免责声明:本项目为个人工具,按现状提供。你需自行遵守所在地区关于会议录制的法律与知情同意要求。
