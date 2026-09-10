/** Isolated visual study. These palettes are proposals, not the application theme. */
import type { CSSProperties } from "react";

export type StudyTone = "light" | "dark";
const palettes = {
  light: {
    canvas: "#F4F4F2", shell: "#FAFAF8", surface: "#FFFFFF", soft: "#EFEFED",
    text: "#242522", secondary: "#666963", line: "#DADCD6", field: "#A4A7A0",
    selection: "#515A51", focus: "#416AA3", action: "#303830", onAction: "#FFFFFF",
    dot: "#DDDFD9", shadow: "0 6px 24px rgb(20 24 20 / 9%)",
  },
  dark: {
    canvas: "#191B19", shell: "#1E201E", surface: "#292C29", soft: "#333733",
    text: "#E9EBE6", secondary: "#A8AEA5", line: "#3D433B", field: "#71796D",
    selection: "#B6C0AE", focus: "#A9C5ED", action: "#DCE3D5", onAction: "#222820",
    dot: "#343934", shadow: "0 6px 24px rgb(0 0 0 / 24%)",
  },
} as const;

export function studyVariables(tone: StudyTone): CSSProperties {
  const p = palettes[tone];
  return {
    ...Object.fromEntries(Object.entries(p).map(([key, value]) => [`--study-${key}`, value])),
    "--study-media": "#141514",
    "--study-onMedia": "#FFFFFF",
    "--study-media-radius": "6px",
    "--study-floating-radius": "12px",
    "--study-tool-radius": "8px",
    "--ws-raised": p.surface, "--ws-panel": p.surface, "--ws-hover": p.soft,
    "--ws-text": p.text, "--ws-secondary": p.secondary, "--ws-muted": p.secondary,
    "--ws-border": p.line, "--ws-border-subtle": p.line, "--ws-field-border": p.field,
    "--ws-focus": p.focus, "--mantine-color-text": p.text, "--mantine-color-dimmed": p.secondary,
  } as CSSProperties;
}
