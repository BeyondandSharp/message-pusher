// summary.mjs — the digest table for the run.
//
// The official build-push-action writes a rich job summary; Forgejo runners may
// or may not expose $GITHUB_STEP_SUMMARY, so this writes there when it exists and
// always prints to stdout. The digests are the useful part: they are what a
// deployment pins.

import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { statePath } from './resolve.mjs';

// Run directly (argv[1] is this file) rather than imported by a test.
// Compare real paths: /tmp is a symlink on some hosts, and path.resolve
// would then disagree with import.meta.url.
export const IS_DIRECT = (() => {
  if (!process.argv[1] || !process.argv[1].endsWith('.mjs')) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

/** One line per published image tag, with its digest. */
export function summaryLines(state) {
  const lines = [];
  for (const result of state.results || []) {
    const status = result.builder === 'buildx' ? 'buildx' : 'docker（降级）';
    lines.push(`${result.variant} [${status}]${result.digest ? ` ${result.digest}` : ''}`);
    for (const image of result.images || []) {
      for (const tag of image.tags) lines.push(`  ${tag}`);
    }
  }
  return lines;
}

/** The job-summary markdown (a small table, no HTML). */
export function summaryMarkdown(state) {
  const rows = [];
  for (const result of state.results || []) {
    const digest = result.digest || '—';
    for (const image of result.images || []) {
      for (const tag of image.tags) rows.push(`| ${result.variant} | \`${tag}\` | \`${digest}\` |`);
    }
  }
  return [
    `## docker-build-push ${state.version}`,
    '',
    `- 仓库：${state.repo}`,
    `- tag：${state.tag}（sha ${state.sha ? state.sha.slice(0, 7) : '—'}）`,
    `- 变体：${state.variants.map((variant) => variant.name).join('、')}`,
    `- 推送：${state.options?.push && !state.dryRun ? '是' : '否'}`,
    '',
    '| 变体 | tag | digest |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

async function main() {
  const state = JSON.parse(readFileSync(statePath(process.env), 'utf8'));
  for (const line of summaryLines(state)) process.stdout.write(`${line}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summaryMarkdown(state)}\n`);
  }
}

if (IS_DIRECT) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`汇总失败：${error.message}\n`);
    process.exit(1);
  }
}
