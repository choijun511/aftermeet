// 仅用于「浏览器中预览 UI」的假数据。Electron 里 window.api 由 preload 注入,永不走这里。
import type { AfterMeetApi, CalendarEvent, Meeting, StatusEvent } from '../../shared/types'

function ev(id: string, title: string, sh: number, sm: number, eh: number, em: number, org: string): CalendarEvent {
  const d = new Date()
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm).getTime()
  const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em).getTime()
  return { eventId: id, title, startTime: s, endTime: e, organizer: org, hasVchat: true }
}

const MEETINGS: Meeting[] = [
  {
    id: 'm1',
    title: '增长团队周会',
    startedAt: Date.now() - 2 * 3600e3,
    endedAt: Date.now() - 1.2 * 3600e3,
    durationSec: 2880,
    transcript:
      '这周我们重点看了新用户激活漏斗。首日留存从 32% 提升到了 38%,主要来自引导流程的简化。\n\n下一步要把关联日程的功能推给灰度用户,预计下周三上线。张伟负责埋点,李娜跟进设计走查。\n\n风险是数据管道还没打通,可能影响准确性,需要数据组本周确认。',
    todos: [
      { id: 't1', text: '完成新引导流程埋点', owner: '张伟', due: '周五', done: false },
      { id: 't2', text: '设计走查关联日程界面', owner: '李娜', done: false },
      { id: 't3', text: '同步数据管道进度', owner: '数据组', done: true }
    ],
    minutes: {
      topic: '新用户激活漏斗优化与关联日程灰度上线',
      keyPoints: ['首日留存 32%→38%', '引导流程简化是主要增益', '关联日程下周三灰度'],
      decisions: ['关联日程功能进入灰度', '埋点由张伟本周完成'],
      risks: ['数据管道未打通,可能影响准确性']
    },
    summary:
      '## 背景\n本周聚焦**新用户激活漏斗**的优化效果复盘。\n\n## 讨论\n- 首日留存从 32% 提升到 **38%**\n- 主要增益来自引导流程简化\n\n## 结论与下一步\n关联日程功能进入灰度,预计**下周三**上线。\n\n> 数据管道未打通是最大风险,需数据组本周确认。'
  },
  {
    id: 'm2',
    title: '与设计团队的产品评审',
    startedAt: Date.now() - 26 * 3600e3,
    endedAt: Date.now() - 25 * 3600e3,
    durationSec: 3600,
    transcript: '评审了三个候选方案,最终选择了 B 方案的卡片式布局……',
    todos: [{ id: 't4', text: '输出高保真原型', owner: '设计', done: false }],
    minutes: {
      topic: '三方案评审,选定卡片式布局',
      keyPoints: ['B 方案胜出', '强调留白与圆角'],
      decisions: ['采用 B 方案'],
      risks: []
    },
    summary: '选定 **B 方案**。'
  },
  {
    id: 'm3',
    title: '会议 09:12:04',
    startedAt: Date.now() - 3 * 864e5,
    endedAt: Date.now() - 3 * 864e5 + 900e3,
    durationSec: 900,
    transcript: '快速对齐了本周排期。',
    todos: [],
    llmError: '转写过短,跳过纪要生成'
  }
]

