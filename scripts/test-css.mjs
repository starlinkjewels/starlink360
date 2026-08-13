/**
 * The stylesheet, checked against the markup that uses it.
 *
 * Two faults cost most of a working day and neither was visible to any other
 * check — both compiled, both linted, both built, and both were only found by
 * someone looking at the screen and saying it was wrong.
 *
 *  - `.upload-float` was used in the markup and had NO RULE AT ALL. Its child
 *    positioned itself against the stage instead and landed a full viewport
 *    below the fold, so the Upload button looked broken when it worked fine.
 *  - A scripted edit left a duplicated closing brace, which silently killed
 *    every rule after it — including the one for a control that then rendered
 *    as unstyled stacked elements.
 *
 * Neither is subtle once you know to look, and both are a second of arithmetic
 * to detect. That is what this is.
 *
 * Usage: node scripts/test-css.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

const css = readFileSync("src/styles.css", "utf8");

console.log("=== the stylesheet parses ===");
{
  /*
   * Braces, counted. A stray closing brace ends the rule it is in and every
   * enclosing block with it, so everything after that point stops applying —
   * silently, because CSS has no errors, only rules it chose to ignore.
   */
  let depth = 0;
  let negativeAt = 0;
  const lines = css.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const c of lines[i]) {
      if (c === "{") depth++;
      if (c === "}") depth--;
    }
    if (depth < 0 && !negativeAt) negativeAt = i + 1;
  }
  check(!negativeAt, "no stray closing brace", negativeAt ? `first at line ${negativeAt}` : "");
  check(depth === 0, "every block is closed", `ends at depth ${depth}`);
}

console.log("\n=== every class in the markup has a rule ===");
{
  const defined = new Set([...css.matchAll(/@utility\s+([a-zA-Z0-9_-]+)/g)].map((m) => m[1]));
  // Plain selectors count too — not everything is a utility.
  for (const m of css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) defined.add(m[1]);

  /*
   * Tailwind's own utilities are generated, not written here, so they are
   * skipped. The list is deliberately broad: a false positive costs somebody an
   * investigation, and the faults worth catching are project-specific names
   * like `upload-float` that nothing else could be responsible for.
   */
  const builtin =
    /^(?:[a-z]+-)?(?:\[|\d)|^(?:flex|grid|hidden|block|inline|relative|absolute|fixed|sticky|w|h|min|max|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|text|font|bg|border|rounded|shadow|opacity|z|top|left|right|bottom|inset|overflow|cursor|select|pointer|transition|duration|ease|scale|rotate|translate|origin|items|justify|self|order|col|row|space|divide|ring|outline|size|aspect|object|truncate|whitespace|break|list|align|leading|tracking|uppercase|lowercase|capitalize|underline|sr|not|group|peer|dark|sm|md|lg|xl|touch|antialiased|appearance|backdrop|contents|isolate|mix|will|snap|scroll|resize|accent|caret|fill|stroke)(?:$|-|:)/;

  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name)) files.push(p);
    }
  })("src");

  const missing = new Map();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      // Template holes are conditionals, not class names.
      const raw = (m[1] || m[2] || "").replace(/\$\{[^}]*\}/g, " ");
      for (const cls of raw.split(/\s+/)) {
        if (!cls || cls.includes("$") || defined.has(cls)) continue;
        /*
         * Variants come off before the test. `hover:bg-accent` is Tailwind's
         * `bg-accent` under a variant, and testing the whole string against a
         * list of utility roots reports it as a project class nobody defined.
         */
        const bare = cls.slice(cls.lastIndexOf(":") + 1);
        if (builtin.test(bare) || defined.has(bare)) continue;
        if (!missing.has(cls)) missing.set(cls, new Set());
        missing.get(cls).add(relative("src", file));
      }
    }
  }

  for (const [cls, where] of [...missing].sort()) {
    console.log(`  ${cls} — ${[...where].join(", ")}`);
  }
  check(missing.size === 0, "no class is used without a rule", `${missing.size} missing`);
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
