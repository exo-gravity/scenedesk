import { NumberInput, Popover, Slider, Tooltip, UnstyledButton } from "@mantine/core";
import {
  CaretDown,
  FilmStrip,
  ImageSquare,
  MusicNotes,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import type { Schema } from "../../business/api";
import type { ImageCapability } from "../../business/image-generation";
import {
  durationControl,
  specificationSummary,
} from "../../business/generation-specification";
import { useEscapablePopover } from "../../business/escapable-popover";
import { CanvasShotSources } from "../../business/CanvasShotSources";
import type { ShotSource } from "../../business/canvas-shot-sources";
import classes from "./composer.module.css";

type Kind = "image" | "video" | "audio";
type Output = Schema<"OutputOptions">;
const icons = { image: ImageSquare, video: FilmStrip, audio: MusicNotes };
const statusLabel = (capability: ImageCapability) =>
  capability.executionMode === "verified_provider" ? "已接入" : "受控测试";

/**
 * The model pill and its list: icon, name, and whether it is a verified
 * provider or a controlled fixture. Names are the capability records' own;
 * nothing is invented for them, and no time or cost is shown.
 */
export function ModelPicker({
  kind,
  models,
  loading,
  capability,
  disabled,
  onChange,
}: {
  kind: Kind;
  models: readonly ImageCapability[];
  loading: boolean;
  capability: ImageCapability | undefined;
  disabled: boolean;
  onChange: (capability: ImageCapability) => void;
}) {
  const popover = useEscapablePopover();
  const Icon = icons[kind];
  return (
    <Popover
      opened={popover.opened}
      onChange={popover.onChange}
      position="top-start"
      shadow="md"
      trapFocus
      returnFocus
      withinPortal
    >
      <Popover.Target>
        <UnstyledButton
          className={classes.pill}
          aria-label="生成模型"
          aria-haspopup="listbox"
          disabled={disabled || (!loading && !models.length)}
          {...popover.targetProps}
        >
          <Icon size={14} aria-hidden />
          <span>
            {capability?.modelVersion ??
              (loading ? "正在读取模型" : models.length ? "选择模型" : "暂无可用模型")}
          </span>
          <CaretDown size={12} aria-hidden />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        {models.length ? (
          <div className={classes.models} role="listbox" aria-label="可用模型">
            {models.map((model) => (
              <UnstyledButton
                key={model.id}
                className={classes.model}
                role="option"
                aria-selected={model.id === capability?.id}
                onClick={() => {
                  onChange(model);
                  popover.onChange(false);
                }}
              >
                <Icon size={18} aria-hidden />
                <span className={classes.modelName}>{model.modelVersion}</span>
                <span className={classes.modelStatus}>{statusLabel(model)}</span>
              </UnstyledButton>
            ))}
          </div>
        ) : (
          <div className={classes.empty}>暂无可用模型</div>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

/** Aspect ratio as a small rectangle of that shape. */
function RatioGlyph({ ratio }: { ratio: string }) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
  const w = match ? Number(match[1]) : 1,
    h = match ? Number(match[2]) : 1;
  const scale = 18 / Math.max(w, h);
  return (
    <span
      className={classes.ratioGlyph}
      style={{ width: Math.max(8, Math.round(w * scale)), height: Math.max(8, Math.round(h * scale)) }}
      aria-hidden
    />
  );
}

/**
 * The specification pill and its popover: only what the chosen model allows.
 * Ratio tiles, resolution grid, duration slider, audio on/off, and the fixed
 * shot sources. No generation count exists here.
 */
export function SpecificationPicker({
  kind,
  capability,
  output,
  disabled,
  frozen,
  onChange,
  shotSources,
  showShotSources,
  onShotSources,
  shotSourceProps,
}: {
  kind: Kind;
  capability: ImageCapability | undefined;
  output: Output;
  disabled: boolean;
  frozen: boolean;
  onChange: (output: Output) => void;
  shotSources: readonly ShotSource[] | undefined;
  showShotSources: boolean;
  onShotSources: (sources: ShotSource[]) => void;
  shotSourceProps: { path: string; projectId: string; sceneId: string | undefined };
}) {
  const popover = useEscapablePopover();
  const summary = specificationSummary({
    kind,
    output,
    shotSourceCount: shotSources?.length ?? 0,
  });
  const ratios = kind !== "audio" ? (capability?.allowedAspectRatios ?? []) : [];
  const resolutions = kind !== "audio" ? (capability?.allowedResolutions ?? []) : [];
  const duration = durationControl(kind, capability);
  const audio = kind === "video" && capability?.audioOutput === true;
  const locked = disabled || frozen || !capability;
  const set = (patch: Partial<Output>, drop: (keyof Output)[] = []) => {
    const next: Output = { ...output, ...patch };
    for (const key of drop) delete next[key];
    onChange(next);
  };
  return (
    <Popover
      opened={popover.opened}
      onChange={popover.onChange}
      position="top-start"
      shadow="md"
      trapFocus
      returnFocus
      withinPortal
    >
      <Popover.Target>
        <UnstyledButton
          className={classes.pill}
          aria-label="生成规格"
          aria-haspopup="dialog"
          disabled={disabled || !capability}
          {...popover.targetProps}
        >
          <SlidersHorizontal size={14} aria-hidden />
          <span>{summary ?? "规格"}</span>
          <CaretDown size={12} aria-hidden />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <div className={classes.spec} role="group" aria-label="生成规格">
          {ratios.length > 0 && (
            <section>
              <h4 className={classes.specTitle}>比例</h4>
              <div className={classes.tiles}>
                {ratios.map((ratio) => (
                  <UnstyledButton
                    key={ratio}
                    className={classes.tile}
                    aria-pressed={output.aspectRatio === ratio}
                    disabled={locked}
                    onClick={() =>
                      output.aspectRatio === ratio
                        ? set({}, ["aspectRatio"])
                        : set({ aspectRatio: ratio })
                    }
                  >
                    <RatioGlyph ratio={ratio} />
                    {ratio}
                  </UnstyledButton>
                ))}
              </div>
            </section>
          )}
          {resolutions.length > 0 && (
            <section>
              <h4 className={classes.specTitle}>清晰度</h4>
              <div className={classes.tiles} data-columns="2">
                {resolutions.map((resolution) => (
                  <UnstyledButton
                    key={resolution}
                    className={classes.tile}
                    aria-pressed={output.resolution === resolution}
                    disabled={locked}
                    onClick={() => set({ resolution })}
                  >
                    {resolution}
                  </UnstyledButton>
                ))}
              </div>
            </section>
          )}
          {duration && (
            <section>
              <h4 className={classes.specTitle}>时长</h4>
              {"fixed" in duration ? (
                <div className={classes.duration}>固定 {duration.fixed} s</div>
              ) : (
                <div className={classes.duration}>
                  <Slider
                    style={{ flex: 1 }}
                    min={duration.min}
                    max={duration.max}
                    step={1}
                    value={output.durationSeconds ?? duration.min}
                    disabled={locked}
                    label={(value) => `${value} s`}
                    aria-label="时长（秒）"
                    onChange={(value) => set({ durationSeconds: value })}
                  />
                  <NumberInput
                    className={classes.durationValue}
                    size="xs"
                    min={duration.min}
                    max={duration.max}
                    allowDecimal={false}
                    value={output.durationSeconds ?? ""}
                    disabled={locked}
                    aria-label="时长数值"
                    onChange={(value) =>
                      typeof value === "number"
                        ? set({ durationSeconds: value })
                        : set({}, ["durationSeconds"])
                    }
                  />
                  <span>s</span>
                </div>
              )}
            </section>
          )}
          {audio && (
            <section>
              <h4 className={classes.specTitle}>生成音频</h4>
              <div className={classes.pair}>
                <UnstyledButton
                  className={classes.tile}
                  aria-pressed={output.withAudio === true}
                  disabled={locked}
                  onClick={() => set({ withAudio: true })}
                >
                  开启
                </UnstyledButton>
                <UnstyledButton
                  className={classes.tile}
                  aria-pressed={output.withAudio !== true}
                  disabled={locked}
                  onClick={() => set({}, ["withAudio"])}
                >
                  关闭
                </UnstyledButton>
              </div>
            </section>
          )}
          {showShotSources && (
            <section>
              <CanvasShotSources
                path={shotSourceProps.path}
                projectId={shotSourceProps.projectId}
                sceneId={shotSourceProps.sceneId}
                sources={shotSources}
                disabled={locked}
                onChange={onShotSources}
                compact
              />
            </section>
          )}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

export function SubmitButton({
  label,
  reason,
  disabled,
  onClick,
  children,
}: {
  label: string;
  reason: string | undefined;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const button = (
    <UnstyledButton
      className={classes.submit}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </UnstyledButton>
  );
  return reason ? <Tooltip label={reason}>{button}</Tooltip> : button;
}
