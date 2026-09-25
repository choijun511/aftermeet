import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = await mkdtemp(join(tmpdir(), 'aftermeet-tests-'))
try {
 const outputs=[]
 for (const name of ['cloud', 'recovery', 'playback', 'settings', 'recovery-worker']) {
 const output = join(dir, `${name}.cjs`)
 if (name !== 'recovery-worker') outputs.push(output)
 await build({entryPoints:[name === 'recovery-worker' ? 'tests/recovery-worker.ts' : `tests/${name}.test.ts`],outfile:output,bundle:true,platform:'node',format:'cjs',plugins:[{
  name:'electron-network-test',setup(b){
   b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'test'}))
   b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const app={isPackaged:false,getPath:()=>process.env.AFTERMEET_TEST_DATA||process.cwd(),getAppPath:()=>process.cwd()};export const net={fetch:(...args)=>globalThis.fetch(...args)};'}))
  }
 }]})
 }
 const result=spawnSync(process.execPath,['--test',...outputs],{stdio:'inherit',env:{...process.env,AFTERMEET_TEST_WORKER:join(dir,'recovery-worker.cjs')}})
 process.exitCode=result.status??1
} finally {await rm(dir,{recursive:true,force:true})}
