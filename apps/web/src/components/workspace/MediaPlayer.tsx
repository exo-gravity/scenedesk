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

/** Plays one authorized fixed file. Timeline composition and URL authorization belong to callers. */
export default function MediaPlayer({
  src,
  title,
  audio,
  onError,
  resumeAt = 0,
  onTime,
}: {
  src: string;
  title: string;
  audio: boolean;
  onError: () => void;
  resumeAt?: number;
  onTime: (time: number) => void;
}) {
  const media = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const element = media.current;
    if (element && element.getAttribute("src") !== src) {
      element.src = src;
      element.load();
    }
    return () => {
      if (element) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
    };
  }, [src]);
  return (
    <MediaController
      className={classes.player}
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
          if (resumeAt > 0 && Number.isFinite(el.duration))
            el.currentTime = Math.min(resumeAt, el.duration);
        }}
        onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
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
