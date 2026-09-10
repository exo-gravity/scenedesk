import { SceneProduction } from "./SceneProduction";
import { NativeSelect, Textarea } from "@mantine/core";
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import * as I from "../icons";
import {
  Avatar,
  Badge,
  Button,
  Empty,
  Frame,
  IconButton,
  Modal,
  Player,
} from "../components/ui";
import { clipFromShot, timecode } from "../model";
import type { Clip, DemoState, SceneView } from "../model";
import type { Navigate, Notify, ReworkSource } from "../App";
type Props = {
  state: DemoState;
  setState: Dispatch<SetStateAction<DemoState>>;
  selected: number;
  setSelected: (id: number) => void;
  view: SceneView;
  onView: (v: SceneView) => void;
  onAction: (
    a: "suggest" | "plan" | "prompt" | "rework",
    source?: ReworkSource,
  ) => void;
  notify: Notify;
  navigate: Navigate;
};
export function ScenePage({
  state,
  setState,
  selected,
  setSelected,
  view,
  onView,
  onAction,
  notify,
  navigate,
}: Props) {
  const [inspector, setInspector] = useState("compose");
  const [preview, setPreview] = useState(false);
  const [time, setTime] = useState(21);
  const [reviewNumber, setReviewNumber] = useState(
    state.revisions.at(-1)?.number || 0,
  );
  const [comment, setComment] = useState("");
  const [reviewFilter, setReviewFilter] = useState("全部意见");
  const [replace, setReplace] = useState(false);
  const [expandedShot, setExpandedShot] = useState<number | null>(null);
  const shot = state.shots.find((s) => s.id === selected)!;
  const clip = state.clips.find((c) => c.shotId === selected);
  const duration = state.clips.reduce((n, c) => n + c.seconds, 0);
  const review =
    state.revisions.find((r) => r.number === reviewNumber) ||
    state.revisions.at(-1);
  const [selectedClipId, setSelectedClipId] = useState(4);
  const editClip =
    state.clips.find((c) => c.shotId === selectedClipId) || state.clips[0]!;
  function useInCut() {
    setState((s) => ({
      ...s,
      clips: s.clips.some((c) => c.shotId === selected)
        ? s.clips.map((c) =>
            c.shotId === selected
              ? { ...c, take: shot.selected, frame: shot.frame }
              : c,
          )
        : [...s.clips, clipFromShot(shot)],
    }));
    setReplace(false);
    notify("已更新当前剪辑草稿，固定审阅版本保持原样。");
  }
  function freeze() {
    const number = Math.max(0, ...state.revisions.map((r) => r.number)) + 1;
    setState((s) => ({
      ...s,
      revisions: [
        ...s.revisions,
        {
          number,
          clips: structuredClone(s.clips),
          status: "待审阅",
          comments: [],
        },
      ],
    }));
    setReviewNumber(number);
    setTime(0);
    onView("review");
    notify(`已建立 v${number} 的本地状态快照，未执行真实视频渲染。`);
  }
  function moveClip(direction: -1 | 1) {
    const i = state.clips.findIndex((c) => c.shotId === editClip.shotId);
    const j = i + direction;
    if (j < 0 || j >= state.clips.length) return;
    setState((s) => {
      const clips = [...s.clips];
      [clips[i], clips[j]] = [clips[j]!, clips[i]!];
      return { ...s, clips };
    });
    setTime(0);
    notify("剪辑顺序已调整；制作中的分镜顺序不受影响。");
  }
  function addComment() {
    if (!comment.trim() || !review) return;
    setState((s) => ({
      ...s,
      revisions: s.revisions.map((r) =>
        r.number === review.number
          ? {
              ...r,
              comments: [
                ...r.comments,
                {
                  id: crypto.randomUUID(),
                  text: comment.trim(),
                  time,
                  author: "许知",
                  resolved: false,
                },
              ],
            }
          : r,
      ),
    }));
    setComment("");
    notify(`意见已记录在 v${review.number} / ${timecode(time)}。`);
  }
  return (
    <div className="scene-page">
      <div className="scene-heading">
        <div>
          <div className="scene-kicker">
            <span>第 1 集 · 重逢</span>
            <I.CaretRight size={12} />
            <span>场次 01</span>
          </div>
          <div className="title-row">
            <h1>咖啡厅的旧钥匙</h1>
            <Badge tone="amber">制作中</Badge>
          </div>
          <div className="scene-facts">
            <span>
              <I.Sun />日 / 内
            </span>
            <span>
              <I.FilmStrip />
              {state.shots.length} 个镜头
            </span>
            <span>
              <I.Timer />
              {duration} 秒编排
            </span>
            <span className="scene-owner">
              <Avatar name="许知" color={2} small />
              许知主责
            </span>
          </div>
        </div>
        <div className="scene-header-actions">
          <Button
            onClick={() => {
              setTime(0);
              setPreview(true);
            }}
          >
            <I.Play />
            预演场次
          </Button>
          <Button
            tone="primary"
            onClick={() =>
              view === "edit"
                ? freeze()
                : view === "review"
                  ? navigate("delivery")
                  : onView("edit")
            }
          >
            {view === "edit" ? (
              <I.ChatCircleText />
            ) : view === "review" ? (
              <I.ArrowRight />
            ) : (
              <I.Scissors />
            )}
            {view === "edit"
              ? "生成审阅版本"
              : view === "review"
                ? "整集与交付"
                : "进入剪辑"}
          </Button>
        </div>
      </div>
      <div className="scene-tabs">
        <nav aria-label="场次视图">
          {(
            [
              { v: "production", name: "制作", Icon: I.GridFour },
              { v: "edit", name: "剪辑", Icon: I.Scissors },
              { v: "review", name: "审阅", Icon: I.ChatCircleText },
            ] as const
          ).map(({ v, name, Icon }) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              aria-current={view === v ? "page" : undefined}
              onClick={() => {
                onView(v);
                setTime(v === "review" ? 24 : 0);
              }}
            >
              <Icon />
              {name}
              {v === "review" && <span>{state.revisions.length}</span>}
            </button>
          ))}
        </nav>
        <div className="context-status">
          <I.CheckCircle />
          创作依据已确认 <span>·</span>
          <button onClick={() => navigate("script")}>
            查看戏文
            <I.ArrowUpRight size={12} />
          </button>
        </div>
      </div>
      {view === "production" && (
        <SceneProduction
          state={state}
          setState={setState}
          selected={selected}
          setSelected={setSelected}
          inspector={inspector}
          setInspector={setInspector}
          onExpand={setExpandedShot}
          onReplace={() => setReplace(true)}
          onAction={onAction}
          notify={notify}
          navigate={navigate}
        />
      )}
      {view === "edit" && (
        <div className="editing-workspace">
          <div className="edit-upper">
            <aside className="edit-bin">
              <div className="label-with-action">
                <h2>已采用镜头</h2>
                <span>{state.shots.filter((s) => s.selected).length}</span>
              </div>
              <p className="small muted">加入后保存实际使用的候选。</p>
              {state.shots
                .filter((s) => s.selected)
                .map((s) => (
                  <button
                    key={s.id}
                    className={
                      editClip.shotId === s.id ? "bin-item active" : "bin-item"
                    }
                    onClick={() => {
                      setSelectedClipId(s.id);
                      setSelected(s.id);
                      if (!state.clips.some((c) => c.shotId === s.id))
                        setState((st) => ({
                          ...st,
                          clips: [...st.clips, clipFromShot(s)],
                        }));
                      setTime(
                        state.clips
                          .slice(
                            0,
                            state.clips.findIndex((c) => c.shotId === s.id),
                          )
                          .reduce((n, c) => n + c.seconds, 0),
                      );
                    }}
                  >
                    <Frame index={s.frame} />
                    <div>
                      <strong>{s.label}</strong>
                      <small>{s.title}</small>
                    </div>
                    <span>{s.seconds}s</span>
                  </button>
                ))}
            </aside>
            <div className="edit-preview">
              <Player
                clips={state.clips}
                time={Math.min(time, duration)}
                setTime={setTime}
                subtitles={state.subtitleEnabled}
              />
            </div>
            <aside className="clip-inspector">
              <h2>片段属性</h2>
              <Badge>
                {editClip.label} / {editClip.take}
              </Badge>
              <label className="field-label">实际使用</label>
              <p>{state.shots.find((s) => s.id === editClip.shotId)?.title}</p>
              <div className="key-values">
                <div>
                  <span>画幅</span>
                  <strong>9:16</strong>
                </div>
                <div>
                  <span>片段时长</span>
                  <strong>{editClip.seconds} 秒</strong>
                </div>
                <div>
                  <span>素材范围</span>
                  <strong>00:00 — {timecode(editClip.seconds)}</strong>
                </div>
                <div>
                  <span>显示方式</span>
                  <strong>完整画面</strong>
                </div>
              </div>
              <label className="field-label" htmlFor="clip-seconds">
                裁切时长 · 秒
              </label>
              <input
                id="clip-seconds"
                type="range"
                min={1}
                max={
                  state.shots.find((s) => s.id === editClip.shotId)?.seconds ||
                  editClip.seconds
                }
                step={1}
                value={editClip.seconds}
                onChange={(e) => {
                  const seconds = Number(e.target.value);
                  setState((s) => ({
                    ...s,
                    clips: s.clips.map((c) =>
                      c.shotId === editClip.shotId ? { ...c, seconds } : c,
                    ),
                  }));
                  setTime(0);
                }}
              />
              <p className="small muted">
                演示中字幕随关联片段显示。真实裁切需按媒体帧边界处理。
              </p>
              <Button
                className="full-width"
                onClick={() => {
                  setSelected(editClip.shotId);
                  onView("production");
                  setInspector("candidates");
                }}
              >
                <I.ArrowSquareOut />
                回到镜头与候选
              </Button>
            </aside>
          </div>
          <div className="timeline-panel">
            <div className="timeline-toolbar">
              <div className="row">
                <h2>场次剪辑草稿</h2>
                <Badge>本地示例</Badge>
              </div>
              <div className="row">
                <IconButton
                  label="前移选中片段"
                  disabled={state.clips[0]?.shotId === editClip.shotId}
                  onClick={() => moveClip(-1)}
                >
                  <I.CaretLeft />
                </IconButton>
                <IconButton
                  label="后移选中片段"
                  disabled={state.clips.at(-1)?.shotId === editClip.shotId}
                  onClick={() => moveClip(1)}
                >
                  <I.CaretRight />
                </IconButton>
                <Button onClick={freeze}>
                  <I.ChatCircleText />
                  生成审阅版本
                </Button>
              </div>
            </div>
            <div className="timeline-scroll">
              <div className="timeline-ruler">
                <span className="track-name">轨道</span>
                <div>
                  {Array.from({ length: 6 }, (_, i) => (
                    <span key={i}>{timecode((duration * i) / 5)}</span>
                  ))}
                </div>
              </div>
              <div className="timeline-track">
                <div className="track-name">
                  <I.FilmStrip />
                  <span>主视频</span>
                </div>
                <div className="video-track">
                  {state.clips.map((c) => (
                    <button
                      key={c.shotId}
                      className={`timeline-clip ${editClip.shotId === c.shotId ? "selected" : ""}`}
                      style={{ flex: c.seconds }}
                      onClick={() => {
                        setSelectedClipId(c.shotId);
                        setTime(
                          state.clips
                            .slice(0, state.clips.indexOf(c))
                            .reduce((n, x) => n + x.seconds, 0),
                        );
                      }}
                    >
                      <Frame index={c.frame} />
                      <span>
                        {c.label} / {c.take}
                        <small>{c.seconds}s</small>
                      </span>
                    </button>
                  ))}
                  <div
                    className="playhead"
                    style={{
                      left: `${(Math.min(time, duration) / duration) * 100}%`,
                    }}
                  >
                    <span />
                  </div>
                </div>
              </div>
              <div className="timeline-track">
                <button
                  className="track-name"
                  onClick={() =>
                    setState((s) => ({ ...s, audioMuted: !s.audioMuted }))
                  }
                >
                  {state.audioMuted ? <I.SpeakerSlash /> : <I.SpeakerHigh />}
                  <span>原生声音</span>
                </button>
                <div
                  className={`audio-track ${state.audioMuted ? "muted-track" : ""}`}
                >
                  {state.clips.map((c) => (
                    <span key={c.shotId} style={{ flex: c.seconds }}>
                      <i className="waveform-illustration" />
                      <small>{state.audioMuted ? "已静音" : "示例音轨"}</small>
                    </span>
                  ))}
                </div>
              </div>
              <div className="timeline-track">
                <button
                  className="track-name"
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      subtitleEnabled: !s.subtitleEnabled,
                    }))
                  }
                >
                  <I.TextT />
                  <span>字幕 {state.subtitleEnabled ? "" : "· 隐藏"}</span>
                </button>
                <div
                  className={`subtitle-track ${!state.subtitleEnabled ? "muted-track" : ""}`}
                >
                  {state.clips.map((c) => (
                    <span
                      className={c.dialogue ? "has-dialogue" : ""}
                      key={c.shotId}
                      style={{ flex: c.seconds }}
                    >
                      {c.dialogue}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="timeline-bottom">
              <span>
                <I.CheckCircle />
                草稿保存在本机
              </span>
              <span>
                图像、音轨与字幕为设计示例 · 总时长 {timecode(duration)}
              </span>
            </div>
          </div>
        </div>
      )}
      {view === "review" && (
        <div className="review-workspace">
          {review ? (
            <>
              <section className="review-main">
                <div className="review-toolbar">
                  <div className="row">
                    <h2>场次审阅</h2>
                    <NativeSelect
                      aria-label="审阅版本"
                      value={review.number}
                      onChange={(e) => {
                        setReviewNumber(Number(e.target.value));
                        setTime(0);
                      }}
                    >
                      {[...state.revisions].reverse().map((r) => (
                        <option key={r.number} value={r.number}>
                          v{r.number} · {r.status}
                        </option>
                      ))}
                    </NativeSelect>
                    <Badge
                      tone={
                        review.status === "已确认"
                          ? "green"
                          : review.status === "需修改"
                            ? "amber"
                            : "neutral"
                      }
                    >
                      {review.status}
                    </Badge>
                  </div>
                  <span className="small muted">
                    固定稿件 · {review.clips.length} 镜
                  </span>
                </div>
                <Player
                  clips={review.clips}
                  time={Math.min(
                    time,
                    review.clips.reduce((n, c) => n + c.seconds, 0),
                  )}
                  setTime={setTime}
                  subtitles
                  large
                />
                <div className="review-source">
                  <I.LockSimple />
                  <div>
                    <strong>你正在查看固定版本 v{review.number}</strong>
                    <p>新候选和新草稿不会改变这份内容，意见始终留在此版本。</p>
                  </div>
                  <Button
                    onClick={() => {
                      let end = 0;
                      const source =
                        review.clips.find((clip) => {
                          end += clip.seconds;
                          return time < end;
                        }) || review.clips.at(-1)!;
                      setSelected(source.shotId);
                      onView("production");
                      setInspector("candidates");
                    }}
                  >
                    <I.ArrowSquareOut />
                    查看镜头来源
                  </Button>
                </div>
                <div className="review-filmstrip">
                  {review.clips.map((c) => (
                    <button
                      key={c.shotId}
                      onClick={() =>
                        setTime(
                          review.clips
                            .slice(0, review.clips.indexOf(c))
                            .reduce((n, x) => n + x.seconds, 0),
                        )
                      }
                    >
                      <Frame index={c.frame} />
                      <span>
                        {c.label} / {c.take}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <aside className="review-comments">
                <div className="comments-heading">
                  <h2>
                    审阅意见 <span>{review.comments.length}</span>
                  </h2>
                  <I.ChatCircleText />
                </div>
                <div className="filter-chips">
                  {["全部意见", "待处理"].map((f) => (
                    <button
                      className={reviewFilter === f ? "active" : ""}
                      key={f}
                      onClick={() => setReviewFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <div className="comment-list">
                  {review.comments
                    .filter((c) => reviewFilter === "全部意见" || !c.resolved)
                    .map((c) => (
                      <article className="comment-card" key={c.id}>
                        <div className="comment-author">
                          <Avatar
                            name={c.author}
                            color={c.author === "陈舟" ? 0 : 2}
                            small
                          />
                          <strong>{c.author}</strong>
                          <small>{c.author === "陈舟" ? "主创" : "制作"}</small>
                        </div>
                        <button
                          className="comment-time"
                          onClick={() => setTime(c.time)}
                        >
                          <I.Play weight="fill" size={10} />
                          {timecode(c.time)}
                          <span>v{review.number}</span>
                        </button>
                        <p>{c.text}</p>
                        <div className="comment-actions">
                          <button
                            onClick={() => {
                              setState((s) => ({
                                ...s,
                                revisions: s.revisions.map((r) =>
                                  r.number === review.number
                                    ? {
                                        ...r,
                                        comments: r.comments.map((item) =>
                                          item.id === c.id
                                            ? {
                                                ...item,
                                                resolved: !item.resolved,
                                              }
                                            : item,
                                        ),
                                      }
                                    : r,
                                ),
                              }));
                            }}
                            className={c.resolved ? "resolved" : ""}
                          >
                            {c.resolved ? <I.CheckCircle /> : <I.Circle />}
                            {c.resolved ? "已处理" : "标记已处理"}
                          </button>
                          {!c.resolved && (
                            <button
                              onClick={() => {
                                let end = 0;
                                const source =
                                  review.clips.find((clip) => {
                                    end += clip.seconds;
                                    return c.time < end;
                                  }) || review.clips.at(-1)!;
                                setSelected(source.shotId);
                                onAction("rework", {
                                  number: review.number,
                                  time: c.time,
                                  text: c.text,
                                  shotId: source.shotId,
                                });
                              }}
                            >
                              <I.Sparkle />
                              准备修改
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  {!review.comments.length && (
                    <Empty
                      title="等待第一条反馈"
                      text="播放或定位到某个时刻，记录具体修改意见。"
                    />
                  )}
                </div>
                <div className="comment-composer">
                  <div className="label-with-action">
                    <label className="field-label" htmlFor="comment-text">
                      添加意见
                    </label>
                    <span className="comment-time">{timecode(time)}</span>
                  </div>
                  <Textarea
                    id="comment-text"
                    rows={3}
                    placeholder="描述需要保留或修改的内容…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <Button
                    className="full-width"
                    disabled={!comment.trim()}
                    onClick={addComment}
                  >
                    <I.PaperPlaneTilt />
                    记录到 v{review.number}
                  </Button>
                </div>
                <div className="review-decision">
                  <span className="field-label">主创决定 · 预览操作</span>
                  <div className="row">
                    <Button
                      disabled={review.status !== "待审阅"}
                      onClick={() => {
                        setState((s) => ({
                          ...s,
                          revisions: s.revisions.map((r) =>
                            r.number === review.number
                              ? { ...r, status: "需修改" }
                              : r,
                          ),
                        }));
                        notify("已模拟记录需修改，决定只作用于这份固定稿。");
                      }}
                    >
                      需要修改
                    </Button>
                    <Button
                      tone="primary"
                      disabled={review.status !== "待审阅"}
                      onClick={() => {
                        setState((s) => ({
                          ...s,
                          revisions: s.revisions.map((r) =>
                            r.number === review.number
                              ? { ...r, status: "已确认" }
                              : r,
                          ),
                        }));
                        notify("已模拟确认此场次版本；整集仍需独立审阅。");
                      }}
                    >
                      <I.Check />
                      确认场次
                    </Button>
                  </div>
                  <small>场次确认后可用于整集，整集另行确认。</small>
                </div>
              </aside>
            </>
          ) : (
            <Empty title="还没有审阅版本" text="从剪辑草稿生成第一份固定版本。">
              <Button onClick={() => onView("edit")}>进入剪辑</Button>
            </Empty>
          )}
        </div>
      )}
      {preview && (
        <Modal
          title="咖啡厅的旧钥匙"
          subtitle="按当前剪辑顺序查看静帧，非真实视频渲染。"
          onClose={() => setPreview(false)}
          wide
        >
          <Player
            clips={state.clips}
            time={Math.min(time, duration)}
            setTime={setTime}
            subtitles={state.subtitleEnabled}
            large
          />
        </Modal>
      )}
      {expandedShot !== null && (
        <Modal
          title={`${state.shots.find((s) => s.id === expandedShot)?.label} · 分镜画面`}
          subtitle="写实视觉示意 · 当前画幅 9:16"
          onClose={() => setExpandedShot(null)}
        >
          <Frame
            index={state.shots.find((s) => s.id === expandedShot)?.frame || 0}
            className="expanded-frame"
          />
        </Modal>
      )}
      {replace && (
        <Modal
          title={clip ? "更新剪辑草稿" : "加入剪辑草稿"}
          subtitle={`${shot.label} · 当前采用 ${shot.selected}`}
          onClose={() => setReplace(false)}
        >
          <div className="modal-body">
            <div className="replacement-summary">
              <div>
                <span>剪辑当前使用</span>
                <strong>{clip?.take || "未加入"}</strong>
              </div>
              <I.ArrowRight />
              <div>
                <span>替换为</span>
                <strong>{shot.selected}</strong>
              </div>
            </div>
            <div className="inline-note">
              <I.Info />
              <span>
                本次演示保持现有片段时长 {clip?.seconds || shot.seconds}{" "}
                秒。冻结审阅版本不会改变。
              </span>
            </div>
            <div className="modal-actions">
              <Button onClick={() => setReplace(false)}>暂不更新</Button>
              <Button tone="primary" onClick={useInCut}>
                确认用于草稿
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
