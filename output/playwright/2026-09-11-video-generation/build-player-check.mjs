import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../..');
await build({configFile:false,root:here,base:'/player-check/',plugins:[react()],build:{outDir:path.join(repo,'apps/web/dist/player-check'),emptyOutDir:true,rollupOptions:{input:path.join(here,'player-check.html')}}});
