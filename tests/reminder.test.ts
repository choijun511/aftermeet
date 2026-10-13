import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ReminderPolicy } from '../src/main/reminder-policy'
test('audio activity must persist; busy recording and playback suppress prompts', () => {
 const p = new ReminderPolicy()
 p.activity(true,100)
 assert.equal(p.shouldShow(3000,true),false)
 assert.equal(p.shouldShow(4100,false),false)
 assert.equal(p.shouldShow(4100,true),true)
 p.markShown()
 assert.equal(p.shouldShow(20000,true),false)
 p.activity(false,21000)
 assert.equal(p.shouldShow(30000,true),false)
 p.activity(true,30000)
 assert.equal(p.shouldShow(34000,true),true)
})
test('snooze survives device activity changes for ten minutes', () => {
 const p = new ReminderPolicy()
 p.activity(true,0); p.snooze(4000)
 p.activity(false,5000); p.activity(true,6000)
 assert.equal(p.shouldShow(603999,true),false)
 assert.equal(p.shouldShow(604000,true),true)
})
