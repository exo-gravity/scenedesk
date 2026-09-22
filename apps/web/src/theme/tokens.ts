import { sharedSurfaces } from "./shared-language-study.js";
/** Single value source for the Mantine visual sample. Business CSS uses the semantic variables. */
export const tokens = {
  surface: {
    canvas: "#141414",
    panel: "#1B1B1B",
    raised: "#242424",
    hover: "#2D2D2D",
    media: "#101010",
  },
  text: {
    primary: "#EAEAEA",
    secondary: "#B8B8B8",
    muted: "#9C9C9C",
    onAccent: "#201A13",
  },
  border: { subtle: "#303030", default: "#414141", field: "#737373" },
  accent: { solid: "#EDB878", hover: "#F3C996", soft: "#352D23" },
  status: {
    success: "#A5CBB6",
    warning: "#E6BB86",
    danger: "#F0ABA5",
    info: "#A7C6EE",
  },
  focus: "#B3CDF8",
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  control: { compact: 28, default: 32, form: 36 },
  radius: { control: 6, content: 8, round: "50%" },
  font: {
    family:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
    small: 12,
    body: 14,
    reading: 16,
    title: 22,
    display: 32,
    heading: 21,
  },
  shadow: "0 12px 32px rgb(0 0 0 / 28%)",
} as const;

/**
 * Structural sizes of the rebuilt creative workspace (`apps/web/src/studio/`).
 * They follow LibTV's density where the shared scale has no value of its own;
 * every colour the studio uses comes from the palette (see `theme.ts`).
 */
export const studio = {
  topbarHeight: 48,
  toolbarHeight: 48,
  toolSize: 36,
  composerWidth: 660,
  referenceSize: 56,
  dockWidth: 400,
  portSize: 10,
  dotSize: 1.5,
  dotGap: 20,
} as const;

export const semanticVariables = {
  "--ws-canvas": tokens.surface.canvas,
  "--ws-panel": tokens.surface.panel,
  "--ws-raised": tokens.surface.raised,
  "--ws-hover": tokens.surface.hover,
  "--ws-media": sharedSurfaces.media,
  "--ws-text": tokens.text.primary,
  "--ws-secondary": tokens.text.secondary,
  "--ws-muted": tokens.text.muted,
  "--ws-on-accent": tokens.text.onAccent,
  "--ws-border-subtle": tokens.border.subtle,
  "--ws-border": tokens.border.default,
  "--ws-field-border": tokens.border.field,
  "--ws-accent": tokens.accent.solid,
  "--ws-accent-hover": tokens.accent.hover,
  "--ws-accent-soft": tokens.accent.soft,
  "--ws-success": tokens.status.success,
  "--ws-warning": tokens.status.warning,
  "--ws-danger": tokens.status.danger,
  "--ws-info": tokens.status.info,
  "--ws-focus": tokens.focus,
  "--ws-control-compact": `${tokens.control.compact}px`,
  "--ws-control-default": `${tokens.control.default}px`,
  "--ws-control-form": `${tokens.control.form}px`,
  "--ws-radius": `${tokens.radius.control}px`,
  "--ws-card-radius": `${tokens.radius.content}px`,
  "--ws-round-radius": tokens.radius.round,
  "--ws-media-radius": sharedSurfaces.mediaRadius,
  "--ws-tool-radius": sharedSurfaces.toolRadius,
  "--ws-floating-radius": sharedSurfaces.floatingRadius,
  "--ws-shadow": tokens.shadow,
  "--ws-display-size": `${tokens.font.display}px`,
  "--ws-heading-size": `${tokens.font.heading}px`,
  "--ws-reading-size": `${tokens.font.reading}px`,
  "--ws-studio-topbar-height": `${studio.topbarHeight}px`,
  "--ws-studio-toolbar-height": `${studio.toolbarHeight}px`,
  "--ws-studio-tool-size": `${studio.toolSize}px`,
  "--ws-studio-composer-width": `${studio.composerWidth}px`,
  "--ws-studio-reference-size": `${studio.referenceSize}px`,
  "--ws-studio-dock-width": `${studio.dockWidth}px`,
  "--ws-studio-port-size": `${studio.portSize}px`,
  "--ws-studio-dot-size": `${studio.dotSize}px`,
  "--ws-studio-dot-gap": `${studio.dotGap}px`,
} as const;
