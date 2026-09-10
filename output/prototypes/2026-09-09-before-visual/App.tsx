import { useEffect, useState } from "react";

type Shot = {
  id: number;
  label: string;
  intent: string;
  seconds: number;
  selected: string;
  candidates: string[];
};
type Clip = { shotId: number; label: string; take: string; seconds: number };
type Revision = {
  number: number;
  clips: Clip[];
  status: "待审阅" | "需修改" | "已通过";
  comments: string[];
};
const initial: Shot[] = [
  { id: 1, label: "SH-01", intent: "双人中景，建立桌面与人物位置", seconds: 6 },
  { id: 2, label: "SH-02", intent: "林夏追问钥匙的来历", seconds: 8 },
  { id: 3, label: "SH-03", intent: "周远避开目光，停顿后回答", seconds: 7 },
  { id: 4, label: "SH-04", intent: "钥匙从桌面移到林夏右手", seconds: 9 },
  { id: 5, label: "SH-05", intent: "林夏握住钥匙，表情变化", seconds: 8 },
  { id: 6, label: "SH-06", intent: "双人反应，保留片尾停顿", seconds: 8 },
].map((shot) => ({ ...shot, selected: "A", candidates: ["A", "B"] }));
const clipFrom = (shot: Shot): Clip => ({
  shotId: shot.id,
  label: shot.label,
  take: shot.selected,
  seconds: shot.seconds,
});

