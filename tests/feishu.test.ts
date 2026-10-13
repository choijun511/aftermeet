import { test } from 'node:test'
import assert from 'node:assert/strict'
import { feishuError } from '../src/main/feishu-error'
test('Feishu missing scope is explained from either output stream without raw authorization hints', () => {
 const raw = JSON.stringify({ok:false,error:{type:'authorization',subtype:'missing_scope',missing_scopes:['vc:meeting.search:read'],hint:'PRIVATE_DEVICE_CODE'}})
 for (const streams of [[raw,''],['',raw]]) {
  const message=feishuError(streams[0],streams[1],3)
  assert.match(message,/搜索会议记录/)
  assert.doesNotMatch(message,/PRIVATE_DEVICE_CODE/)
 }
})
test('Feishu configuration and authorization failures remain distinct', () => {
 assert.match(feishuError('',JSON.stringify({error:{subtype:'not_configured'}}),3),/尚未配置/)
 assert.match(feishuError('',JSON.stringify({error:{type:'authorization'}}),3),/重新授权/)
 assert.match(feishuError('','',2),/退出码 2/)
})

import { withCalendar } from '../src/main/calendar-link'
import type { Meeting, CalendarEvent } from '../src/shared/types'
test('calendar association, replacement and removal rename immediately and preserve meeting content', () => {
 const meeting = { id:'test', title:'original', transcript:'original words', summary:'notes', todos:[{id:'t',text:'todo',done:true}], audioPath:'/audio', notesSource:'local' } as Meeting
 const event: CalendarEvent = {eventId:'e1',title:'Calendar title',startTime:100,endTime:200,hasVchat:false,recurring:false}
 const linked=withCalendar(meeting,event)
 assert.deepEqual(linked.calendar,event)
 assert.equal(meeting.calendar,undefined)
 const replaced=withCalendar(linked,{...event,eventId:'e2'})
 assert.equal(replaced.calendar?.eventId,'e2')
 const removed=withCalendar(replaced,null)
 const {calendar,...rest}=removed
 assert.equal(calendar,undefined)
 assert.deepEqual(rest,{...meeting,title:'Calendar title'})
 assert.equal(linked.title,event.title)
 assert.equal(meeting.title,'original')
 assert.throws(()=>withCalendar(meeting,{...event,startTime:NaN}))
 assert.throws(()=>withCalendar(meeting,{...event,endTime:0}))
})

import { Session } from '../src/main/session'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getMeeting } from '../src/main/store'
test('linking during recording updates active session and disk, processing refuses changes', () => {
 const dir=mkdtempSync(join(tmpdir(),'aftermeet-calendar-'))
 process.env.AFTERMEET_TEST_DATA=dir
 try {
  const session=new Session(()=>{})
  const current={id:'active',title:'original',startedAt:1,durationSec:0,transcript:'words',todos:[]} as Meeting
  Object.assign(session,{meeting:current,state:'recording'})
  const event:CalendarEvent={eventId:'calendar',title:'日历标题',startTime:1,endTime:2,hasVchat:false,recurring:false}
  assert.equal(session.linkCalendar('active',event).ok,true)
  assert.equal(getMeeting('active')?.title,'日历标题')
  assert.equal((session as unknown as {meeting:Meeting}).meeting.title,'日历标题')
  Object.assign(session,{stopping:true,state:'transcribing'})
  assert.equal(session.linkCalendar('active',{...event,title:'wrong'}).ok,false)
  assert.equal(getMeeting('active')?.title,'日历标题')
 } finally {delete process.env.AFTERMEET_TEST_DATA;rmSync(dir,{recursive:true,force:true})}
})
