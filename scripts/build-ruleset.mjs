import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hashRulesetArtifacts } from "@yuuinih/turn-kernel";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
// Keep the generated module outside all inputs to avoid a self-referential hash.
const buildId = await hashRulesetArtifacts([
  { name: "game", path: path("../dist/src") },
  { name: "kernel", path: path("../../turn-kernel/dist/src") },
  { name: "content", path: path("../data") },
  { name: "game-package", path: path("../package.json") },
  { name: "kernel-package", path: path("../../turn-kernel/package.json") },
  { name: "game-lock", path: path("../package-lock.json") },
  { name: "kernel-lock", path: path("../../turn-kernel/package-lock.json") },
]);
await writeFile(
  path("../dist/ruleset-build.js"),
  `export const rulesetBuildId = ${JSON.stringify(buildId)};\n`,
);
