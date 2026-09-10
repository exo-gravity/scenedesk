import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const commands = [ ['npm',['run','check']], ['npm',['audit','--json']], ['.venv/bin/python',['docs/implementation/check_design.py']] ];
const report = { checkedAt:new Date().toISOString(), node:process.version, npm:spawnSync('npm',['--version'],{encoding:'utf8'}).stdout.trim(), scope:'Local visual prototype and existing regression checks; no business acceptance or real provider calls', checks:[], fileHashes:{}, passed:false };
const reportPath = `output/engineering/${report.checkedAt.replace(/[:.]/g, '-')}-visual-checks.json`;
mkdirSync('output/engineering',{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
for (const [command,args] of commands) { const result=spawnSync(command,args,{encoding:'utf8',timeout:60000});report.checks.push({command:[command,...args].join(' '),exitCode:result.status,stdout:result.stdout,stderr:result.stderr,error:result.error?.message});console.log(`${result.status===0?'PASS':'FAIL'} ${command} ${args.join(' ')}`); if(result.status!==0){console.log(result.stderr||result.stdout);break;} }
for(const path of ['package-lock.json','apps/web/src/App.tsx','apps/web/src/model.ts','apps/web/src/components/ui.tsx','apps/web/src/pages/ScenePage.tsx','apps/web/src/pages/ContentPages.tsx','apps/web/src/pages/WorkspacePages.tsx','apps/web/src/style.css','apps/web/public/demo/old-key-storyboard.png'])report.fileHashes[path]=createHash('sha256').update(readFileSync(path)).digest('hex');
report.passed=report.checks.length===commands.length&&report.checks.every(c=>c.exitCode===0);
mkdirSync('output/engineering',{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(`Report: ${reportPath}`);if(!report.passed)process.exitCode=1;
