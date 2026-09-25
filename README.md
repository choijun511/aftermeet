# 会后秘书 AfterMeet

> macOS 会议录制、本地实时字幕、Qwen 云端精转与 Luna / Sol 会议纪要。

更新记录见 [CHANGELOG.md](./CHANGELOG.md)。后续功能、修复和升级注意事项统一记录在该文件。

## 当前模型组合

- **实时字幕**：本地 sherpa-onnx；不可用时回退 Whisper 分块转写。
- **停止后精转**：开启「Qwen 云端精转」时上传录音至阿里云；失败时回退本地 Whisper large-v3-turbo。
- **普通纪要、问答和转写校对**：GPT-5.6 Luna。
- **深度分析**：会议详情的「Sol 深度分析」按钮使用 GPT-5.6 Sol；会前跨会议关注点也使用 Sol。
- **关闭云端精转**：录音留在本地；生成 AI 纪要仍会把转写文字发送给 OpenAI。

### 密钥配置

已安装应用从 `~/Library/Application Support/AfterMeet/.env` 读取配置，格式见 `.env.example`。
Luna 与 Sol 共用 `OPENAI_API_KEY`；Qwen 使用 `DASHSCOPE_API_KEY`、`DASHSCOPE_WORKSPACE_ID` 和 `DASHSCOPE_REGION`。
密钥不随 `.app` 分发，修改后完全退出并重开应用。

Qwen 使用百炼临时上传存储，临时文件 URL 有效期 48 小时；此方案用于个人本机使用，规模化部署应改用独立 OSS 存储与生命周期策略。
录音以 20 分钟为一段顺序处理，限制内存和单文件上传大小。各段说话人编号独立，不能据此认定跨段身份相同。云端失败原因和实际模型会显示在会议详情。

### 验证

`npm run test:cloud` 执行离线接口回归测试，不调用付费模型。
实际联调需有效 API Key；应使用公开样例或明确授权的录音。

---

## ✨ 特性

- **实时字幕**:边开会边出字(sherpa-onnx 流式,可选)
- **高精度转写**:停止后可用 Qwen 云端精转，失败时回退本地 Whisper large-v3-turbo
- **AI 纪要**:主题 / 要点 / 决议 / 风险 / 会后总结 / 待办(Luna / Sol)
- **问 AI**:就本场会议提问,答案只基于本场转写
- **隐私优先**:关闭云端精转时音频只在本地；可离线录音+转写（不生成 AI 纪要）
- **飞书集成(可选)**:今日日程、录制关联会议、拉取飞书妙记逐字稿、周期会议会前简报
- **崩溃恢复**:录制中意外退出,下次启动自动找回

## 🖥 系统要求