function App() {
  const [view, setView] = useState("制作");
  const [shots, setShots] = useState(initial);
  const [selected, setSelected] = useState(4);
  const [clips, setClips] = useState<Clip[]>(initial.map(clipFrom));
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [reviewNumber, setReviewNumber] = useState(0);
  const [drawer, setDrawer] = useState<
    "suggest" | "prompt" | "rework" | "plan" | null
  >(null);
  const [prompts, setPrompts] = useState<Record<number, string>>({
    4: "保持两位人物、咖啡厅与灰风衣参考；特写钥匙从桌面移到林夏右手，接触自然，动作连续。",
  });
  const [feedback, setFeedback] = useState(
    "00:24 钥匙与右手接触不自然；保留人物、服装与相邻镜头节奏。",
  );
  const [message, setMessage] = useState(
    "选择一个镜头，查看采用与剪辑实际使用的区别。",
  );
  const [api, setApi] = useState("未连接");
  const shot = shots.find((item) => item.id === selected)!;
  const prompt =
    prompts[selected] ?? `保持场次已选人物与空间参考；${shot.intent}。`;
  const setPrompt = (value: string) =>
    setPrompts((previous) => ({ ...previous, [selected]: value }));
  const clip = clips.find((item) => item.shotId === selected);
  const review = revisions.find((item) => item.number === reviewNumber);
  const duration = clips.reduce((sum, item) => sum + item.seconds, 0);
  useEffect(() => {
    fetch("/health/live")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(() => setApi("工程 API 可用"))
      .catch(() => setApi("离线交互可用"));
  }, []);
  function adopt(take: string) {
    setShots((items) =>
      items.map((item) =>
        item.id === selected ? { ...item, selected: take } : item,
      ),
    );
    setMessage(
      `已模拟采用 ${shot.label} 候选 ${take}。剪辑中的使用保持原样，请明确更新。`,
    );
  }
  function updateCut() {
    setClips((items) =>
      items.some((item) => item.shotId === selected)
        ? items.map((item) =>
            item.shotId === selected ? clipFrom(shot) : item,
          )
        : [...items, clipFrom(shot)],
    );
    setMessage(
      `已明确将 ${shot.label} 当前采用 ${shot.selected} 用于演示草稿；已冻结版本保持原样。`,
    );
  }
  function freeze() {
    const number = revisions.length + 1;
    setRevisions((items) => [
      ...items,
      { number, clips: structuredClone(clips), status: "待审阅", comments: [] },
    ]);
    setReviewNumber(number);
    setView("审阅");
    setMessage(
      `已建立 v${number} 的独立状态快照。这里未执行媒体渲染，审批仅用于交互验证。`,
    );
  }
  function decide(status: Revision["status"]) {
    setRevisions((items) =>
      items.map((item) =>
        item.number === reviewNumber ? { ...item, status } : item,
      ),
    );
    setMessage(
      `模拟决定已固定到 v${reviewNumber}；新草稿不继承此结果，整集仍需独立确认。`,
    );
  }
  function addSuggestion() {
    const id = Math.max(...shots.map((item) => item.id)) + 1;
    setShots((items) => [
      ...items,
      {
        id,
        label: `SH-${String(id).padStart(2, "0")}`,
        intent: "补拍桌面空位，交代钥匙已被拿走",
        seconds: 3,
        selected: "",
        candidates: [],
      },
    ]);
    setSelected(id);
    setDrawer(null);
    setMessage(
      "分镜建议已追加至当前咖啡厅场次；现有镜头、采用和剪辑没有被覆盖。",
    );
  }
  function simulate() {
    const name = `试作${shot.candidates.length + 1}`;
    setShots((items) =>
      items.map((item) =>
        item.id === selected
          ? { ...item, candidates: [...item.candidates, name] }
          : item,
      ),
    );
    setDrawer(null);
    setMessage(
      `添加了模拟候选 ${name}；没有调用模型、生成媒体或改变当前采用。`,
    );
  }
  return (
    <div className="app">
      <div className="demo-banner">
        <strong>S0 交互验证</strong>
        <span>
          虚构内容与内存状态 · 刷新重置 · 无真实生成、渲染、审批或费用
        </span>
        <a href="/design/openapi.json" target="_blank" rel="noreferrer">
          查看设计契约 ↗
        </a>
      </div>
      <header>
        <div className="wordmark">
          片场 <small>WORKBENCH</small>
        </div>
        <div className="breadcrumb">
          示例工作室 <span>/</span> 旧钥匙 <span>/</span> 第 1 集
        </div>
        <div className="connection">{api}</div>
      </header>
      <div className="workspace">
        <aside className="navigation">
          <p className="eyebrow">项目内容</p>
          <h3>旧钥匙</h3>
          <p className="muted">写实短剧 · 9:16</p>
          <div className="nav-label">第 1 集</div>
          <button className="scene current">
            01 咖啡厅 <small>当前场次 · {shots.length} 镜</small>
          </button>
          <p className="nav-label">完整 MVP 后续入口</p>
          <p className="muted small">
            整集编排与交付
            <br />第 2 集与资产复用
            <br />
            内部后期回传
          </p>
          <div className="scope-note">
            当前页面只验证场次交互。以上入口将在 S1–S3 实现。
          </div>
          <div className="owner">
            <span className="avatar">制</span>
            <div>
              <strong>场次主责</strong>
              <small>示例制作人员</small>
            </div>
          </div>
          <p className="small muted">成员协助 · 主创确认方向与结果</p>
        </aside>
        <main>
          <div className="scene-header">
            <div>
              <p className="eyebrow">SCENE 01 · 日 / 内</p>
              <h1>咖啡厅的旧钥匙</h1>
              <p>钥匙从桌面交到林夏右手，人物关系在短暂停顿中发生变化。</p>
            </div>
            <div className="scene-meta">
              <strong>{shots.length} 个镜头</strong>
              <span>{duration} 秒编排示意</span>
              <span>正式创作依据：示例已确认</span>
            </div>
          </div>
          <div className="tabs">
            <nav aria-label="场次视图">
              {["制作", "剪辑", "审阅"].map((item) => (
                <button
                  key={item}
                  aria-current={view === item ? "page" : undefined}
                  className={view === item ? "active" : ""}
                  onClick={() => {
                    setView(item);
                    setDrawer(null);
                  }}
                >
                  {item}
                </button>
              ))}
            </nav>
            <span>场次上下文随视图保留</span>
          </div>
          <div className="status" role="status">
            {message}
          </div>
          {view === "制作" && (
            <div className="production-layout">
              <section className="shots">
                <div className="section-heading">
                  <h2>分镜与候选</h2>
                  <button onClick={() => setDrawer("suggest")}>
                    生成分镜建议
                  </button>
                </div>
                <div className="shot-grid">
                  {shots.map((item) => (
                    <button
                      key={item.id}
                      className={`shot-card ${selected === item.id ? "selected" : ""}`}
                      onClick={() => setSelected(item.id)}
                    >
                      <div className="story-frame">
                        <span>{String(item.id).padStart(2, "0")}</span>
                        <small>分镜占位 · 非模型画面</small>
                        <b>{item.seconds}s</b>
                      </div>
                      <div className="shot-text">
                        <strong>{item.label}</strong>
                        <p>{item.intent}</p>
                        <div className="facts">
                          <span>{item.candidates.length} 个模拟候选</span>
                          <span>采用 {item.selected || "未选"}</span>
                        </div>
                        <small>
                          剪辑使用{" "}
                          {clips.find((c) => c.shotId === item.id)?.take ||
                            "未加入"}
                        </small>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
              <aside className="inspector">
                <div className="section-heading">
                  <h2>{shot.label}</h2>
                  <span className="badge">当前镜头</span>
                </div>
                <p>{shot.intent}</p>
                <p className="field-label">明确参考</p>
                <div className="reference">
                  林夏 / 灰风衣 v1 <span>造型</span>
                </div>
                <div className="reference">
                  咖啡厅 / 日景 v1 <span>空间</span>
                </div>
                <p className="small muted">
                  以上为虚构设定标签，未上传参考媒体。
                </p>
                <div className="pair">
                  <button onClick={() => setDrawer("prompt")}>
                    准备本次提示
                  </button>
                  <button onClick={() => setDrawer("plan")}>准备生成</button>
                </div>
                <hr />
                <p className="field-label">候选比较 · 模拟元数据</p>
                {shot.candidates.map((take) => (
                  <div className="candidate" key={take}>
                    <span>候选 {take}</span>
                    <button
                      className={shot.selected === take ? "chosen" : ""}
                      onClick={() => adopt(take)}
                    >
                      {shot.selected === take ? "当前采用" : `采用 ${take}`}
                    </button>
                  </div>
                ))}
                {!shot.candidates.length && (
                  <p className="empty">还没有候选。可先准备生成计划。</p>
                )}
                <div className="usage">
                  <strong>剪辑中的使用：{clip?.take || "未加入"}</strong>
                  <p>采用 {shot.selected || "未选"} 与剪辑分别记录。</p>
                  <button
                    disabled={!shot.selected || clip?.take === shot.selected}
                    onClick={updateCut}
                  >
                    将当前采用用于草稿
                  </button>
                </div>
              </aside>
            </div>
          )}
          {view === "剪辑" && (
            <section className="editing">
              <div className="section-heading">
                <div>
                  <h2>场次草稿</h2>
                  <p className="muted">
                    编排状态示意，尚无连续视频渲染。冻结后旧版本保持不变。
                  </p>
                </div>
                <button className="primary" onClick={freeze}>
                  冻结演示版本
                </button>
              </div>
              <div className="timeline">
                <div className="track-label">
                  主视频
                  <br />
                  <small>{duration} 秒</small>
                </div>
                <div className="clip-strip">
                  {clips.map((item, index) => (
                    <div className="clip" key={item.shotId}>
                      <b>{item.label}</b>
                      <span>
                        候选 {item.take} · {item.seconds}s
                      </span>
                      <button
                        disabled={index === 0}
                        aria-label={`前移 ${item.label}`}
                        onClick={() =>
                          setClips((items) => {
                            const copy = [...items];
                            [copy[index - 1], copy[index]] = [
                              copy[index]!,
                              copy[index - 1]!,
                            ];
                            return copy;
                          })
                        }
                      >
                        ← 前移
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="track-placeholder">
                <b>声音</b>
                <span>后续接入：原生音轨、独立声音、增益与明确静音</span>
              </div>
              <div className="track-placeholder">
                <b>字幕</b>
                <span>后续接入：准确文字、时间边界与实际 SRT</span>
              </div>
              <div className="notice">
                这里验证的是“采用、实际使用、冻结版本”的关系。帧采样归一、声音编辑和媒体导出尚未接入。
              </div>
              <h3>冻结版本</h3>
              {revisions.length ? (
                revisions.map((item) => (
                  <button
                    className="version"
                    key={item.number}
                    onClick={() => {
                      setReviewNumber(item.number);
                      setView("审阅");
                    }}
                  >
                    v{item.number} · {item.status}{" "}
                    <span>{item.clips.length} 个片段 · 状态快照</span>
                  </button>
                ))
              ) : (
                <p className="empty">
                  冻结第一份演示版本后，可验证审阅与新草稿的关系。
                </p>
              )}
            </section>
          )}
          {view === "审阅" && (
            <section className="review-area">
              <div className="section-heading">
                <h2>固定版本审阅</h2>
                <select
                  aria-label="审阅版本"
                  value={reviewNumber}
                  onChange={(event) =>
                    setReviewNumber(Number(event.target.value))
                  }
                >
                  <option value={0}>选择版本</option>
                  {revisions.map((item) => (
                    <option key={item.number} value={item.number}>
                      v{item.number} · {item.status}
                    </option>
                  ))}
                </select>
              </div>
              {review ? (
                <>
                  <div className="review-snapshot">
                    <p className="eyebrow">
                      v{review.number} · {review.status}
                    </p>
                    <h3>固定编排快照</h3>
                    <p>
                      {review.clips
                        .map((item) => `${item.label} / ${item.take}`)
                        .join(" → ")}
                    </p>
                    <small>
                      没有实际可播放文件；生产审阅必须等待媒体验收。本页仅模拟决定。
                    </small>
                  </div>
                  <div className="review-columns">
                    <div>
                      <h3>该版本意见</h3>
                      {review.comments.map((comment, index) => (
                        <p className="comment" key={index}>
                          {comment}
                        </p>
                      ))}
                      <label htmlFor="feedback">返工说明</label>
                      <textarea
                        id="feedback"
                        value={feedback}
                        onChange={(event) => setFeedback(event.target.value)}
                      />
                      <button
                        disabled={
                          !feedback.trim() || review.status !== "待审阅"
                        }
                        onClick={() => {
                          setRevisions((items) =>
                            items.map((item) =>
                              item.number === reviewNumber
                                ? {
                                    ...item,
                                    comments: [...item.comments, feedback],
                                  }
                                : item,
                            ),
                          );
                          setMessage(
                            `意见保留在 v${reviewNumber}，没有移动到新草稿。`,
                          );
                        }}
                      >
                        保存模拟意见
                      </button>
                    </div>
                    <div>
                      <h3>主创决定 · 模拟身份</h3>
                      <p>
                        场次通过后可进入整集，整集仍独立审阅。生产环境将检查真实角色与媒体。
                      </p>
                      <div className="pair">
                        <button
                          disabled={review.status !== "待审阅"}
                          onClick={() => decide("需修改")}
                        >
                          模拟需修改
                        </button>
                        <button
                          className="primary"
                          disabled={review.status !== "待审阅"}
                          onClick={() => decide("已通过")}
                        >
                          模拟通过
                        </button>
                      </div>
                      <button
                        className="wide"
                        onClick={() => setDrawer("rework")}
                      >
                        按意见准备修改
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty large">
                  <h3>先冻结一份场次版本</h3>
                  <p>审阅总是指向固定版本，不能直接批准仍在变化的草稿。</p>
                  <button onClick={() => setView("剪辑")}>前往剪辑</button>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <aside
            className="drawer"
            aria-label="创作操作"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="close"
              aria-label="关闭操作面板"
              onClick={() => setDrawer(null)}
            >
              ×
            </button>
            <p className="eyebrow">{shot.label} · 咖啡厅</p>
            <h2>
              {
                {
                  suggest: "生成分镜建议",
                  prompt: "准备本次提示",
                  rework: "按意见准备修改",
                  plan: "本次生成计划",
                }[drawer]
              }
            </h2>
            <p className="notice">
              模拟建议与计划，不调用
              AI；关闭面板保留本次页面的编辑，刷新会重置。
            </p>
            {drawer === "suggest" ? (
              <>
                <p>目标：追加到当前场次。现有 {shots.length} 个镜头保留。</p>
                <div className="suggestion">
                  <strong>新增：钥匙被拿走后的桌面</strong>
                  <p>用 3 秒空位补镜，明确道具已离开桌面。</p>
                </div>
                <button className="primary wide" onClick={addSuggestion}>
                  采纳并追加到当前场次
                </button>
              </>
            ) : (
              <>
                {drawer === "rework" && (
                  <p className="comment">
                    来源：v{reviewNumber || "—"} · {feedback}
                  </p>
                )}
                <label htmlFor="prompt">可编辑提示建议</label>
                <textarea
                  id="prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
                <p className="field-label">保留</p>
                <p>人物身份、灰风衣、日景空间和相邻镜头节奏。</p>
                {drawer === "plan" ? (
                  <>
                    <div className="reference">
                      执行模式 <strong>Mock · 无外部调用</strong>
                    </div>
                    <div className="reference">
                      本次数量 <strong>1 个模拟候选</strong>
                    </div>
                    <p className="small muted">
                      没有供应商报价。真实生成需要已验证账号、输入和授权预算。
                    </p>
                    <button className="primary wide" onClick={simulate}>
                      运行模拟（无费用）
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="wide"
                      onClick={() => {
                        setDrawer(null);
                        setMessage(
                          "提示草稿保留在当前页面内存，可重开继续编辑；未保存至业务数据库。",
                        );
                      }}
                    >
                      保留演示草稿
                    </button>
                    <button
                      className="primary wide"
                      onClick={() => setDrawer("plan")}
                    >
                      用此建议准备计划
                    </button>
                  </>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export default App;
