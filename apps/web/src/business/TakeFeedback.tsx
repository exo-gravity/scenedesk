import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { ChatCircleText, Sparkle } from "@phosphor-icons/react";
import { useSession, type Schema } from "./api";
import { useTakeFeedback } from "./use-take-feedback";
import { feedbackRetryAllowed } from "./take-feedback";
import { ShotPromptComposer } from "./ShotPromptComposer";
import type { ReworkSource } from "./prompt-draft";
import classes from "./assistant.module.css";
export function TakeFeedback(props: {
  tenantId: string;
  projectId: string;
  take: Schema<"Take">;
  shot: Schema<"Shot">;
  revision: Schema<"ShotRevision">;
  active: boolean;
}) {
  const session = useSession();
  return <FeedbackContent key={`${session.id}:${props.take.id}`} {...props} />;
}
function FeedbackContent({
  tenantId,
  projectId,
  take,
  shot,
  revision,
  active,
}: Parameters<typeof TakeFeedback>[0]) {
  const session = useSession(),
    { controller, state } = useTakeFeedback(tenantId, projectId, take);
  const [confirmation, setConfirmation] = useState<{
    kind: "rework" | "resolve";
    comment: Schema<"Comment">;
  }>();
  useEffect(() => {
    if (state.access !== "ready") setConfirmation(undefined);
  }, [state.access]);
  if (state.access !== "ready")
    return (
      <Alert
        title={
          state.access === "forbidden"
            ? "当前不可访问候选意见"
            : "正在核对候选意见"
        }
      >
        <Text size="sm">{state.error}</Text>
        {state.busy ? (
          <Loader size="sm" />
        ) : (
          <Button
            variant="default"
            mt="sm"
            onClick={() => void controller.verify()}
          >
            重新读取候选意见
          </Button>
        )}
      </Alert>
    );
  const draft = state.draft!,
    intent = draft.intent,
    disabled = !active || state.busy;
  const hasReview = state.data?.reviews.some((r) => r.status === "open");
  const selected = draft.selected;
  const fixedShot = {
    ...shot,
    specRevisionId: take.shotRevisionId,
    spec: revision.spec,
  };
  return (
    <Stack gap="md" aria-label="候选意见">
      <Group justify="space-between">
        <Text fw={600}>候选意见</Text>
        <Group>
          <Badge variant="light">
            {state.saved ? "本机已保留" : "正在保留"}
          </Badge>
          <Button
            variant="subtle"
            disabled={state.busy}
            onClick={() => {
              controller.suspend();
              void controller.verify();
            }}
          >
            读取当前意见
          </Button>
        </Group>
      </Group>
      <Text size="xs" c="dimmed">
        固定候选 {take.id.slice(0, 8)} · 镜头要求 v{revision.number}
        。意见处理与候选采用分别记录。
      </Text>
      {state.error && (
        <Alert title="需要核对" role="alert">
          {state.error}
        </Alert>
      )}
      {!draft.started && !intent && !draft.receipt && (
        <Button
          variant="default"
          leftSection={<ChatCircleText size={16} />}
          disabled={disabled}
          onClick={() => controller.edit({ started: true })}
        >
          记录候选意见
        </Button>
      )}
      {(draft.started || !!intent || !!draft.receipt) && (
        <Stack gap="sm">
          <Textarea
            label={
              draft.editing
                ? `编辑意见 · r${draft.editing.revision}`
                : "候选意见正文"
            }
            description="记录你对这份候选的具体判断。文字会保留，保存不会改变采用。"
            value={draft.body}
            onChange={(event) =>
              controller.edit({ body: event.currentTarget.value })
            }
            disabled={disabled || !!intent || !!draft.receipt}
            autosize
            minRows={3}
            maxRows={8}
            maxLength={5000}
          />
          {intent && (
            <Alert
              title={intent.rejected ? "本次意见未提交" : "原请求结果待核对"}
            >
              <Text size="sm">
                {intent.rejected ??
                  (intent.kind === "review"
                    ? "建立意见记录的结果尚未确认。恢复后仍需明确保存正文。"
                    : intent.kind === "change"
                      ? "原意见修订与本机编辑已保留，请读取当前意见核对。"
                      : "原意见正文已固定。刷新不会重新发送。")}
              </Text>
              {!feedbackRetryAllowed(intent) && (
                <Text size="sm">
                  已超过创建回执的恢复期限，只能读取列表人工核对；本机原文仍保留。
                </Text>
              )}
            </Alert>
          )}
          <Group>
            {intent?.rejected ? (
              <Button
                disabled={disabled}
                onClick={() => void controller.returnToEditing()}
              >
                保留原文，返回编辑
              </Button>
            ) : (
              <Button
                disabled={
                  disabled ||
                  (!draft.receipt &&
                    !!intent &&
                    !feedbackRetryAllowed(intent)) ||
                  (!intent && !draft.body.trim())
                }
                onClick={() =>
                  void controller.submit(
                    intent || draft.receipt
                      ? undefined
                      : draft.editing
                        ? "change"
                        : hasReview
                          ? "comment"
                          : "review",
                  )
                }
              >
                {draft.receipt
                  ? "核对并完成本机整理"
                  : intent
                    ? "明确恢复原请求"
                    : draft.editing
                      ? "保存意见新修订"
                      : hasReview
                        ? "保存意见"
                        : "建立此候选的意见记录"}
              </Button>
            )}
            {!hasReview && !intent && (
              <Text size="xs" c="dimmed">
                先建立意见记录，再保存这段正文。
              </Text>
            )}
          </Group>
        </Stack>
      )}
      {intent?.kind === "review" && hasReview && (
        <Button
          variant="default"
          disabled={disabled}
          onClick={() => void controller.useExistingReview()}
        >
          保留原请求，使用已存在的意见记录
        </Button>
      )}
      {intent?.kind === "change" && (
        <Group>
          <Button
            variant="default"
            disabled={disabled}
            onClick={() => void controller.reconcileChange()}
          >
            只读核对本次修改
          </Button>
          <Button
            variant="subtle"
            disabled={disabled}
            onClick={() => void controller.reconcileChange(true)}
          >
            保留本机副本，打开当前意见
          </Button>
        </Group>
      )}
      {!!draft.retained?.length && (
        <details>
          <summary>保留的意见输入与原请求（{draft.retained.length}）</summary>
          {draft.retained.map((item, index) => (
            <Text key={index} className={classes.prose} size="sm">
              {item.body} ·{" "}
              {item.intent?.kind === "review"
                ? "原建立记录的请求，未据此认定成功"
                : "原意见修订输入"}
            </Text>
          ))}
        </details>
      )}
      {!!draft.selections?.length && (
        <details>
          <summary>此前选定的修改依据</summary>
          {draft.selections.map((source) => (
            <Button
              key={`${source.comment.id}:${source.comment.revision}`}
              variant="subtle"
              onClick={() => void controller.openPrevious(source)}
            >
              打开意见 r{source.comment.revision} ·{" "}
              {source.comment.body.slice(0, 24)}
            </Button>
          ))}
        </details>
      )}
      {!state.data?.comments.length && (
        <Text size="sm" c="dimmed">
          这份候选暂无已保存意见。
        </Text>
      )}
      {state.data?.comments.map((comment) => (
        <div className={classes.result} key={comment.id}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {comment.authorId === session.userId ? "我的意见" : "成员意见"} ·
              r{comment.revision}
              {comment.startUs !== undefined
                ? ` · 候选 ${(comment.startUs / 1e6).toFixed(2)} 秒`
                : ""}
            </Text>
            <Badge variant="light">
              {comment.resolved ? "已处理" : "待处理"}
            </Badge>
          </Group>
          <Text className={classes.prose} size="sm">
            {comment.body}
          </Text>
          <Group>
            <Button
              variant="default"
              leftSection={<Sparkle size={16} />}
              disabled={disabled || comment.resolved}
              onClick={() =>
                setConfirmation({
                  kind: "rework",
                  comment: structuredClone(comment),
                })
              }
            >
              按意见准备修改…
            </Button>
            {comment.authorId === session.userId && (
              <Button
                variant="subtle"
                disabled={disabled || !!intent || !!draft.receipt}
                onClick={() => void controller.openEditor(comment)}
              >
                编辑正文
              </Button>
            )}
            <Button
              variant="subtle"
              disabled={disabled || !!intent || !!draft.receipt}
              onClick={() =>
                setConfirmation({
                  kind: "resolve",
                  comment: structuredClone(comment),
                })
              }
            >
              {comment.resolved ? "重新打开意见…" : "标记已处理…"}
            </Button>
          </Group>
        </div>
      ))}
      {selected && (
        <ShotPromptComposer
          tenantId={tenantId}
          projectId={projectId}
          shot={fixedShot}
          active={active}
          rework={selected}
        />
      )}
      <Modal
        opened={!!confirmation}
        onClose={() => setConfirmation(undefined)}
        centered
        title={
          confirmation?.kind === "rework"
            ? "确认本次修改依据"
            : "确认意见处理状态"
        }
      >
        <Stack>
          <Text size="sm">
            候选 {take.id.slice(0, 8)} · 原镜头要求 v{revision.number} · 意见 r
            {confirmation?.comment.revision}
          </Text>
          <Text className={classes.prose}>{confirmation?.comment.body}</Text>
          <Text size="sm">
            {confirmation?.kind === "rework"
              ? "使用这条意见的固定版本另开修改输入。模型计划与执行仍需分别确认。"
              : "只更新此意见的处理状态，保留原候选及意见正文。"}
          </Text>
          <Button
            disabled={disabled}
            onClick={() => {
              const fixed = confirmation;
              setConfirmation(undefined);
              if (!fixed) return;
              if (fixed.kind === "resolve")
                void controller.submit(
                  "change",
                  fixed.comment,
                  !fixed.comment.resolved,
                );
              else {
                const source: ReworkSource = {
                  takeId: take.id,
                  reviewId: fixed.comment.reviewId,
                  comment: fixed.comment,
                };
                void controller.select(source);
              }
            }}
          >
            {confirmation?.kind === "rework"
              ? "以此版本准备修改"
              : "确认更新处理状态"}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
