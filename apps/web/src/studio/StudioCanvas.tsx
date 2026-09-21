import { useCallback, useMemo, useState } from "react";
import { Alert, Loader, UnstyledButton } from "@mantine/core";
import { Check } from "@phosphor-icons/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useCanvas } from "../business/use-canvas";
import { useScenePreference } from "../business/use-scene-preference";
import { CanvasRecovery, canvasSaveLabel } from "../business/CanvasRecovery";
import type {
  CanvasController,
  CanvasEditorState,
} from "../business/canvas-controller";
import { ErrorNotice, projectPath, tenantPath } from "../business/common";
import { StudioFrame } from "./StudioFrame";
import { Board } from "./board/Board";
import { Shortcuts } from "./shell/Shortcuts";
import classes from "./studio.module.css";

/**
 * One canvas open in the studio: the engine's controller (document, local
 * recovery, save, undo) and the user's view preference, wired to the board.
 * The studio writes only the preference keys it owns (viewport, selection);
 * the docks own theirs when they arrive.
 */
export function StudioCanvas({
  tenantId,
  projectId,
  canvasId,
  active,
  projectName,
  environment,
}: {
  tenantId: string;
  projectId: string;
  canvasId: string;
  active: boolean;
  projectName: string;
  environment?: string | undefined;
}) {
  const path = projectPath(tenantId, projectId);
  const { controller, state, error, retry } = useCanvas(
    tenantId,
    projectId,
    canvasId,
  );
  const preference = useScenePreference(`${path}/workspace-preference`);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const document = state?.local?.document;
  const readOnly =
    !active ||
    !state ||
    state.accessChecking ||
    !!state.recovery ||
    state.recoveryBlocked ||
    state.phase === "loading" ||
    state.phase === "discarding";
  const selected = useMemo(
    () =>
      (preference.view?.selectedNodeIds ?? []).filter((id) =>
        document?.nodes.some((node) => node.id === id),
      ),
    [preference.view?.selectedNodeIds, document?.nodes],
  );
  const change = preference.change;
  const select = useCallback(
    (ids: string[]) => change({ selectedNodeIds: ids }),
    [change],
  );
  const moveViewport = useCallback(
    (viewport: { x: number; y: number; zoom: number }) =>
      change({ viewport }),
    [change],
  );
  const attention =
    !!state &&
    (state.accessChecking ||
      !!state.recovery ||
      state.recoveryBlocked ||
      state.hasInvalidInput ||
      !["ready", "saving", "loading"].includes(state.phase));
  return (
    <StudioFrame
      projectName={projectName}
      environment={environment}
      status={
        controller && state ? (
          <SaveStatus controller={controller} state={state} readOnly={readOnly} />
        ) : null
      }
    >
      <main className={classes.board} aria-label="创作台">
        {!controller || !state || !preference.view ? (
          <div className={classes.center}>
            <ErrorNotice error={error} retry={retry} />
            <ErrorNotice error={preference.error} retry={preference.retry} />
            {!error && <Loader aria-label="正在读取创作台" />}
          </div>
        ) : (
          <ReactFlowProvider>
            {(attention || !active || preference.error) && (
              <section className={classes.notice} aria-label="创作台状态">
                {!active && (
                  <Alert title="只读项目">
                    项目已归档，可继续查看原有创作台。
                  </Alert>
                )}
                <ErrorNotice
                  error={preference.error}
                  retry={preference.retry}
                  retryLabel="重新保存本页视图"
                />
                {attention && (
                  <CanvasRecovery
                    controller={controller}
                    state={state}
                    retry={retry}
                    selectNode={(id) => select([id])}
                  />
                )}
              </section>
            )}
            {document && (
              <Board
                controller={controller}
                document={document}
                readOnly={readOnly}
                selected={selected}
                onSelect={select}
                viewport={preference.view.viewport}
                onViewport={moveViewport}
                mediaPath={tenantPath(tenantId)}
                onShortcuts={() => setShortcutsOpen(true)}
              />
            )}
            <Shortcuts
              opened={shortcutsOpen}
              onClose={() => setShortcutsOpen(false)}
            />
          </ReactFlowProvider>
        )}
      </main>
    </StudioFrame>
  );
}

/** Where the work stands, in the top bar; a click saves now. */
function SaveStatus({
  controller,
  state,
  readOnly,
}: {
  controller: CanvasController;
  state: CanvasEditorState;
  readOnly: boolean;
}) {
  const label = canvasSaveLabel(state);
  const settled = label === "已保存";
  return (
    <UnstyledButton
      className={classes.status}
      data-settled={settled || undefined}
      aria-label={`创作台保存状态：${label}`}
      title="立即保存"
      disabled={readOnly || state.phase === "conflict" || state.phase === "saving"}
      onClick={() => void controller.save()}
    >
      <Check size={14} aria-hidden />
      <span role="status" aria-live="polite">
        {label}
      </span>
    </UnstyledButton>
  );
}
