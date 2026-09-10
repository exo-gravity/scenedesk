import { useEffect } from "react";
import { Button, Group, Select, Stack, Text, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { Play, Sparkle } from "../../icons";
import { AssetCard, InlineNote } from "./cards";
import type { AssetDisplay } from "./cards";
import classes from "./workspace.module.css";

export function ModelSelector() {
  return (
    <Select
      label="视频模型"
      description="示例配置，尚未连接模型服务"
      value="seedance"
      data={[{ value: "seedance", label: "Seedance · 待接入" }]}
      allowDeselect={false}
      searchable={false}
    />
  );
}

export function PromptComposer({
  value,
  onChange,
  references,
  onReference,
  onPrepare,
  onAssist,
}: {
  value: string;
  onChange: (value: string) => void;
  references: AssetDisplay[];
  onReference: () => void;
  onPrepare: () => void;
  onAssist: () => void;
}) {
  const form = useForm({
    initialValues: { prompt: value },
    validate: {
      prompt: (text) => (text.trim() ? null : "请先填写本次镜头的提示词。"),
    },
  });
  // The parent owns the per-shot draft so switching shots/views cannot discard it.
  useEffect(() => {
    if (value !== form.getValues().prompt) form.setFieldValue("prompt", value);
  }, [value]);
  return (
    <form className={classes.composer} onSubmit={form.onSubmit(onPrepare)}>
      <Stack gap="lg">
        <div>
          <Group justify="space-between" mb="sm">
            <Text size="xs" fw={500}>
              本次参考 · {references.length}
            </Text>
            <Text size="xs" c="dimmed">
              固定示例版本
            </Text>
          </Group>
          <div className={classes.referenceGrid}>
            {references.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                compact
                onOpen={onReference}
              />
            ))}
          </div>
        </div>
        <Textarea
          label="本次提示词"
          description="描述动作、表演和镜头，保留需要延续的细节。"
          minRows={6}
          maxRows={12}
          value={form.values.prompt}
          error={form.errors.prompt}
          onChange={(event) => {
            form.setFieldValue("prompt", event.currentTarget.value);
            form.clearFieldError("prompt");
            onChange(event.currentTarget.value);
          }}
        />
        <Group justify="space-between">
          <Button
            variant="subtle"
            size="xs"
            leftSection={<Sparkle size={14} />}
            onClick={onAssist}
          >
            准备提示
          </Button>
          <Text size="xs" c="dimmed">
            草稿保存在本机
          </Text>
        </Group>
        <ModelSelector />
        <InlineNote>
          参考和提示用于新尝试。结果生成后，再明确采用并更新剪辑。
        </InlineNote>
      </Stack>
      <div className={classes.composerFooter}>
        <div>
          <Text size="xs">本地演示 · 不计费</Text>
          <Text size="xs" c="dimmed">
            下一步核对本次生成计划
          </Text>
        </div>
        <Button
          type="submit"
          variant="filled"
          leftSection={<Play size={14} weight="fill" />}
        >
          准备生成
        </Button>
      </div>
    </form>
  );
}
