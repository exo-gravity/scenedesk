import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Transaction } from "../../kernel/database.js";
import { canonical } from "../../kernel/crypto.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import {
  activeParent,
  contentRecord,
  findContent,
  type Schema,
} from "../content/model.js";

type Task = Schema<"Task">;
type Input = Schema<"TaskInput">;
const select = `SELECT t.*,coalesce(m.status='active' AND (m.role IN ('owner','admin') OR pm.id IS NOT NULL),false) AS assignee_available
  FROM production_tasks t LEFT JOIN memberships m ON m.tenant_id=t.tenant_id AND m.id=t.assignee_membership_id
  LEFT JOIN project_memberships pm ON pm.project_id=t.project_id AND pm.membership_id=m.id
  LEFT JOIN shots s ON s.id=t.shot_id`;
async function getTask(tx: Transaction, id: string): Promise<Task> {
  const { rows } = await tx.sql.query(
    `${select} WHERE t.tenant_id=$1 AND t.project_id=$2 AND t.id=$3`,
    [tx.tenantId, tx.projectId, id],
  );
  requireThat(rows[0], 404, "NOT_FOUND", "任务不存在或无访问权限。");
  return contentRecord<Task>(rows[0]);
}
function normalize(input: Input): Input {
  const body = { ...input };
  for (const key of ["assigneeMembershipId", "sceneId", "shotId"] as const)
    if (body[key]) body[key] = body[key].toLowerCase();
  if (body.dueAt) {
    const date = new Date(body.dueAt);
    requireThat(
      Number.isFinite(date.getTime()) &&
        date.getUTCFullYear() >= 1 &&
        date.getUTCFullYear() <= 9999,
      422,
      "INVALID_DUE_DATE",
      "任务期限不是有效日期。",
    );
    body.dueAt = date.toISOString();
  }
  requireThat(
    body.title.trim().length > 0 &&
      ![body.title, body.note ?? ""].some((text) =>
        Array.from(text).some(
          (c) =>
            c === "\0" ||
            (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
        ),
      ),
    422,
    "INVALID_TASK_TEXT",
    "请输入有效的任务标题与说明。",
  );
  return body;
}
function taskInput(task: Task): Input {
  const {
    id: _id,
    revision: _revision,
    projectId: _project,
    createdAt: _created,
    updatedAt: _updated,
    assigneeAvailable: _available,
    ...body
  } = task;
  return body;
}
async function validate(tx: Transaction, body: Input, previous?: Task) {
  requireThat(
    body.kind !== "rework" && !body.origin && !body.result,
    422,
    "REVIEW_NOT_READY",
    "审片返工需先建立真实审稿与意见来源；当前可使用一般任务、协助或场次主责。",
  );
  if (previous) {
    requireThat(
      body.kind === previous.kind &&
        (body.kind !== "scene_owner" || body.sceneId === previous.sceneId),
      422,
      "TASK_IDENTITY_CHANGED",
      "任务类型与场次主责对象不能更换；改派请更新原任务的负责人。",
    );
    if (!["lead", "admin"].includes(tx.projectRole ?? "")) {
      const own = await tx.sql.query(
        "SELECT id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active'",
        [tx.tenantId, tx.session.userId],
      );
      requireThat(
        own.rows[0]?.id === previous.assigneeMembershipId &&
          previous.assigneeAvailable,
        403,
        "TASK_NOT_ASSIGNED",
        "只能更新分配给自己的有效任务。",
      );
      const protectedFields = (value: Input) => {
        const {
          status: _status,
          note: _note,
          result: _result,
          ...fields
        } = value;
        return fields;
      };
      requireThat(
        canonical(protectedFields(body)) ===
          canonical(protectedFields(taskInput(previous))),
        403,
        "TASK_FIELDS_FORBIDDEN",
        "协作者只能更新自己的任务状态和处理说明；改派、期限与范围由负责人管理。",
      );
    }
  }
  if (
    body.assigneeMembershipId &&
    (!previous || body.assigneeMembershipId !== previous.assigneeMembershipId)
  ) {
    const member = await tx.sql.query(
      "SELECT m.id FROM memberships m LEFT JOIN project_memberships pm ON pm.membership_id=m.id AND pm.project_id=$3 WHERE m.tenant_id=$1 AND m.id=$2 AND m.status='active' AND (m.role IN ('owner','admin') OR pm.id IS NOT NULL)",
      [tx.tenantId, body.assigneeMembershipId, tx.projectId],
    );
    requireThat(
      member.rows[0],
      422,
      "ASSIGNEE_UNAVAILABLE",
      "请选择仍有当前项目资格的有效成员。",
    );
  }
  if (body.sceneId && (!previous || body.sceneId !== previous.sceneId))
    await activeParent(tx, "scenes", body.sceneId);
  if (body.shotId) {
    const shot = await findContent(tx, "shots", body.shotId);
    requireThat(
      !body.sceneId || shot.scene_id === body.sceneId,
      422,
      "TASK_SCOPE_MISMATCH",
      "镜头必须属于任务所选场次。",
    );
    if (!previous || previous.shotId !== body.shotId) {
      requireThat(
        shot.status === "active",
        409,
        "SHOT_ARCHIVED",
        "请先恢复镜头，再分派新任务。",
      );
      await activeParent(tx, "scenes", shot.scene_id);
    }
  }
}
async function history(
  tx: Transaction,
  id: string,
  number: number,
  body: Input,
) {
  await tx.sql.query(
    "INSERT INTO production_task_revisions (id,tenant_id,project_id,task_id,number,changed_by,snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      tx.tenantId,
      tx.projectId,
      id,
      number,
      tx.session.userId,
      body,
    ],
  );
}
function values(body: Input) {
  return [
    body.title,
    body.assigneeMembershipId ?? null,
    body.sceneId ?? null,
    body.shotId ?? null,
    body.stage,
    body.status,
    body.dueAt ?? null,
    body.note ?? null,
  ];
}
export function taskRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(app, context, "listTasks", async (tx, input) => ({
    body: await page(
      tx,
      context.secrets,
      "listTasks",
      input.query,
      `${select} WHERE t.tenant_id=$1 AND t.project_id=$2 AND ($3::uuid IS NULL OR t.scene_id=$3 OR (t.scene_id IS NULL AND s.scene_id=$3)) AND ($4::text IS NULL OR t.kind=$4) AND ($5::uuid IS NULL OR t.assignee_membership_id=$5) AND ($6::text IS NULL OR t.status=$6) AND (t.title ILIKE $7 OR t.note ILIKE $7)`,
      [
        tx.tenantId,
        tx.projectId,
        input.query.sceneId ?? null,
        input.query.kind ?? null,
        input.query.assigneeMembershipId ?? null,
        input.query.status ?? null,
        searchPattern(input.query),
      ],
      contentRecord<Task>,
    ),
  }));
  registerAction(app, context, "getTask", async (tx, input) => {
    const task = await getTask(tx, input.params.taskId!);
    return { body: task, etag: task.revision };
  });
  registerAction(app, context, "listTaskRevisions", async (tx, input) => {
    await getTask(tx, input.params.taskId!);
    return {
      body: await page(
        tx,
        context.secrets,
        "listTaskRevisions",
        { ...input.query, taskId: input.params.taskId },
        "SELECT * FROM production_task_revisions WHERE tenant_id=$1 AND project_id=$2 AND task_id=$3 AND (snapshot->>'title' ILIKE $4 OR snapshot->>'note' ILIKE $4)",
        [
          tx.tenantId,
          tx.projectId,
          input.params.taskId,
          searchPattern(input.query),
        ],
        contentRecord<Schema<"TaskRevision">>,
      ),
    };
  });
  registerAction(app, context, "createTask", async (tx, input) => {
    const body = normalize(input.body as Input);
    await validate(tx, body);
    if (body.kind === "scene_owner") {
      const existing = await tx.sql.query(
        "SELECT id FROM production_tasks WHERE tenant_id=$1 AND project_id=$2 AND scene_id=$3 AND kind='scene_owner'",
        [tx.tenantId, tx.projectId, body.sceneId],
      );
      requireThat(
        !existing.rows[0],
        409,
        "SCENE_OWNER_EXISTS",
        "这个场次已有主责任务（包括已完成任务），请在原任务中改派或重新打开。",
      );
    }
    const id = randomUUID();
    await tx.sql.query(
      "INSERT INTO production_tasks (id,tenant_id,project_id,kind,title,assignee_membership_id,scene_id,shot_id,stage,status,due_at,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [id, tx.tenantId, tx.projectId, body.kind, ...values(body)],
    );
    await history(tx, id, 1, body);
    return { body: await getTask(tx, id), etag: 1 };
  });
  registerAction(app, context, "changeTask", async (tx, input) => {
    const task = await getTask(tx, input.params.taskId!);
    versionMatches(task.revision, input.version);
    const body = normalize(input.body as Input);
    await validate(tx, body, task);
    if (canonical(body) === canonical(taskInput(task)))
      return { body: task, etag: task.revision };
    await tx.sql.query(
      "UPDATE production_tasks SET title=$4,assignee_membership_id=$5,scene_id=$6,shot_id=$7,stage=$8,status=$9,due_at=$10,note=$11,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
      [tx.tenantId, tx.projectId, task.id, ...values(body)],
    );
    await history(tx, task.id, task.revision + 1, body);
    return { body: await getTask(tx, task.id), etag: task.revision + 1 };
  });
}
