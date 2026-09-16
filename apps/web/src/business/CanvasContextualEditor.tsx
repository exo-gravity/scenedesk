import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Button, FocusTrap, Group, Text } from "@mantine/core";
import { CornersOut, Crosshair, X } from "@phosphor-icons/react";
import { useViewport } from "@xyflow/react";
import type { ScreenRect } from "./canvas-editor-placement";
import classes from "./canvas.module.css";

/** One editor tree in the canvas viewport. Focus changes its transform only. */
export function CanvasContextualEditor({
  title,
  nodePosition,
  nodeWidth,
  boardSize,
  safe,
  onHeight,
  focused,
  onFocus,
  onClose,
  onLocate,
  busy,
  children,
  preview,
}: {
  title: string;
  nodePosition: { x: number; y: number };
  nodeWidth: number;
  boardSize: { width: number; height: number };
  safe: ScreenRect;
  onHeight: (height: number) => void;
  focused: boolean;
  onFocus: (value: boolean) => void;
  onClose: () => void;
  onLocate: () => void;
  busy: boolean;
  children: ReactNode;
  preview?: ReactNode;
}) {
  const viewport = useViewport();
  const element = useRef<HTMLElement>(null);
  const composing = useRef(false);
  const focusReturn = useRef<HTMLElement | null>(null);
  const height = useRef(260);
  useLayoutEffect(() => {
    const current = element.current;
    if (!current || focused) return;
    const measure = () => {
      // offsetHeight is in world CSS pixels, unlike the scaled client rect.
      const measured = Math.ceil(current.offsetHeight);
      if (measured <= 0) return;
      height.current = measured;
      onHeight(measured);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(current);
    return () => observer.disconnect();
  }, [focused, onHeight, nodeWidth]);
  useEffect(() => {
    if (focused) return;
    const target = focusReturn.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
    focusReturn.current = null;
  }, [focused]);
  const screenX = nodePosition.x * viewport.zoom + viewport.x;
  const screenY = nodePosition.y * viewport.zoom + viewport.y;
  const offscreen =
    screenX + nodeWidth * viewport.zoom <= safe.x ||
    screenX >= safe.x + safe.width ||
    screenY + height.current * viewport.zoom <= safe.y ||
    screenY >= safe.y + safe.height;
  const showLocator =
    !focused &&
    (offscreen ||
      screenX < safe.x ||
      screenX + nodeWidth * viewport.zoom > safe.x + safe.width ||
      screenY < safe.y ||
      screenY + 160 * viewport.zoom > safe.y + safe.height ||
      viewport.zoom < 0.6 ||
      safe.width < 300);
  const enterFocus = () => {
    focusReturn.current =
      window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null;
    onFocus(true);
  };
  // The portal remains under React Flow's viewport. Cancel only that transform
  // for an explicit focus view; never write a compensating canvas preference.
  const screenPosition = (x: number, y: number) => ({
    left: (x - viewport.x) / viewport.zoom,
    top: (y - viewport.y) / viewport.zoom,
    transform: `scale(${1 / viewport.zoom})`,
    transformOrigin: "top left",
  });
  return (
    <>
      {focused && (
        <div
          className={classes.creationFocusBackdrop}
          style={{
            ...screenPosition(0, 0),
            width: boardSize.width,
            height: boardSize.height,
          }}
          aria-hidden
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        />
      )}
      <FocusTrap active={focused}>
        <section
          ref={element}
          className={`${classes.contextualEditor} nodrag nopan nowheel`}
          data-focused={focused || undefined}
          data-world-editor={!focused || undefined}
          role={focused ? "dialog" : "region"}
          aria-modal={focused || undefined}
          aria-label={`编辑 ${title}`}
          inert={(!focused && offscreen) || undefined}
          style={
            focused
              ? {
                  ...screenPosition(12, 12),
                  width: Math.max(0, boardSize.width - 24),
                  height: Math.max(0, boardSize.height - 24),
                }
              : {
                  left: nodePosition.x,
                  top: nodePosition.y,
                  width: nodeWidth,
                  maxHeight: Math.max(
                    160,
                    Math.min(
                      560,
                      (safe.y + safe.height - Math.max(safe.y, screenY)) /
                        viewport.zoom,
                    ),
                  ),
                }
          }
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            // The native path survives Mantine's capture-phase dropdown close.
            const fromFloatingLayer = event.nativeEvent
              .composedPath()
              .some(
                (target) =>
                  target instanceof Element &&
                  target !== event.currentTarget &&
                  target.matches(
                    '[role="dialog"], [role="listbox"], [role="menu"], .mantine-Popover-dropdown',
                  ),
              );
            if (
              event.key === "Escape" &&
              !event.defaultPrevented &&
              !event.nativeEvent.isComposing &&
              !composing.current &&
              !fromFloatingLayer &&
              !Array.from(
                window.document.querySelectorAll(
                  '[data-mantine-portal] [role="dialog"], [data-mantine-portal] [role="listbox"], [data-mantine-portal] [role="menu"], [data-mantine-portal] .mantine-Popover-dropdown',
                ),
              ).some(
                (layer) =>
                  layer.getClientRects().length > 0 &&
                  window.getComputedStyle(layer).visibility !== "hidden" &&
                  !layer.closest('[hidden], [inert], [aria-hidden="true"]'),
              )
            ) {
              event.preventDefault();
              if (focused) onFocus(false);
              else onClose();
            }
          }}
        >
          <Group
            className={classes.editorHeader}
            justify="space-between"
            wrap="nowrap"
          >
            <div className={classes.editorIdentity}>
              <Text size="xs" fw={600} truncate title={title}>
                {focused ? `正在编辑 · ${title}` : "创作描述"}
              </Text>
            </div>
            <Group gap={4} wrap="nowrap">
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => (focused ? onFocus(false) : enterFocus())}
                leftSection={<CornersOut size={15} />}
              >
                {focused ? "返回画布" : "专注编辑"}
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={busy}
                aria-label={`收起 ${title} 编辑`}
                onClick={onClose}
              >
                <X size={16} />
              </Button>
            </Group>
          </Group>
          <div className={classes.editorColumns}>
            {focused && (
              <aside className={classes.focusReferences}>{preview}</aside>
            )}
            <div className={classes.editorInput}>{children}</div>
          </div>
        </section>
      </FocusTrap>
      {showLocator && (
        <Group
          className={`${classes.creationLocator} nodrag nopan nowheel`}
          style={{
            ...screenPosition(64, Math.max(12, boardSize.height - 112)),
            width: Math.max(180, Math.min(380, boardSize.width - 88)),
          }}
          gap="xs"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Text
            size="xs"
            truncate
            className={classes.editorIdentity}
            title={title}
          >
            正在编辑 · {title}
            {offscreen
              ? " · 位于视图外"
              : viewport.zoom < 0.6
                ? " · 当前缩放较小"
                : " · 展开可完整编辑"}
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            aria-label={`定位 ${title}`}
            onClick={onLocate}
          >
            <Crosshair size={15} />
          </Button>
          <Button size="compact-xs" variant="default" onClick={enterFocus}>
            专注编辑
          </Button>
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={busy}
            aria-label={`收起 ${title} 编辑`}
            onClick={onClose}
          >
            <X size={15} />
          </Button>
        </Group>
      )}
    </>
  );
}
