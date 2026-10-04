// build-push.mjs — the Forgejo port of docker/build-push-action, limited to the
// two supported registries.
//
// Two things this module is strict about:
//
//   1. One `docker build` per variant. Each variant compiles its own artifact
//      against its own base image; nothing is shared between variants, and no
//      variant is ever produced by retagging another one. That is what makes
//      "alpine" and "trixie" honest builds rather than one build with two tags.
//   2. `buildx` when it is there, `docker build` + `docker tag` + `docker push`
//      when it is not. The fallback is single-platform and cannot export cache,
//      which preflight has already warned about.
//
// Platforms and tags are orthogonal: variants are tags, platforms are manifest
// list entries. When more than one platform is requested and buildx exists, a
// `docker-container` builder is created for the run and removed afterwards.

import { existsSync, mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeDocker } from './deps.mjs';
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

/** `buildx` grew --provenance in 0.11; older plugins reject the flag outright. */
export function parseBuildxVersion(text) {
  const match = /v?(\d+)\.(\d+)/.exec(String(text ?? ''));
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function supportsProvenance(version) {
  if (!version) return false;
  const [major, minor] = version;
  return major > 0 || minor >= 11;
}

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
 * The full `docker buildx build` command line for one variant.
 *
 * `--push` and `--output type=cacheonly` are mutually exclusive outputs: the
 * first publishes, the second validates the build without touching the image
 * store, which is what a dry run wants.
 */
export function buildxArgv({ build, options, metadataFile, provenanceSupported = true, builder = '' }) {
  const argv = ['buildx', 'build'];
  if (builder) argv.push('--builder', builder);
  argv.push('--file', build.dockerfile);
  if (build.target) argv.push('--target', build.target);
  for (const image of build.images) for (const tag of image.tags) argv.push('--tag', tag);
  argv.push(...labelArgs(build.labels));
  if (options.platforms.length > 0) argv.push('--platform', options.platforms.join(','));
  for (const { key, value } of options.buildArgs) argv.push('--build-arg', `${key}=${value}`);
  for (const source of options.cacheFrom) argv.push('--cache-from', source);
  for (const target of options.cacheTo) argv.push('--cache-to', target);
  if (options.pull) argv.push('--pull');
  if (options.noCache) argv.push('--no-cache');
  if (provenanceSupported) argv.push(`--provenance=${options.provenance ? 'true' : 'false'}`);
  if (metadataFile) argv.push('--metadata-file', metadataFile);
  if (options.push) argv.push('--push');
  else argv.push('--output', 'type=cacheonly');
  argv.push(options.context);
  return argv;
}

/**
 * The environment for the classic builder. The example Dockerfiles use
 * `RUN --mount=type=cache`, which only BuildKit understands, and every Docker
 * Engine since 20.10 ships BuildKit — so the fallback path opts in explicitly
 * instead of silently failing on the Dockerfile syntax.
 */
export function classicBuildEnv(env = process.env) {
  return { ...env, DOCKER_BUILDKIT: '1' };
}

/**
 * `docker build` fallback: every tag but the first is attached with `docker tag`
 * afterwards, because the classic builder takes a single -t per invocation.
 */
export function classicBuildArgv({ build, options }) {
  const [first] = build.images.flatMap((image) => image.tags);
  const argv = ['build', '--file', build.dockerfile];
  if (build.target) argv.push('--target', build.target);
  if (first) argv.push('--tag', first);
  argv.push(...labelArgs(build.labels));
  if (options.platforms.length === 1) argv.push('--platform', options.platforms[0]);
  for (const { key, value } of options.buildArgs) argv.push('--build-arg', `${key}=${value}`);
  if (options.pull) argv.push('--pull');
  if (options.noCache) argv.push('--no-cache');
  argv.push(options.context);
  return argv;
}

export function classicTagArgv(source, target) {
  return ['tag', source, target];
}

export function classicPushArgv(tag) {
  return ['push', tag];
}

/** Every tag after the first, built with `docker build` and attached by `docker tag`. */
export function extraTags(build) {
  const all = build.images.flatMap((image) => image.tags);
  return all.slice(1);
}

/** `containerimage.digest` out of a buildx --metadata-file. */
export function digestFromMetadata(json) {
  return String(json?.['containerimage.digest'] ?? '').trim();
}

/** `repo/name@sha256:…` (from docker inspect) → `sha256:…`. */
export function digestFromInspect(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return '';
  const at = text.lastIndexOf('@');
  const value = at === -1 ? text : text.slice(at + 1);
  return value.startsWith('sha256:') ? value : '';
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

/** The digest of the image that was just built/pushed, best effort. */
export function imageDigest({ build, run = spawnSync, env = process.env }) {
  const first = build.images[0]?.tags?.[0];
  if (!first) return '';
  const inspect = runDocker(['inspect', '--format', '{{index .RepoDigests 0}}', first], { run, env, capture: true });
  const digest = digestFromInspect(inspect.stdout);
  if (digest) return digest;
  const id = runDocker(['inspect', '--format', '{{.Id}}', first], { run, env, capture: true });
  return String(id.stdout || '').trim();
}

function buildOneVariant({ build, options, env, run, buildx, provenanceSupported, builder, workDir }) {
  if (buildx) {
    const metadataFile = join(workDir, `metadata-${build.variant}.json`);
    const argv = buildxArgv({ build, options, metadataFile, provenanceSupported, builder });
    const result = runDocker(argv, { run, env });
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

  const result = runDocker(classicBuildArgv({ build, options }), { run, env: classicBuildEnv(env) });
  if (result.status !== 0) throw new Error(`变体 ${build.variant} 构建失败（docker build 退出码 ${result.status}）`);
  const [first] = build.images.flatMap((image) => image.tags);
  for (const tag of extraTags(build)) {
    const tagged = runDocker(classicTagArgv(first, tag), { run, env });
    if (tagged.status !== 0) throw new Error(`docker tag ${first} ${tag} 失败`);
  }
  if (options.push) {
    for (const tag of build.images.flatMap((image) => image.tags)) {
      const pushed = runDocker(classicPushArgv(tag), { run, env });
      if (pushed.status !== 0) throw new Error(`docker push ${tag} 失败`);
    }
  }
  return {
    variant: build.variant,
    builder: 'docker',
    digest: imageDigest({ build, run, env }),
    tagNames: build.tagNames,
    images: build.images,
  };
}

async function main() {
  const env = process.env;
  const state = JSON.parse(readFileSync(statePath(env), 'utf8'));
  if (!Array.isArray(state.builds) || state.builds.length === 0) {
    process.stderr.write('没有构建计划：请先运行 meta 步骤\n');
    process.exit(1);
  }

  const docker = probeDocker(env);
  if (!docker.cli || !docker.daemon) {
    process.stderr.write('docker 不可用，无法构建\n');
    process.exit(1);
  }
  const buildx = docker.buildx;
  if (!buildx) {
    process.stdout.write('[WARN] 没有 buildx：降级为 docker build + docker tag + docker push（单平台、无缓存导出）\n');
  }

  const provenanceSupported = buildx
    ? supportsProvenance(parseBuildxVersion(runDocker(['buildx', 'version'], { env, capture: true }).stdout))
    : false;
  if (buildx && !provenanceSupported) {
    process.stdout.write('[WARN] buildx 版本较旧（< 0.11）：不传 --provenance\n');
  }

  const workDir = mkdtempSync(join(tmpdir(), 'docker-build-push-'));
  const builder = buildx && state.options.platforms.length > 1 ? `forgejo-docker-publish-${process.pid}` : '';
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
      const result = buildOneVariant({ build, options, env, run: spawnSync, buildx, provenanceSupported, builder, workDir });
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
