#!/usr/bin/env node
import { readFileSync } from "node:fs";

// Convert a CodeRabbit glob (with optional leading "/") to a RegExp.
// Minimatch semantics for the patterns used here:
//   `**/` => zero or more path segments -> `(?:.*/)?`
//   `**`  => spans any path incl. separators -> `.*`
//   `*`   => a full segment (no separator) -> `[^/]*`
//   `?`   => a single char within a segment -> `[^/]`
// Paths are normalized (leading `/` stripped) so `**/*.md` matches `README.md`
// and `**/node_modules/*` matches `deep/nested/node_modules/f.js`.
function globToRegExp(glob) {
  const g = glob.startsWith("/") ? glob.slice(1) : glob;
  let re = "";
  let i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        if (g[i + 2] === "/") {
          re += ".*";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
        continue;
      }
      re += "[^/]*";
      i++;
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (".+^$+[]{}|#&*".includes(c)) {
      re += "\\" + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp("^" + re + "$", "u");
}

export function parsePathFilters(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const filters = [];
  let inBlock = false;
  let filterIndent = null;
  for (const line of lines) {
    const t = line.trim();
    if (/^path_filters:\s*$/.test(t)) { inBlock = true; continue; }
    if (!inBlock || t === "") continue;
    const curIndent = line.match(/^\s*/)[0].length;
    if (filterIndent === null) filterIndent = curIndent;
    // Stop the array at the next key with the same indentation as `path_filters:`.
    if (curIndent <= filterIndent && !t.startsWith("-")) { inBlock = false; continue; }
    if (!t.startsWith("-")) continue;
    const val = t.replace(/^\s*-\s*/, "").trim().replace(/^['"]|['"]$/g, "");
    if (val) filters.push(val);
  }
  return filters;
}

export function resolveFilter(path, filters) {
  let verdict = "none";
  for (const entry of filters) {
    const neg = entry.startsWith("!");
    const re = globToRegExp(neg ? entry.slice(1) : entry);
    if (re.test(path)) verdict = neg ? "exclude" : "include";
  }
  return verdict;
}

const EXPECTATIONS = [
  // The target of this fix: the generated graphify report is Markdown, so
  // it is pulled into review by `**/*.md` unless a filter excludes it.
  { path: "graphify-out/GRAPH_REPORT.md", verdict: "exclude" },
  // A representative .serena path the review must respect (single-segment).
  { path: ".serena/project.yml", verdict: "exclude" },
  // Markdown outside graphify-out stays in scope.
  { path: "README.md", verdict: "include" },
  { path: "CONTRIBUTING.md", verdict: "include" },
  { path: "docs/typescript-toolchain-spec.md", verdict: "include" },
  { path: "evaluation/EVALUATION_PLAN.md", verdict: "include" },
  // TypeScript code stays in scope.
  { path: "src/agents/registry.ts", verdict: "include" },
];

function main() {
  const yaml = readFileSync(
    new URL("../.coderabbit.yaml", import.meta.url),
    "utf8",
  );
  const filters = parsePathFilters(yaml);
  if (filters.length === 0) {
    console.error("FATAL: no path_filters parsed");
    process.exit(2);
  }
  console.log("Resolved path_filters:");
  for (const f of filters) console.log(`  - ${f}`);
  console.log("");

  let fail = 0;
  for (const { path, verdict } of EXPECTATIONS) {
    const resolved = resolveFilter(path, filters);
    const expected = verdict === "ignore" ? "exclude" : verdict;
    const ok = resolved === expected;
    if (!ok) fail++;
    console.log(`[${ok ? "PASS" : "FAIL"}] resolved=${resolved} expected=${expected}  ${path}`);
  }
  console.log("");
  if (fail > 0) {
    console.error(`${fail} expectation(s) failed`);
    process.exit(1);
  }
  console.log("All path_filter expectations passed.");
}

main();
