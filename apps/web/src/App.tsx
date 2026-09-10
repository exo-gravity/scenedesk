import { NativeSelect, TextInput, Textarea } from "@mantine/core";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import * as I from "./icons";
import {
  Avatar,
  Badge,
  Button,
  Frame,
  IconButton,
  Modal,
} from "./components/ui";
import {
  assets,
  loadDemo,
  makeInitialState,
  saveDemo,
  timecode,
} from "./model";
import type { DemoState, Page, SceneView } from "./model";
import { ScenePage } from "./pages/ScenePage";
import { AssetsPage, ScriptPage } from "./pages/ContentPages";
import {
  DeliveryPage,
  OverviewPage,
  ProjectsPage,
  SettingsPage,
  WorkPage,
} from "./pages/WorkspacePages";
const DesignPage = lazy(() =>
  import("./pages/DesignPage").then((module) => ({
    default: module.DesignPage,
  })),
);
const LayoutOptionsPage = lazy(() =>
  import("./pages/LayoutOptionsPage").then((module) => ({
    default: module.LayoutOptionsPage,
  })),
);
const VisualDirectionsPrototype = lazy(() =>
  import("./pages/VisualDirectionsPrototype").then((module) => ({
    default: module.VisualDirectionsPrototype,
  })),
);
const NavigationJourneyPrototype = lazy(() => import("./pages/NavigationJourneyPrototype").then(module => ({ default: module.NavigationJourneyPrototype })));
const ProductionDetailPrototype = lazy(() => import("./pages/ProductionDetailPrototype").then(m => ({ default: m.ProductionDetailPrototype })));
const WorkspaceRecommendationPrototype = lazy(() => import("./pages/WorkspaceRecommendationPrototype").then(module => ({ default: module.WorkspaceRecommendationPrototype })));

