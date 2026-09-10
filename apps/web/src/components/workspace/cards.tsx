import type { ReactNode } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Loader,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowsOut,
  Check,
  CheckCircle,
  Clock,
  FilmStrip,
  ImageSquare,
  Info,
  WarningCircle,
  X,
} from "../../icons";
import { Frame } from "../ui";
import type { Clip, Shot } from "../../model";
import classes from "./workspace.module.css";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";
export function StatusLabel({
  tone = "neutral",
  children,
  icon,
}: {
  tone?: StatusTone;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span className={classes.status} data-tone={tone}>
      {icon}
      {children}
    </span>
  );
}

export function MediaViewport({
  frame = 0,
  title,
  className = "",
  videoSrc,
  children,
}: {
  frame?: number;
  title: string;
  className?: string | undefined;
  videoSrc?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`${classes.mediaViewport} ${className}`}>
      {videoSrc ? (
        <video
          src={videoSrc}
          controls
          preload="metadata"
          playsInline
          aria-label={title}
        />
      ) : (
        <Frame
          index={frame}
          fit="contain"
          alt={title}
          className={classes.frame}
        />
      )}
      {children}
    </div>
  );
}

export function ShotCard({
  shot,
  clip,
  selected,
  feedbackCount,
  onSelect,
  onExpand,
  list = false,
}: {
  shot: Shot;
  clip?: Clip | undefined;
  selected: boolean;
  feedbackCount: number;
  onSelect: () => void;
  onExpand: () => void;
  list?: boolean;
}) {
  return (
    <article
      className={classes.shotCard}
      data-selected={selected || undefined}
      data-layout={list ? "list" : "grid"}
      data-shot-id={shot.id}
    >
      <UnstyledButton
        className={classes.shotSelect}
        onClick={onSelect}
        aria-label={`选择 ${shot.label} ${shot.title}`}
        aria-pressed={selected}
      >
        <div className={classes.shotHeading}>
          <span>{shot.label}</span>
          <span>{shot.camera.split(" · ")[0]}</span>
          <span className={classes.selectionMark} aria-hidden>
            {selected && <Check size={12} weight="bold" />}
          </span>
        </div>
        {shot.candidates.length ? (
          <MediaViewport
            frame={shot.frame}
            title={`${shot.label} ${shot.title}，分镜示意图`}
            className={classes.shotMedia}
          >
            <span className={classes.mediaLabel}>分镜图</span>
            <span className={classes.duration}>{shot.seconds}s</span>
          </MediaViewport>
        ) : (
          <div className={classes.emptyMedia}>
            <ImageSquare size={28} />
            <Text size="xs">待准备画面</Text>
          </div>
        )}
        <div className={classes.shotCopy}>
          <h3>{shot.title}</h3>
          <p>{shot.intent}</p>
          <div className={classes.shotFacts}>
            <span>
              {shot.selected ? `已采用 ${shot.selected}` : "尚未采用"}
            </span>
            <span>{shot.candidates.length} 个候选</span>
          </div>
        </div>
      </UnstyledButton>
      <div className={classes.shotFooter}>
        <span>
          <FilmStrip size={14} />
          {clip ? `剪辑使用 ${clip.take}` : "未加入剪辑"}
        </span>
        {feedbackCount > 0 && (
          <StatusLabel tone="warning" icon={<WarningCircle size={14} />}>
            {feedbackCount} 条待处理
          </StatusLabel>
        )}
        <Tooltip label="查看完整分镜">
          <ActionIcon
            size="sm"
            aria-label={`放大 ${shot.label} 分镜`}
            onClick={onExpand}
          >
            <ArrowsOut size={14} />
          </ActionIcon>
        </Tooltip>
      </div>
    </article>
  );
}

