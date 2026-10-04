// build-push.mjs — the Forgejo port of docker/build-push-action, limited to the
// two supported registries.
//
// Two things this module is strict about:
//
//   1. One `docker buildx build` per variant. Each variant compiles its own
//      artifact against its own base image; nothing is shared between variants,
//      and no variant is ever produced by retagging another one. That is what
//      makes "alpine" and "trixie-slim" honest builds rather than one build with
//      two tags.
//   2. buildx, always. There is no classic-builder fallback: the job container
//      provides the CLI and the plugin (mounted from the host, or by using an
//      image that has them), and preflight refuses to run without them.
//
// Platforms and tags are orthogonal: variants are tags, platforms are manifest
// list entries. When more than one platform is requested, a `docker-container`
// builder is created for the run and removed afterwards.

import { existsSync, mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeDocker } from './endpoints.mjs';
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

/** `--label k=v` pairs, in a stable order. */
export function labelArgs(labels = {}) {
  return Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
}

export function buildxCreateArgv(name) {
  return ['buildx', 'create', '--use', '--name', name, '--driver', 'docker-container'];
}

export function buildxRemoveArgv(name) {
  return ['buildx', 'rm', name];
}

/**
 * The build args of one variant: the per-variant ones from the variant table
 * (e.g. `NODE_IMAGE=node:lts-alpine`) plus the globally injected ones.
 *
 * `options.buildArgs` wins on a key collision: it holds what `resolve` injected
 * (`VERSION`, `GOPROXY`, …) and what the repository wrote in `DOCKER_BUILD_ARGS`,
 * which is the more explicit statement of intent.
 */
export function effectiveBuildArgs(build, options) {
  const merged = new Map();
  for (const arg of build.buildArgs || []) merged.set(arg.key, arg);
  for (const arg of options.buildArgs || []) merged.set(arg.key, arg);
  return [...merged.values()];
}

/**
 * The full `docker buildx build` command line for one variant.
 *
 * `--push` and `--output type=cacheonly` are mutually exclusive outputs: the
 * first publishes, the second validates the build without touching the image
 * store, which is what a dry run wants.
 */
export function buildxArgv({ build, options, metadataFile, builder = '' }) {
  const argv = ['buildx', 'build'];
  if (builder) argv.push('--builder', builder);
  argv.push('--file', build.dockerfile);
  if (build.target) argv.push('--target', build.target);
  for (const image of build.images) for (const tag of image.tags) argv.push('--tag', tag);
  argv.push(...labelArgs(build.labels));
  if (options.platforms.length > 0) argv.push('--platform', options.platforms.join(','));
  for (const { key, value } of effectiveBuildArgs(build, options)) argv.push('--build-arg', `${key}=${value}`);
  // Attestations are always off: they add manifest entries some registries and
  // clients still choke on, and this Action has no knob for them.
  argv.push('--provenance=false');
  if (metadataFile) argv.push('--metadata-file', metadataFile);
  if (options.push) argv.push('--push');
  else argv.push('--output', 'type=cacheonly');
  argv.push(options.context);
  return argv;
}

/** `containerimage.digest` out of a buildx --metadata-file. */
export function digestFromMetadata(json) {
  return String(json?.['containerimage.digest'] ?? '').trim();
}

/** Run docker with the log streamed to ours (builds must show progress). */
export function runDocker(args, { env = process.env, run = spawnSync, capture = false } = {}) {
  process.stdout.write(`$ docker ${args.join(' ')}\n`);
  const result = run('docker', args, capture
    ? { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }
    : { stdio: ['ignore', 'inherit', 'inherit'], env });
  return {
    status: result.status === 0 ? 0 : result.status ?? 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || result.error?.message || ''),
  };
}

function buildOneVariant({ build, options, env, run, builder, workDir }) {
  const metadataFile = join(workDir, `metadata-${build.variant}.json`);
  const result = runDocker(buildxArgv({ build, options, metadataFile, builder }), { run, env });
  if (result.status !== 0) throw new Error(`变体 ${build.variant} 构建失败（docker buildx build 退出码 ${result.status}）`);

  let digest = '';
  if (existsSync(metadataFile)) {
    try {
      digest = digestFromMetadata(JSON.parse(readFileSync(metadataFile, 'utf8')));
    } catch {
      digest = '';
    }
  }
  return { variant: build.variant, builder: 'buildx', digest, tagNames: build.tagNames, images: build.images };
}

async function main() {
  const env = process.env;
  const state = JSON.parse(readFileSync(statePath(env), 'utf8'));
  if (!Array.isArray(state.builds) || state.builds.length === 0) {
    process.stderr.write('没有构建计划：请先运行 meta 步骤\n');
    process.exit(1);
  }

  const docker = probeDocker(env);
  if (!docker.cli || !docker.daemon || !docker.buildx) {
    process.stderr.write('docker / buildx 不可用，无法构建（preflight 会给出前置条件清单）\n');
    process.exit(1);
  }

  const workDir = mkdtempSync(join(tmpdir(), 'docker-build-push-'));
  const builder = state.options.platforms.length > 1 ? `forgejo-docker-publish-${process.pid}` : '';
  let createdBuilder = false;

  try {
    if (builder) {
      const created = runDocker(buildxCreateArgv(builder), { run: spawnSync, env });
      if (created.status !== 0) throw new Error(`创建 buildx builder 失败（${builder}）`);
      createdBuilder = true;
    }
    for (const build of state.builds) {
      const options = state.dryRun ? { ...state.options, push: false } : state.options;
      process.stdout.write(`==> ${build.variant}${build.isDefault ? '（默认）' : ''}：${build.dockerfile}${build.target ? `#${build.target}` : ''}\n`);
      const result = buildOneVariant({ build, options, env, run: spawnSync, builder, workDir });
      state.results.push(result);
      writeFileSync(statePath(env), JSON.stringify(state, null, 2));
      process.stdout.write(`    完成：${result.digest || '(未取到 digest)'}\n`);
    }
  } finally {
    if (createdBuilder) {
      const removed = runDocker(buildxRemoveArgv(builder), { run: spawnSync, env });
      if (removed.status !== 0) process.stderr.write(`[WARN] 清理 buildx builder 失败：${builder}\n`);
    }
  }

  process.stdout.write(`\n完成：${state.results.length} 个变体${state.options.push && !state.dryRun ? '已推送' : '（未推送）'}\n`);
}

if (IS_DIRECT) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`构建/推送失败：${error.message}\n`);
    process.exit(1);
  }
}
