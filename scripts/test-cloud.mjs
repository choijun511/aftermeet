import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = await mkdtemp(join(tmpdir(), 'aftermeet-tests-'))
try {
 const output = join(dir, 'tests.cjs')
 await build({entryPoints:['tests/cloud.test.ts'],outfile:output,bundle:true,platform:'node',format:'cjs',plugins:[{
  name:'electron-network-test',setup(b){
   b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'test'}))
   b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const app={isPackaged:false,getPath:()=>process.cwd(),getAppPath:()=>process.cwd()};export const net={fetch:(...args)=>globalThis.fetch(...args)};'}))
  }
 }]})
 const result=spawnSync(process.execPath,['--test',output],{stdio:'inherit'})
 process.exitCode=result.status??1
} finally {await rm(dir,{recursive:true,force:true})}
