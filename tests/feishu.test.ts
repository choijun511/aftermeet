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