export function installMockApi(): void {
  const params = new URLSearchParams(location.search)
  const rec = params.has('rec') // 预览录制中(1B)
  const empty = params.has('empty') // 预览首次使用(1G)
  const status: StatusEvent = rec
    ? { state: 'recording', durationSec: 754, active: true, meetingId: 'm1' }
    : { state: 'idle', durationSec: 0, active: false }
  const SAMPLE = rec
    ? [
        { id: 's_1', t: 12, text: '大家好,我们先过一下这周新用户激活的数据。', final: true },
        { id: 's_2', t: 26, text: '首日留存从上周的百分之三十二提升到了三十八。', final: true },
        { id: 's_3', t: 41, text: '主要的增益来自引导流程的简化,把步骤从五步减到三步。', final: true },
        { id: 's_4', t: 58, text: '下一步我们把关联日程推给灰度用户,预计下周三上线。', final: true }
      ]
    : []

  const api: AfterMeetApi = {
    startRecording: async () => ({ ok: true, meetingId: 'm_new' }),
    stopRecording: async () => ({ ok: true }),
    listTodayMeetings: async () => ({ ok: true, events: [] }),
    listMeetingsByDate: async (off) => ({
      ok: true,
      label: off === 0 ? '今天' : '其他日期',
      events:
        off === 0
          ? [
              ev('e1', '晨会 · 站会', 9, 0, 9, 15, '王强'),
              ev('e2', '增长团队周会', 14, 0, 15, 0, '产品组'),
              ev('e3', '与设计团队的产品评审', 16, 30, 17, 30, '设计组')
            ]
          : []
    }),
    feishuAvailable: async () => true,
    feishuStatus: async () => ({ available: true, authed: true }),
    feishuSearchNotes: async () => ({
      ok: true,
      candidates: [{ meetingId: '730205868', title: '增长团队周会', info: '增长团队周会\nToday 14:00 | 产品组' }]
    }),
    applyFeishuNotes: async () => ({ ok: true }),
    useLocalNotes: async () => ({ ok: true }),
    getMeetingPrep: async () => ({
      hasPrev: true,
      source: 'local' as const,
      last: {
        title: '增长团队周会',
        when: Date.now() - 7 * 864e5,
        minutes: {
          topic: '上周聚焦首日留存,灰度引导流程',
          keyPoints: ['首日留存 32%→38%', '引导步骤从五步减到三步'],
          decisions: ['下周三对灰度用户上线关联日程'],
          risks: ['埋点口径需与数据组对齐']
        }
      },
      openTodos: [
        { text: '与数据组对齐埋点口径', owner: '张伟' },
        { text: '输出灰度上线 checklist', owner: '李娜' }
      ],
      focus: [
        '跟进上周埋点口径对齐是否完成',
        '确认灰度上线 checklist 已就绪',
        '复盘首日留存 38% 后的新数据'
      ]
    }),
    renameMeeting: async () => ({ ok: true }),
    askMeeting: async (_id, q) => ({ ok: true, answer: `关于「${q}」:根据这场会议的转写,主要提到了首日留存提升到 38%。` }),
    getSettings: async () => ({ autoStart: true, twoPass: true, autoMinutes: true }),
    setSetting: async (k, v) => ({ autoStart: true, twoPass: true, autoMinutes: true, [k]: v }),
    storageInfo: async () => ({ dir: '~/Library/Application Support/AfterMeet/transcripts' }),
    openPath: async () => {},
    getState: async () => status,
    listMeetings: async () => (empty ? [] : MEETINGS),
    getMeeting: async (id) => MEETINGS.find((m) => m.id === id) ?? null,
    deleteMeeting: async () => ({ ok: true }),
    regenerate: async () => ({ ok: true }),
    toggleTodo: async () => ({ ok: true }),
    openTranscriptsFolder: async () => {},
    hasApiKey: async () => true,
    setAutoStart: async (e) => ({ ok: true, enabled: e }),
    getAutoStart: async () => true,
    onStatus: (cb) => {
      if (rec) setTimeout(() => cb(status), 30)
      return () => {}
    },
    onSegment: (cb) => {
      if (rec) {
        SAMPLE.forEach((s, i) => setTimeout(() => cb(s), 60 + i * 20))
        // 追加一个进行中的 partial 行
        setTimeout(() => cb({ id: 'live', t: 71, text: '张伟负责埋点,李娜跟进设计走查……', final: false }), 200)
      }
      return () => {}
    },
    onMeetingUpdated: () => () => {},
    onNotice: () => () => {}
  }
  ;(window as unknown as { api: AfterMeetApi }).api = api
}
