/** Isolated local verification server. Never loaded by the application runtime. */
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import type { TestContext } from "node:test";
import { businessFixture } from "../../../tests/support/business.js";
import { buildApp } from "../../../apps/api/src/app.js";
import { migrate } from "@drama/database";
const directory = resolve("output/playwright/2026-09-12-canvas-complete-fit/translation");
const cleanup: (() => Promise<unknown>)[] = [];
const t = { after: (fn: () => Promise<unknown>) => cleanup.push(fn) } as unknown as TestContext;
const f = await businessFixture(t);
const repeated = await migrate(f.admin, new URL("../../../packages/database/migrations/", import.meta.url), f.schema);
const ep = await f.ok("POST", `${f.path}/episodes`, {title:"屏幕变换技术验证",position:0,status:"active"},await f.next());
const cases=[];
for(const [index,count] of [2].entries()) {
  const scene=await f.ok("POST",`${f.path}/scenes`,{episodeId:ep.id,title:count===2?"合法远距双节点":"2000 节点全览",position:index,status:"active",summary:"隔离本地全览验收；没有媒体或模型执行",state:{}},await f.next());
  const ensured=await f.request("POST",`${f.path}/scenes/${scene.id}/canvas`);if(ensured.statusCode!==200)throw Error("ensure failed");const canvas=ensured.json().canvas;
  const groups=count===2000?Array.from({length:200},(_,i)=>({id:randomUUID(),title:`组 ${i+1}`})):[];
  const nodes=Array.from({length:count},(_,i)=>({id:randomUUID(),title:count===2?(i?"右下合法边界":"左上合法边界"):`节点 ${String(i+1).padStart(4,"0")}`,kind:i%2?"image":"text",width:320,position:count===2?{x:i?1000000:-1000000,y:i?1000000:-1000000}:{x:(i%20)*380,y:Math.floor(i/20)*280},...(groups.length?{groupId:groups[Math.floor(i/10)]!.id}:{}),content:i%2?{type:"draft",prompt:"原文与位置保持；仅验证视口",output:{}}:{type:"text",text:"本地技术验证的画布原文；全览不改变内容。"}}));
  const edges=count===2000?Array.from({length:5000},(_,i)=>({id:randomUUID(),sourceNodeId:nodes[2*((i+Math.floor(i/1000)*17)%1000)]!.id,targetNodeId:nodes[2*(i%1000)+1]!.id,enabled:true,position:i,purpose:"prompt"})):[];
  const saved=await f.ok("PUT",`${f.path}/canvases/${canvas.id}`,{schemaVersion:1,document:{nodes,edges,groups}},canvas.revision);
  const prefPath=`${f.path}/scenes/${scene.id}/workspace-preference`;
  const pref=await f.ok("GET",prefPath);const {sceneId:_s,revision:_r,...body}=pref;
  await f.ok("PUT",prefPath,{...body,mode:"canvas",viewport:{x:0,y:0,zoom:1}},pref.revision);
  cases.push({count,sceneId:scene.id,canvasId:canvas.id,documentHash:saved.documentHash,revision:saved.revision,nodes:nodes.map(({id,title,position,width})=>({id,title,position,width})),url:`http://127.0.0.1:4316/#/app/t/${f.tenant.id}/p/${f.project.id}/production?scene=${scene.id}&mode=canvas`});
}
const app=buildApp(f.runtime,{schema:f.schema,origin:"http://127.0.0.1:4316",secret:randomBytes(32).toString("base64url"),localIdentity:true});
const requests:{method:string;url:string;status:number;body?:unknown}[]=[];
app.addHook("onResponse",async(req,reply)=>{if(req.url.startsWith("/v1/"))requests.push({method:req.method,url:req.url,status:reply.statusCode,...(req.method==="PUT"?{body:req.body}:{})})});
app.get("/__fit_fixture/login",async(_req,reply)=>reply.header("set-cookie",`session=${f.owner.token}; HttpOnly; SameSite=Strict; Path=/`).redirect(cases[0]!.url));
const dist=resolve("apps/web/dist");
app.get("/*",async(req,reply)=>{
  if(req.url.startsWith("/v1/"))return reply.code(404).send({code:"NOT_FOUND",message:"Not found",requestId:"fit-fixture"});
  const pathname=decodeURIComponent(req.url.split("?")[0]!);let file=resolve(dist,`.${pathname}`);
  if(!file.startsWith(`${dist}/`)&&file!==dist)return reply.code(404).send();
  if(!(await stat(file).catch(()=>undefined))?.isFile())file=resolve(dist,"index.html");
  const mime:Record<string,string>={".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".woff2":"font/woff2"};
  return reply.type(mime[extname(file)]??"application/octet-stream").send(await readFile(file));
});
await app.listen({host:"127.0.0.1",port:4316});
await writeFile(resolve(directory,"fixture.json"),JSON.stringify({schema:f.schema,projectId:f.project.id,tenantId:f.tenant.id,path:f.path,repeatMigration:repeated,cases},null,2));
console.log("FIT_FIXTURE_READY: http://127.0.0.1:4316/__fit_fixture/login");
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;await app.close();await writeFile(resolve(directory,"requests.json"),JSON.stringify(requests,null,2));for(const fn of cleanup.reverse())await fn();console.log("FIT_FIXTURE_CLEANED");process.exit(0)};
process.on("SIGTERM",()=>void stop());process.on("SIGINT",()=>void stop());
