import type { AfterMeetApi } from '../shared/types'

declare global {
  interface Window {
    api: AfterMeetApi
  }
}

export {}
