import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Popover,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import {
  ArrowBendDownRight,
  FilmStrip,
  ImageSquare,
  MusicNotes,
} from "@phosphor-icons/react";
import type { CanvasController } from "./canvas-controller";
import {
  createCanvasDraft,
  prepareCanvasCreation,
  type CanvasCreation,
} from "./canvas-creation";

export function CanvasContinueCreation({
  controller,
  selected,
  readOnly,
  focus,
}: {
  controller: CanvasController;
  selected: string[];
  readOnly: boolean;
  focus: (ids: string[]) => void;
}) {
  const [prepared, setPrepared] = useState<CanvasCreation | null>(null),
    [error, setError] = useState<Error | null>(null);
  const consumed = useRef<string | null>(null);
  const open = () => {
    try {
      const local = controller.getSnapshot().local;
      if (readOnly || !local) return;
      if (
        Object.keys(local.buffers).some((key) =>
          selected.some((id) => key.startsWith(`node:${id}:`)),
        )
      )
        throw new Error("请先补全所选来源中的未完成输入。");
      setPrepared(prepareCanvasCreation(local.document, selected));
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason : new Error("来源核对未完成。"),
      );
    }
  };
  const create = (kind: "image" | "video" | "audio") => {
    if (readOnly || !prepared || consumed.current === prepared.id) return;
    try {
      const state = controller.getSnapshot();
      if (!state.local || state.accessChecking || state.phase === "forbidden")
        return;
      if (
        Object.keys(state.local.buffers).some((key) =>
          prepared.sources.some((source) =>
            key.startsWith(`node:${source.id}:`),
          ),
        )
      )
        throw new Error("来源有未完成输入，请补全后重新选择。");
      const next = createCanvasDraft(state.local.document, prepared, kind);
      controller.change(next);
      if (
        !controller
          .getSnapshot()
          .local?.document.nodes.some((node) => node.id === prepared.id)
      )
        throw new Error("当前画布暂不可修改，请先完成恢复或权限核对。");
      consumed.current = prepared.id;
      setPrepared(null);
      setError(null);
      focus([prepared.id]);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason
          : new Error("草稿尚未创建，原来源已保留。"),
      );
    }
  };
  return (
    <Stack gap="xs">
      <Popover
        opened={!!prepared}
        onChange={(opened) => {
          if (!opened) setPrepared(null);
        }}
        width={320}
        position="top-end"
        withArrow
        trapFocus
        returnFocus
      >
        <Popover.Target>
          <Button
            size="xs"
            disabled={readOnly || !selected.length}
            leftSection={<ArrowBendDownRight size={14} />}
            onClick={() => (prepared ? setPrepared(null) : open())}
          >
            {selected.length > 1 ? "共同作为参考" : "继续创作"}
          </Button>
        </Popover.Target>
        <Popover.Dropdown aria-label="选择继续创作类型">
          <Stack gap="sm">
            <Text fw={600}>从这些来源创建</Text>
            <ScrollArea.Autosize mah={160}>
              <Stack gap="xs">
                {prepared?.sources.map((source) => (
                  <Text key={source.id} size="sm">
                    {source.title}
                  </Text>
                ))}
              </Stack>
            </ScrollArea.Autosize>
            <Text size="xs" c="dimmed">
              新建独立草稿，原内容保留。参考用途可在新草稿中调整。
            </Text>
            {error && <Alert title="来源需要核对">{error.message}</Alert>}
            <Group gap="xs">
              <Button
                size="xs"
                disabled={readOnly}
                leftSection={<ImageSquare size={14} />}
                onClick={() => create("image")}
              >
                新的图片草稿
              </Button>
              <Button
                size="xs"
                disabled={readOnly}
                leftSection={<FilmStrip size={14} />}
                onClick={() => create("video")}
              >
                新的视频草稿
              </Button>
              <Button
                size="xs"
                disabled={readOnly}
                leftSection={<MusicNotes size={14} />}
                onClick={() => create("audio")}
              >
                新的声音草稿
              </Button>
            </Group>
          </Stack>
        </Popover.Dropdown>
      </Popover>
      {!prepared && error && (
        <Text size="xs" role="status">
          {error.message}
        </Text>
      )}
    </Stack>
  );
}
