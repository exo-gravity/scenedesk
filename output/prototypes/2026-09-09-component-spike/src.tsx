import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Group, MantineProvider, Modal, Select, Splitter, Stack, Text, TextInput, createTheme } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useLocalStorage, type UseSplitterReturnValue, type SplitterPaneSize } from '@mantine/hooks';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { move } from '@dnd-kit/helpers';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MediaController, MediaControlBar, MediaPlayButton, MediaTimeRange, MediaTimeDisplay, MediaMuteButton, MediaCaptionsButton } from 'media-chrome/react';
import '@mantine/core/styles.css';
import './style.css';

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
const theme = createTheme({ primaryColor: 'orange', defaultRadius: 'sm', fontFamily: 'system-ui, sans-serif', fontSizes: { sm: '13px', md: '14px' } });
function Shot({id, index}: {id: string; index: number}) {
  const {ref, handleRef} = useSortable({id, index});
  return <div ref={ref} className="shot" data-shot={id}><button ref={handleRef} aria-label={`移动 ${id}`}>⠿</button><span>{id} · 镜头素材</span></div>;
}
function Assets() {
  const ref = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({count: 1000, getScrollElement: () => ref.current, estimateSize: () => 36, overscan: 4});
  return <div ref={ref} className="asset-scroll" aria-label="虚拟素材列表"><div style={{height: virtual.getTotalSize(), position:'relative'}}>{virtual.getVirtualItems().map(row => <div data-asset={row.index} key={row.key} style={{position:'absolute',top:0,left:0,width:'100%',height:36,transform:`translateY(${row.start}px)`}}>素材 {row.index + 1}</div>)}</div></div>;
}
function Workbench() {
  const [shots, setShots] = useState(['SH01','SH02','SH03']);
  const [opened, setOpened] = useState(false);
  const [saved, setSaved] = useState('尚未保存');
  const [time, setTime] = useState(0);
  const [sizes, setSizes] = useLocalStorage<SplitterPaneSize[]>({key:'drama-component-spike-sizes',defaultValue:[25,50,25]});
  const splitterRef = useRef<UseSplitterReturnValue>(null);
  const form = useForm({initialValues:{name:'',model:'Seedance'},validate:{name:value=>value.trim() ? null : '请输入镜头名称'}});
  const query = useQuery({queryKey:['component-spike','status'],queryFn:async()=>({label:'本地模拟数据已读取'}),staleTime:60000});
  return <main>
    <h1>前端组件兼容性验证</h1>
    <p>隔离的技术样例；不代表产品页面迁移、真实生成或完整剪辑。</p>
    <Group mb="md"><Button onClick={()=>setOpened(true)}>编辑镜头</Button><Button variant="default" onClick={()=>splitterRef.current?.toggleCollapse(0)}>切换左侧面板</Button><Text size="sm">{query.data?.label}</Text></Group>
    <Splitter splitterRef={splitterRef} sizes={sizes} onSizeChange={setSizes} h={540}>
      <Splitter.Pane defaultSize={25} min={15} max={40} collapsible>
        <section><h2>镜头排序</h2><DragDropProvider onDragEnd={event=>{if(!event.canceled)setShots(items=>move(items,event));}}>{shots.map((id,index)=><Shot key={id} id={id} index={index}/>)}</DragDropProvider><output data-testid="order">{shots.join(',')}</output><h2>1000 条素材</h2><Assets/></section>
      </Splitter.Pane>
      <Splitter.Pane defaultSize={50} min={30}>
        <section><h2>原生媒体与播放控制</h2><MediaController>
          <video slot="media" src="/probe.mp4" preload="auto" muted playsInline onTimeUpdate={event=>setTime(event.currentTarget.currentTime)}><track kind="subtitles" src="/probe.vtt" srcLang="zh" label="中文" default/></video>
          <MediaControlBar><MediaPlayButton/><MediaTimeRange/><MediaTimeDisplay showDuration/><MediaMuteButton/><MediaCaptionsButton/></MediaControlBar>
        </MediaController><output data-testid="time">{time.toFixed(2)} 秒</output></section>
      </Splitter.Pane>
      <Splitter.Pane defaultSize={25} min={15}>
        <section><h2>选型集成范围</h2><p>Mantine 样式与弹窗</p><p>Splitter 折叠与尺寸记忆</p><p>dnd-kit 排序</p><p>Media Chrome 播放与字幕</p><p>Query 与 Virtual</p><output data-testid="saved">{saved}</output></section>
      </Splitter.Pane>
    </Splitter>
    <Modal opened={opened} onClose={()=>setOpened(false)} title="镜头参数" centered>
      <form onSubmit={form.onSubmit(values=>{setSaved(values.name+' / '+values.model);setOpened(false);})}><Stack><TextInput label="镜头名称" data-autofocus {...form.getInputProps('name')}/><Select label="模型" data={['Seedance','导入素材']} {...form.getInputProps('model')}/><Button type="submit">保存参数</Button></Stack></form>
    </Modal>
  </main>;
}
createRoot(document.getElementById('root')!).render(<MantineProvider theme={theme} defaultColorScheme="dark"><QueryClientProvider client={queryClient}><Workbench/></QueryClientProvider></MantineProvider>);
