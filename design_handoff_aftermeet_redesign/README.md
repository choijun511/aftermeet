# Handoff: AfterMeet 整体重设计（现代软质风格 v2）

## Overview
AfterMeet 是一个 macOS 本地会议助手（Electron + React + TypeScript，代码库 `aftermeet/`）：录制系统音频+麦克风、本地实时转写（sherpa-onnx 流式 / whisper 高精度）、会后用 Gemini 生成纪要与待办。本次重设计包含新的信息架构与全部 7 个页面的高保真稿。

## About the Design Files
本包中的 `.dc.html` / `.html` 文件是 **HTML 制作的设计参考稿**（原型，展示目标外观与行为），不是可直接搬运的生产代码。任务是在现有代码库（`src/renderer/`，React 18 + TSX，无 UI 框架，纯 CSS）中**重新实现**这些设计，沿用现有的 IPC 契约（`src/shared/types.ts` 的 `AfterMeetApi`），必要处新增接口。

## Fidelity
**High-fidelity。** 颜色、字号、圆角、间距、文案均为最终值，按像素还原。`AfterMeet Redesign v2.dc.html` 是最终风格；`AfterMeet Redesign.dc.html` 是旧方向（Modernist 风格）+ 交互全图，仅作交互逻辑参考，不要按它的视觉实现。

## 信息架构（相对现状的关键变更）
现有 5 个 tab（概览/会中转写/转写历史/会议纪要/待办中心）收敛为 4 个顶部导航项：
1. **首页** — 日程（飞书，可按日期翻页）+ 未完成待办（按会议分组）+ 最近会议（带纪要状态）；「转写历史」与「会议纪要」是同一数据的两个视图，**合并为会议库**。
2. **会议库** — 列表（搜索/筛选）→ 详情（纪要 + 转写 + 问 AI）。
3. **待办** — 按会议分组的全局待办视图（不平铺）。
4. **设置** — 转写模型 / Gemini Key / 自动化 / 飞书 / 存储。

**录制是平行状态，不是页面接管**：录制期间所有页面顶部悬浮一个居中迷你条（计时 + 会议名 + 回到录制 + 停止），点「回到录制」进入录制视图（1B）。导航区不出现录制项。

## Screens / Views（对应 v2 文件内的 1a–1g 画板）

### 1A 首页 · 待命
- 布局：内容区 padding `4px 32px 28px`，两栏 flex，左 1.45fr 右 1fr，gap 20px。
- 左：白卡「日程」——头部（标题 + 日期切换胶囊 ‹ 今天·08-28 › + 刷新圆钮），行卡三态：已结束（`#f5f6f9` 圆角 16、opacity .55、「看纪要」白胶囊链接）；**下一场高亮 = 黑色卡** `#17181c` 白字 + 珊瑚红胶囊「● 录制此会议」+ 组织者姓名头像（32px 圆，`rgba(255,255,255,.16)`）；普通行（`#f5f6f9` + 白底描边胶囊按钮 + 头像 `#e4ecf9`/`#3f66a8`）。卡底部：自动起录开关行（`#f5f6f9` 圆角 16 + 黑色胶囊 toggle 46×27，knob 白 21px）。
- 右：白卡「未完成待办」按会议分组（组头 = 会议名 bold + 时间 + n 项 ›，条目 = 18px 圆形复选框 `2px solid #c9cdd6` + 13.5px 文本，临期红胶囊 chip）；白卡「最近会议」行 hover `#f5f6f9`，状态 chip 见下。
- 状态 chip：生成中 `#edeff3/#6b7180`；已生成 `#e1f1e8/#2e7d54`；失败·重试 `#fbe9e5/#b23c2b`；仅转写（未配 Key）灰。

### 1B 录制中
- 导航右侧出现珊瑚红计时胶囊 `● 42:13`（替代「开始录制」黑胶囊），红点 1.6s 呼吸（`opacity 1→.35`）。
- 左大白卡：头部 = 呼吸红点 14px + 计时 26px tabular + chips（系统音+麦克风 红tint / 流式·本地 灰）+ 音量条（3 根 3px 圆角红条）+「■ 停止并生成纪要」红胶囊；转写行 = 时间戳（48px 宽，12px 700 `#b23c2b`）+ 正文 14.5px/1.7；未落定段 = 灰底圆角块「正在听」。底部转写知情提示 12px 灰。
- 右栏：黑卡「关联会议·飞书」（白字，半透明白 chips）；白卡「本场」3 个统计 tile（`#f5f6f9` 圆角 14）；白卡「实时存档」+ 灰胶囊按钮「打开存档文件夹」。

