import type { Transaction } from "../../kernel/database.js";
import { canonical, digest } from "../../kernel/crypto.js";
import { requireThat } from "../../kernel/errors.js";
import { contentRecord, type Schema } from "../content/model.js";
import { getTake } from "../candidates/model.js";

export function reviewRecord(row: Record<string, unknown>): Schema<"Review"> {
  const { take_id, opened_by: _actor, ...fields } = row;
  return {
    ...contentRecord<Schema<"Review">>(fields),
    subject: { takeId: String(take_id) },
    sourceReviewIds: [],
    reworkItems: [],
  };
}
export function commentRecord(row: Record<string, unknown>): Schema<"Comment"> {
  const { project_id: _project, start_us, end_us, ...fields } = row;
  return {
    ...contentRecord<Schema<"Comment">>(fields),
    ...(start_us == null ? {} : { startUs: Number(start_us) }),
    ...(end_us == null ? {} : { endUs: Number(end_us) }),
  };
}
export async function getReview(tx: Transaction, id: string) {
  const row = (
    await tx.sql.query(
      "SELECT * FROM reviews WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
      [tx.tenantId, tx.projectId, id],
    )
  ).rows[0];
  requireThat(row, 404, "NOT_FOUND", "意见记录不存在或无访问权限。");
  return reviewRecord(row);
}
export async function getComment(
  tx: Transaction,
  reviewId: string,
  commentId: string,
) {
  const row = (
    await tx.sql.query(
      "SELECT * FROM review_comments WHERE tenant_id=$1 AND project_id=$2 AND review_id=$3 AND id=$4",
      [tx.tenantId, tx.projectId, reviewId, commentId],
    )
  ).rows[0];
  requireThat(row, 404, "NOT_FOUND", "评论不存在或不属于当前意见记录。");
  return commentRecord(row);
}
export function validateCommentText(body: string) {
  requireThat(
    body.trim().length > 0 &&
      Array.from(body).length <= 5000 &&
      !Array.from(body).some(
        (c) =>
          c === "\0" ||
          (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
      ),
    422,
    "INVALID_COMMENT_TEXT",
    "评论须为 1–5000 个有效字符。",
  );
}

/** Read exactly the chosen history; freshness is a separate plan/execution decision. */
export async function resolveTakeFeedback(
  tx: Transaction,
  request: Schema<"AssistanceRequest">,
) {
  requireThat(
    request.kind === "prepare_rework" &&
      request.sourceTakeId &&
      !request.sourceCutRevisionId &&
      request.feedback &&
      Number.isSafeInteger(request.feedback.commentRevision) &&
      request.feedback.commentRevision! > 0,
    422,
    "REWORK_SOURCE_MISMATCH",
    "请明确选择候选、原评论及看到的评论版本；当前不支持成片返工。",
  );
  const take = await getTake(tx, request.sourceTakeId);
  const review = await getReview(tx, request.feedback.reviewId);
  requireThat(
    review.subject.takeId === take.id,
    422,
    "REWORK_SOURCE_MISMATCH",
    "原意见的观看对象必须是明确选择的候选。",
  );
  const saved = (
    await tx.sql.query(
      "SELECT c.start_us,c.end_us,c.revision AS current_revision,c.resolved AS current_resolved,r.body,r.number FROM review_comments c JOIN review_comment_revisions r ON r.comment_id=c.id AND r.review_id=c.review_id AND r.tenant_id=c.tenant_id AND r.project_id=c.project_id WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.review_id=$3 AND c.id=$4 AND r.number=$5",
      [
        tx.tenantId,
        tx.projectId,
        review.id,
        request.feedback.commentId,
        request.feedback.commentRevision,
      ],
    )
  ).rows[0];
  requireThat(
    saved,
    404,
    "REWORK_FEEDBACK_UNAVAILABLE",
    "固定评论版本不存在或无访问权限。",
  );
  const feedbackSnapshot: NonNullable<
    Schema<"ResolvedInput">["feedbackSnapshot"]
  > = {
    reviewId: review.id,
    commentId: request.feedback.commentId.toLowerCase(),
    commentRevision: Number(saved.number),
    body: saved.body,
    subject: { takeId: take.id },
    ...(saved.start_us == null ? {} : { startUs: Number(saved.start_us) }),
    ...(saved.end_us == null ? {} : { endUs: Number(saved.end_us) }),
  };
  const dependency: Schema<"SourceDependency"> = {
    kind: "review_comment",
    objectId: feedbackSnapshot.commentId,
    revision: feedbackSnapshot.commentRevision,
    tracking: "fixed",
    contentHash: digest(canonical(feedbackSnapshot)),
  };
  return {
    take,
    feedbackSnapshot,
    dependency,
    currentCommentRevision: Number(saved.current_revision),
    currentResolved: saved.current_resolved as boolean,
  };
}
