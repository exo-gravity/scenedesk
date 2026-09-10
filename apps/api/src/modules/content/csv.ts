import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { validateContract } from "@drama/contracts/validation";
import { Problem, requireThat } from "../../kernel/errors.js";
import type { Schema } from "./model.js";

type CsvRecord = { record: string[]; info: { lines: number } };
const required = ["episode", "scene", "shot_label", "intent"];
const allowed = [...required, "dialogue", "duration_seconds", "notes"];

/** CSV is bounded to 500,000 codepoints before parsing. Quoting, embedded
 * newlines and BOM are handled by csv-parse; no type inference or skipped errors.
 * Only these declared columns are mapped, never arbitrary object properties.
 */
export function csvProposal(
  csv: string,
  target: Schema<"ProposalTarget">,
): Schema<"ProposalOperation">[] {
  requireThat(
    Array.from(csv).length <= 500_000,
    422,
    "CSV_TOO_LARGE",
    "CSV 最多包含 500,000 个字符。",
  );
  requireThat(
    !Array.from(csv).some(
      (c) =>
        c === "\0" ||
        (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
    ),
    422,
    "INVALID_CSV_TEXT",
    "CSV 含有无效字符，请使用 UTF-8 文本。",
  );
  let records: CsvRecord[];
  try {
    records = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 500_000,
      info: true,
    }) as unknown as CsvRecord[]; // csv-parse typings omit the info:true result wrapper.
  } catch (error) {
    const lines = (error as { lines?: unknown }).lines;
    throw new Problem(
      422,
      "INVALID_CSV",
      `CSV 格式不完整${typeof lines === "number" ? `（第 ${lines} 行附近）` : ""}，请检查引号与列数。`,
    );
  }
  const header = records.shift()?.record.map((h) => h.trim());
  requireThat(
    header &&
      required.every((h) => header.includes(h)) &&
      header.every((h) => allowed.includes(h)) &&
      new Set(header).size === header.length,
    422,
    "INVALID_CSV_HEADER",
    "CSV 必须包含 episode、scene、shot_label、intent；可选 dialogue、duration_seconds、notes，不能重复列名。",
  );
  requireThat(
    records.length > 0,
    422,
    "EMPTY_CSV",
    "CSV 只有表头，没有镜头内容。",
  );
  const operations: Schema<"ProposalOperation">[] = [],
    episodes = new Map<string, string>(),
    episodeSceneCounts = new Map<string, number>(),
    scenes = new Map<string, { id: string; count: number }>();
  let appendSource: string | undefined;
  let currentLine = 1;
  function operation(
    kind: Schema<"ProposalOperation">["kind"],
    temporaryId: string,
    summary: string,
    proposed: Schema<"ProposalOperation">["proposed"],
  ) {
    const op: Schema<"ProposalOperation"> = {
      opId: randomUUID(),
      action: "create",
      kind,
      temporaryId,
      summary,
      proposed,
    };
    requireThat(
      validateContract("ProposalOperation", op).valid,
      422,
      "INVALID_CSV_ROW",
      `CSV 第 ${currentLine} 行内容超出字段长度或范围。`,
    );
    operations.push(op);
  }
  for (const { record, info } of records) {
    currentLine = info.lines;
    const row = Object.fromEntries(
      header.map((column, index) => [column, record[index]!]),
    );
    requireThat(
      required.every((column) => row[column]?.trim()),
      422,
      "INVALID_CSV_ROW",
      `CSV 第 ${info.lines} 行缺少单集、场次、镜头编号或叙事意图。`,
    );
    const episode = row.episode!.trim(),
      scene = row.scene!.trim(),
      label = row.shot_label!.trim(),
      source = JSON.stringify([episode, scene]);
    const spec: Schema<"ShotSpec"> = { intent: row.intent!, references: [] };
    if (row.dialogue)
      spec.dialogue = [{ id: randomUUID(), text: row.dialogue }];
    if (row.notes) spec.notes = row.notes;
    const duration = row.duration_seconds?.trim();
    if (duration) {
      requireThat(
        /^\d+(\.\d{1,6})?$/.test(duration),
        422,
        "INVALID_CSV_DURATION",
        `CSV 第 ${info.lines} 行时长须为非负秒数，最多六位小数。`,
      );
      const [whole, fraction = ""] = duration.split("."),
        micros = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, "0"));
      requireThat(
        micros <= BigInt(Number.MAX_SAFE_INTEGER),
        422,
        "INVALID_CSV_DURATION",
        `CSV 第 ${info.lines} 行时长超出可保存范围。`,
      );
      spec.plannedDurationUs = Number(micros);
    }
    let sceneId: string, position: number;
    if (target.mode === "append_to_scene") {
      requireThat(
        appendSource === undefined || appendSource === source,
        422,
        "CSV_MULTIPLE_SCENES",
        "追加到当前场次时，CSV 只能包含一个来源场次；请拆批或选择新建结构。",
      );
      appendSource = source;
      sceneId = target.sceneId;
      position = operations.length;
    } else {
      let episodeId = episodes.get(episode);
      if (!episodeId) {
        episodeId = randomUUID();
        episodes.set(episode, episodeId);
        operation("episode", episodeId, `新建单集：${episode}`, {
          title: episode,
          position: episodes.size - 1,
          status: "active",
        });
      }
      let group = scenes.get(source);
      if (!group) {
        group = { id: randomUUID(), count: 0 };
        scenes.set(source, group);
        const position = episodeSceneCounts.get(episodeId) ?? 0;
        episodeSceneCounts.set(episodeId, position + 1);
        operation("scene", group.id, `新建场次：${scene}`, {
          episodeId,
          title: scene,
          position,
          summary: "",
          state: {},
          status: "active",
        });
      }
      sceneId = group.id;
      position = group.count++;
    }
    operation("shot", randomUUID(), `镜头：${label}`, {
      sceneId,
      label,
      position,
      spec,
      status: "active",
    });
  }
  return operations;
}
