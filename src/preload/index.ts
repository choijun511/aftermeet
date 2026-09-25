import { contextBridge, ipcRenderer } from 'electron'
import type { AfterMeetApi, StatusEvent, TranscriptSegment, Meeting } from '../shared/types'

const api: AfterMeetApi = {
  testSystemAudio: () => ipcRenderer.invoke('permissions:testSystemAudio'),
  getPermissions: () => ipcRenderer.invoke('permissions:get'),
  requestMicrophonePermission: () => ipcRenderer.invoke('permissions:microphone'),
  openPermissionSettings: (kind) => ipcRenderer.invoke('permissions:open', kind),
  startRecording: (title, calendar) => ipcRenderer.invoke('rec:start', title, calendar ?? null),
  stopRecording: () => ipcRenderer.invoke('rec:stop'),
  listTodayMeetings: () => ipcRenderer.invoke('feishu:agenda'),
  listMeetingsByDate: (dayOffset) => ipcRenderer.invoke('feishu:byDate', dayOffset),
  feishuAvailable: () => ipcRenderer.invoke('feishu:available'),
  feishuStatus: () => ipcRenderer.invoke('feishu:status'),
  feishuSearchNotes: (id) => ipcRenderer.invoke('feishu:searchNotes', id),
  applyFeishuNotes: (id, source) => ipcRenderer.invoke('feishu:applyNotes', id, source),
  useLocalNotes: (id) => ipcRenderer.invoke('feishu:useLocal', id),
  getMeetingPrep: (event) => ipcRenderer.invoke('meeting:prep', event),
  renameMeeting: (id, title) => ipcRenderer.invoke('meetings:rename', id, title),
  askMeeting: (id, question) => ipcRenderer.invoke('meetings:ask', id, question),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  storageInfo: () => ipcRenderer.invoke('app:storageInfo'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  getState: () => ipcRenderer.invoke('rec:state'),
  listMeetings: () => ipcRenderer.invoke('meetings:list'),
  getMeeting: (id) => ipcRenderer.invoke('meetings:get', id),
  deleteMeeting: (id) => ipcRenderer.invoke('meetings:delete', id),
  retranscribe: (id, options) => ipcRenderer.invoke('meetings:retranscribe', id, options),
  cancelProcessing: (id) => ipcRenderer.invoke('meetings:cancelProcessing', id),
  regenerate: (id, mode = 'standard') => ipcRenderer.invoke('meetings:regenerate', id, mode),
  modelStatus: () => ipcRenderer.invoke('app:modelStatus'),
  toggleTodo: (meetingId, todoId) =>
    ipcRenderer.invoke('meetings:toggleTodo', meetingId, todoId),
  openTranscriptsFolder: () => ipcRenderer.invoke('app:openTranscripts'),
  hasApiKey: () => ipcRenderer.invoke('app:hasApiKey'),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  getAutoStart: () => ipcRenderer.invoke('autostart:get'),

  onStatus: (cb) => {
    const h = (_e: unknown, p: StatusEvent): void => cb(p)
    ipcRenderer.on('status', h)
    return () => ipcRenderer.removeListener('status', h)
  },
  onSegment: (cb) => {
    const h = (_e: unknown, p: TranscriptSegment): void => cb(p)
    ipcRenderer.on('segment', h)
    return () => ipcRenderer.removeListener('segment', h)
  },
  onMeetingUpdated: (cb) => {
    const h = (_e: unknown, p: Meeting): void => cb(p)
    ipcRenderer.on('meeting-updated', h)
    return () => ipcRenderer.removeListener('meeting-updated', h)
  },
  onNotice: (cb) => {
    const h = (_e: unknown, p: string): void => cb(p)
    ipcRenderer.on('notice', h)
    return () => ipcRenderer.removeListener('notice', h)
  }
}

contextBridge.exposeInMainWorld('api', api)