### 1C 会议详情
- 顶部居中悬浮录制迷你条（白胶囊，shadow `0 6px 20px rgba(20,24,40,.12)`）：呼吸红点 + 04:12 + 「正在录制：…可继续浏览其他页面」+ 回到录制 › + 红tint「■ 停止」胶囊。演示边录边看。
- 左栏（1.15fr）：返回圆钮（白，chevron-left）+ 标题/元信息 + 三个白描边胶囊操作（↻ 重新生成 / 导出 / 删除灰字）；**黑色主题卡**（kicker「会议主题」+ 21px 800 结论句）；白卡「要点」= 红点 bullet + 文本 + **时间戳胶囊**（`#fbe9e5/#b23c2b` 11px 800，点击跳转写并高亮）；白卡「决议」（绿√ svg）+「风险/待确认」（红!）并排；白卡「待办」（复选框 + 负责人·日期，完成项划线 45% 透明）。
- 右栏：白卡「完整转写」+ chip「已定位 42:10」，目标行红tint圆角块高亮；白卡「问 AI」= 用户气泡（`#eef0f4`，右对齐，圆角 16/16/4/16）+ AI 气泡（`#f5f6f9`，答案内嵌时间戳胶囊）+ 输入胶囊 + 黑色圆形发送钮（箭头↑ svg）。问 AI 只基于本场转写作答。

### 1D 会议库
- 标题区 + 右侧搜索胶囊输入（320px）+ 筛选胶囊组（`#e2e5eb` 槽 + 选中黑胶囊：全部/本周/有待办）。
- 白卡表格：表头 11.5px 灰；行 hover `#f5f6f9` 圆角 14；列 = 日期(110) / 会议(1fr, 700) / 时长(70) / 字数(80) / 待办(红 chip 数字) / 纪要状态 chip。空值 `—` `#c9cdd6`。
- 底注：自动起录的会议按开始时间命名，详情页可重命名。

### 1E 待办
- 筛选胶囊「未完成 | 全部」。2 列 grid gap 16 的白卡，每卡一场会议：组头（会议名 + 时间 + n 未完成 + 看纪要 ›）+ 条目（复选框/负责人/截止 chip，临期红）。完成项划线。全部完成的会议卡自动收起。

### 1F 设置
- 2×2 白卡 grid：**转写**（单选 tile：流式·中英双语推荐 选中 = `2px solid #17181c`；高精度 large-v3-turbo；+「停止后高精度重转全文」toggle）；**纪要生成**（Gemini Key 胶囊输入 + 测试钮 + 「连接正常」绿 chip + 上次调用信息 + 自动生成 toggle）；**自动化**（自动起录 / 开机自启常驻菜单栏 toggle + 飞书授权行：绿 chip + 重新授权钮）；**存储**（路径输入 + 更改/打开 + 占用统计文案）。

### 1G 首页 · 首次使用（空态即引导）
- 左黑卡 hero：红 kicker「开会前 30 秒设置一次，之后全自动」+ 32px 标语「录下每一场会，纪要自己长出来。」+ 说明 + 红胶囊「● 开始第一场录制」+ 灰注。
- 右白卡「准备清单」4 行 tile：系统音频权限✓（绿圆）/ 麦克风权限✓ / LLM Key（红描边空圆 + 黑胶囊「去配置」）/ 飞书可选（灰空圆 + 白描边「连接」）；下方自动起录开关卡。

## Interactions & Behavior
- 录制状态机（沿用 `RecState`）：idle → starting → recording → transcribing → summarizing → idle；error 分支提示去「隐私与安全性」授权。未配 Key：跳过 summarizing，会议标记「仅转写」，详情页可补生成。
- 迷你条：`state ∈ {recording, starting}` 时在除 1B 外所有页面显示；stop 后变「收尾转写中/生成纪要中」直至完成，完成发系统通知，点击直达详情。
- 时间戳跳转：点要点/决议/AI 答案里的时间戳 chip → 右栏转写滚动至该段并红tint高亮 + 顶部「已定位 mm:ss」chip。
- 转写实时段：`final:false` 的段渲染为灰底「正在听」块，落定后转普通行；转写区自动吸底滚动。
- 待办勾选双向同步（首页/待办页/详情页同一数据源，`toggleTodo`）。
- 日期切换：‹ › 逐日翻，点中间日期胶囊回到今天。
- hover：导航项/行 `#e2e5eb` 或 `#f5f6f9`；黑胶囊 hover `#33353c`；红胶囊 hover `#c94f3d`。
- 动画：录制红点 `@keyframes rec-pulse { 50% { opacity:.35 } }` 1.6s ease-in-out infinite。其余过渡建议 150ms ease。

