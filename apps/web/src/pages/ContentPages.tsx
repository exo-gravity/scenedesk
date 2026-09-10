import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import * as I from "../icons";
import { assets } from "../model";
import type { DemoState } from "../model";
import {
  Avatar,
  Badge,
  Button,
  Empty,
  Frame,
  IconButton,
  Modal,
  PageHeading,
  SectionHeading,
} from "../components/ui";
import type { Navigate, Notify } from "../App";
type ContentProps = {
  state: DemoState;
  setState: Dispatch<SetStateAction<DemoState>>;
  navigate: Navigate;
  notify: Notify;
};
export function ScriptPage({
  state,
  setState,
  navigate,
  suggest,
  notify,
}: ContentProps & { suggest: () => void }) {
  const [tab, setTab] = useState("戏文");
  const [version, setVersion] = useState("draft");
  return (
    <div className="content-page">
      <PageHeading
        eyebrow="STORY & DIRECTION"
        title="剧本与创作基准"
        subtitle="让团队从同一份故事、人物和视觉方向开始。"
      >
        <Button onClick={() => navigate("scene")}>
          <I.FilmStrip />
          场次制作
        </Button>
        <Button tone="primary" onClick={suggest}>
          <I.Sparkle />
          生成分镜建议
        </Button>
      </PageHeading>
      <div className="content-tabs">
        {["戏文", "创作基准"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <span>
          <I.CheckCircle />
          正式依据 v1 已确认
        </span>
      </div>
      {tab === "戏文" ? (
        <div className="script-layout">
          <aside className="script-outline">
            <span className="field-label">剧集结构</span>
            <h3>
              <I.CaretDown />第 1 集 · 重逢
            </h3>
            <button className="active">
              <span>01</span>
              <div>
                咖啡厅<small>日 / 内 · {state.shots.length} 镜</small>
              </div>
            </button>
            <button onClick={() => navigate("delivery")}>
              <span>02</span>
              <div>
                咖啡厅外<small>待展开</small>
              </div>
            </button>
            <h3 className="muted">
              <I.CaretRight />第 2 集 · 留下的线索
            </h3>
            <div className="outline-foot">
              <I.Info />
              <p>先完成当前场次，其他集与场可逐步展开。</p>
            </div>
          </aside>
          <section className="script-editor">
            <div className="script-editor-toolbar">
              <div>
                <I.FileText />
                <strong>咖啡厅</strong>
                <Badge>{version === "draft" ? "编辑草稿" : "正式 v1"}</Badge>
              </div>
              <select
                aria-label="戏文版本"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              >
                <option value="draft">当前编辑草稿</option>
                <option value="v1">已确认 v1 · 只读</option>
              </select>
            </div>
            <textarea
              aria-label="场次戏文"
              className="screenplay"
              readOnly={version !== "draft"}
              value={version === "draft" ? state.scriptDraft : state.script}
              onChange={(e) =>
                setState((s) => ({ ...s, scriptDraft: e.target.value }))
              }
            />
            <div className="script-editor-footer">
              <span>
                {
                  Array.from(
                    version === "draft" ? state.scriptDraft : state.script,
                  ).length
                }{" "}
                字 · {version === "draft" ? "本地自动保存" : "正式版本只读"}
              </span>
              <Button
                disabled={version !== "draft"}
                onClick={() =>
                  notify("戏文草稿已保存在本机，正式 v1 仍保留原内容。")
                }
              >
                <I.Check />
                保存草稿
              </Button>
            </div>
          </section>
          <aside className="script-context">
            <h2>这场戏的依据</h2>
            <div className="context-block">
              <span className="field-label">叙事目标</span>
              <p>通过一把旧钥匙，让林夏意识到那段关系从未真正结束。</p>
            </div>
            <div className="context-block">
              <span className="field-label">出场角色</span>
              {assets.slice(0, 2).map((a) => (
                <button
                  className="script-person"
                  key={a.id}
                  onClick={() => navigate("assets")}
                >
                  <Frame index={a.frame} />
                  <span>
                    <strong>{a.name}</strong>
                    <small>{a.note}</small>
                  </span>
                  <I.ArrowUpRight />
                </button>
              ))}
            </div>
            <div className="context-block">
              <span className="field-label">连续性重点</span>
              <ul>
                <li>林夏在左，周远在右。</li>
                <li>钥匙从桌面转移到林夏右手。</li>
                <li>人物造型与环境光保持一致。</li>
              </ul>
            </div>
            <div className="creative-confirmation">
              <Avatar name="陈舟" />
              <div>
                <strong>陈舟已确认方向</strong>
                <small>正式 v1 · 示例记录</small>
              </div>
              <I.CheckCircle />
            </div>
            <p className="small muted">
              草稿可以自由试作。剧情、正式台词与共享造型的变更需主创确认。
            </p>
          </aside>
        </div>
      ) : (
        <div className="creative-basis">
          <div className="basis-overview">
            <Frame index={5} />
            <div>
              <Badge tone="green">正式 v1 · 已确认</Badge>
              <h2>克制的情绪，真实的距离</h2>
              <p>
                当代都市写实。用停顿、目光与细微动作推进关系，避免夸张的表演和装饰性的镜头运动。
              </p>
              <div className="row">
                <Badge>自然光</Badge>
                <Badge>低饱和</Badge>
                <Badge>细腻颗粒</Badge>
              </div>
            </div>
          </div>
          <div className="basis-sections">
            <section>
              <SectionHeading title="人物与造型" />
              <div className="basis-characters">
                {assets.slice(0, 2).map((a) => (
                  <button key={a.id} onClick={() => navigate("assets")}>
                    <Frame index={a.frame} />
                    <h3>{a.name}</h3>
                    <p>{a.note}</p>
                    <Badge tone="green">{a.version} · 已确认</Badge>
                  </button>
                ))}
              </div>
            </section>
            <section>
              <SectionHeading title="声音与表达" />
              <div className="direction-row">
                <strong>对白</strong>
                <p>自然口语，声音清楚；周远的回答前保留迟疑。</p>
              </div>
              <div className="direction-row">
                <strong>环境</strong>
                <p>轻微街道声、杯子接触桌面的声音，避免音乐盖过对白。</p>
              </div>
              <div className="direction-row">
                <strong>输出</strong>
                <p>竖屏 9:16；字幕以实际对白核对，保留可编辑文件。</p>
              </div>
              <Button onClick={() => navigate("scene")}>
                <I.ArrowRight />
                带着这些依据开始制作
              </Button>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
export function AssetsPage({
  state,
  setState,
  navigate,
  notify,
}: ContentProps) {
  const [scope, setScope] = useState("项目资产");
  const [filter, setFilter] = useState("全部");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<number | null>(null);
  const [upload, setUpload] = useState(false);
  const [localFiles, setLocalFiles] = useState<
    { name: string; url: string; id: string }[]
  >([]);
  const createdUrls = useRef<string[]>([]);
  useEffect(() => () => createdUrls.current.forEach(URL.revokeObjectURL), []);
  const selectedAsset = assets.find((a) => a.id === detail);
  const visible = assets.filter(
    (a) =>
      (scope === "项目资产" || [1, 3, 6].includes(a.id)) &&
      (filter === "全部" || a.kind === filter) &&
      `${a.name}${a.note}`.includes(search),
  );
  return (
    <div className="content-page">
      <PageHeading
        eyebrow="ASSET LIBRARY"
        title="把创作依据留在项目里"
        subtitle="人物、场景、道具与风格参考，带着明确版本一起复用。"
      >
        <Button
          onClick={() =>
            setScope(scope === "项目资产" ? "工作室共享" : "项目资产")
          }
        >
          <I.FolderSimple />
          {scope === "项目资产" ? "工作室共享" : "回到项目"}
        </Button>
        <Button tone="primary" onClick={() => setUpload(true)}>
          <I.UploadSimple />
          导入素材
        </Button>
      </PageHeading>
      <div className="content-tabs">
        {["项目资产", "工作室共享"].map((s) => (
          <button
            className={scope === s ? "active" : ""}
            key={s}
            onClick={() => setScope(s)}
          >
            {s}
            {s === "项目资产" && (
              <span>{assets.length + localFiles.length}</span>
            )}
          </button>
        ))}
        <span>
          <I.LinkSimple />
          引用固定版本
        </span>
      </div>
      <div className="asset-toolbar">
        <div className="filter-chips">
          {["全部", "角色", "场景", "道具", "风格", "声音"].map((t) => (
            <button
              key={t}
              className={filter === t ? "active" : ""}
              onClick={() => setFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="search">
          <I.MagnifyingGlass />
          <input
            placeholder="搜索名称、标签…"
            aria-label="搜索资产"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="asset-grid">
        {visible.map((a) => (
          <button
            key={a.id}
            className="asset-card"
            onClick={() => setDetail(a.id)}
          >
            <Frame index={a.frame} className={`asset-image asset-${a.kind}`}>
              <Badge>{a.kind}</Badge>
            </Frame>
            <div className="asset-content">
              <div>
                <h3>{a.name}</h3>
                <span>{a.version}</span>
              </div>
              <p>{a.note}</p>
              <div className="asset-meta">
                <span
                  className={
                    a.status === "已确认" ? "status-green" : "status-amber"
                  }
                >
                  {a.status === "已确认" ? <I.CheckCircle /> : <I.Clock />}
                  {a.status}
                </span>
                <span>
                  {scope === "工作室共享"
                    ? state.importedAssets.includes(a.id)
                      ? "已引入项目"
                      : "可引入项目"
                    : "项目内可用"}
                </span>
              </div>
            </div>
          </button>
        ))}
        {scope === "项目资产" &&
          filter === "全部" &&
          localFiles
            .filter((f) => f.name.includes(search))
            .map((f) => (
              <article key={f.id} className="asset-card">
                <img className="local-asset-image" src={f.url} alt={f.name} />
                <div className="asset-content">
                  <h3>{f.name}</h3>
                  <p>本次浏览器会话 · 尚未上传</p>
                  <Badge tone="amber">本地素材预览</Badge>
                </div>
              </article>
            ))}
      </div>
      {!visible.length &&
        !(
          scope === "项目资产" &&
          filter === "全部" &&
          localFiles.some((f) => f.name.includes(search))
        ) && (
          <Empty
            title={filter === "声音" ? "还没有独立声音资产" : "没有匹配的资产"}
            text={
              filter === "声音"
                ? "对白、环境声和配乐可以在后续制作中加入。"
                : "尝试其他名称或资产类型。"
            }
          >
            <Button onClick={() => setFilter("全部")}>查看全部资产</Button>
          </Empty>
        )}
      <div className="asset-library-note">
        <I.Info />
        <p>
          {scope === "项目资产"
            ? "草稿资产可用于试作。确认和升级版本是独立动作，已生成内容不会随资产更新而改变。"
            : "工作室共享资产引入项目时保留固定版本，后续升级由项目明确选择。"}
        </p>
      </div>
      {selectedAsset && (
        <Modal
          title={selectedAsset.name}
          subtitle={`${selectedAsset.kind}参考 / ${selectedAsset.version} / ${scope}`}
          onClose={() => setDetail(null)}
          wide
        >
          <div className="asset-detail-layout">
            <Frame index={selectedAsset.frame} className="asset-detail-image" />
            <div>
              <Badge
                tone={selectedAsset.status === "已确认" ? "green" : "amber"}
              >
                {selectedAsset.status}
              </Badge>
              <h3>{selectedAsset.note}</h3>
              <div className="key-values">
                <div>
                  <span>版本</span>
                  <strong>{selectedAsset.version} · 固定引用</strong>
                </div>
                <div>
                  <span>维护者</span>
                  <strong>陈舟</strong>
                </div>
                <div>
                  <span>使用位置</span>
                  <strong>{selectedAsset.usage}</strong>
                </div>
              </div>
              <p className="small muted">
                本地视觉示意。进入真实业务后，原始素材、版本依据和使用关系分别保存。
              </p>
              <div className="stack-actions">
                <Button
                  onClick={() => {
                    setDetail(null);
                    navigate("scene");
                  }}
                >
                  <I.ArrowSquareOut />
                  查看场次中的使用
                </Button>
                {scope === "工作室共享" && (
                  <Button
                    tone="primary"
                    disabled={state.importedAssets.includes(selectedAsset.id)}
                    onClick={() => {
                      setState((s) => ({
                        ...s,
                        importedAssets: [...s.importedAssets, selectedAsset.id],
                      }));
                      notify(
                        `已在本地记录引入 ${selectedAsset.name} / ${selectedAsset.version}。`,
                      );
                    }}
                  >
                    <I.Plus />
                    {state.importedAssets.includes(selectedAsset.id)
                      ? "已引入当前项目"
                      : "引入当前项目"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
      {upload && (
        <Modal
          title="导入素材"
          subtitle="仅在本浏览器查看图片，不会上传到任何服务。"
          onClose={() => setUpload(false)}
        >
          <div className="modal-body">
            <label className="upload-zone">
              <I.UploadSimple size={32} />
              <strong>选择本地图片</strong>
              <span>PNG、JPEG、WebP · 单张最大 20 MB</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(e) => {
                  const accepted = Array.from(e.target.files || []).filter(
                    (f) =>
                      ["image/png", "image/jpeg", "image/webp"].includes(
                        f.type,
                      ) && f.size <= 20 * 1024 * 1024,
                  );
                  if (!accepted.length) {
                    notify("请选择不超过 20 MB 的 PNG、JPEG 或 WebP 图片。");
                    return;
                  }
                  setLocalFiles((items) => [
                    ...items,
                    ...accepted.map((f) => {
                      const url = URL.createObjectURL(f);
                      createdUrls.current.push(url);
                      return { id: crypto.randomUUID(), name: f.name, url };
                    }),
                  ]);
                  setScope("项目资产");
                  setFilter("全部");
                  setSearch("");
                  setUpload(false);
                  notify(
                    `已在本次会话中打开 ${accepted.length} 张图片；离开页面后需重新选择。`,
                  );
                }}
              />
            </label>
            <p className="small muted">
              该入口用于评估导入交互。生产版本会进行媒体归档、权限和文件校验。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
