// preflight.mjs — refuse to start a publish that cannot succeed.
//
// Everything that can be checked without touching a registry is checked here,
// before `docker login` runs: credentials, image names, the variant table, the
// Dockerfiles that must exist, tag collisions between variants, and whether the
// runner can actually reach a Docker daemon.
//
// Every finding is a hard error with an actionable message: there are no
// degradations left, because build-push.mjs only knows how to drive buildx.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeDocker } from './endpoints.mjs';
import { readOptional } from './config.mjs';
import { computeBuilds } from './meta.mjs';
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

export const DOCKER_HELP = [
  'runner 侧检查清单：',
  '  1) 宿主机 runner（workflow 里不写 container:）：确认 runner 用户能访问 /var/run/docker.sock；',
  '  2) docker runner（写了 container:）：job 容器默认看不到宿主机的 socket，需要挂进去 ——',
  '       container:',
  '         image: ${{ matrix.image }}',
  '         options: >-',
  '           --volume /var/run/docker.sock:/var/run/docker.sock',
  '           --volume /usr/bin/docker:/usr/bin/docker:ro',
  '           --volume /usr/libexec/docker/cli-plugins:/usr/libexec/docker/cli-plugins:ro',
  '     并在 runner 配置里放行这些路径、然后**重启 runner**：',
  '       runner:',
  '         container:',
  '           valid_volumes: ["/var/run/docker.sock", "/usr/bin/docker", "/usr/libexec/docker/cli-plugins"]',
  '     （第 2 条同时解决 docker CLI 与 buildx：两者都必须来自挂载或镜像，Action 不再自己安装）',
  '  3) 容器内以 root 运行（本 Action 默认如此），非 root 需要加进 docker 组；',
  '  4) daemon 不在默认位置时，用仓库变量 DOCKER_HOST 指定（如 tcp://host:2375 或 unix:///run/user/1000/docker.sock），',
  '     或在 runner 配置里设 container.docker_host。',
].join('\n');

/** A sharper reason than "docker version failed": socket absent vs daemon refusing. */
export function dockerUnreachableReason(docker) {
  if (docker.socketPresent === false) {
    return `容器内看不到 ${docker.socketPath}：socket 没有挂进 job 容器（清单第 2 条），或它不在默认路径（用 DOCKER_HOST 指定）`;
  }
  if (docker.socketPresent === true) {
    return `${docker.socketPath} 存在但守护进程不可达：检查权限/守护进程状态（清单第 3 条）`;
  }
  return `DOCKER_HOST=${docker.host || '<unset>'} 不可达`;
}

/** Which files a build plan needs. `target` selects a stage inside the file. */
export function missingDockerfiles(builds, context, exists = existsSync) {
  const missing = [];
  for (const build of builds) {
    const full = isAbsolute(build.dockerfile) ? build.dockerfile : join(context, build.dockerfile);
    if (!exists(full)) missing.push(`${build.variant}: ${full}`);
  }
  return missing;
}

/**
 * All preflight findings. Pure except for the injected probes, so the tests can
 * drive every branch without a daemon.
 */
export function preflightChecks({
  state,
  env = process.env,
  docker = probeDocker(env),
  exists = existsSync,
  now = new Date(),
}) {
  const errors = [];
  const warnings = [];

  const enabled = state.registries.filter((entry) => entry.enabled);
  const halfConfigured = [];
  if (readOptional(env.DOCKERHUB_TOKEN) !== '' && readOptional(env.DOCKERHUB_USERNAME) === '') halfConfigured.push('DOCKERHUB_TOKEN');
  if (readOptional(env.GHCR_TOKEN) !== '' && (enabled.find((entry) => entry.id === 'ghcr')?.user || '') === '') halfConfigured.push('GHCR_TOKEN');
  if (halfConfigured.length > 0) {
    errors.push(
      `${halfConfigured.join(' / ')} 配置不完整：Docker Hub 需要 DOCKERHUB_USERNAME + DOCKERHUB_TOKEN，` +
        'ghcr.io 需要 GHCR_IMAGE（或仓库 owner）与 GHCR_TOKEN',
    );
  }
  if (enabled.length === 0 && !state.dryRun) {
    errors.push(
      '没有可用的 registry 凭据：请至少配置 GHCR_TOKEN，或 DOCKERHUB_USERNAME + DOCKERHUB_TOKEN' +
        '（这两个是 Secrets，也可以放 Variables）',
    );
  }
  if (enabled.length === 0 && state.dryRun) {
    warnings.push('dry run 且没有任何 registry 凭据：只验证构建，不会推送');
  }
  if (state.images.length === 0 && !state.dryRun) {
    errors.push('没有任何镜像要发布（检查 registry 凭据与 DOCKER_META_IMAGES）');
  }

  let builds = [];
  try {
    builds = computeBuilds({
      state,
      // computeBuilds() turns an empty (unconfigured) value into the default.
      tagsRaw: env.DOCKER_META_TAGS,
      flavorRaw: env.DOCKER_META_FLAVOR,
      labelsRaw: env.DOCKER_META_LABELS,
      now,
    });
  } catch (error) {
    errors.push(error.message);
  }

  if (builds.length > 0) {
    const missing = missingDockerfiles(builds, state.options.context, exists);
    if (missing.length > 0) {
      errors.push(`找不到变体的 Dockerfile：${missing.join('、')}（构建上下文 ${state.options.context}）`);
    }
  }

  if (!docker.cli) {
    errors.push(`runner 里没有 docker 命令：${docker.error}\n${DOCKER_HELP}`);
  } else if (!docker.daemon) {
    errors.push(
      `连不上 Docker 守护进程：${dockerUnreachableReason(docker)}\n` +
        `docker version 的原始报错：${docker.error || 'unknown'}\n${DOCKER_HELP}`,
    );
  } else if (!docker.buildx) {
    errors.push(
      'runner 里没有 docker buildx：本 Action 只用 `docker buildx build`（没有经典构建回退）。\n' +
        `${DOCKER_HELP}`,
    );
  }

  if (state.dryRun) {
    warnings.push('dry run：不登录、不推送，只验证构建（--output type=cacheonly）');
  }

  return { errors, warnings, builds };
}

async function main() {
  const env = process.env;
  const state = JSON.parse(readFileSync(statePath(env), 'utf8'));
  const { errors, warnings, builds } = preflightChecks({ state, env });

  for (const warning of warnings) process.stderr.write(`[WARN] ${warning}\n`);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`[ERROR] ${error}\n`);
    process.stderr.write('预检未通过，已中止。\n');
    process.exit(1);
  }

  const tags = builds.reduce((sum, build) => sum + build.images.reduce((count, image) => count + image.tags.length, 0), 0);
  process.stdout.write(
    `预检通过：${state.version} → ${state.images.map((image) => image.base).join('、')}；` +
      `${builds.length} 个变体、${tags} 个 tag` +
      `${state.options.push ? '' : '（不推送）'}\n`,
  );
  if (env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(env.GITHUB_OUTPUT, `dockerfile_count=${builds.length}\n`);
  }
}

if (IS_DIRECT) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`预检异常：${error.message}\n`);
    process.exit(1);
  }
}
