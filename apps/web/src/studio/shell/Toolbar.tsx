import { Menu, Tooltip, UnstyledButton } from "@mantine/core";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Cursor,
  FilmStrip,
  Hand,
  ImageSquare,
  Keyboard,
  MusicNotes,
  Plus,
  TextT,
} from "@phosphor-icons/react";
import type { CanvasNode } from "@drama/domain";
import classes from "./shell.module.css";

export type BoardTool = "select" | "hand";

/** The bottom toolbar: what you do. Only actions that exist are on it. */
export function Toolbar({
  readOnly,
  tool,
  onTool,
  onAdd,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onShortcuts,
}: {
  readOnly: boolean;
  tool: BoardTool;
  onTool: (tool: BoardTool) => void;
  onAdd: (kind: CanvasNode["kind"]) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onShortcuts: () => void;
}) {
  return (
    <div className={classes.toolbar} role="toolbar" aria-label="创作台工具">
      <Menu position="top" shadow="md" width={160} withinPortal>
        <Menu.Target>
          <UnstyledButton
            className={`${classes.tool} ${classes.add}`}
            aria-label="添加"
            disabled={readOnly}
          >
            <Plus size={20} weight="bold" aria-hidden />
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<TextT size={14} />} onClick={() => onAdd("text")}>
            文字
          </Menu.Item>
          <Menu.Item
            leftSection={<ImageSquare size={14} />}
            onClick={() => onAdd("image")}
          >
            图片
          </Menu.Item>
          <Menu.Item
            leftSection={<FilmStrip size={14} />}
            onClick={() => onAdd("video")}
          >
            视频
          </Menu.Item>
          <Menu.Item
            leftSection={<MusicNotes size={14} />}
            onClick={() => onAdd("audio")}
          >
            音频
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Tooltip label="选择 · V">
        <UnstyledButton
          className={classes.tool}
          aria-label="选择"
          aria-pressed={tool === "select"}
          onClick={() => onTool("select")}
        >
          <Cursor size={18} aria-hidden />
        </UnstyledButton>
      </Tooltip>
      <Tooltip label="平移 · H">
        <UnstyledButton
          className={classes.tool}
          aria-label="平移"
          aria-pressed={tool === "hand"}
          onClick={() => onTool("hand")}
        >
          <Hand size={18} aria-hidden />
        </UnstyledButton>
      </Tooltip>
      <span className={classes.separator} aria-hidden />
      <Tooltip label="撤销 · ⌘Z">
        <UnstyledButton
          className={classes.tool}
          aria-label="撤销"
          disabled={readOnly || !canUndo}
          onClick={onUndo}
        >
          <ArrowCounterClockwise size={18} aria-hidden />
        </UnstyledButton>
      </Tooltip>
      <Tooltip label="重做 · ⌘⇧Z">
        <UnstyledButton
          className={classes.tool}
          aria-label="重做"
          disabled={readOnly || !canRedo}
          onClick={onRedo}
        >
          <ArrowClockwise size={18} aria-hidden />
        </UnstyledButton>
      </Tooltip>
      <span className={classes.separator} aria-hidden />
      <Tooltip label="快捷键 · ?">
        <UnstyledButton
          className={classes.tool}
          aria-label="快捷键"
          onClick={onShortcuts}
        >
          <Keyboard size={18} aria-hidden />
        </UnstyledButton>
      </Tooltip>
    </div>
  );
}
