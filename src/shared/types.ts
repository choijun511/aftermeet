// 主进程与渲染进程共享的类型定义

export type RecState = 'idle' | 'starting' | 'recording' | 'transcribing' | 'summarizing' | 'error'

export interface TranscriptSegment {
  originalText?: string
  id: string
  /** 相对录制开始的秒数 */
  t: number
  text: string
  /** false = 实时临时结果(可能被后续覆盖);true = 已落定 */
  final: boolean
}

export interface TodoItem {
  id: string
  text: string
  owner?: string
  due?: string
  done: boolean
}

export interface Minutes {
  /** 一句话主题 */
  topic: string
  /** 要点(分条) */
  keyPoints: string[]
  /** 决议 / 结论 */
  decisions: string[]
  /** 风险 / 待确认 */
  risks: string[]
}

/** 飞书日历会议(用于「今日会议」展示与录制关联) */
export interface CalendarEvent {
  eventId: string
  title: string
  startTime: number
  endTime: number
  organizer?: string
  /** self_rsvp_status: accept / tentative / decline / needs_action */
  rsvpStatus?: string
  meetingUrl?: string
  hasVchat: boolean
  /** 是否周期性会议(event_id 后缀为时间戳) */
  recurring?: boolean
}

/** 会前简报:周期性会议开会前的「上次重点 + 遗留待办 + 本场关注」 */
export interface MeetingPrep {
  hasPrev: boolean
  /** 上次记录来源 */
  source?: 'local' | 'feishu'
  last?: {
    title: string
    /** 上次会议时间(飞书兜底来源可能为 0=未知) */
    when: number
    minutes: Minutes
  }
  /** 上次遗留的未完成待办 */
  openTodos: { text: string; owner?: string }[]
  /** 本场需要关注什么(Gemini 生成) */
  focus: string[]
  error?: string
}

export type ProcessingEngine = 'qwen' | 'local'
export interface ProcessingStatus {
  stage: 'recording' | 'saved' | 'transcribing' | 'summarizing' | 'complete'
  state: 'running' | 'paused' | 'failed' | 'done'
  engine?: ProcessingEngine
  completedChunks?: number
  totalChunks?: number
  message?: string
  updatedAt: number
}
export interface RetranscribeOptions {
  engine: ProcessingEngine
  restart?: boolean
  allowResubmit?: boolean
}

export interface Meeting {
  audioPath?: string
  audioFormat?: 'pcm-s16le-16000-mono'
  audioBytes?: number
  processing?: ProcessingStatus
  notesStale?: boolean

  notesModel?: string
  analysisMode?: 'standard' | 'deep'
  transcriptionModel?: string
  transcriptionWarning?: string
  speakerSegments?: { startMs: number; endMs: number; text: string; speaker: string }[]
  id: string
  title: string
  startedAt: number
  endedAt?: number
  durationSec: number
  /** 完整转写纯文本 */
  transcript: string
  /** 实时转写存档文件路径 */
  transcriptPath?: string
  minutes?: Minutes
  /** 会后总结(成段叙述) */
  summary?: string
  todos: TodoItem[]
  /** 生成纪要时是否出错 */
  llmError?: string
  /** 关联的飞书日历会议(可选) */
  calendar?: CalendarEvent
  /** 当前纪要基于哪路转写生成:本地录制 or 飞书妙记 */
  notesSource?: 'local' | 'feishu'
  /** 飞书妙记逐字稿(说话人分离,拉取后缓存) */
  feishuTranscript?: string
  /** 妙记标题 */
  feishuTitle?: string
}

/** 录制状态推送 */
export interface AudioHealth {
  system: { rms: number; receiving: boolean }
  microphone: { rms: number; receiving: boolean }
  micIncluded: boolean
  silenceSeconds: number
}
export interface StatusEvent {
  audioHealth?: AudioHealth
  state: RecState
  durationSec: number
  /** 麦克风/系统音频是否活跃 */
  active: boolean
  message?: string
  meetingId?: string
}

/** 应用设置(持久化在 settings.json) */
export interface AppSettings {
  cloudAsr: boolean
  /** 自动起录(麦克风活跃即开录) */
  autoStart: boolean
  /** 停止后用高精度模型重转全文(两遍精转) */
  twoPass: boolean
  /** 录制结束后自动生成纪要 */
  autoMinutes: boolean
}

