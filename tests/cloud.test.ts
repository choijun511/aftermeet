import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openaiText, strictSchema } from '../src/main/openai'
import { qwenBase, transcribeQwenPcm } from '../src/main/qwen'
const originalFetch = globalThis.fetch
const originalEnv = {...process.env}
afterEach(()=>{ globalThis.fetch=originalFetch; process.env={...originalEnv} })
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status})
test('strict schema requires nested properties and rejects additional keys',()=>{
 const s:any=strictSchema({type:'object',properties:{todos:{type:'array',items:{type:'object',properties:{owner:{type:'string'}}}}}})
 assert.equal(s.additionalProperties,false)
 assert.deepEqual(s.properties.todos.items.required,['owner'])
 assert.equal(s.properties.todos.items.additionalProperties,false)
})
test('OpenAI standard and deep routing preserve input, use strict schema and store:false',async()=>{
 process.env.OPENAI_API_KEY='test-key'
 const seen:any[]=[]
 globalThis.fetch=async(_url,init)=>{seen.push(JSON.parse(String(init?.body)));return json({status:'completed',output:[{content:[{type:'output_text',text:'OK'}]}]})}
 const input='BEGIN '+ '长会议'.repeat(25000)+' END'
 await openaiText('system',input)
 await openaiText('system',input,{mode:'deep'})
 assert.equal(seen[0].model,'gpt-5.6-luna'); assert.equal(seen[1].model,'gpt-5.6-sol')
 assert.equal(seen[0].store,false);assert.equal(seen[0].input,input)
 assert.equal(seen[1].reasoning.effort,'medium')
})
test('OpenAI incomplete response never becomes saved notes',async()=>{
 process.env.OPENAI_API_KEY='test-key'
 globalThis.fetch=async()=>json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]})
 await assert.rejects(openaiText('system','text'),/未完成/)
})
test('Qwen validates configured region before sending credentials',()=>{
 process.env.DASHSCOPE_REGION='https://example.com'
 assert.throws(()=>qwenBase(),/地域/)
})
test('Qwen chunks long audio, keeps speaker IDs separate and offsets timestamps',async()=>{
 process.env.DASHSCOPE_API_KEY='test-key';process.env.DASHSCOPE_REGION='ap-southeast-1';process.env.DASHSCOPE_WORKSPACE_ID='test-workspace'
 const dir=await mkdtemp(join(tmpdir(),'aftermeet-pcm-'));const file=join(dir,'sample.pcm')
 await writeFile(file,Buffer.alloc(32000 * (20 * 60 + 1)))
 const calls:string[]=[]
 globalThis.fetch=async(url,init)=>{
  const address=String(url);calls.push(address)
  if(address.includes('/uploads?'))return json({data:{upload_host:'https://sample.oss-ap-southeast-1.aliyuncs.com',upload_dir:'private',oss_access_key_id:'temporary',signature:'signature',policy:'policy',x_oss_object_acl:'private',x_oss_forbid_overwrite:'true'}})
  if(address.endsWith('.aliyuncs.com')){assert.equal(init?.headers,undefined);assert(init?.body instanceof FormData);return new Response('ok')}
  if(address.endsWith('/transcription')){const body=JSON.parse(String(init?.body));assert.equal(body.parameters.diarization_enabled,true);assert.match(body.input.file_urls[0],/^oss:\/\//);return json({output:{task_id:'test-task'}})}
  if(address.includes('/tasks/'))return json({output:{task_status:'SUCCEEDED',results:[{subtask_status:'SUCCEEDED',transcription_url:'https://sample.oss-ap-southeast-1.aliyuncs.com/result'}]}})
  assert.equal(init?.headers,undefined)
  return json({transcripts:[{sentences:[{text:'项目周五上线。',speaker_id:1,begin_time:0,end_time:1000}]}]})
 }
 try{const r=await transcribeQwenPcm(file);assert.match(r.text,/分段1-说话人2/);assert.match(r.text,/分段2-说话人2/);assert.equal(r.sentences[0].endMs,1000);assert.equal(r.sentences[1].startMs,1200000);assert.equal(calls.length,10)}finally{await rm(dir,{recursive:true})}
})

test('Qwen empty first chunk recovers locally and continues later chunks without shifting timestamps',async()=>{
 process.env.DASHSCOPE_API_KEY='test-key';process.env.DASHSCOPE_REGION='ap-southeast-1'
 const dir=await mkdtemp(join(tmpdir(),'aftermeet-recover-'));const file=join(dir,'sample.pcm')
 await writeFile(file,Buffer.alloc(32000*(20*60+1)))
 let tasks=0;let recovered=0
 globalThis.fetch=async(url)=>{
  const address=String(url)
  if(address.includes('/uploads?'))return json({data:{upload_host:'https://sample.aliyuncs.com',upload_dir:'private'}})
  if(address==='https://sample.aliyuncs.com')return new Response('ok')
  if(address.endsWith('/transcription'))return json({output:{task_id:String(++tasks)}})
  if(address.endsWith('/tasks/1'))return json({output:{task_status:'FAILED',code:'ASR_RESPONSE_HAVE_NO_WORDS'}})
  if(address.endsWith('/tasks/2'))return json({output:{task_status:'SUCCEEDED',results:[{subtask_status:'SUCCEEDED',transcription_url:'https://sample.aliyuncs.com/result'}]}})
  return json({transcripts:[{sentences:[{text:'后续会议内容',begin_time:500,end_time:1000}]}]})
 }
 try {
  const r=await transcribeQwenPcm(file,()=>{},async(pcm,index)=>{recovered++;assert.equal(index,0);assert.equal(pcm.length,32000*1200);return '首段本地恢复内容'})
  assert.equal(tasks,2);assert.equal(recovered,1);assert.match(r.text,/首段本地恢复内容/);assert.match(r.text,/后续会议内容/)
  assert.equal(r.sentences[0].startMs,1200500);assert.equal(r.warnings.length,1);assert.match(r.model,/whisper/)
 }finally{await rm(dir,{recursive:true})}
})

test('Qwen and local empty results never silently drop a chunk',async()=>{
 process.env.DASHSCOPE_API_KEY='test-key';process.env.DASHSCOPE_REGION='ap-southeast-1'
 const dir=await mkdtemp(join(tmpdir(),'aftermeet-empty-'));const file=join(dir,'sample.pcm');await writeFile(file,Buffer.alloc(32000))
 globalThis.fetch=async(url)=>{
  const address=String(url)
  if(address.includes('/uploads?'))return json({data:{upload_host:'https://sample.aliyuncs.com',upload_dir:'private'}})
  if(address==='https://sample.aliyuncs.com')return new Response('ok')
  if(address.endsWith('/transcription'))return json({output:{task_id:'empty'}})
  return json({output:{task_status:'FAILED',message:'ASR_RESPONSE_HAVE_NO_WORDS'}})
 }
 try {await assert.rejects(transcribeQwenPcm(file,()=>{},async()=>''),/不能确认是否静音/)}finally{await rm(dir,{recursive:true})}
})


test('live correction retains original when local result is empty or materially shorter',async()=>{
 const {chooseLiveCorrection,cleanStreamText}=await import('../src/main/streaming')
 assert.equal(chooseLiveCorrection('确认需求，完成测试，周五发布。','周五发布。'),'确认需求，完成测试，周五发布。')
 assert.equal(chooseLiveCorrection('看看数据，人人都能使用。',''), '看看数据，人人都能使用。')
 assert.equal(chooseLiveCorrection('今天今天决定周五周五发布测试版本','今天决定周五发布测试版本'),'今天决定周五发布测试版本')
 assert.equal(cleanStreamText('看看数据，人人都能使用，金额 10000。'),'看看数据，人人都能使用，金额 10000。')
})

test('audio health expires old positive meters rather than reporting stale sound',async()=>{
 const {AudioCapture}=await import('../src/main/audio')
 const c:any=new AudioCapture({onData:()=>{},onError:()=>{}})
 c.healthValue={system:{rms:0.5,receiving:true},microphone:{rms:0.1,receiving:true},micIncluded:false}
 c.healthAt=Date.now()-5000
 c.lastSound=Date.now()-35000
 assert.equal(c.health.system.receiving,false)
 assert.equal(c.health.system.rms,0)
 assert(c.health.silenceSeconds>=35)
 c.healthAt=Date.now()
 assert.equal(c.health.system.receiving,true)
})
