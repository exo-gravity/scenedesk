import {useState} from "react";
import {createRoot} from "react-dom/client";
import {MantineProvider, Button, Stack, Text} from "@mantine/core";
import "@mantine/core/styles.layer.css";
import "../../../apps/web/src/theme/global.css";
import {theme, cssVariablesResolver} from "../../../apps/web/src/theme/theme";
import MediaPlayer from "../../../apps/web/src/components/workspace/MediaPlayer";
function Check() {
  const [mounted,setMounted]=useState(true), [errors,setErrors]=useState(0);
  return <MantineProvider theme={theme, cssVariablesResolver}><Stack maw={960} mx="auto" p="md"><Text>受控测试：视频与音频两个实际 MediaPlayer 实例，不是模型输出。</Text><Text aria-label="播放器错误数">{errors}</Text><Button onClick={()=>setMounted(value=>!value)}>切换播放器挂载</Button>{mounted && ["A","B"].map(id=><MediaPlayer key={id} src={id === "A" ? "/__controlled__/video.mp4" : "/__controlled__/audio.wav"} title={`受控播放器 ${id}`} audio={id === "B"} onError={()=>setErrors(value=>value+1)} onTime={()=>{}} />)}</Stack></MantineProvider>;
}
createRoot(document.getElementById("root")!).render(<Check />);