export function CandidateCard({
  shot,
  take,
  viewed,
  used,
  onView,
  onAdopt,
}: {
  shot: Shot;
  take: string;
  viewed: boolean;
  used: boolean;
  onView: () => void;
  onAdopt: () => void;
}) {
  const adopted = shot.selected === take;
  return (
    <article className={classes.candidate} data-selected={viewed || undefined}>
      <UnstyledButton
        className={classes.candidatePreview}
        onClick={onView}
        aria-label={`查看候选 ${take}`}
        aria-pressed={viewed}
      >
        <MediaViewport
          frame={shot.frame}
          title={`${shot.label} 候选 ${take} 示意图`}
        />
      </UnstyledButton>
      <div className={classes.candidateCopy}>
        <Group gap="sm">
          <Text fw={500}>候选 {take}</Text>
          {adopted && (
            <StatusLabel icon={<Check size={13} />}>已采用</StatusLabel>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {shot.seconds} 秒 · 分镜示意
        </Text>
        <Text size="xs" c="dimmed">
          {used ? `剪辑正在使用 ${take}` : "未用于当前剪辑"}
        </Text>
        <Group gap="sm" mt="sm">
          <Button size="xs" onClick={onView}>
            查看画面
          </Button>
          <Button
            size="xs"
            variant="subtle"
            disabled={adopted}
            onClick={onAdopt}
          >
            {adopted ? "当前采用" : "采用此候选"}
          </Button>
        </Group>
      </div>
    </article>
  );
}

export type AssetDisplay = {
  id: number;
  name: string;
  kind: string;
  note: string;
  frame: number;
  version: string;
};
export function AssetCard({
  asset,
  onOpen,
  compact = false,
}: {
  asset: AssetDisplay;
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <UnstyledButton
      className={classes.asset}
      data-compact={compact || undefined}
      onClick={onOpen}
      aria-label={`查看参考 ${asset.name} ${asset.version}`}
    >
      <MediaViewport frame={asset.frame} title={`${asset.name} 参考示意图`} />
      <div>
        <Text size="xs" fw={500} truncate>
          {asset.name}
        </Text>
        <Text size="xs" c="dimmed">
          {compact ? asset.version : `${asset.kind} · ${asset.version}`}
        </Text>
        {!compact && (
          <Text size="xs" c="dimmed">
            {asset.note}
          </Text>
        )}
      </div>
    </UnstyledButton>
  );
}

export type GenerationPhase =
  | "queued"
  | "running"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";
const phases: Record<GenerationPhase, { label: string; tone: StatusTone }> = {
  queued: { label: "排队中", tone: "neutral" },
  running: { label: "生成中", tone: "info" },
  processing: { label: "产物处理中", tone: "info" },
  succeeded: { label: "结果已就绪", tone: "success" },
  failed: { label: "生成失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "neutral" },
  unknown: { label: "提交待核对", tone: "warning" },
};
export function GenerationCard({
  phase,
  title,
  detail,
  action,
}: {
  phase: GenerationPhase;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  const config = phases[phase];
  const icon =
    phase === "running" || phase === "processing" ? (
      <Loader size={14} color="var(--ws-info)" />
    ) : phase === "succeeded" ? (
      <CheckCircle size={16} />
    ) : phase === "failed" || phase === "unknown" ? (
      <WarningCircle size={16} />
    ) : phase === "cancelled" ? (
      <X size={16} />
    ) : (
      <Clock size={16} />
    );
  return (
    <article className={classes.generation} aria-label={title}>
      <Group justify="space-between">
        <Text fw={500}>{title}</Text>
        <StatusLabel tone={config.tone} icon={icon}>
          {config.label}
        </StatusLabel>
      </Group>
      <Text size="xs" c="dimmed" mt="sm">
        {detail}
      </Text>
      {action && <div className={classes.generationAction}>{action}</div>}
    </article>
  );
}

export function InlineNote({ children }: { children: ReactNode }) {
  return (
    <div className={classes.note}>
      <Info size={16} />
      <Text size="xs">{children}</Text>
    </div>
  );
}
