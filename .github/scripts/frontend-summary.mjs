// Writes the Frontend job's coverage section of the GitHub job summary, as
// Markdown on stdout. Reads coverage/coverage-summary.json (Vitest's
// `json-summary` reporter); run from frontend/. Test counts are not repeated
// here: Vitest's own github-actions reporter already writes them.
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

const METRICS = ['statements', 'branches', 'functions', 'lines'];
const REPORT = 'coverage/coverage-summary.json';

console.log('### Frontend coverage\n');
if (!existsSync(REPORT)) {
  console.log('_No coverage report produced._');
  process.exit(0);
}

const { total, ...files } = JSON.parse(readFileSync(REPORT, 'utf8'));
const pct = (m) => `${m.pct}%`;
const capitalise = (s) => s[0].toUpperCase() + s.slice(1);

console.log('| Metric | Coverage | Covered |');
console.log('| --- | ---: | ---: |');
for (const k of METRICS) {
  console.log(`| ${capitalise(k)} | ${pct(total[k])} | ${total[k].covered}/${total[k].total} |`);
}

const rows = Object.entries(files)
  .map(([path, m]) => [relative(process.cwd(), path), m])
  .sort(([a], [b]) => a.localeCompare(b));
// Open by default only when something is below 100%, so the gap is visible.
const gap = rows.some(([, m]) => METRICS.some((k) => m[k].pct < 100));

console.log(
  `\n<details${gap ? ' open' : ''}><summary>Coverage by file (${rows.length} files)</summary>\n`,
);
console.log(`| File | ${METRICS.map(capitalise).join(' | ')} |`);
console.log(`| --- |${' ---: |'.repeat(METRICS.length)}`);
for (const [path, m] of rows) {
  console.log(`| \`${path}\` | ${METRICS.map((k) => pct(m[k])).join(' | ')} |`);
}
console.log('\n</details>');
