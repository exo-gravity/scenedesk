import { useEffect, useId, useState } from "react";
import {
  ActionIcon,
  Badge as MantineBadge,
  Button as MantineButton,
  Modal as MantineModal,
  Text,
  Tooltip,
} from "@mantine/core";
import type { ButtonProps, ActionIconProps } from "@mantine/core";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { X, Play, Pause, SkipBack, ArrowsOut, SpeakerSlash } from "../icons";
import type { Clip } from "../model";
import { timecode } from "../model";
export function Button({
  children,
  tone = "default",
  className = "",
  ...props
}: ButtonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonProps> & {
    tone?: "default" | "primary" | "ghost" | "danger";
    children: ReactNode;
  }) {
  return (
    <MantineButton
      variant={
        tone === "primary"
          ? "filled"
          : tone === "ghost"
            ? "subtle"
            : tone === "danger"
              ? "light"
              : "default"
      }
      {...(tone === "danger" ? { color: "danger" } : {})}
      className={`btn ${className}`}
      {...props}
    >
      {children}
    </MantineButton>
  );
}
export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ActionIconProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ActionIconProps> & {
    label: string;
    children: ReactNode;
  }) {
  return (
    <Tooltip label={label}>
      <ActionIcon
        className={`icon-btn ${className}`}
        aria-label={label}
        {...props}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  return (
    <MantineBadge
      className="badge"
      color={
        tone === "green"
          ? "success.4"
          : tone === "amber"
            ? "apricot.4"
            : tone === "red"
              ? "danger.3"
              : "dark.1"
      }
      variant="outline"
    >
      {children}
    </MantineBadge>
  );
}
export function Avatar({
  name,
  color = 0,
  small = false,
}: {
  name: string;
  color?: number;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${color % 4} ${small ? "avatar-small" : ""}`}
      title={name}
    >
      {name.slice(-1)}
    </span>
  );
}
export function Frame({
  index = 0,
  className = "",
  alt = "《旧钥匙》写实分镜示意",
  variant = "A",
  fit,
  children,
}: {
  index?: number;
  className?: string | undefined;
  alt?: string;
  variant?: string;
  fit?: "contain" | "cover";
  children?: ReactNode;
}) {
  const clipId = useId();
  const cell = ((index % 6) + 6) % 6;
  const columns = [
    { x: 2, w: 394 },
    { x: 400, w: 351 },
    { x: 755, w: 394 },
  ];
  const column = columns[cell % 3]!;
  return (
    <div className={`film-frame ${className} variant-${variant}`}>
      <svg
        viewBox={`${column.x} ${Math.floor(cell / 3) * 683 + 2} ${column.w} 679`}
        preserveAspectRatio={
          fit
            ? fit === "contain"
              ? "xMidYMid meet"
              : "xMidYMid slice"
            : /shot-image|asset-image|expanded-frame|player-portrait|asset-detail-image/.test(
                  className,
                )
              ? "xMidYMid meet"
              : "xMidYMid slice"
        }
        role="img"
        aria-label={alt}
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={column.x}
              y={Math.floor(cell / 3) * 683 + 2}
              width={column.w}
              height={679}
            />
          </clipPath>
        </defs>
        <image
          href="/demo/old-key-storyboard.png"
          width="1151"
          height="1367"
          clipPath={`url(#${clipId})`}
        />
      </svg>
      {children}
    </div>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark">＋</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <MantineModal
      opened
      onClose={onClose}
      size={wide ? 720 : 560}
      title={
        <div>
          <Text component="h2" fw={600} size="lg">
            {title}
          </Text>
          {subtitle && (
            <Text size="xs" c="dimmed" mt="xs">
              {subtitle}
            </Text>
          )}
        </div>
      }
    >
      {children}
    </MantineModal>
  );
}
export function Player({
  clips,
  time,
  setTime,
  large = false,
  subtitles = true,
}: {
  clips: Clip[];
  time: number;
  setTime: (n: number) => void;
  large?: boolean;
  subtitles?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const total = clips.reduce((sum, c) => sum + c.seconds, 0);
  let cursor = 0;
  const current =
    clips.find((c) => {
      cursor += c.seconds;
      return time < cursor;
    }) || clips.at(-1);
  useEffect(() => {
    if (!playing) return;
    const handle = window.setInterval(() => {
      setTime(Math.min(time + 0.25, total));
      if (time + 0.25 >= total) setPlaying(false);
    }, 250);
    return () => window.clearInterval(handle);
  }, [playing, time, total, setTime]);
  useEffect(() => {
    setPlaying(false);
  }, [clips]);
  const display = (
    <div className={`player-stage ${large ? "large" : ""}`}>
      <div className="player-stage-label">
        9:16 <span>静帧预演</span>
      </div>
      {current && (
        <Frame
          index={current.frame}
          variant={current.take}
          className="player-portrait"
          alt={`${current.label} 静帧预演`}
        />
      )}
      {subtitles && current?.dialogue && (
        <div className="player-subtitle">{current.dialogue}</div>
      )}
      <span className="player-watermark">旧钥匙 / {current?.label}</span>
    </div>
  );
  return (
    <div className="player">
      {display}
      <div className="player-controls">
        <IconButton
          label="回到开头"
          onClick={() => {
            setPlaying(false);
            setTime(0);
          }}
        >
          <SkipBack />
        </IconButton>
        <IconButton
          label={playing ? "暂停静帧预演" : "播放静帧预演"}
          onClick={() => {
            if (time >= total) setTime(0);
            setPlaying((v) => !v);
          }}
        >
          <>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</>
        </IconButton>
        <span className="time-display">
          {timecode(time)} <span>/ {timecode(total)}</span>
        </span>
        <input
          type="range"
          aria-label="预演位置"
          min="0"
          max={total}
          step=".1"
          value={time}
          onChange={(e) => setTime(Number(e.target.value))}
        />
        <span className="muted" title="本地静帧预演不包含真实声音">
          <SpeakerSlash />
        </span>
        <IconButton
          label="放大预演"
          onClick={() => {
            setPlaying(false);
            setExpanded(true);
          }}
        >
          <ArrowsOut />
        </IconButton>
      </div>
      {expanded && (
        <Modal
          title="场次静帧预演"
          subtitle="用于查看镜头顺序；当前没有真实运动画面与声音。"
          onClose={() => setExpanded(false)}
          wide
        >
          {display}
        </Modal>
      )}
    </div>
  );
}
export function SectionHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      <div className="row">{children}</div>
    </div>
  );
}
export function Progress({ value }: { value: number }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label="示例任务进度"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${value}%` } as CSSProperties} />
    </div>
  );
}
