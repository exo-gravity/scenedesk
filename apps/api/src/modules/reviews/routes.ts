import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import type { Schema } from "../content/model.js";
import { getTake } from "../candidates/model.js";
import {
  commentRecord,
  getComment,
  getReview,
  reviewRecord,
  validateCommentText,
} from "./model.js";

export function reviewRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(app, context, "listReviews", async (tx, input) => {
    requireThat(
      !input.query.cutRevisionId,
      422,
      "REVIEW_SCOPE_UNSUPPORTED",
      "当前仅支持候选意见记录。",
    );
    if (input.query.takeId) await getTake(tx, String(input.query.takeId));
    return {
      body: await page(
        tx,
        context.secrets,
        "listReviews",
        input.query,
        "SELECT * FROM reviews WHERE tenant_id=$1 AND project_id=$2 AND ($3::uuid IS NULL OR take_id=$3) AND ($4::text IS NULL OR status=$4) AND id::text ILIKE $5",
        [
          tx.tenantId,
          tx.projectId,
          input.query.takeId ?? null,
          input.query.status ?? null,
          searchPattern(input.query),
        ],
        reviewRecord,
      ),
    };
  });
  registerAction(app, context, "createReview", async (tx, input) => {
    const body = input.body as Schema<"ReviewInput">;
    requireThat(
      body.subject.takeId &&
        !body.subject.cutRevisionId &&
        !body.sourceReviewIds?.length &&
        !body.reworkItems?.length,
      422,
      "REVIEW_SCOPE_UNSUPPORTED",
      "当前仅记录候选意见，尚不支持成片审阅、正式决定或返工闭环。",
    );
    const take = await getTake(tx, body.subject.takeId);
    const media = (
      await tx.sql.query(
        "SELECT status,kind FROM media WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, take.mediaId],
      )
    ).rows[0];
    requireThat(
      media?.status === "ready" && media.kind === "video",
      422,
      "REVIEW_MEDIA_UNAVAILABLE",
      "请对可用的候选视频记录意见。",
    );
    await tx.sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `take-review:${take.id}`,
    ]);
    const rounds = (
      await tx.sql.query(
        "SELECT coalesce(max(number),0)::bigint AS last_number,bool_or(status='open') AS opened FROM reviews WHERE tenant_id=$1 AND project_id=$2 AND take_id=$3",
        [tx.tenantId, tx.projectId, take.id],
      )
    ).rows[0];
    requireThat(
      !rounds.opened,
      409,
      "REVIEW_ALREADY_OPEN",
      "这个候选已有开放的意见记录，请读取后继续记录。",
    );
    const id = randomUUID();
    await tx.sql.query(
      "INSERT INTO reviews(id,tenant_id,project_id,take_id,number,opened_by) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        tx.tenantId,
        tx.projectId,
        take.id,
        Number(rounds.last_number) + 1,
        tx.session.userId,
      ],
    );
    return { body: await getReview(tx, id), etag: 1 };
  });
  registerAction(app, context, "getReview", async (tx, input) => {
    const review = await getReview(tx, input.params.reviewId!);
    return { body: review, etag: review.revision };
  });
  registerAction(app, context, "listComments", async (tx, input) => {
    await getReview(tx, input.params.reviewId!);
    return {
      body: await page(
        tx,
        context.secrets,
        "listComments",
        { ...input.query, reviewId: input.params.reviewId },
        "SELECT * FROM review_comments WHERE tenant_id=$1 AND project_id=$2 AND review_id=$3 AND body ILIKE $4",
        [
          tx.tenantId,
          tx.projectId,
          input.params.reviewId,
          searchPattern(input.query),
        ],
        commentRecord,
      ),
    };
  });
  registerAction(app, context, "createComment", async (tx, input) => {
    const review = await getReview(tx, input.params.reviewId!),
      body = input.body as Schema<"CommentInput">;
    validateCommentText(body.body);
    const take = await getTake(tx, review.subject.takeId!);
    const duration = take.range.outUs - take.range.inUs;
    requireThat(
      (body.startUs === undefined || body.startUs < duration) &&
        (body.endUs === undefined ||
          (body.startUs !== undefined &&
            body.endUs > body.startUs &&
            body.endUs <= duration)),
      422,
      "INVALID_COMMENT_TIME",
      "评论时间须位于候选局部区间内，结束时间须晚于开始时间。",
    );
    if (body.parentCommentId)
      await getComment(tx, review.id, body.parentCommentId);
    const id = randomUUID();
    await tx.sql.query(
      "INSERT INTO review_comments(id,tenant_id,project_id,review_id,author_id,body,start_us,end_us,parent_comment_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        tx.tenantId,
        tx.projectId,
        review.id,
        tx.session.userId,
        body.body,
        body.startUs ?? null,
        body.endUs ?? null,
        body.parentCommentId ?? null,
      ],
    );
    return { body: await getComment(tx, review.id, id), etag: 1 };
  });
  registerAction(app, context, "changeComment", async (tx, input) => {
    const comment = await getComment(
        tx,
        input.params.reviewId!,
        input.params.commentId!,
      ),
      body = input.body as Schema<"CommentChange">;
    requireThat(
      body.body !== undefined || body.resolved !== undefined,
      422,
      "EMPTY_COMMENT_CHANGE",
      "请选择要修改的评论文本或处理状态。",
    );
    versionMatches(comment.revision, input.version);
    if (body.body !== undefined) {
      validateCommentText(body.body);
      requireThat(
        comment.authorId === tx.session.userId,
        403,
        "COMMENT_AUTHOR_REQUIRED",
        "只有评论作者可以编辑文本。",
      );
    }
    const text = body.body ?? comment.body,
      resolved = body.resolved ?? comment.resolved;
    if (text === comment.body && resolved === comment.resolved)
      return { body: comment, etag: comment.revision };
    await tx.sql.query(
      "UPDATE review_comments SET body=$5,resolved=$6,revision=revision+1 WHERE tenant_id=$1 AND project_id=$2 AND review_id=$3 AND id=$4",
      [tx.tenantId, tx.projectId, comment.reviewId, comment.id, text, resolved],
    );
    return {
      body: await getComment(tx, comment.reviewId, comment.id),
      etag: comment.revision + 1,
    };
  });
}
