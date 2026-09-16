import type { components } from "@drama/contracts";
import type { WorkspaceFixture } from "./fixture.js";
import { seedShotList } from "./shot-list-fixture.js";
type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

export async function selectedScene(w: WorkspaceFixture) {
  const seed = await seedShotList(w);
  const take = await w.command<Schema<"Take">>("POST", `${w.path}/takes`, {
    shotId: seed.second.id,
    shotRevisionId: seed.second.specRevisionId,
    mediaId: seed.blue.id,
    range: { inUs: 500001, outUs: 2500001 },
    note: "合成蓝片完整原件，清单保留精确微秒。",
  });
  for (const item of [seed.orangeTake, take]) {
    const state = await w.command<Schema<"SelectionState">>(
      "GET",
      `${w.path}/shots/${item.shotId}/selection`,
    );
    await w.command(
      "PUT",
      `${w.path}/shots/${item.shotId}/selection`,
      { takeId: item.id, reason: "合成验收明确选用" },
      state.revision,
    );
  }
  const alternative = await w.command<Schema<"Take">>(
    "POST",
    `${w.path}/takes`,
    {
      shotId: seed.shot.id,
      shotRevisionId: seed.shot.specRevisionId,
      mediaId: seed.blue.id,
      range: { inUs: 0, outUs: 1000000 },
      note: "只作预览的另一候选",
    },
  );
  return { ...seed, take, alternative };
}
