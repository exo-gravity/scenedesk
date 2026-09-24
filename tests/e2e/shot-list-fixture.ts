import { randomUUID } from "node:crypto";
import type { components } from "@drama/contracts";
import { expect, type WorkspaceFixture } from "./fixture.js";
import { seedSelectedMedia } from "../support/selected-media.js";
type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

export async function seedShotList(w: WorkspaceFixture, withProjectCanvas = true) {
  const seed = {
    ...w.runtime.database,
    tenantId: w.tenant.id,
    projectId: w.project.id,
    userId: w.owner.userId,
  };
  const blue = await seedSelectedMedia(seed, "blue"),
    orange = await seedSelectedMedia(seed, "orange");
  const shotInput = {
    sceneId: w.scene.id,
    label: "01 推门",
    position: 0,
    status: "active" as const,
    spec: { intent: "林推开咖啡店的门。", references: [] },
  };
  const shot = await w.command<Schema<"Shot">>(
    "POST",
    `${w.path}/shots`,
    shotInput,
    (await w.content()).revision,
  );
  const second = await w.command<Schema<"Shot">>(
    "POST",
    `${w.path}/shots`,
    { ...shotInput, label: "02 阅读", position: 1 },
    (await w.content()).revision,
  );
  const archived = await w.command<Schema<"Shot">>(
    "POST",
    `${w.path}/shots`,
    { ...shotInput, label: "03 旧镜", position: 2 },
    (await w.content()).revision,
  );
  await w.command(
    "PUT",
    `${w.path}/shots/${archived.id}`,
    { ...shotInput, label: "03 旧镜", position: 2, status: "archived" },
    archived.revision,
  );
  const orangeTake = await w.command<Schema<"Take">>(
    "POST",
    `${w.path}/takes`,
    {
      shotId: shot.id,
      shotRevisionId: shot.specRevisionId,
      mediaId: orange.id,
      range: { inUs: 0, outUs: 3000000 },
      note: "受控橙片；不是供应商验收。",
    },
  );
  if (withProjectCanvas) {
    const ensured = await w.runtime.request<Schema<"ProjectCanvas">>(
      w.owner,
      "POST",
      `${w.path}/canvas`,
    );
    expect(ensured.status).toBe(200);
    const node = {
      id: randomUUID(),
      kind: "video",
      title: "合成蓝片",
      position: { x: 80, y: 80 },
      width: 320,
      content: { type: "media", mediaId: blue.id },
    };
    await w.command(
      "PUT",
      `${w.path}/canvases/${ensured.value.canvas.id}`,
      { schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] } },
      ensured.value.canvas.revision,
    );
  }
  const selection = () =>
    w.command<Schema<"SelectionState">>(
      "GET",
      `${w.path}/shots/${shot.id}/selection`,
    );
  const takes = () =>
    w.command<{ items: Schema<"Take">[] }>(
      "GET",
      `${w.path}/takes?shotId=${shot.id}`,
    );
  return { blue, orange, shot, second, archived, orangeTake, selection, takes };
}
