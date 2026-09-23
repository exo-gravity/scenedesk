import { NumberInput, Popover, Slider, Tooltip, UnstyledButton } from "@mantine/core";
import {
  CaretDown,
  FilmStrip,
  FrameCorners,
  ImageSquare,
  MusicNotes,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import type { Schema } from "../../business/api";
import type { ImageCapability } from "../../business/image-generation";
import {
  aspectRatioOptions,
  durationControl,
  qualityOptions,
  resolutionFor,
  specificationSummary,
} from "../../business/generation-specification";
import {
  capabilityForModel,
  modeLabel,
  type ModelEntry,
} from "../../business/capability-presentation";
import { useEscapablePopover } from "../../business/escapable-popover";
import { CanvasShotSources } from "../../business/CanvasShotSources";
import type { ShotSource } from "../../business/canvas-shot-sources";
import classes from "./composer.module.css";

type Kind = "image" | "video" | "audio";
type Output = Schema<"OutputOptions">;
const icons = { image: ImageSquare, video: FilmStrip, audio: MusicNotes };
/** A controlled fixture never reaches a provider; nothing marks a real model. */
const fixtureLabel = (entry: ModelEntry) => (entry.fixture ? "受控测试" : undefined);

/**
 * The model pill and its list: one row per model, carrying the name the
 * capability record gives it and nothing else. Records differing only in input
 * mode are one row here; the mode is chosen in the pill beside this one.
 */
export function ModelPicker({
  kind,
  entries,
  loading,
  capability,
  disabled,
  onChange,
}: {
  kind: Kind;
  entries: readonly ModelEntry[];
  loading: boolean;
  capability: ImageCapability | undefined;
  disabled: boolean;
  onChange: (capability: ImageCapability) => void;
}) {
  const popover = useEscapablePopover();
  const Icon = icons[kind];
  const current = entries.find((entry) =>
    entry.capabilities.some((c) => c.id === capability?.id),
  );
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
          disabled={disabled || (!loading && !entries.length)}
          {...popover.targetProps}
        >
          <Icon size={14} aria-hidden />
          <span>
            {current?.name ??
              (loading ? "正在读取模型" : entries.length ? "选择模型" : "暂无可用模型")}
          </span>
          <CaretDown size={12} aria-hidden />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        {entries.length ? (
          <div className={classes.models} role="listbox" aria-label="可用模型">
            {entries.map((entry) => (
              <UnstyledButton
                key={entry.modelVersion}
                className={classes.model}
                role="option"
                aria-selected={entry.modelVersion === current?.modelVersion}
                onClick={() => {
                  // Rule 17 applies to the record, so keep the mode in hand.
                  onChange(capabilityForModel(entry, capability?.mode) as ImageCapability);
                  popover.onChange(false);
                }}
              >
                <Icon size={18} aria-hidden />
                <span className={classes.modelName}>{entry.name}</span>
                {fixtureLabel(entry) && (
                  <span className={classes.modelStatus}>{fixtureLabel(entry)}</span>
                )}
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

/**
 * How the request is fed: start and end frames, or reference images. One
 * record exists per mode, so choosing a mode chooses a record — which is why
 * it is frozen alongside the model. A model with one mode shows no pill.
 */
export function ModePicker({
  entry,
  capability,
  disabled,
  onChange,
}: {
  entry: ModelEntry | undefined;
  capability: ImageCapability | undefined;
  disabled: boolean;
  onChange: (capability: ImageCapability) => void;
}) {
  const popover = useEscapablePopover();
  const choices = (entry?.capabilities ?? []).filter((c) => modeLabel(c));
  if (choices.length < 2) return null;
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
          aria-label="进料方式"
          aria-haspopup="listbox"
          disabled={disabled}
          {...popover.targetProps}
        >
          <FrameCorners size={14} aria-hidden />
          <span>{(capability && modeLabel(capability)) ?? "进料方式"}</span>
          <CaretDown size={12} aria-hidden />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <div className={classes.models} role="listbox" aria-label="进料方式">
          {choices.map((choice) => (
            <UnstyledButton
              key={choice.id}
              className={classes.model}
              role="option"
              aria-selected={choice.id === capability?.id}
              onClick={() => {
                onChange(choice as ImageCapability);
                popover.onChange(false);
              }}
            >
              <span className={classes.modelName}>{modeLabel(choice)}</span>
            </UnstyledButton>
          ))}
        </div>
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
    capability,
    shotSourceCount: shotSources?.length ?? 0,
  });
  const ratios = kind !== "audio" ? aspectRatioOptions(capability) : [];
  const qualities =
    kind !== "audio" ? qualityOptions(capability, output.aspectRatio) : [];
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
                    onClick={() => {
                      // A ratio and a tier name one size; keep the tier if the
                      // new ratio has it, and take its only size when that is
                      // all it has.
                      const quality = qualities.find(
                        (q) => q.resolution === output.resolution,
                      )?.quality;
                      const next = qualityOptions(capability, ratio);
                      const resolution =
                        resolutionFor(capability, ratio, quality) ??
                        (next.length === 1 ? next[0]!.resolution : undefined);
                      set(
                        resolution
                          ? { aspectRatio: ratio, resolution }
                          : { aspectRatio: ratio },
                        resolution ? [] : ["resolution"],
                      );
                    }}
                  >
                    <RatioGlyph ratio={ratio} />
                    {ratio}
                  </UnstyledButton>
                ))}
              </div>
            </section>
          )}
          {qualities.length > 0 && (
            <section>
              <h4 className={classes.specTitle}>清晰度</h4>
              {qualities.length === 1 ? (
                // One tier is not a choice; it reads as the fact it is.
                <div className={classes.duration}>{qualities[0]!.quality}</div>
              ) : (
                <div className={classes.tiles} data-columns="2">
                  {qualities.map(({ quality, resolution }) => (
                    <UnstyledButton
                      key={resolution}
                      className={classes.tile}
                      aria-pressed={output.resolution === resolution}
                      disabled={locked}
                      onClick={() => set({ resolution })}
                    >
                      {quality}
                    </UnstyledButton>
                  ))}
                </div>
              )}
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
                    classNames={{ input: classes.durationInput }}
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
