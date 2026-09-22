import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tokens } from "../apps/web/src/theme/tokens.js";
import { palettes } from "../apps/web/src/theme/shared-language-study.js";

// This gate covers migrated UI only. It does not claim a full visual/accessibility audit.
const migrated = [
  "apps/web/src/business",
  "apps/web/src/studio",
  "apps/web/src/components/workspace",
  "apps/web/src/pages/SceneProduction.tsx",
  "apps/web/src/pages/DesignPage.tsx",
  "apps/web/src/pages/LayoutOptionsPage.tsx",
  "apps/web/src/pages/layout-options.module.css",
  "apps/web/src/pages/design.module.css",
  "apps/web/src/pages/WorkspaceRecommendationPrototype.tsx",
  "apps/web/src/pages/WorkspaceWalkthroughPages.tsx",
  "apps/web/src/pages/ProductionDetailPrototype.tsx",
  "apps/web/src/pages/production-detail.module.css",
  "apps/web/src/pages/workspace-recommendation.module.css",
];
const files = (path: string): string[] =>
  /\.(tsx?|css)$/.test(path)
    ? [path]
    : readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(join(path, entry.name))
          : /\.(tsx?|css)$/.test(entry.name)
            ? [join(path, entry.name)]
            : [],
      );
const failures: string[] = [];
if (
  !readFileSync("apps/web/index.html", "utf8").includes(
    "@layer legacy, mantine;",
  )
) {
  failures.push(
    "index.html must establish cascade layer order before extracted vendor CSS",
  );
}
const forbidden =
  /^(tailwindcss|@tailwindcss\/|@heroui\/|@kumo\/|@cloudflare\/kumo|@mantine\/emotion|@mui\/|@chakra-ui\/|@radix-ui\/|shadcn|@shadcn\/)/;
for (const path of ["package.json", "apps/web/package.json"]) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  for (const name of Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }))
    if (forbidden.test(name))
      failures.push(`${path}: unapproved general UI dependency ${name}`);
}
for (const path of migrated.flatMap(files)) {
  const source = readFileSync(path, "utf8");
  if (
    /#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})\b|\b(?:rgb|rgba|hsl|hsla)\(/i.test(
      source,
    )
  )
    failures.push(`${path}: raw color outside theme`);
  if (/font-size\s*:\s*\d|border-radius\s*:\s*\d/.test(source))
    failures.push(`${path}: raw type/radius instead of theme token`);
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (forbidden.test(match[1]!))
      failures.push(`${path}: unapproved import ${match[1]}`);
  }
  if (/<(?:button|input|select|textarea)\b/.test(source))
    failures.push(`${path}: use Mantine for general controls`);
}
const luminance = (hex: string) => {
  const values = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * values[0]! + 0.7152 * values[1]! + 0.0722 * values[2]!;
};
const contrast = (a: string, b: string) => {
  const l = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l[0]! + 0.05) / (l[1]! + 0.05);
};
const pairs: {
  name: string;
  foreground: string;
  background: string;
  minimum: number;
}[] = [];
for (const [tone, p] of Object.entries(palettes)) {
  pairs.push(
    {
      name: `${tone} primary`,
      foreground: p.text,
      background: p.surface,
      minimum: 4.5,
    },
    {
      name: `${tone} secondary`,
      foreground: p.secondary,
      background: p.surface,
      minimum: 4.5,
    },
    {
      name: `${tone} action`,
      foreground: p.onAction,
      background: p.action,
      minimum: 4.5,
    },
    {
      name: `${tone} input border`,
      foreground: p.field,
      background: p.surface,
      minimum: 3,
    },
    {
      name: `${tone} focus`,
      foreground: p.focus,
      background: p.surface,
      minimum: 3,
    },
  );
}
for (const [name, color] of Object.entries({
  ...tokens.text,
  ...tokens.status,
  focus: tokens.focus,
})) {
  if (name === "onAccent") continue;
  pairs.push({
    name: `${name} on raised`,
    foreground: color,
    background: tokens.surface.raised,
    minimum: 4.5,
  });
}
pairs.push(
  {
    name: "filled button",
    foreground: tokens.text.onAccent,
    background: tokens.accent.solid,
    minimum: 4.5,
  },
  {
    name: "input border",
    foreground: tokens.border.field,
    background: tokens.surface.raised,
    minimum: 3,
  },
);
const contrastChecks = pairs.map((pair) => {
  const ratio = contrast(pair.foreground, pair.background);
  if (ratio < pair.minimum)
    failures.push(`${pair.name}: ${ratio.toFixed(2)} < ${pair.minimum}`);
  return {
    name: pair.name,
    ratio: Number(ratio.toFixed(2)),
    minimum: pair.minimum,
  };
});
console.log(
  JSON.stringify(
    {
      passed: failures.length === 0,
      scope:
        "Migrated source rules and selected opaque color pairs; browser interaction and composed media checked separately.",
      files: migrated.flatMap(files).length,
      contrastChecks,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
