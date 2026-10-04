// resolve.mjs — derive the release identity and the whole build plan skeleton
// from the environment, and persist it for the later steps.
//
// The rules match the npm-publish Action of this template library: the tag that
// triggered the run is the version, and a hand-typed workflow_dispatch version
// must agree with an existing tag, so a typo cannot publish the wrong version.
//
// The state file lives in $RUNNER_TEMP (default /tmp) and deliberately contains
// no credential: registries are recorded by token *variable name* only.

import { appendFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DEFAULT_VARIANT,
  buildOptionsFrom,
  imagesFrom,
  parseVariants,
  readOptional,
  registriesFrom,
  variantSelection,
} from './config.mjs';
import { goProxyFrom } from './deps.mjs';

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

/** Where the shared state for one run lives. */
export function statePath(env = process.env) {
  return join(env.RUNNER_TEMP || '/tmp', 'docker-publish.json');
}

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

/**
 * Build arguments this Action can fill in by itself, because their values are
 * known only at run time:
 *
 *   * `VERSION`      — the tag (what people write by hand with the official trio:
 *                      `build-args: VERSION=${{ steps.meta.outputs.version }}`);
 *   * `GOPROXY`      — `GOPROXY` / `GO_PROXY`, so a Dockerfile's `ARG GOPROXY`
 *                      reaches an internal Athens without extra configuration;
 *   * `NPM_REGISTRY` — an explicit `NPM_REGISTRY`, or the registry `ensure-tools`
 *                      classified out of `NPM_PROXY` (it exports the verdict).
 *
 * An explicit `DOCKER_BUILD_ARGS` entry always wins, because that is the
 * repository saying what it wants. Nothing is injected when the source variable
 * is empty, so a repository that sets none of them sees exactly the same
 * command line as before.
 */
export function withDefaultBuildArgs(options, { version, env = process.env }) {
  const candidates = [
    ['VERSION', version],
    ['GOPROXY', goProxyFrom(env)],
    ['NPM_REGISTRY', readOptional(env.NPM_REGISTRY)],
  ];
  const injected = candidates
    .filter(([key, value]) => value !== undefined && value !== null && String(value) !== '')
    .filter(([key]) => !options.buildArgs.some((arg) => arg.key === key))
    .map(([key, value]) => ({ key, value: String(value) }));
  return { ...options, buildArgs: [...injected, ...options.buildArgs] };
}

export function stripTagPrefix(tag) {
  let value = String(tag || '').trim();
  if (value.startsWith('refs/tags/')) value = value.slice('refs/tags/'.length);
  if (value.startsWith('v')) value = value.slice(1);
  return value;
}

export function tagVersionFromRef(ref) {
  const match = /^refs\/tags\/(.+)$/.exec(ref || '');
  return match ? match[1] : '';
}

/**
 * Free-form tags are allowed only when DOCKER_ALLOW_ANY_TAG=true: the semver
 * rules then produce nothing, but `type=ref`, `type=sha` and `type=raw` still
 * work. Default is strict, because a mistyped tag is how wrong versions ship.
 */
