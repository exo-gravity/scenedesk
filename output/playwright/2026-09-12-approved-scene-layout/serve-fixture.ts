/** Isolated visual fixture. Real restricted API/PG; local static files substitute for object storage, not media/provider acceptance. */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import type { TestContext } from 'node:test';
import type { MediaStore } from '@drama/media';
import { businessFixture } from '../../../tests/support/business.js';
import { buildApp } from '../../../apps/api/src/app.js';
const directory=resolve('output/playwright/2026-09-12-approved-scene-layout'), origin='http://127.0.0.1:4316';
const cleanup:(()=>Promise<unknown>)[]=[];
const mediaFiles=new Map<string,string>();
const store={verify:async()=>{},access:async(source:{key:string})=>{const file=mediaFiles.get(source.key);if(!file)throw Error('Unknown fixture file');return {url:origin+file,expiresAt:new Date(Date.now()+300000).toISOString()};}} as unknown as MediaStore;
const services={store,schedule:async()=>{throw Error('Visual fixture does not run media processing');}};
const f=await businessFixture({after:(fn:()=>Promise<unknown>)=>cleanup.push(fn)} as unknown as TestContext,async()=>({media:services}));
async function media(kind:'image'|'video',name:string,file:string,width:number,height:number) {
 const id=randomUUID(),upload=randomUUID(),poster=randomUUID(),sha='a'.repeat(64),mime=kind==='video'?'video/mp4':'image/png';
 await f.admin.query(`INSERT INTO ${f.schema}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch) VALUES($1,$2,$3,'project',$4,64,$5,'fixture',$6,$7,$8,'accepted',now()+interval '15 minutes','fixture-version',1)`,[upload,f.tenant.id,f.project.id,`staging/${upload}`,sha,mime,name,f.owner.userId]);
 await f.admin.query(`INSERT INTO ${f.schema}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio,duration_us,fps_num,fps_den) VALUES($1,$2,$3,'project',$4,'ready',$5,'fixture',$6,$7,$8,'fixture-version',$9,64,$10,$11,$12,$13,$14,$15,$16)`,[id,f.tenant.id,f.project.id,kind,name,f.owner.userId,upload,`originals/${id}`,sha,mime,width,height,kind==='video',kind==='video'?4000000:null,kind==='video'?24:null,kind==='video'?1:null]);
 await f.admin.query(`INSERT INTO ${f.schema}.media_derivatives(id,tenant_id,media_id,kind,profile_revision,status,immutable_key,storage_version_id,sha256,bytes,mime,width,height,epoch) VALUES($1,$2,$3,'poster',1,'ready',$4,'fixture-version',$5,64,'image/png',$6,$7,1)`,[poster,f.tenant.id,id,`derivatives/${poster}`,sha,width,height]);
 mediaFiles.set(`originals/${id}`,file);mediaFiles.set(`derivatives/${poster}`,kind==='video'?'/demo/workspace-v2/key-candidate-c.png':file);
 return id;
}
const reference=await media('image','旧铜钥匙 · 固定道具参考','/demo/workspace-v2/key-reference.png',1024,1024);
const frame=await media('image','手部动作 · 视觉夹具','/demo/workspace-v2/key-candidate-c.png',768,1344);
const video=await media('video','4 秒本地技术片 · 非 AI 生成','/demo/technical-preview.mp4',360,640);
const ep=await f.ok('POST',`${f.path}/episodes`,{title:'第 1 集 · 重逢',position:0,status:'active'},await f.next());
const cases=[];
for(const [j,title] of ['咖啡厅 · 日','未创建画布的场次'].entries()) {
 const scene=await f.ok('POST',`${f.path}/scenes`,{episodeId:ep.id,title,position:j,status:'active',summary:'本地布局与恢复技术验收',state:{}},await f.next());
 const shots=[];
 for(const [i,intent] of ['咖啡厅的午后','林夏推门走入','她停在桌边','手指接触旧铜钥匙','抬头望向门外','未建立候选的镜头'].entries()) {
  const shot=await f.ok('POST',`${f.path}/shots`,{sceneId:scene.id,label:`SH-${String(i+1).padStart(2,'0')}`,position:i,status:'active',spec:{intent,references:i===3?[{mediaId:reference,purpose:'prop',note:'固定道具参考，保留钥匙形状'}]:[]}},await f.next());
  if(i<5) {const take=await f.ok('POST',`${f.path}/takes`,{shotId:shot.id,shotRevisionId:shot.specRevisionId,mediaId:video,range:{inUs:0,outUs:4000000},note:'本地视觉验证候选'});await f.ok('PUT',`${f.path}/shots/${shot.id}/selection`,{takeId:take.id,reason:'视觉夹具采用状态'},shot.revision);if(i===3)await f.ok('POST',`${f.path}/takes`,{shotId:shot.id,shotRevisionId:shot.specRevisionId,mediaId:video,range:{inUs:500000,outUs:3500000},note:'第二个独立候选'});}
  shots.push(shot);
 }
 let canvasId:string|undefined,draftId:string|undefined;
 if(j===0){const ensured=await f.request('POST',`${f.path}/scenes/${scene.id}/canvas`);if(ensured.statusCode!==200)throw Error(ensured.body);const canvas=ensured.json().canvas;canvasId=canvas.id;draftId=randomUUID();
 const nodes=[{id:randomUUID(),kind:'image',title:'旧铜钥匙 · 参考',position:{x:60,y:55},width:165,content:{type:'media',mediaId:reference}},{id:randomUUID(),kind:'text',title:'本次动作要求',position:{x:285,y:75},width:215,content:{type:'text',text:'右手轻轻靠近匙环，指尖接触后自然收拢。\n保留光线、节奏与原有物件。'}},{id:draftId,kind:'video',title:'动作优化 · 创作草稿',position:{x:535,y:110},width:200,content:{type:'draft',prompt:'手指与钥匙的接触更自然，保留原来的节奏。',output:{}}},{id:randomUUID(),kind:'image',title:'手部动作 · 候选参考',position:{x:810,y:35},width:174,content:{type:'media',mediaId:frame}}];
 const edges=[{id:randomUUID(),sourceNodeId:nodes[0]!.id,targetNodeId:draftId,enabled:true,position:0,purpose:'prop'},{id:randomUUID(),sourceNodeId:nodes[1]!.id,targetNodeId:draftId,enabled:true,position:1,purpose:'prompt'}];await f.ok('PUT',`${f.path}/canvases/${canvas.id}`,{schemaVersion:1,document:{nodes,edges,groups:[]}},canvas.revision);}
 const prefPath=`${f.path}/scenes/${scene.id}/workspace-preference`,pref=await f.ok('GET',prefPath);const {sceneId:_s,revision:_r,...body}=pref;await f.ok('PUT',prefPath,{...body,mode:'storyboard',selectedShotId:shots[3]!.id,assistantOpen:false,assetPanelOpen:false,viewport:{x:60,y:30,zoom:1}},pref.revision);
 cases.push({sceneId:scene.id,canvasId,draftId,shots:shots.map(s=>({id:s.id,label:s.label})),url:`${origin}/#/app/t/${f.tenant.id}/p/${f.project.id}/production?scene=${scene.id}&shot=${shots[3]!.id}&mode=storyboard`});
}
const app=buildApp(f.runtime,{schema:f.schema,origin,secret:randomBytes(32).toString('base64url'),localIdentity:true,media:services});
const requests:{method:string;url:string;status:number}[]=[];app.addHook('onResponse',async(req,reply)=>{if(req.url.startsWith('/v1/'))requests.push({method:req.method,url:req.url,status:reply.statusCode});});
app.get('/__layout_fixture/login',async(_req,reply)=>reply.header('set-cookie',`session=${f.owner.token}; HttpOnly; SameSite=Strict; Path=/`).redirect(cases[0]!.url));
const dist=resolve('apps/web/dist');app.get('/*',async(req,reply)=>{if(req.url.startsWith('/v1/'))return reply.code(404).send({code:'NOT_FOUND',message:'Not found',requestId:'layout-fixture'});const pathname=decodeURIComponent(req.url.split('?')[0]!);let file=resolve(dist,`.${pathname}`);if(!file.startsWith(`${dist}/`)&&file!==dist)return reply.code(404).send();if(!(await stat(file).catch(()=>undefined))?.isFile())file=resolve(dist,'index.html');const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.mp4':'video/mp4'};return reply.type(mime[extname(file)]??'application/octet-stream').send(await readFile(file));});
await app.listen({host:'127.0.0.1',port:4316});await writeFile(resolve(directory,'fixture.json'),JSON.stringify({schema:f.schema,tenantId:f.tenant.id,projectId:f.project.id,path:f.path,cases},null,2));console.log('LAYOUT_FIXTURE_READY http://127.0.0.1:4316/__layout_fixture/login');
let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();await writeFile(resolve(directory,'requests.json'),JSON.stringify(requests,null,2));for(const fn of cleanup.reverse())await fn();console.log('LAYOUT_FIXTURE_CLEANED');process.exit(0);};process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