/** 渲染进程通过 window.api 调用主进程的接口契约 */
export type RecordingPermission = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
export interface PermissionStatus {
  supported: boolean
  microphone: RecordingPermission
  screen: RecordingPermission
}

export interface AudioPermissionProbe {
  ok: boolean
  message: string
}
export type PlaybackInfo = { ok: true; url: string; token: string; durationSec: number } | { ok: false; error: string }
export interface AfterMeetApi {
  preparePlayback(id: string): Promise<PlaybackInfo>
  setPlaybackActive(token: string, active: boolean): Promise<boolean>
  releasePlayback(token: string): Promise<void>
  testSystemAudio(): Promise<AudioPermissionProbe>
  getPermissions(): Promise<PermissionStatus>
  requestMicrophonePermission(): Promise<PermissionStatus>
  openPermissionSettings(kind: 'microphone' | 'screen'): Promise<void>
  startRecording(
    title: string,
    calendar?: CalendarEvent | null
  ): Promise<{ ok: boolean; meetingId?: string; error?: string }>
  stopRecording(): Promise<{ ok: boolean; meetingId?: string; error?: string }>
  /** 飞书:今日日历会议 */
  listTodayMeetings(): Promise<{ ok: boolean; events: CalendarEvent[]; error?: string }>
  /** 飞书:指定日期(相对今天的偏移天数)的日历会议 */
  listMeetingsByDate(
    dayOffset: number
  ): Promise<{ ok: boolean; events: CalendarEvent[]; error?: string; label: string }>
  feishuAvailable(): Promise<boolean>
  feishuStatus(): Promise<{ available: boolean; authed: boolean }>
  /** 按标题+时间自动搜索可能的妙记会议 */
  feishuSearchNotes(
    meetingId: string
  ): Promise<{ ok: boolean; candidates: { meetingId: string; title: string; info: string }[]; error?: string }>
  /** 用飞书妙记生成纪要/待办(meetingId=飞书会议ID 或 minuteToken/链接二选一) */
  applyFeishuNotes(
    id: string,
    source: { feishuMeetingId?: string; minuteInput?: string }
  ): Promise<{ ok: boolean; error?: string }>
  /** 切回用本地录制转写生成纪要 */
  useLocalNotes(id: string): Promise<{ ok: boolean; error?: string }>
  /** 会前简报:汇总上次同系列会议重点 + 遗留待办 + 本场关注 */
  getMeetingPrep(event: CalendarEvent): Promise<MeetingPrep>
  /** 会议改名 */
  renameMeeting(id: string, title: string): Promise<{ ok: boolean }>
  /** 就本场会议转写问 AI(Gemini,仅基于本场转写作答) */
  askMeeting(id: string, question: string): Promise<{ ok: boolean; answer: string; error?: string }>
  /** 设置读写 */
  getSettings(): Promise<AppSettings>
  setSetting(key: keyof AppSettings, value: boolean): Promise<AppSettings>
  /** 存储信息 */
  storageInfo(): Promise<{ dir: string }>
  openPath(p: string): Promise<void>
  getState(): Promise<StatusEvent>
  listMeetings(): Promise<Meeting[]>
  getMeeting(id: string): Promise<Meeting | null>
  deleteMeeting(id: string): Promise<{ ok: boolean }>
  retranscribe(id: string, options: RetranscribeOptions): Promise<{ ok: boolean; error?: string }>
  cancelProcessing(id: string): Promise<{ ok: boolean; error?: string }>
  regenerate(id: string, mode?: 'standard' | 'deep'): Promise<{ ok: boolean; error?: string }>
  modelStatus(): Promise<{ openai: boolean; qwen: boolean; standard: string; deep: string; asr: string }>
  toggleTodo(meetingId: string, todoId: string): Promise<{ ok: boolean }>
  openTranscriptsFolder(): Promise<void>
  hasApiKey(): Promise<boolean>
  setAutoStart(enabled: boolean): Promise<{ ok: boolean; enabled: boolean }>
  getAutoStart(): Promise<boolean>

  onStatus(cb: (e: StatusEvent) => void): () => void
  onSegment(cb: (s: TranscriptSegment) => void): () => void
  onMeetingUpdated(cb: (m: Meeting) => void): () => void
  onNotice(cb: (msg: string) => void): () => void
}