## State Management
- 全局：`status: StatusEvent`（含 durationSec 驱动所有计时显示）、`meetings: Meeting[]`、`segments: TranscriptSegment[]`、`hasKey`、当前路由、日程日期偏移、搜索词、筛选值。
- 派生：未完成待办按 `meeting` 分组；导航待办角标 = 未完成总数。
- 事件：`onStatus / onSegment / onMeetingUpdated / onNotice`（已有）。需新增 API：按日期查日历（现只有今日）、问 AI（`askMeeting(id, question)` 流式返回 + 引用时间点）、重命名会议、按时间戳定位段落（转写需保留每段 `t` 秒，见 `TranscriptSegment.t`）。

## Design Tokens
- 字体：`"Plus Jakarta Sans","Noto Sans SC",system-ui,sans-serif`（Google Fonts，400–800）。
- 颜色：ink `#17181c`；次级文本 `#5c6270`；muted `#8a8f9c`；窗口底 `#eef0f4`；卡片 `#fff`；嵌套 tile `#f5f6f9`；描边 `#e5e8ee`；hover 槽 `#e2e5eb`；禁用 knob 槽 `#d6d9e0`；珊瑚红（录制/强调）`#e0604d`，hover `#c94f3d`，红tint `#fbe9e5` / 深红字 `#b23c2b`；绿 `#2e7d54` / tint `#e1f1e8`；蓝（头像）`#3f66a8` / tint `#e4ecf9`；灰 chip `#edeff3`/`#6b7180`。
- 圆角：窗口 24 / 大卡 20–22 / tile 14–16 / 按钮与 chip 999（全胶囊）/ 复选框圆形。
- 阴影：卡 `0 1px 2px rgba(20,24,40,.04)`；悬浮迷你条 `0 6px 20px rgba(20,24,40,.12)`。
- 字号：页面标题 22/800；卡标题 14–16/800；正文 13.5–14.5；元信息 11.5–12.5 muted；计时 26/800 tabular-nums（所有数字用 `font-variant-numeric: tabular-nums`）。
- 间距：内容区横向 32px；卡内 padding 18–24px；栏间 gap 16–20px。
- 控件：toggle 46×27 胶囊（开 `#17181c`，knob 白 21px）；复选框 18px 圆（完成 = 黑底白√）；chip padding `3px 10px` 11px 700。

## Assets
- 图标：Lucide（https://lucide.dev）内联 SVG，stroke 2.2–2.4，`currentColor`：mic（品牌标，30px 黑色圆角 10 tile 内）、search、rotate-cw（刷新/重新生成）、square 填充（停止）、check、chevron-left、arrow-up（发送）。音量条为 3 根 3px 圆角矩形。
- 头像：无照片时用姓名首字圆形（32px，蓝 tint 或黑卡上半透明白）。
- 无位图资源。

## Files
- `AfterMeet Redesign v2.dc.html` — **最终高保真**，7 个画板（1a 首页待命 / 1b 录制中 / 1c 详情 / 1d 会议库 / 1e 待办 / 1f 设置 / 1g 首次使用），浏览器直接打开即可查看。
- `AfterMeet Redesign.dc.html` — 交互全图（信息架构 / 状态机 / 旅程泳道）+ 旧 Modernist 视觉方向，仅作交互与流程参考。

## 给 Claude Code 的建议入口
现有代码 `src/renderer/src/App.tsx`（5 tab 结构）与 `views/*.tsx` 需按上述 IA 重组为：`HomeView`（含首次使用空态）、`LiveView`（录制视图 + 全局迷你条组件）、`LibraryView` + `MeetingDetailView`、`TodosView`、`SettingsView`。样式建议集中一份 token（CSS 变量）按上面 Design Tokens 落。
