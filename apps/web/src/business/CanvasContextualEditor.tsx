import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Button, FocusTrap, Group, Text } from "@mantine/core";
import { CornersOut, Crosshair, X } from "@phosphor-icons/react";
import {
  placeCanvasEditor,
  type EditorPlacement,
  type ScreenRect,
} from "./canvas-editor-placement";
import classes from "./canvas.module.css";

export function CanvasContextualEditor({
  title,
  anchor,
  safe,
  references,
  focused,
  onFocus,
  onClose,
  onLocate,
  busy,
  children,
  preview,
}: {
  title: string;
  anchor: ScreenRect;
  safe: ScreenRect;
  references: ScreenRect[];
  focused: boolean;
  onFocus: (value: boolean) => void;
  onClose: () => void;
  onLocate: () => void;
  busy: boolean;
  children: ReactNode;
  preview?: ReactNode;
}) {
  const prior = useRef<EditorPlacement>(undefined);
  const composing = useRef(false);
  const focusReturn = useRef<HTMLElement | null>(null);
  const placement = placeCanvasEditor({
    anchor,
    safe,
    references,
    previous: prior.current,
  });
  useLayoutEffect(() => {
    if (!focused) prior.current = placement;
  }, [focused, placement]);
  useEffect(() => {
    if (focused) return;
    const target = focusReturn.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
    focusReturn.current = null;
  }, [focused]);
  const compact = !focused && placement.kind === "compact";
  const enterFocus = () => {
    focusReturn.current =
      window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null;
    onFocus(true);
  };
  return (
    <FocusTrap active={focused}>
      <section
        className={classes.contextualEditor}
        data-focused={focused || undefined}
        data-compact={compact || undefined}
        role={focused ? "dialog" : "region"}
        aria-modal={focused || undefined}
        aria-label={`编辑 ${title}`}
        style={
          !focused && placement.kind === "local"
            ? {
                left: placement.rect.x,
                top: placement.rect.y,
                width: placement.rect.width,
                height: placement.rect.height,
              }
            : undefined
        }
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          // Mantine closes a dropdown in capture phase. Its layout may already
          // be gone when this bubble handler runs, but the native event keeps
          // the original path. One Escape belongs to that inner layer only.
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
              (element) =>
                element.getClientRects().length > 0 &&
                window.getComputedStyle(element).visibility !== "hidden" &&
                !element.closest('[hidden], [inert], [aria-hidden="true"]'),
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
              正在编辑 · {title}
            </Text>
            {compact && (
              <Text size="xs" c="dimmed">
                {placement.kind === "compact" &&
                placement.reason === "offscreen"
                  ? "位于视图外"
                  : "当前空间不足，请进入专注编辑"}
              </Text>
            )}
          </div>
          <Group gap={4} wrap="nowrap">
            {compact && (
              <Button
                size="compact-xs"
                variant="subtle"
                aria-label={`定位 ${title}`}
                onClick={onLocate}
              >
                <Crosshair size={15} />
              </Button>
            )}
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
        <div className={classes.editorColumns} hidden={compact}>
          {focused && (
            <aside className={classes.focusReferences}>{preview}</aside>
          )}
          <div className={classes.editorInput}>{children}</div>
        </div>
      </section>
    </FocusTrap>
  );
}
