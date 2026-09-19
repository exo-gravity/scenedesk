export type Page =
  | "scene"
  | "projects"
  | "overview"
  | "script"
  | "assets"
  | "delivery"
  | "work"
  | "settings"
  | "design"
  | "layouts"
  | "directions"
  | "journey"
  /** 剧本页重构 A 的效果对照稿（设计预览）。 */
  | "script-layout";
export type SceneView = "production" | "edit" | "review";
export type Shot = {
  id: number;
  label: string;
  title: string;
  intent: string;
  dialogue: string;
  camera: string;
  seconds: number;
  frame: number;
  selected: string;
  candidates: string[];
  prompt: string;
  entry: string;
  exit: string;
};
export type Clip = {
  shotId: number;
  label: string;
  take: string;
  seconds: number;
  frame: number;
  dialogue: string;
};
export type Comment = {
  id: string;
  text: string;
  time: number;
  author: string;
  resolved: boolean;
};
export type Revision = {
  number: number;
  clips: Clip[];
  status: "待审阅" | "需修改" | "已确认";
  comments: Comment[];
};
export type DemoState = {
  shots: Shot[];
  clips: Clip[];
  revisions: Revision[];
  script: string;
  scriptDraft: string;
  subtitleEnabled: boolean;
  audioMuted: boolean;
  completedTasks: string[];
  localProjects: string[];
  importedAssets: number[];
};
export const initialScript = `第 1 集 · 重逢\n\n01  咖啡厅 / 日 / 内\n\n雨刚停。窗外的光落在桌面上。林夏与周远相对而坐，两杯咖啡已经凉了。\n\n周远从口袋里取出一把旧钥匙，放在两人之间。\n\n林夏（看着钥匙）\n这把钥匙，怎么会在你这里？\n\n周远避开她的目光，手指停在杯沿。\n\n周远\n他让我交给你。他说，你会知道。\n\n林夏伸出右手，拿起钥匙。她看清钥匙上的磨痕，神情微微一变。\n\n林夏（轻声）\n原来，他一直留着。\n\n周远没有接话。窗外有人走过。林夏握紧钥匙，两人陷入短暂的沉默。`;
const inputs = [
  [
    "相对而坐",
    "双人中景，建立人物与桌面的空间关系",
    "",
    "中景 · 固定",
    6,
    "钥匙在周远口袋",
    "钥匙放到桌面中央",
  ],
  [
    "迟来的追问",
    "林夏看向周远，追问钥匙的来历",
    "这把钥匙，怎么会在你这里？",
    "近景 · 缓推",
    8,
    "林夏视线落在钥匙",
    "抬眼看向周远",
  ],
  [
    "欲言又止",
    "周远避开目光，停顿后回答",
    "他让我交给你。他说，你会知道。",
    "近景 · 固定",
    7,
    "周远看向林夏",
    "目光下垂，手停在杯沿",
  ],
  [
    "拿起旧钥匙",
    "林夏右手拿起钥匙，完成道具状态转移",
    "",
    "特写 · 固定",
    9,
    "钥匙在桌面中央",
    "钥匙握在林夏右手",
  ],
  [
    "被唤起的记忆",
    "林夏看清磨痕，压住情绪，低声说话",
    "原来，他一直留着。",
    "特写 · 缓推",
    8,
    "钥匙已在林夏手中",
    "握住钥匙，视线转向窗外",
  ],
  [
    "无声的回答",
    "双人反应镜头，保留片尾停顿",
    "",
    "中景 · 固定",
    8,
    "两人沉默",
    "林夏握紧钥匙，周远未回应",
  ],
] as const;
export const initialShots: Shot[] = inputs.map((r, i) => ({
  id: i + 1,
  label: `SH-0${i + 1}`,
  title: r[0],
  intent: r[1],
  dialogue: r[2],
  camera: r[3],
  seconds: r[4],
  frame: i,
  selected: "A",
  candidates: i === 3 ? ["A", "B", "C"] : ["A", "B"],
  prompt: `保持林夏灰风衣、周远深色夹克与咖啡厅日景参考。${r[1]}。真实自然的表演，克制的电影光线，保持人物位置与动作连续。`,
  entry: r[5],
  exit: r[6],
}));
export const clipFromShot = (s: Shot): Clip => ({
  shotId: s.id,
  label: s.label,
  take: s.selected,
  seconds: s.seconds,
  frame: s.frame,
  dialogue: s.dialogue,
});
export const makeInitialState = (): DemoState => ({
  shots: structuredClone(initialShots),
  clips: initialShots.map(clipFromShot),
  revisions: [
    {
      number: 1,
      clips: initialShots.map(clipFromShot),
      status: "需修改",
      comments: [
        {
          id: "c1",
          text: "拿钥匙的接触点再自然一些，保留人物、衣服和当前节奏。",
          time: 24,
          author: "陈舟",
          resolved: false,
        },
        {
          id: "c2",
          text: "这一镜的停顿和眼神很好，后面的版本保留。",
          time: 15,
          author: "陈舟",
          resolved: true,
        },
      ],
    },
  ],
  script: initialScript,
  scriptDraft: initialScript,
  subtitleEnabled: true,
  audioMuted: false,
  completedTasks: [],
  localProjects: [],
  importedAssets: [],
});
const STORAGE_KEY = "pianchang-visual-prototype-v1";
export function loadDemo(): DemoState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (
      saved &&
      Array.isArray(saved.shots) &&
      saved.shots.length &&
      Array.isArray(saved.clips) &&
      saved.clips.length &&
      Array.isArray(saved.revisions) &&
      typeof saved.scriptDraft === "string"
    )
      return { ...makeInitialState(), ...saved };
  } catch {
    /* Private browsing or invalid local preview state: use the example. */
  }
  return makeInitialState();
}
export function saveDemo(state: DemoState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
export const timecode = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const assets = [
  {
    id: 1,
    name: "林夏",
    kind: "角色",
    note: "灰风衣 · 日常造型",
    frame: 1,
    version: "v2",
    status: "已确认",
    usage: "第 1、2 集 · 8 个镜头",
  },
  {
    id: 2,
    name: "周远",
    kind: "角色",
    note: "深色夹克 · 日常造型",
    frame: 2,
    version: "v1",
    status: "已确认",
    usage: "第 1 集 · 5 个镜头",
  },
  {
    id: 3,
    name: "临街咖啡厅",
    kind: "场景",
    note: "日景 · 雨后自然光",
    frame: 0,
    version: "v1",
    status: "已确认",
    usage: "第 1 集 · 场次 01",
  },
  {
    id: 4,
    name: "旧铜钥匙",
    kind: "道具",
    note: "黄铜 · 明显磨痕",
    frame: 3,
    version: "v1",
    status: "已确认",
    usage: "第 1、2 集 · 4 个镜头",
  },
  {
    id: 5,
    name: "林夏 · 情绪参考",
    kind: "角色",
    note: "克制、迟疑、重新确认",
    frame: 4,
    version: "v1",
    status: "试作中",
    usage: "第 1 集 · SH-05",
  },
  {
    id: 6,
    name: "雨后咖啡厅氛围",
    kind: "风格",
    note: "暖光 · 低饱和 · 细腻颗粒",
    frame: 5,
    version: "v1",
    status: "试作中",
    usage: "项目视觉参考",
  },
];