export type Navigate = (page: Page, view?: SceneView) => void;
export type Notify = (message: string) => void;
export type ReworkSource = {
  number: number;
  time: number;
  text: string;
  shotId: number;
};
const pageNames: Record<Page, string> = {
  scene: "场次制作",
  projects: "工作室项目",
  overview: "项目概览",
  script: "剧本与设定",
  assets: "资产库",
  delivery: "整集与交付",
  work: "我的工作",
  settings: "成员与用量",
  design: "视觉规范",
  layouts: "场次双模式效果图",
  directions: "视觉方向评审",
  journey: "导航与核心流程",
};
const navItems = [
  { page: "overview", label: "项目概览", Icon: I.House },
  { page: "script", label: "剧本与设定", Icon: I.BookOpenText },
  { page: "assets", label: "资产库", Icon: I.Stack },
  { page: "scene", label: "场次制作", Icon: I.FilmStrip },
  { page: "delivery", label: "整集与交付", Icon: I.DownloadSimple },
] as const;
function readRoute(): { page: Page; view: SceneView } {
  const [, p, v] = location.hash.split("/");
  return {
    page: p && p in pageNames ? (p as Page) : "scene",
    view: v === "edit" || v === "review" ? v : "production",
  };
}
export default function App() {
  const [route, setRoute] = useState(readRoute);
  const mainRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<DemoState>(loadDemo);
  const [selected, setSelected] = useState(4);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [modal, setModal] = useState<
    | "about"
    | "suggest"
    | "plan"
    | "prompt"
    | "rework"
    | "reset"
    | "project"
    | null
  >(null);
  const [projectName, setProjectName] = useState("");
  const [suggestion, setSuggestion] = useState(
    "桌面空位的特写，交代钥匙已被拿走，为下一场的情绪留出停顿。",
  );
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [reworkSource, setReworkSource] = useState<ReworkSource | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedShot =
    state.shots.find((s) => s.id === selected) || state.shots[0]!;
  useEffect(() => {
    const fn = () => {
      setRoute(readRoute());
      setMobileNav(false);
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    if (!saveDemo(state))
      setToast("浏览器暂时无法保存预览状态，本次编辑会保留到页面关闭。");
  }, [state]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    document.title = `${pageNames[route.page]} · 片场`;
  }, [route.page]);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [route.page, route.view]);
  const navigate: Navigate = (page, view = "production") => {
    location.hash = `/${page}/${page === "scene" ? view : ""}`;
    setRoute({ page, view });
    setMobileNav(false);
  };
  const updateShot = (patch: Partial<typeof selectedShot>) =>
    setState((s) => ({
      ...s,
      shots: s.shots.map((item) =>
        item.id === selectedShot.id ? { ...item, ...patch } : item,
      ),
    }));
  const goAction = (
    action: "suggest" | "plan" | "prompt" | "rework",
    source?: ReworkSource,
  ) => {
    if (source) {
      setReworkSource(source);
      setSelected(source.shotId);
      setState((s) => ({
        ...s,
        shots: s.shots.map((item) =>
          item.id === source.shotId
            ? {
                ...item,
                prompt: `根据场次 v${source.number} 的意见准备修改：${source.text}\n保留当前人物、服装、空间与道具参考。只准备新尝试，旧稿保持不变。`,
              }
            : item,
        ),
      }));
    }
    setModal(action);
  };
  function simulate() {
    if (busy) return;
    const shotId = selectedShot.id;
    const quantity = count;
    setBusy(true);
    timer.current = setTimeout(() => {
      setState((s) => ({
        ...s,
        shots: s.shots.map((shot) =>
          shot.id === shotId
            ? {
                ...shot,
                candidates: [
                  ...shot.candidates,
                  ...Array.from(
                    { length: quantity },
                    (_, i) => `试作 ${shot.candidates.length + i + 1}`,
                  ),
                ],
              }
            : shot,
        ),
      }));
      setBusy(false);
      setModal(null);
      setToast(
        `已添加 ${quantity} 个模拟候选。未调用模型，尚未采用或更新剪辑。`,
      );
    }, 1100);
  }
  function appendShot() {
    const id = Math.max(...state.shots.map((s) => s.id)) + 1;
    setState((s) => ({
      ...s,
      shots: [
        ...s.shots,
        {
          id,
          label: `SH-${String(id).padStart(2, "0")}`,
          title: "桌面的空位",
          intent: suggestion.trim(),
          dialogue: "",
          camera: "特写 · 固定",
          seconds: 3,
          frame: 0,
          selected: "",
          candidates: [],
          prompt: suggestion.trim(),
          entry: "钥匙已被拿走",
          exit: "桌面留白",
        },
      ],
    }));
    setSelected(id);
    setModal(null);
    navigate("scene");
    setToast("新镜头已追加到当前场次，原有镜头与剪辑保持原样。");
  }
  if (route.page === "journey") {
    if (new URLSearchParams(location.hash.split("?")[1]).get("variant") === "finishing") return <Suspense fallback={<div className="content-page">正在载入专项设计…</div>}><ProductionDetailPrototype /></Suspense>;
    if (new URLSearchParams(location.hash.split("?")[1]).get("variant") === "recommendation") return <Suspense fallback={<div className="content-page">正在载入新方案效果图…</div>}><WorkspaceRecommendationPrototype /></Suspense>;
    return <Suspense fallback={<div className="content-page">正在载入导航方案…</div>}><NavigationJourneyPrototype /></Suspense>;
  }
  if (route.page === "directions") {
    return <Suspense fallback={<div className="content-page">正在载入视觉方案…</div>}><VisualDirectionsPrototype navigate={navigate} /></Suspense>;
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <button
          className="brand"
          onClick={() => navigate("projects")}
          aria-label="片场，返回工作室项目"
        >
          <span className="brand-mark">
            <I.FilmSlate weight="fill" />
          </span>
          <strong>片场</strong>
          <span>PIANCHANG</span>
        </button>
        <button className="studio-switch" onClick={() => navigate("projects")}>
          <span className="studio-icon">拾</span>
          <span>
            <strong>拾光工作室</strong>
            <small>团队工作空间</small>
          </span>
          <I.CaretDown />
        </button>
        <nav aria-label="工作室导航" className="workspace-nav">
          <button
            className={route.page === "projects" ? "active" : ""}
            onClick={() => navigate("projects")}
          >
            <I.SquaresFour />
            工作室项目
          </button>
          <button
            className={route.page === "work" ? "active" : ""}
            onClick={() => navigate("work")}
          >
            <I.CheckSquare />
            我的工作
            <span className="nav-count">
              {Math.max(0, 3 - state.completedTasks.length)}
            </span>
          </button>
        </nav>
        <div className="nav-divider" />
        <div className="project-label">
          <span>当前项目</span>
          <I.DotsThree />
        </div>
        <button
          className="project-current"
          onClick={() => navigate("overview")}
        >
          <Frame index={4} className="project-tiny" />
          <div>
            <strong>旧钥匙</strong>
            <small>写实短剧 · 9:16</small>
          </div>
          <I.CaretDown />
        </button>
        <nav className="project-nav" aria-label="项目导航">
          {navItems.map(({ page, label, Icon }) => (
            <button
              key={page}
              className={route.page === page ? "active" : ""}
              onClick={() => navigate(page)}
            >
              <Icon weight={route.page === page ? "fill" : "regular"} />
              {label}
              {page === "scene" && <span className="active-line" />}
            </button>
          ))}
        </nav>
        {route.page === "scene" && (
          <div className="scene-tree">
            <div>
              <I.CaretDown size={12} />第 1 集 · 重逢
            </div>
            <button
              className="active"
              onClick={() => navigate("scene", route.view)}
            >
              <span>01</span> 咖啡厅 <Badge tone="amber">制作中</Badge>
            </button>
            <button onClick={() => navigate("delivery")}>
              <span>02</span> 咖啡厅外 <I.LockSimple size={13} />
            </button>
            <button
              className="episode-link"
              onClick={() => navigate("delivery")}
            >
              <I.CaretRight size={12} />第 2 集 · 留下的线索
            </button>
          </div>
        )}
        <div className="sidebar-bottom">
          <button
            className={
              route.page === "design" ? "bottom-link active" : "bottom-link"
            }
            onClick={() => navigate("design")}
          >
            <I.Palette />
            视觉规范<span>01</span>
          </button>
          <button className="bottom-link" onClick={() => navigate("settings")}>
            <I.GearSix />
            成员与用量
          </button>
          <div className="nav-divider" />
          <div className="profile">
            <Avatar name="许知" color={2} />
            <div>
              <strong>许知</strong>
              <small>制作人员 · 示例身份</small>
            </div>
            <IconButton label="关于本地预览" onClick={() => setModal("about")}>
              <I.Info />
            </IconButton>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="收起导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <IconButton
            label="展开导航"
            className="mobile-menu"
            onClick={() => setMobileNav((v) => !v)}
          >
            <I.List />
          </IconButton>
          <div className="breadcrumbs">
            <button onClick={() => navigate("projects")}>拾光工作室</button>
            <I.CaretRight />
            <button onClick={() => navigate("overview")}>旧钥匙</button>
            <I.CaretRight />
            <span>{pageNames[route.page]}</span>
          </div>
          <div className="topbar-right">
            <button
              className="preview-indicator"
              onClick={() => setModal("about")}
            >
              <span />
              本地设计预览
            </button>
            <button className="saved-local" onClick={() => setModal("about")}>
              <I.CheckCircle />
              已保存在本机
            </button>
            <IconButton label="查看我的待办" onClick={() => navigate("work")}>
              <I.Bell />
            </IconButton>
            <Avatar name="许知" color={2} small />
          </div>
        </header>
        <main
          ref={mainRef}
          className={`page-body page-${route.page}`}
          id="main-content"
        >
          {route.page === "scene" && (
            <ScenePage
              state={state}
              setState={setState}
              selected={selectedShot.id}
              setSelected={setSelected}
              view={route.view}
              onView={(v) => navigate("scene", v)}
              onAction={goAction}
              notify={setToast}
              navigate={navigate}
            />
          )}
          {route.page === "projects" && (
            <ProjectsPage
              state={state}
              navigate={navigate}
              newProject={() => setModal("project")}
            />
          )}
          {route.page === "overview" && (
            <OverviewPage state={state} navigate={navigate} />
          )}
          {route.page === "script" && (
            <ScriptPage
              state={state}
              setState={setState}
              navigate={navigate}
              suggest={() => setModal("suggest")}
              notify={setToast}
            />
          )}
          {route.page === "assets" && (
            <AssetsPage
              state={state}
              setState={setState}
              notify={setToast}
              navigate={navigate}
            />
          )}
          {route.page === "delivery" && (
            <DeliveryPage state={state} navigate={navigate} notify={setToast} />
          )}
          {route.page === "work" && (
            <WorkPage
              state={state}
              setState={setState}
              navigate={navigate}
              notify={setToast}
            />
          )}
          {route.page === "settings" && (
            <SettingsPage reset={() => setModal("reset")} />
          )}
          {route.page === "design" && (
            <Suspense
              fallback={<div className="content-page">正在载入组件样板…</div>}
            >
              <DesignPage navigate={navigate} />
            </Suspense>
          )}
          {route.page === "layouts" && (
            <Suspense fallback={<div className="content-page">正在载入效果图…</div>}>
              <LayoutOptionsPage navigate={navigate} />
            </Suspense>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <I.CheckCircle />
          <span>{toast}</span>
          <IconButton label="关闭提示" onClick={() => setToast("")}>
            <I.X />
          </IconButton>
        </div>
      )}
      {modal === "about" && (
        <Modal
          title="这是一套可操作的设计预览"
          subtitle="先判断页面和工作方式，再进入完整业务实现。"
          onClose={() => setModal(null)}
        >
          <div className="modal-body prose">
            <p>
              这里展示目前 MVP
              的核心页面与统一视觉方案。角色、剧目、参考和制作记录均为示例；分镜图片为本次生成的写实示意图。
            </p>
            <ul>
              <li>可以切换页面、编辑分镜、选择候选、调整编排、留下意见。</li>
              <li>变更只保存在当前浏览器，不会提交到服务端。</li>
              <li>播放器是静帧预演，模拟生成不调用模型、不计费。</li>
              <li>真实生成、音画处理、权限和正式审批仍待工程实现。</li>
            </ul>
            <Button
              onClick={() => {
                setModal(null);
                navigate("design");
              }}
            >
              <I.Palette />
              查看视觉规范
            </Button>
          </div>
        </Modal>
      )}
      {modal === "reset" && (
        <Modal
          title="重置本地示例"
          subtitle="只清除本浏览器里的这套设计预览状态。"
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <p>你在原型中编辑的提示、分镜、剪辑和评论将恢复为初始示例。</p>
            <div className="modal-actions">
              <Button onClick={() => setModal(null)}>保留当前内容</Button>
              <Button
                tone="danger"
                onClick={() => {
                  setState(makeInitialState());
                  setSelected(4);
                  setModal(null);
                  setToast("本地预览已恢复为初始示例。");
                }}
              >
                重置示例
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "project" && (
        <Modal
          title="新建项目"
          subtitle="本地演示，只创建项目入口示意。"
          onClose={() => setModal(null)}
        >
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              if (projectName.trim()) {
                setState((s) => ({
                  ...s,
                  localProjects: [...s.localProjects, projectName.trim()],
                }));
                setProjectName("");
                setModal(null);
                setToast(
                  "已创建本地项目卡片。完整制作流程请使用《旧钥匙》示例。",
                );
              }
            }}
          >
            <label className="field-label" htmlFor="project-name">
              项目名称
            </label>
            <TextInput
              id="project-name"
              required
              maxLength={40}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="例如：雨停之后"
              autoFocus
            />
            <div className="form-pair">
              <label>
                内容类型
                <NativeSelect defaultValue="短剧">
                  <option>短剧</option>
                </NativeSelect>
              </label>
              <label>
                默认画幅
                <NativeSelect defaultValue="9:16">
                  <option>9:16</option>
                  <option>16:9</option>
                </NativeSelect>
              </label>
            </div>
            <div className="modal-actions">
              <Button type="button" onClick={() => setModal(null)}>
                取消
              </Button>
              <Button tone="primary" type="submit">
                创建本地项目
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "suggest" && (
        <Modal
          title="生成分镜建议"
          subtitle="第 1 集 / 场次 01 咖啡厅 · 追加到当前场次"
          onClose={() => setModal(null)}
          wide
        >
          <div className="modal-body">
            <div className="inline-note">
              <I.Info />
              <span>
                已有 {state.shots.length}{" "}
                个镜头。建议只新增镜头，保留已有戏文、候选和剪辑。
              </span>
            </div>
            <div className="suggestion-card">
              <span className="shot-number">
                {String(state.shots.length + 1).padStart(2, "0")}
              </span>
              <div>
                <label className="field-label" htmlFor="new-shot">
                  补充一个道具衔接镜头
                </label>
                <Textarea
                  id="new-shot"
                  value={suggestion}
                  onChange={(e) => setSuggestion(e.target.value)}
                />
                <p className="muted small">
                  特写 · 3 秒 · 本地模拟建议，可编辑后采纳
                </p>
              </div>
            </div>
            <div className="modal-actions">
              <Button onClick={() => setModal(null)}>暂不采纳</Button>
              <Button
                tone="primary"
                disabled={!suggestion.trim()}
                onClick={appendShot}
              >
                <I.Plus />
                采纳并追加 1 个镜头
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {(modal === "plan" || modal === "prompt" || modal === "rework") && (
        <Modal
          title={
            modal === "plan"
              ? "本次生成计划"
              : modal === "rework"
                ? "按意见准备修改"
                : "准备本次提示"
          }
          subtitle={`第 1 集 / 咖啡厅 / ${selectedShot.label} · ${selectedShot.title}`}
          onClose={() => {
            if (!busy) setModal(null);
          }}
          wide
        >
          <div className="modal-body">
            <div className="plan-context">
              <Frame index={selectedShot.frame} />
              <div>
                <Badge tone="amber">仅本次试作</Badge>
                <h3>{selectedShot.intent}</h3>
                <p>
                  {selectedShot.camera} · {selectedShot.seconds} 秒 · 9:16
                </p>
              </div>
            </div>
            {modal === "rework" && reworkSource && (
              <div className="inline-note">
                <I.ChatCircleText />
                <span>
                  v{reworkSource.number} / {timecode(reworkSource.time)}：
                  {reworkSource.text}
                </span>
              </div>
            )}
            <label className="field-label" htmlFor="shot-prompt">
              {modal === "rework" ? "修改要求与保留项" : "本次提示"}
            </label>
            <Textarea
              id="shot-prompt"
              minRows={4}
              value={selectedShot.prompt}
              onChange={(e) => updateShot({ prompt: e.target.value })}
              disabled={busy}
            />
            <div className="label-with-action">
              <span className="field-label">本次引用</span>
              <span className="muted small">来自当前场次 · 固定示例版本</span>
            </div>
            <div className="plan-references">
              {assets.slice(0, 4).map((a) => (
                <div key={a.id}>
                  <Frame index={a.frame} />
                  <span>
                    {a.name}
                    <small>
                      {a.kind} / {a.version}
                    </small>
                  </span>
                  <I.CheckCircle />
                </div>
              ))}
            </div>
            <div className="form-pair">
              <label>
                视频模型
                <NativeSelect disabled value="Seedance" onChange={() => {}}>
                  <option value="Seedance">Seedance · 待接入</option>
                </NativeSelect>
              </label>
              <label>
                生成数量
                <NativeSelect
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  disabled={busy}
                >
                  <option value={1}>1 个候选</option>
                  <option value={2}>2 个候选</option>
                  <option value={3}>3 个候选</option>
                </NativeSelect>
              </label>
            </div>
            <div className="plan-cost">
              <div>
                <strong>本地模拟，不产生费用</strong>
                <span>真实接入后在此核对模型能力、计价与预算。</span>
              </div>
              <span>¥ 0.00</span>
            </div>
            <div className="modal-actions">
              <Button
                disabled={busy}
                onClick={() => {
                  setModal(null);
                  setToast("本镜提示已保存在本机，可稍后继续准备。");
                }}
              >
                保存提示，稍后继续
              </Button>
              <Button
                tone="primary"
                disabled={busy || !selectedShot.prompt.trim()}
                onClick={simulate}
              >
                <I.Sparkle className={busy ? "spinning" : ""} />
                {busy ? "正在添加模拟候选…" : "模拟生成 · 不计费"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