export function resolveRelease(env = process.env, { variantsOverride } = {}) {
  const inputVersion = readOptional(env.INPUT_VERSION);
  const refName = readOptional(env.GITHUB_REF_NAME);
  const ref = readOptional(env.GITHUB_REF);
  const isRefTag = ref.startsWith('refs/tags/');
  // A dispatch can be started from a branch, where there is no tag to inherit:
  // then the typed version IS the release, and it must be typed explicitly.
  if (inputVersion && isRefTag && stripTagPrefix(inputVersion) !== stripTagPrefix(refName)) {
    throw new Error(
      `手工输入的版本（${inputVersion}）与触发 ref（${refName || '<none>'}）不一致，已中止以避免误发`,
    );
  }
  if (!inputVersion && !isRefTag && !tagVersionFromRef(ref)) {
    throw new Error(
      `当前 ref 是 ${ref || '<empty>'}，不是 tag：请推送 tag，或在 workflow_dispatch 里填写 version（要与已有 tag 的版本一致）`,
    );
  }
  const rawTag = inputVersion || refName || tagVersionFromRef(ref);
  if (!rawTag) throw new Error('无法确定版本：GITHUB_REF_NAME 为空');
  const versionSource = inputVersion ? 'input' : 'ref';

  const allowAnyTag = ['1', 'true', 'yes', 'on'].includes(readOptional(env.DOCKER_ALLOW_ANY_TAG).toLowerCase());
  const version = stripTagPrefix(rawTag);
  if (!SEMVER.test(version) && !allowAnyTag) {
    throw new Error(
      `无法从 tag 解析出合法版本号：${rawTag}（想让任意 tag 可用，请设置变量 DOCKER_ALLOW_ANY_TAG=true）`,
    );
  }
  const prerelease = version.includes('-');

  const repo = readOptional(env.GITHUB_REPOSITORY);
  const serverUrl = readOptional(env.GITHUB_SERVER_URL);
  const runNumber = readOptional(env.GITHUB_RUN_NUMBER);
  const sha = readOptional(env.GITHUB_SHA);
  const dryRun = readOptional(env.INPUT_DRY_RUN).toLowerCase() === 'true';

  const variants = variantSelection(
    parseVariants(
      readOptional(env.DOCKER_VARIANTS) || variantsOverride || undefined,
      readOptional(env.DOCKER_DEFAULT_VARIANT) || DEFAULT_DEFAULT_VARIANT,
    ),
    readOptional(env.INPUT_VARIANTS),
  );
  const registries = registriesFrom(env);
  const images = imagesFrom(env, registries, repo.split('/').pop() || '', { preview: dryRun });

  return {
    version,
    tag: rawTag,
    versionSource,
    prerelease,
    allowAnyTag,
    semver: SEMVER.test(version),
    sha,
    shortSha: sha.slice(0, 7),
    repo,
    repoName: repo.split('/').pop() || '',
    serverUrl,
    runUrl: `${serverUrl}/${repo}/actions/runs/${runNumber}`,
    runNumber,
    runAttempt: readOptional(env.GITHUB_RUN_ATTEMPT),
    eventName: readOptional(env.GITHUB_EVENT_NAME),
    refName,
    ref,
    // A manual dispatch names an existing tag rather than a ref, so it is
    // treated as a tag event for every tagging rule.
    isTagEvent: ref.startsWith('refs/tags/') || readOptional(env.GITHUB_EVENT_NAME) === 'workflow_dispatch',
    isBranchEvent: ref.startsWith('refs/heads/'),
    isPrEvent: ref.startsWith('refs/pull/'),
    dryRun,
    variants,
    registries,
    images,
    options: withDefaultBuildArgs(buildOptionsFrom(env, { dryRun }), { version, env }),
    builds: [],
    results: [],
  };
}

async function main() {
  const state = resolveRelease(process.env);
  writeFileSync(statePath(process.env), JSON.stringify(state, null, 2));

  const emit = (key, value) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    process.stdout.write(`${key}=${value}\n`);
  };
  emit('version', state.version);
  emit('tag', state.tag);
  emit('version_source', state.versionSource);
  emit('prerelease', String(state.prerelease));
  emit('dry_run', String(state.dryRun));
  emit('push', String(state.options.push));
  emit('variants', state.variants.map((variant) => variant.name).join(','));
  emit('images', state.images.map((image) => image.base).join(','));
  process.stdout.write(
    `tag=${state.tag} version=${state.version} 来源=${state.versionSource === 'input' ? 'workflow_dispatch 输入' : 'ref'} ` +
      `prerelease=${state.prerelease} dry-run=${state.dryRun} push=${state.options.push}\n`,
  );
  process.stdout.write(
    `变体：${state.variants
      .map((variant) => `${variant.name}(${variant.dockerfile}${variant.target ? `#${variant.target}` : ''}${variant.isDefault ? ',默认' : ''})`)
      .join(' ')}\n`,
  );
  process.stdout.write(
    `registry：${state.registries.map((entry) => `${entry.id}=${entry.enabled ? `启用(${entry.user})` : '未配置'}`).join(' ')}\n`,
  );
}

if (IS_DIRECT) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
