import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader, Popover, TextInput, UnstyledButton } from "@mantine/core";
import {
  CaretDown,
  CaretRight,
  Check,
  ListBullets,
  MagnifyingGlass,
  Plus,
  Image as ImageIcon,
} from "@phosphor-icons/react";
import type { Schema } from "./api";
import classes from "./scene-navigator.module.css";

export interface CanvasNavigatorProps {
  content: Schema<"ContentTree">;
  sceneId?: string | undefined;
  unselected?: boolean;
  canCreate: boolean;
  onDirectory: () => void | Promise<void>;
  onCreate: () => void | Promise<void>;
  /** Resolve after navigation is safe; reject to keep the current context and show why. */
  onSelect: (sceneId: string | null) => void | Promise<void>;
  disabled?: boolean;
}

const byPosition = (
  a: { position: number; id: string },
  b: { position: number; id: string },
) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function CanvasNavigator({
  content,
  sceneId,
  onSelect,
  disabled = false,
  unselected = false,
  canCreate,
  onDirectory,
  onCreate,
}: CanvasNavigatorProps) {
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const request = useRef(0);
  const selecting = useRef(false);
  const id = useId();
  const current = content.scenes.find((scene) => scene.id === sceneId);
  const episode = content.episodes.find(
    (item) => item.id === current?.episodeId,
  );
  const archived =
    current?.status === "archived" || episode?.status === "archived";
  const currentLabel = current
    ? `${episode?.title ?? "未找到所属集"} · ${current.title}${archived ? " · 已归档" : ""}`
    : sceneId
      ? "场次不可访问"
      : unselected
        ? "选择画布"
        : "项目画布";

  useEffect(() => {
    request.current += 1;
    selecting.current = false;
    setPending(null);
    setError(null);
    setQuery("");
    setOpened(false);
    return () => {
      request.current += 1;
    };
  }, [content.projectId, sceneId]);

  const groups = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const scenes = new Map<string, Schema<"Scene">[]>();
    for (const scene of content.scenes) {
      if (scene.status !== "active" && scene.id !== sceneId) continue;
      const items = scenes.get(scene.episodeId) ?? [];
      items.push(scene);
      scenes.set(scene.episodeId, items);
    }
    return [...content.episodes]
      .sort(byPosition)
      .filter(
        (item) => item.status === "active" || item.id === current?.episodeId,
      )
      .map((item) => ({
        episode: item,
        scenes: (scenes.get(item.id) ?? [])
          .filter((scene) => {
            if (item.status === "archived" && scene.id !== sceneId)
              return false;
            const text = [
              item.title,
              scene.title,
              scene.locationLabel,
              scene.timeLabel,
            ]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase();
            return terms.every((term) => text.includes(term));
          })
          .sort(byPosition),
      }))
      .filter((group) => group.scenes.length > 0);
  }, [content.episodes, content.scenes, current?.episodeId, query, sceneId]);

  const visibleCount = groups.reduce(
    (sum, group) => sum + group.scenes.length,
    0,
  );
  const showProject =
    !query.trim() || "项目画布 自由探索".includes(query.trim());
  const navigable = [
    ...(showProject ? ["project"] : []),
    ...groups.flatMap((group) =>
      group.episode.status === "active"
        ? group.scenes
            .filter((scene) => scene.status === "active")
            .map((scene) => scene.id)
        : [],
    ),
  ];
  const focusScene = (index: number) => {
    const next = navigable[index];
    if (next && !disabled && !selecting.current) {
      const button = buttons.current.get(next);
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: "nearest" });
    }
  };
  const select = async (next: string) => {
    if (disabled || selecting.current) return;
    if ((next === sceneId || (next === "project" && !sceneId)) && !unselected) {
      setOpened(false);
      return;
    }
    const token = ++request.current;
    selecting.current = true;
    setPending(next);
    setError(null);
    try {
      if (next === "directory") await onDirectory();
      else if (next === "create") await onCreate();
      else await onSelect(next === "project" ? null : next);
      if (request.current === token) setOpened(false);
    } catch (cause) {
      if (request.current === token)
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : "暂时无法切换，请重试。当前画布未改变。",
        );
    } finally {
      if (request.current === token) {
        selecting.current = false;
        setPending(null);
      }
    }
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width={360}
      offset={8}
      trapFocus
      returnFocus
      classNames={{ dropdown: classes.dropdown }}
    >
      <Popover.Target>
        <UnstyledButton
          type="button"
          className={classes.trigger}
          disabled={disabled}
          aria-label={`切换画布：${currentLabel}`}
          aria-busy={!!pending}
          title={currentLabel}
          onClick={() => setOpened((value) => !value)}
        >
          <span className={classes.triggerLabel}>{currentLabel}</span>
          <CaretDown size={14} aria-hidden className={classes.caret} />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown aria-label="切换画布">
        <div className={classes.search}>
          <TextInput
            ref={search}
            data-autofocus
            size="sm"
            aria-label="搜索画布或场次"
            placeholder="搜索画布或场次"
            leftSection={<MagnifyingGlass size={16} aria-hidden />}
            value={query}
            readOnly={!!pending}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              focusScene(event.key === "ArrowDown" ? 0 : navigable.length - 1);
            }}
          />
        </div>
        <div className={classes.list} aria-busy={!!pending}>
          {showProject && (
            <UnstyledButton
              ref={(element) => {
                if (element) buttons.current.set("project", element);
                else buttons.current.delete("project");
              }}
              className={classes.scene}
              data-current={(!sceneId && !unselected) || undefined}
              aria-current={!sceneId && !unselected ? "location" : undefined}
              aria-label="项目画布"
              disabled={disabled || !!pending}
              onClick={() => void select("project")}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusScene(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  search.current?.focus();
                } else if (event.key === "End") {
                  event.preventDefault();
                  focusScene(navigable.length - 1);
                }
              }}
            >
              <ImageIcon size={18} aria-hidden />
              <span className={classes.sceneText}>
                <span className={classes.sceneTitle}>项目画布</span>
              </span>
              <span className={classes.detail}>自由探索</span>
              <span className={classes.indicator} aria-hidden>
                {pending === "project" ? (
                  <Loader size={14} />
                ) : !sceneId && !unselected ? (
                  <Check size={16} weight="bold" />
                ) : null}
              </span>
            </UnstyledButton>
          )}
          {groups.map((group) => (
            <section
              key={group.episode.id}
              aria-labelledby={`${id}-${group.episode.id}`}
            >
              <div
                className={classes.groupTitle}
                id={`${id}-${group.episode.id}`}
              >
                <span>{group.episode.title}</span>
                <span className={classes.count}>{group.scenes.length} 场</span>
              </div>
              {group.scenes.map((scene) => {
                const selected = scene.id === sceneId;
                const inactive =
                  scene.status === "archived" ||
                  group.episode.status === "archived";
                const detail = [scene.locationLabel, scene.timeLabel]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <UnstyledButton
                    key={scene.id}
                    ref={(element) => {
                      if (element) buttons.current.set(scene.id, element);
                      else buttons.current.delete(scene.id);
                    }}
                    type="button"
                    className={classes.scene}
                    data-current={selected || undefined}
                    aria-current={selected ? "location" : undefined}
                    aria-label={`${group.episode.title} · ${scene.title}${inactive ? " · 已归档" : ""}${selected ? " · 当前画布" : ""}`}
                    disabled={disabled || !!pending || inactive}
                    onClick={() => void select(scene.id)}
                    onKeyDown={(event) => {
                      const index = navigable.indexOf(scene.id);
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        const next =
                          index + (event.key === "ArrowDown" ? 1 : -1);
                        if (next < 0) search.current?.focus();
                        else focusScene(Math.min(next, navigable.length - 1));
                      } else if (event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        focusScene(
                          event.key === "Home" ? 0 : navigable.length - 1,
                        );
                      }
                    }}
                  >
                    <span className={classes.sceneText}>
                      <span className={classes.sceneTitle}>{scene.title}</span>
                      {(detail || inactive) && (
                        <span className={classes.detail}>
                          {inactive ? "已归档" : detail}
                        </span>
                      )}
                    </span>
                    <span className={classes.indicator} aria-hidden>
                      {pending === scene.id ? (
                        <Loader size={14} />
                      ) : selected ? (
                        <Check size={16} weight="bold" />
                      ) : null}
                    </span>
                  </UnstyledButton>
                );
              })}
            </section>
          ))}
          {!visibleCount && !showProject && (
            <div className={classes.empty} role="status">
              {query.trim() ? "没有匹配的画布或场次。" : "还没有可切换的画布。"}
            </div>
          )}
        </div>
        {error && (
          <div role="alert" className={classes.error}>
            {error}
          </div>
        )}
        <div className={classes.footer}>
          <UnstyledButton
            className={classes.scene}
            disabled={disabled || !!pending || !canCreate}
            onClick={() => void select("create")}
          >
            <Plus size={18} aria-hidden />
            <span className={classes.sceneText}>新增场次</span>
            {pending === "create" && <Loader size={14} />}
          </UnstyledButton>
          <UnstyledButton
            className={classes.scene}
            disabled={disabled || !!pending}
            onClick={() => void select("directory")}
          >
            <ListBullets size={18} aria-hidden />
            <span className={classes.sceneText}>场次目录</span>
            {pending === "directory" ? (
              <Loader size={14} />
            ) : (
              <CaretRight size={15} aria-hidden />
            )}
          </UnstyledButton>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
