import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import * as I from "../icons";
import {
  Avatar,
  Badge,
  Button,
  Empty,
  Frame,
  Modal,
  PageHeading,
  SectionHeading,
} from "../components/ui";
import type { DemoState } from "../model";
import { timecode } from "../model";
import type { Navigate, Notify } from "../App";
type Basic = { state: DemoState; navigate: Navigate };
export function ProjectsPage({
  state,
  navigate,
  newProject,
}: Basic & { newProject: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("进行中");
  const [emptyProject, setEmptyProject] = useState("");
  return (
    <div className="content-page projects-page">
      <PageHeading
        eyebrow="SHIGUANG STUDIO"
        title="让故事，一镜一镜发生。"
        subtitle="拾光工作室 · 从上次停下的地方继续。"
      >
        <Button tone="primary" onClick={newProject}>
          <I.Plus />
          新建项目
        </Button>
      </PageHeading>
      <div className="studio-summary">
        <div>
          <span>进行中项目</span>
          <strong>
            {1 + state.localProjects.length}
            <small>个</small>
          </strong>
        </div>
        <div>
          <span>我的待处理</span>
          <strong>
            {Math.max(0, 3 - state.completedTasks.length)}
            <small>项</small>
          </strong>
        </div>
        <div>
          <span>待审阅版本</span>
          <strong>
            {state.revisions.filter((r) => r.status === "待审阅").length}
            <small>份</small>
          </strong>
        </div>
        <div>
          <span>团队成员</span>
          <div className="member-stack">
            <Avatar name="陈舟" />
            <Avatar name="许知" color={2} />
            <Avatar name="宋宁" color={1} />
            <small>一起制作</small>
          </div>
        </div>
      </div>
      <div className="asset-toolbar">
        <div className="filter-chips">
          {["进行中", "已归档"].map((f) => (
            <button
              key={f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <label className="search">
          <I.MagnifyingGlass />
          <input
            aria-label="搜索项目"
            placeholder="搜索项目…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {filter === "进行中" ? (
        <div className="project-grid">
          {"旧钥匙".includes(query) && (
            <article className="project-cover-card">
              <button
                className="project-cover"
                onClick={() => navigate("overview")}
              >
                <Frame index={0} />
                <div className="project-cover-title">
                  <span>A SHIGUANG ORIGINAL</span>
                  <h2>旧钥匙</h2>
                  <p>一把钥匙，一段没有结束的故事。</p>
                </div>
                <Badge tone="amber">制作中</Badge>
              </button>
              <div className="project-card-info">
                <div>
                  <strong>旧钥匙</strong>
                  <span>写实短剧 · 9:16 · 2 集规划</span>
                </div>
                <div className="row">
                  <Avatar name="陈舟" small />
                  <Avatar name="许知" color={2} small />
                </div>
              </div>
              <button
                className="resume-project"
                onClick={() => navigate("scene")}
              >
                <I.Play weight="fill" />
                <span>
                  继续制作<strong>第 1 集 / 场次 01 咖啡厅</strong>
                </span>
                <I.ArrowRight />
              </button>
            </article>
          )}
          {state.localProjects
            .filter((p) => p.includes(query))
            .map((p, i) => (
              <button
                className="new-local-project"
                key={`${p}-${i}`}
                onClick={() => setEmptyProject(p)}
              >
                <I.FilmSlate size={44} />
                <h2>{p}</h2>
                <Badge>本地空项目</Badge>
                <p>待准备戏文与素材</p>
              </button>
            ))}
          <button className="new-project-tile" onClick={newProject}>
            <I.Plus size={28} />
            <strong>开启下一个故事</strong>
            <span>创建一个短剧项目</span>
          </button>
        </div>
      ) : (
        <Empty
          title="还没有归档项目"
          text="完成的项目可以归档，原有版本与素材继续保留。"
        />
      )}
      <section className="recent-work">
        <SectionHeading title="接下来，处理这些事">
          <Button tone="ghost" onClick={() => navigate("work")}>
            全部工作
            <I.ArrowRight />
          </Button>
        </SectionHeading>
        <button onClick={() => navigate("scene", "review")}>
          <span className="activity-icon amber">
            <I.ChatCircleText />
          </span>
          <div>
            <strong>咖啡厅场次，有一条待处理意见</strong>
            <p>旧钥匙 · v1 · 00:24 拿钥匙的接触点</p>
          </div>
          <Badge tone="amber">返工</Badge>
          <I.CaretRight />
        </button>
        <button onClick={() => navigate("assets")}>
          <span className="activity-icon green">
            <I.Stack />
          </span>
          <div>
            <strong>为下一集准备可复用的角色参考</strong>
            <p>林夏 / 灰风衣 v2 · 旧铜钥匙 v1</p>
          </div>
          <Badge>资产</Badge>
          <I.CaretRight />
        </button>
      </section>
      {emptyProject && (
        <Modal
          title={emptyProject}
          subtitle="本地新项目空态"
          onClose={() => setEmptyProject("")}
        >
          <div className="modal-body">
            <Empty
              title="从一场戏开始"
              text="完整的新项目初始化将在业务实现中接入。当前可用《旧钥匙》查看戏文、资产和制作全过程。"
            >
              <Button
                tone="primary"
                onClick={() => {
                  setEmptyProject("");
                  navigate("scene");
                }}
              >
                查看完整制作示例
              </Button>
            </Empty>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function OverviewPage({ state, navigate }: Basic) {
  return (
    <div className="content-page">
      <div className="overview-masthead">
        <Frame index={5} />
        <div className="overview-title">
          <span className="eyebrow">PROJECT / 01</span>
          <h1>旧钥匙</h1>
          <p>一把钥匙，打开一段从未结束的关系。</p>
          <div className="row">
            <Badge>写实短剧</Badge>
            <Badge>竖屏 9:16</Badge>
            <Badge>2 集规划</Badge>
          </div>
        </div>
        <div className="overview-members">
          <span>主创 陈舟</span>
          <div className="row">
            <Avatar name="陈舟" />
            <Avatar name="许知" color={2} />
            <Avatar name="宋宁" color={1} />
          </div>
        </div>
      </div>
      <div className="overview-continue">
        <span className="continue-icon">
          <I.FilmSlate />
        </span>
        <div>
          <span className="field-label">当前制作</span>
          <h2>第 1 集 / 咖啡厅的旧钥匙</h2>
          <p>
            {state.shots.length} 个镜头 · 许知主责 ·{" "}
            {state.revisions.filter((r) => r.status === "需修改").length}{" "}
            份稿件需修改
          </p>
        </div>
        <Button tone="primary" onClick={() => navigate("scene")}>
          继续制作
          <I.ArrowRight />
        </Button>
      </div>
      <div className="overview-grid">
        <section>
          <SectionHeading title="剧集与场次">
            <Button tone="ghost" onClick={() => navigate("delivery")}>
              整集与交付
              <I.ArrowUpRight />
            </Button>
          </SectionHeading>
          <div className="episode-card">
            <div className="episode-heading">
              <strong>01</strong>
              <div>
                <h3>重逢</h3>
                <p>第 1 集 · 2 场规划</p>
              </div>
              <Badge tone="amber">制作中</Badge>
            </div>
            <button
              className="episode-scene-row"
              onClick={() => navigate("scene")}
            >
              <Frame index={0} />
              <div>
                <strong>01 咖啡厅</strong>
                <span>{state.shots.length} 镜 · 许知主责</span>
              </div>
              <Badge tone="amber">返工中</Badge>
              <I.ArrowRight />
            </button>
            <button
              className="episode-scene-row"
              onClick={() => navigate("script")}
            >
              <div className="scene-placeholder">
                <I.ImageSquare />
              </div>
              <div>
                <strong>02 咖啡厅外</strong>
                <span>待展开分镜</span>
              </div>
              <Badge>待开始</Badge>
              <I.ArrowRight />
            </button>
          </div>
          <div className="episode-card compact-episode">
            <strong>02</strong>
            <div>
              <h3>留下的线索</h3>
              <p>沿用人物与道具，准备下一集</p>
            </div>
            <Button onClick={() => navigate("assets")}>准备资产</Button>
          </div>
        </section>
        <aside>
          <SectionHeading title="制作依据" />
          <div className="readiness-list">
            <button onClick={() => navigate("script")}>
              <I.CheckCircle className="status-green" />
              <div>
                <strong>正式戏文 v1</strong>
                <p>陈舟已确认，草稿可继续试作</p>
              </div>
              <I.CaretRight />
            </button>
            <button onClick={() => navigate("assets")}>
              <I.CheckCircle className="status-green" />
              <div>
                <strong>角色、场景、道具</strong>
                <p>4 份正式参考已准备</p>
              </div>
              <I.CaretRight />
            </button>
            <button onClick={() => navigate("settings")}>
              <I.Clock className="status-amber" />
              <div>
                <strong>模型与预算</strong>
                <p>设计预览，真实服务待接入</p>
              </div>
              <I.CaretRight />
            </button>
          </div>
          <SectionHeading title="团队分工" />
          <div className="team-list">
            {[
              { n: "陈舟", r: "主创 · 方向与稿件确认", c: 0 },
              { n: "许知", r: "制作 · 场次主责", c: 2 },
              { n: "宋宁", r: "后期 · 声音与整集", c: 1 },
            ].map((m) => (
              <div key={m.n}>
                <Avatar name={m.n} color={m.c} />
                <span>
                  <strong>{m.n}</strong>
                  <small>{m.r}</small>
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
export function DeliveryPage({
  state,
  navigate,
  notify,
}: Basic & { notify: Notify }) {
  const approved = state.revisions.filter((r) => r.status === "已确认");
  const [version, setVersion] = useState(approved.at(-1)?.number || 0);
  const fixed = state.revisions.find((r) => r.number === version);
  const [tab, setTab] = useState("整集编排");
  function download() {
    const value = {
      notice: "本地设计预览清单，不包含真实媒体或交付文件",
      project: "旧钥匙",
      scene: "咖啡厅",
      selectedSceneRevision: fixed?.number || null,
      sceneApproved: fixed?.status === "已确认",
      episodeApproved: false,
      clips: fixed?.clips || state.clips,
      source: "fictional visual prototype",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "旧钥匙-场次示例清单.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("已下载本地示例清单；不包含视频、声音或正式交付文件。");
  }
  return (
    <div className="content-page">
      <PageHeading
        eyebrow="ASSEMBLY & DELIVERY"
        title="从一场戏，到完整的一集"
        subtitle="选定场次版本，衔接整集；确认与交付都指向具体稿件。"
      >
        <Button onClick={download}>
          <I.DownloadSimple />
          导出示例清单
        </Button>
      </PageHeading>
      <div className="content-tabs">
        {["整集编排", "工作包与回传"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <span>第 1 集 · 重逢</span>
      </div>
      {tab === "整集编排" ? (
        <div className="delivery-layout">
          <section>
            <div className="assembly-heading">
              <h2>第 1 集 · 重逢</h2>
              <Badge>草稿准备中</Badge>
            </div>
            <div className="assembly-item">
              <span className="assembly-number">01</span>
              <Frame index={0} />
              <div>
                <h3>咖啡厅的旧钥匙</h3>
                <p>
                  {state.shots.length} 镜 ·{" "}
                  {timecode(
                    (fixed?.clips || state.clips).reduce(
                      (n, c) => n + c.seconds,
                      0,
                    ),
                  )}
                </p>
                <select
                  aria-label="整集使用的场次版本"
                  value={version}
                  onChange={(e) => setVersion(Number(e.target.value))}
                >
                  <option value={0}>
                    {approved.length ? "选择已确认场次版本" : "等待场次确认"}
                  </option>
                  {approved.map((r) => (
                    <option key={r.number} value={r.number}>
                      场次 v{r.number} · 已确认
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={() => navigate("scene", "review")}>
                查看审阅
                <I.ArrowUpRight />
              </Button>
            </div>
            <div className="assembly-join">
              <span />
              <I.LinkSimple />
              <span />
            </div>
            <div className="assembly-item unfinished">
              <span className="assembly-number">02</span>
              <div className="assembly-placeholder">
                <I.FilmStrip />
              </div>
              <div>
                <h3>咖啡厅外</h3>
                <p>还没有可用于整集的场次版本。</p>
                <Badge>待制作</Badge>
              </div>
              <Button onClick={() => navigate("script")}>查看剧集戏文</Button>
            </div>
            <div className="assembly-note">
              <I.Info />
              <p>
                新草稿不会自动覆盖这里选定的场次版本。整集的声音、字幕、节奏和最终结果仍需独立确认。
              </p>
            </div>
            <SectionHeading title="下一集的准备" />
            <button className="next-episode" onClick={() => navigate("assets")}>
              <Frame index={4} />
              <div>
                <h3>第 2 集 · 留下的线索</h3>
                <p>沿用林夏的造型与旧铜钥匙，保留资产固定版本。</p>
              </div>
              <I.ArrowRight />
            </button>
          </section>
          <aside className="delivery-checklist">
            <h2>整集交付检查</h2>
            <div>
              <I.Circle />
              <span>全部场次具有可用版本</span>
            </div>
            <div>
              <I.Circle />
              <span>整集画面、声音与字幕已核对</span>
            </div>
            <div>
              <I.Circle />
              <span>主创确认指定整集稿件</span>
            </div>
            <div>
              <I.Circle />
              <span>导出文件与来源清单已就绪</span>
            </div>
            <div className="delivery-status">
              <I.LockSimple />
              <h3>整集暂不可交付</h3>
              <p>当前示例还缺少第二场和整集审阅。场次通过不等于整集通过。</p>
              <Button className="full-width" disabled>
                生成最终交付
              </Button>
            </div>
          </aside>
        </div>
      ) : (
        <div className="handoff-grid">
          <section className="handoff-panel">
            <I.FolderSimple size={32} />
            <h2>场次工作包</h2>
            <p>让后期拿到当前采用、原始素材区间及已知使用关系。</p>
            <ul>
              <li>
                <I.CheckCircle />
                镜头与候选清单
              </li>
              <li>
                <I.CheckCircle />
                规划片段顺序和时长
              </li>
              <li className="muted">
                <I.Circle />
                原始视频、声音与字幕：待接入
              </li>
            </ul>
            <Button tone="primary" onClick={download}>
              <I.DownloadSimple />
              下载示例 JSON 清单
            </Button>
            <small>工作材料导出无须先完成整集审批。</small>
          </section>
          <section className="handoff-panel">
            <I.UploadSimple size={32} />
            <h2>内部后期回传</h2>
            <p>接收后期的 MP4 与 SRT，形成一份新的固定稿件。</p>
            <div className="unavailable-upload">
              <I.FilmStrip />
              <span>MP4 + SRT</span>
              <small>页面设计示意 · 服务端归档待实现</small>
            </div>
            <p className="small muted">
              外部稿缺少逐镜映射时会明确标为未知，保留文件与人工声明的依据。
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
export function WorkPage({
  state,
  setState,
  navigate,
  notify,
}: Basic & { setState: Dispatch<SetStateAction<DemoState>>; notify: Notify }) {
  const [filter, setFilter] = useState("待处理");
  const tasks = [
    {
      id: "t1",
      title: "调整拿钥匙时的手部接触",
      context: "旧钥匙 / 第 1 集 / 场次 01 / v1 00:24",
      type: "返工",
      name: "许知",
      page: "scene" as const,
      view: "review" as const,
    },
    {
      id: "t2",
      title: "核对场次对白与字幕",
      context: "旧钥匙 / 第 1 集 / 咖啡厅剪辑草稿",
      type: "制作",
      name: "许知",
      page: "scene" as const,
      view: "edit" as const,
    },
    {
      id: "t3",
      title: "整理第二集可复用的角色与道具",
      context: "林夏 / 灰风衣 v2、旧铜钥匙 v1",
      type: "资产",
      name: "许知",
      page: "assets" as const,
      view: "production" as const,
    },
  ];
  return (
    <div className="content-page">
      <PageHeading
        eyebrow="MY WORK"
        title="把注意力留给眼前这场戏"
        subtitle="意见关联的工作、素材准备与待审版本，从这里回到制作。"
      />
      <div className="content-tabs">
        {["待处理", "已完成", "全部"].map((t) => (
          <button
            className={filter === t ? "active" : ""}
            key={t}
            onClick={() => setFilter(t)}
          >
            {t}
          </button>
        ))}
        <span>许知的工作</span>
      </div>
      <div className="work-table">
        <div className="work-table-head">
          <span>工作事项</span>
          <span>类型</span>
          <span>负责人</span>
          <span>状态</span>
        </div>
        {tasks
          .filter(
            (t) =>
              filter === "全部" ||
              (filter === "已完成") === state.completedTasks.includes(t.id),
          )
          .map((t) => (
            <div className="work-row" key={t.id}>
              <button
                className="work-title"
                onClick={() => navigate(t.page, t.view)}
              >
                <I.ArrowSquareOut />
                <div>
                  <strong>{t.title}</strong>
                  <p>{t.context}</p>
                </div>
              </button>
              <Badge tone={t.type === "返工" ? "amber" : "neutral"}>
                {t.type}
              </Badge>
              <div className="row">
                <Avatar name={t.name} color={2} small />
                {t.name}
              </div>
              <Button
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    completedTasks: s.completedTasks.includes(t.id)
                      ? s.completedTasks.filter((x) => x !== t.id)
                      : [...s.completedTasks, t.id],
                  }));
                  notify("已更新轻任务状态；不会改变候选采用或稿件审批。");
                }}
              >
                {state.completedTasks.includes(t.id) ? (
                  <>
                    <I.CheckCircle />
                    已完成
                  </>
                ) : (
                  "标记完成"
                )}
              </Button>
            </div>
          ))}
      </div>
      <div className="inline-note">
        <I.Info />
        <span>
          任务完成表示工作已处理，不自动批准稿件。生成作业的执行状态也独立保留。
        </span>
      </div>
    </div>
  );
}
export function SettingsPage({ reset }: { reset: () => void }) {
  return (
    <div className="content-page">
      <PageHeading
        eyebrow="WORKSPACE SETTINGS"
        title="简单协作，清楚的边界"
        subtitle="工作室管理成员与连接，项目内明确主创与协作者。"
      />
      <div className="settings-grid">
        <section>
          <SectionHeading title="拾光工作室成员" />
          <div className="member-table">
            {[
              { n: "陈舟", c: 0, role: "所有者", work: "项目主创" },
              { n: "许知", c: 2, role: "成员", work: "制作协作者" },
              { n: "宋宁", c: 1, role: "成员", work: "后期协作者" },
            ].map((m) => (
              <div key={m.n}>
                <Avatar name={m.n} color={m.c} />
                <div>
                  <strong>{m.n}</strong>
                  <small>{m.work}</small>
                </div>
                <Badge>{m.role}</Badge>
              </div>
            ))}
          </div>
          <p className="small muted">
            当前均为示例身份；不限制工作室人数。正式版本支持内部成员邀请，外包协作后置。
          </p>
        </section>
        <section>
          <SectionHeading title="模型连接与用量" />
          <div className="provider-row">
            <span className="provider-icon">
              <I.Sparkle />
            </span>
            <div>
              <strong>Seedance</strong>
              <small>主视频模型优先接入方向</small>
            </div>
            <Badge tone="amber">未接入</Badge>
          </div>
          <div className="usage-zero">
            <span>本地预览真实消费</span>
            <strong>¥ 0.00</strong>
            <p>模拟生成不调用模型，不占用真实预算。</p>
          </div>
        </section>
        <section className="settings-local">
          <SectionHeading title="本地预览数据" />
          <p>
            编辑内容仅保存在本机浏览器。你可以随时恢复初始示例，重新走查不同操作。
          </p>
          <Button onClick={reset}>
            <I.ArrowCounterClockwise />
            重置本地示例
          </Button>
        </section>
      </div>
    </div>
  );
}
