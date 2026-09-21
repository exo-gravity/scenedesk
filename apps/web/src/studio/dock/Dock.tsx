import type { ReactNode } from "react";
import { Tooltip, UnstyledButton } from "@mantine/core";
import { ArrowsInLineHorizontal, ArrowSquareOut, X } from "@phosphor-icons/react";
import classes from "./dock.module.css";

export type DockMode = "docked" | "floating";

/**
 * One container for the assistant and the task list: docked to the right
 * edge under the top bar, or floating at the bottom-right. The content is
 * whatever the caller mounts; the container only owns its frame.
 */
export function Dock({
  label,
  title,
  mode,
  onMode,
  onClose,
  children,
}: {
  label: string;
  title: ReactNode;
  mode: DockMode;
  onMode: (mode: DockMode) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section className={classes.dock} data-mode={mode} aria-label={label}>
      <header className={classes.header}>
        <span className={classes.title}>{title}</span>
        <Tooltip label={mode === "docked" ? "改为浮窗" : "停靠到右侧"}>
          <UnstyledButton
            className={classes.control}
            aria-label={mode === "docked" ? "改为浮窗" : "停靠到右侧"}
            onClick={() => onMode(mode === "docked" ? "floating" : "docked")}
          >
            {mode === "docked" ? <ArrowSquareOut size={14} aria-hidden /> : <ArrowsInLineHorizontal size={14} aria-hidden />}
          </UnstyledButton>
        </Tooltip>
        <UnstyledButton className={classes.control} aria-label={`关闭${label}`} onClick={onClose}>
          <X size={14} aria-hidden />
        </UnstyledButton>
      </header>
      <div className={classes.body}>{children}</div>
    </section>
  );
}
