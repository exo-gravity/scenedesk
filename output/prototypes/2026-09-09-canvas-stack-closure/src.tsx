import { StrictMode, memo, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Group, MantineProvider, Select, Textarea, TextInput, createTheme } from '@mantine/core';
import { ReactFlow, Background, Controls, Handle, Position, addEdge, useNodesState, useEdgesState, type Node, type NodeProps, type Connection } from '@xyflow/react';
import { MediaController, MediaControlBar, MediaPlayButton, MediaTimeRange, MediaTimeDisplay, MediaMuteButton, MediaCaptionsButton } from 'media-chrome/react';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { move } from '@dnd-kit/helpers';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import '@mantine/core/styles.css';
import '@xyflow/react/dist/style.css';
import './style.css';

type ContentNode = Node<{ label: string; kind: 'text' | 'media'; prompt: string; model: string; onEdit?: (id: string, key: string, value: string) => void }, 'content'>;
const theme = createTheme({primaryColor:'orange', defaultRadius:'sm', fontFamily:'system-ui, sans-serif',fontSizes:{sm:'13px',md:'14px'}});
const queryClient = new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false},mutations:{retry:false}}});
let serverRevision=1;
let attemptedMutation=0;

const NodeShell=memo(function NodeShell({id,data,selected}:NodeProps<ContentNode>){
  return <article className={`node-shell ${selected?'selected':''}`} data-node={id}>
    <Handle type="target" position={Position.Left} id="in"/>
    <div className="node-title" data-testid={`drag-${id}`}>{data.label}<span>{id}</span></div>
    <div className="node-body nodrag nopan nowheel" onKeyDown={event=>event.stopPropagation()}>
      {data.kind==='media'?<MediaController key={id} noHotkeys>
        <video slot="media" src="/probe.mp4" preload="metadata" muted playsInline>
          <track kind="subtitles" src="/probe.vtt" srcLang="zh" label="中文" default/>
        </video>
        <MediaControlBar><MediaPlayButton/><MediaTimeRange/><MediaTimeDisplay showDuration/><MediaMuteButton/><MediaCaptionsButton/></MediaControlBar>
      </MediaController>:<Textarea label={`${id} 创作输入`} value={data.prompt} onChange={event=>data.onEdit?.(id,'prompt',event.currentTarget.value)} minRows={4}/>} 
      <Select label={`${id} 模型`} value={data.model} data={['Seedance','导入素材']} onChange={value=>value&&data.onEdit?.(id,'model',value)} comboboxProps={{withinPortal:true}}/>
    </div><Handle type="source" position={Position.Right} id="out"/>
  </article>;
});
const nodeTypes={content:NodeShell};
const initialNodes: ContentNode[]=[
  {id:'REF',type:'content',position:{x:30,y:20},dragHandle:'.node-title',data:{label:'整场共用参考',kind:'text',prompt:'咖啡厅，日内，窗边冷光。',model:'Seedance'}},
  {id:'SH01',type:'content',position:{x:440,y:20},dragHandle:'.node-title',data:{label:'SH01 · 场景建立',kind:'media',prompt:'',model:'Seedance'}},
  {id:'SH02',type:'content',position:{x:440,y:350},dragHandle:'.node-title',data:{label:'SH02 · 反应镜头草稿',kind:'text',prompt:'听到钥匙声，人物停顿。',model:'Seedance'}}
];
function Shot({id,index}:{id:string;index:number}){
  const {ref,handleRef}=useSortable({id,index});
  return <div ref={ref} className="shot" data-shot={id}><button ref={handleRef} aria-label={`移动 ${id}`}>⠿</button><span>{id}</span></div>;
}
function AssetList(){
  const ref=useRef<HTMLDivElement>(null);
  const virtual=useVirtualizer({count:10000,getScrollElement:()=>ref.current,estimateSize:()=>34,overscan:5});
  return <div ref={ref} className="asset-scroll" data-testid="assets" aria-label="10000 条素材"><div style={{height:virtual.getTotalSize(),position:'relative'}}>{virtual.getVirtualItems().map(row=><div data-asset={row.index} key={row.key} style={{position:'absolute',width:'100%',height:34,transform:`translateY(${row.start}px)`}}>素材 {row.index+1}</div>)}</div></div>;
}
function Workbench(){
  const [nodes,setNodes,onNodesChange]=useNodesState<ContentNode>(initialNodes);
  const [edges,setEdges,onEdgesChange]=useEdgesState([{id:'reference-1',source:'REF',target:'SH01',sourceHandle:'out',targetHandle:'in'}]);
  const [mode,setMode]=useState('canvas');
  const [shots,setShots]=useState(['SH01','SH02','SH03']);
  const [dirty,setDirty]=useState('本地未提交草稿');
  const [saved,setSaved]=useState('尚未保存');
  const edit=useCallback((id:string,key:string,value:string)=>setNodes(all=>all.map(n=>n.id===id?{...n,data:{...n.data,[key]:value}}:n)),[setNodes]);
  const onConnect=useCallback((connection:Connection)=>setEdges(all=>addEdge(connection,all)),[setEdges]);
  const query=useQuery({queryKey:['probe','tenant-local','project-local','scene'],queryFn:async()=>({revision:serverRevision})});
  const mutation=useMutation({mutationFn:async()=>{attemptedMutation++;throw new Error('模拟写入失败；未调用任何模型');}});
  const save=()=>{localStorage.setItem('drama-canvas-stack-probe',JSON.stringify({nodes,edges}));setSaved('已保存布局与输入');};
  const restore=()=>{const raw=localStorage.getItem('drama-canvas-stack-probe');if(raw){const value=JSON.parse(raw);setNodes(value.nodes);setEdges(value.edges);setSaved('已恢复布局与输入');}};
  return <main>
    <h1>场次双模式 · 专业组件集成验证</h1>
    <p>仅验证组件边界；模拟数据与本地存储，无生成、采用、审阅或服务端保存。</p>
    <Group mb="md"><Button variant={mode==='canvas'?'filled':'default'} onClick={()=>setMode('canvas')}>自由画布</Button><Button variant={mode==='board'?'filled':'default'} onClick={()=>setMode('board')}>分镜模式</Button><Button variant="default" onClick={save}>保存本地布局</Button><Button variant="default" onClick={restore}>恢复本地布局</Button><output>{saved}</output></Group>
    {mode==='canvas'?<div className="canvas"><ReactFlow nodes={nodes.map(n=>({...n,data:{...n.data,onEdit:edit}}))} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes} defaultViewport={{x:20,y:10,zoom:0.8}} minZoom={0.25} maxZoom={1.5} colorMode="dark" panOnScroll zoomOnScroll={false} selectionOnDrag panOnDrag={[1,2]} deleteKeyCode={['Backspace','Delete']}><Background/><Controls/></ReactFlow></div>:<section className="board"><h2>同一场次的镜头顺序</h2><p>模式切换保留画布位置、输入和连线；此处不改动镜头事实。</p>{shots.map(id=><div className="board-shot" key={id}>{id}</div>)}</section>}
    <details><summary>组件状态（供验证）</summary><pre data-testid="canvas-state">{JSON.stringify({nodes:nodes.map(n=>({id:n.id,position:n.position,prompt:n.data.prompt,model:n.data.model})),edges:edges.map(e=>({source:e.source,target:e.target}))})}</pre></details>
    <section className="lower-grid">
      <div><h2>分镜排序</h2><DragDropProvider onDragEnd={event=>{if(!event.canceled)setShots(items=>move(items,event));}}>{shots.map((id,index)=><Shot key={id} id={id} index={index}/>)}</DragDropProvider><output data-testid="order">{shots.join(',')}</output></div>
      <div><h2>服务端状态与草稿分离</h2><TextInput label="独立本地草稿" value={dirty} onChange={event=>setDirty(event.currentTarget.value)}/><p data-testid="revision">服务端模拟 revision {query.data?.revision}</p><Button size="xs" onClick={()=>{serverRevision++;void queryClient.invalidateQueries({queryKey:['probe']});}}>模拟服务端更新</Button><Button size="xs" variant="default" onClick={()=>mutation.mutate()}>模拟失败写入</Button><output data-testid="attempts">{mutation.isError?`写入尝试 ${attemptedMutation} 次；未自动重试`:'尚未写入'}</output></div>
      <div><h2>10,000 条虚拟素材</h2><AssetList/></div>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><MantineProvider theme={theme} defaultColorScheme="dark"><QueryClientProvider client={queryClient}><Workbench/></QueryClientProvider></MantineProvider></StrictMode>);
