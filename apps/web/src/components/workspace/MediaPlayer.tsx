import { useEffect, useRef } from "react";
import {
  MediaController,
  MediaControlBar,
  MediaPlayButton,
  MediaMuteButton,
  MediaTimeRange,
  MediaTimeDisplay,
  MediaFullscreenButton,
} from "media-chrome/react";
import "media-chrome/dist/lang/zh-CN.js";
import { setLanguage } from "media-chrome/dist/utils/i18n.js";
import classes from "./media-player.module.css";
setLanguage("zh-CN");
const mountedPlayers = new Set<HTMLVideoElement>();
function coordinateAudiblePlayback(current: HTMLVideoElement) {
  if (current.paused || current.muted || current.volume === 0) return;
  for (const other of mountedPlayers)
    if (other !== current && !other.paused && !other.muted && other.volume > 0)
      other.pause();
}

/** Plays one authorized fixed file. Timeline composition and URL authorization belong to callers. */
export default function MediaPlayer({
  src,
  title,
  audio,
  onError,
  resumeAt = 0,
  onTime,
  range,
  fit = false,
}: {
  src: string;
  title: string;
  audio: boolean;
  onError: () => void;
  resumeAt?: number;
  onTime: (time: number) => void;
  range?: { inUs: number; outUs: number } | undefined;
  fit?: boolean;
}) {
  const media = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const element = media.current;
    if (element) mountedPlayers.add(element);
    if (element && element.getAttribute("src") !== src) {
      element.src = src;
      element.load();
    }
    return () => {
      if (element) {
        mountedPlayers.delete(element);
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
    };
  }, [src]);
  return (
    <MediaController
      className={`${classes.player}${fit ? ` ${classes.fitted}` : ""}`}
      audio={audio}
      lang="zh-CN"
      aria-label={title}
    >
      <video
        ref={media}
        slot="media"
        src={src}
        preload="metadata"
        playsInline
        crossOrigin="anonymous"
        aria-label={title}
        className={audio ? classes.audio : classes.video}
        onError={onError}
        onLoadedMetadata={(event) => {
          const el = event.currentTarget;
          if (Number.isFinite(el.duration))
            el.currentTime = Math.min(
              Math.max(resumeAt, (range?.inUs ?? 0) / 1_000_000),
              el.duration,
              (range?.outUs ?? Infinity) / 1_000_000,
            );
        }}
        onVolumeChange={(event) =>
          coordinateAudiblePlayback(event.currentTarget)
        }
        onPlay={(event) => {
          const el = event.currentTarget;
          coordinateAudiblePlayback(el);
          if (
            range &&
            (el.currentTime < range.inUs / 1_000_000 ||
              el.currentTime >= range.outUs / 1_000_000)
          )
            el.currentTime = range.inUs / 1_000_000;
        }}
        onSeeking={(event) => {
          const el = event.currentTarget;
          if (!range) return;
          const duration = Number.isFinite(el.duration)
            ? el.duration
            : Infinity;
          const bounded = Math.max(
            Math.min(range.inUs / 1_000_000, duration),
            Math.min(range.outUs / 1_000_000, duration, el.currentTime),
          );
          // Browser media clocks quantize seeks (e.g. 0.250001 becomes 0.25).
          // Reassigning on that tiny difference causes an endless seeking loop.
          // This proxy tolerance never changes the stored source microseconds.
          if (Math.abs(bounded - el.currentTime) > 0.001)
            el.currentTime = bounded;
        }}
        onTimeUpdate={(event) => {
          const el = event.currentTarget;
          if (range && el.currentTime >= range.outUs / 1_000_000) {
            el.pause();
            if (el.currentTime > range.outUs / 1_000_000)
              el.currentTime = range.outUs / 1_000_000;
          }
          onTime(el.currentTime);
        }}
      />
      <MediaControlBar className={classes.controls}>
        <MediaPlayButton />
        <MediaTimeRange />
        <MediaTimeDisplay showDuration />
        <MediaMuteButton />
        {!audio && <MediaFullscreenButton />}
      </MediaControlBar>
    </MediaController>
  );
}
