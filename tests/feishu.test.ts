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
test('calendar association, replacement and removal preserve all meeting content', () => {
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
 assert.deepEqual(rest,meeting)
 assert.throws(()=>withCalendar(meeting,{...event,startTime:NaN}))
 assert.throws(()=>withCalendar(meeting,{...event,endTime:0}))
})