- **macOS 13.3+,Apple Silicon(M 系列)** —— 依赖 ScreenCaptureKit 采集系统音频
- [Homebrew](https://brew.sh/)
- Xcode Command Line Tools(`xcode-select --install`)—— 编译 Swift 采集 helper
- Node.js 18+
- OpenAI API Key（纪要）；阿里云百炼 API Key（可选云端精转）

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
# 编辑 .env,填入你的 OPENAI_API_KEY 和可选 DASHSCOPE_API_KEY
```

### 5) 运行 / 打包

```bash
npm run dev          # 开发模式(热更新)

# 或打包成 .app / .dmg:
bash native/make-signing-cert.sh   # 首次:创建稳定的自签名证书(见下方「为什么要自签名」)
npm run dist:mac                   # 产物在 dist/
```

打包后把 `dist/mac-arm64/AfterMeet.app` 拖到 `/Applications`。

> **为什么要自签名证书**:macOS 的「屏幕录制」权限按 app 的代码签名指纹绑定。临时签名的授权身份绑定具体版本，更新后可能失配。用同一张**稳定的自签名证书**签名，可保持签名身份要求兼容，减少更新造成的授权失效；文件指纹仍会随内容改变。首次从临时签名切换到证书签名后，需要重新授权。`make-signing-cert.sh` 会创建名为 `AfterMeet Local Signing` 的证书,`electron-builder.yml` 已配置用它签名。

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

### 录音健康与实时字幕

- 录制页分别显示系统声音和麦克风音量、数据接收状态，以及麦克风是否混入录音。音量不等同于语音识别质量。
- 连续 30 秒没有明显声音会提醒，不自动停止；采集数据中断会单独提示。
- 临时字幕原地更新；结束的片段由本地 Whisper 校对后覆盖同一行，可展开查看识别原稿。连续语音最多约 30 秒形成一个校对片段。
- 校对结果明显短于原稿或本地处理积压时保留原稿；校对不额外上传音频。实时模型仍可能出现同音字、重复或幻觉，最终会议稿仍以会后精转并人工核对为准。

### 失败恢复与重新转写

在「会议库 → 会议详情 → 录音处理与恢复」选择本地 Whisper 或 Qwen 云端后开始/继续转写。默认复用相同录音、相同配置的已完成分段；需要整场重识别时展开「重新识别选项」。Qwen 会上传音频，重新提交可能再次计费。

- 重启后处理会暂停，录音、云端任务 ID 和已完成分段保存在本机，等待用户继续；不会自动上传恢复的录音。
- 取消保留资料，云端已经接收的任务不保证停止或免计费。未知提交和失效任务默认不再次提交，需明确选择或使用本地转写。
- 「重新生成纪要」使用当前纪要来源的文本，不重新识别录音。重新转写成功后保留旧纪要和待办；基于本地旧稿的纪要会提示需要重新生成。
- `processing/` 保存恢复进度和转写替换前的旧版本。它们含会议文字，应与录音一起作为本地个人资料管理；本次没有版本浏览界面。
- 会议/设置使用原子写入和 `.bak` 备份。数据损坏且备份无效时会停止写入，请先备份应用数据目录，不要直接删除原始资料。

### 音频模式(重要)

通过环境变量 `AFTERMEET_MIX_MIC=1` 控制是否混入麦克风；默认优先录制系统声音，系统采集不可用时尝试麦克风回退。录制页会显示麦克风是否实际混入:

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
停止 → Qwen 云端精转 / 本地 Whisper 回退 → 最终转写
                                                              │
                                              Luna / Sol 生成 纪要 / 总结 / 待办
```

- **Electron 33 + React 19 + Vite + TypeScript**
- 采集 helper:Swift(`native/SystemAudioCapture.swift`),两路各自重采样到 16k 后**按样本计数对齐相加**(不用墙钟,避免变调/噪声)
- 转写:whisper.cpp(brew)+ sherpa-onnx(可选流式)
- 纪要：OpenAI Responses API（GPT-5.6 Luna / Sol）

---

## ❓ 常见问题

**转写全是乱码/变调/噪声?**
先确认音频本身干净:录一小段,到 `~/Library/Application Support/AfterMeet/transcripts/` 找 `audio-*.pcm`,加 WAV 头播放听听。若是清晰人声但转写差 → 模型/语言问题;若回放本身就是噪声 → 采集问题。

**线下远场会议转写差?**
笔记本麦克风收整个会议室先天困难(距离、混响、多人)。把笔记本挪近说话人,或接 USB 会议麦;线上会优先用飞书妙记。

**没生成纪要?**
检查本机 `.env` 里的 `OPENAI_API_KEY`。设置 › 纪要生成里能看到密钥状态。

**录制文件在哪?**
`~/Library/Application Support/AfterMeet/`(`meetings.json` 元数据、`transcripts/` 音频与转写、`debug.log` 日志)。

---

## 📄 License

[MIT](./LICENSE)

> 免责声明:本项目为个人工具,按现状提供。你需自行遵守所在地区关于会议录制的法律与知情同意要求。
