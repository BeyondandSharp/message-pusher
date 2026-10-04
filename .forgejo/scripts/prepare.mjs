// prepare.mjs — make the job container able to build, from inside the container.
//
// The shipped workflow uses `docker:dind` as the workbench and installs nothing
// up front, so this program is what turns a bare job container into a working
// builder:
//
//   1. a reachable daemon: the dind image ships `dockerd`, but the runner starts
//      the job container with `tail -f /dev/null`, so dockerd is never started
//      for us. Start it ourselves when nothing is reachable. (A daemon the runner
//      already provided — mounted socket, DOCKER_HOST, admin-managed dind — is
//      detected and left alone.)
//   2. buildx: the dind/cli image ships the plugin; if the image is swapped for a
//      bare one, install it from the distribution package or the release binary.
//   3. extra packages: `DOCKER_JOB_PACKAGES`, for repositories that need a
//      compiler or a tool the workbench image lacks.
//   4. binfmt/QEMU: multi-architecture builds need it on the host kernel, and a
//      privileged job container is a place we can register it from.
//
// Everything is injectable (`run`, `spawnDetached`, `sleep`, `exists`, `readFile`,
// `probe`) so the tests can drive every branch without a daemon or a network.

import { closeSync, existsSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOptionsFrom, isTruthy, parseVariants, platformsFor, readOptional, variantTableRaw } from './config.mjs';
import { hasBinary, probeDocker } from './endpoints.mjs';

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

/** What to tell an operator whose runner cannot give the job a daemon. */
export const DOCKER_PREREQUISITE = [
  'job 容器里没有可用的 Docker 守护进程。两种接法（默认推荐第 1 种）：',
  '  1) 默认 docker:dind 工作台：在 runner 配置里设置',
  '       container:',
  '         privileged: true',
  '     然后重启 runner。注意 workflow 里写的 `options: --privileged` 会被 runner 忽略，',
  '     权限只能由 runner 侧打开（dind 需要 privileged）。',
  '  2) daemon 由 runner 提供：设置 container.docker_host: automount（或仓库变量 DOCKER_HOST 指向它），',
  '     prepare 检测到可达的 daemon 后会直接使用，不会再去启动 dockerd。',
].join('\n');

/** `x86_64` / `aarch64` / `armv7l` … → the arch name Docker uses. */
export const ARCH_ALIASES = {
  x86_64: 'amd64',
  amd64: 'amd64',
  x64: 'amd64',
  aarch64: 'arm64',
  arm64: 'arm64',
  armv7l: 'arm',
  armv6l: 'arm',
  i386: '386',
  i686: '386',
  ia32: '386',
};

export function normalizeArch(machine) {
  const value = readOptional(machine).toLowerCase();
  return ARCH_ALIASES[value] || value;
}

/** The architecture of the machine this runs on. */
export function hostArch(run = spawnSync) {
  const result = run('uname', ['-m'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const machine = result && result.status === 0 ? result.stdout : process.arch;
  return normalizeArch(machine);
}

/** The architectures of a platform list. */
export function archesOf(platforms = []) {
  return [...new Set(platforms.map((platform) => normalizeArch(String(platform).split('/')[1])))].filter(Boolean);
}

/** The binfmt_misc handler name tonistiigi/binfmt registers for an arch. */
export function binfmtHandler(arch) {
  if (arch === 'amd64') return 'qemu-x86_64';
  if (arch === '386') return 'qemu-i386';
  if (arch === 'arm64') return 'qemu-aarch64';
  return `qemu-${arch}`;
}

export const BINFMT_ROOT = '/proc/sys/fs/binfmt_misc';

/** The platforms this run will ask buildx for: variant table ∪ DOCKER_PLATFORMS. */
export function requestedPlatforms(env = process.env, { table = '' } = {}) {
  const options = buildOptionsFrom(env);
  const platforms = [];
  for (const variant of parseVariants(table || variantTableRaw(env))) {
    for (const platform of platformsFor(variant, options)) platforms.push(platform);
  }
  for (const platform of options.platforms) platforms.push(platform);
  return [...new Set(platforms)];
}

/** The first package manager the container has. */
export function detectManager(run = spawnSync) {
  for (const [name, binary] of [
    ['apk', 'apk'],
    ['apt-get', 'apt-get'],
    ['dnf', 'dnf'],
    ['yum', 'yum'],
  ]) {
    if (hasBinary(binary, run)) return name;
  }
  return '';
}

function packageManagerInstall(manager, packages) {
  const list = packages.join(' ');
  switch (manager) {
    case 'apk':
      return ['apk', ['add', '--no-cache', ...packages]];
    case 'apt-get':
      return ['sh', ['-c', `apt-get update && apt-get install -y --no-install-recommends ${list}`]];
    case 'dnf':
      return ['dnf', ['install', '-y', ...packages]];
    case 'yum':
      return ['yum', ['install', '-y', ...packages]];
    default:
      return null;
  }
}

/**
 * Install `DOCKER_JOB_PACKAGES` (space / comma / semicolon separated). Empty
 * means "nothing extra", which is the docker:dind default.
 */
export function installPackages(raw, { run = spawnSync, packages = [] } = {}) {
  const wanted = packages.length > 0
    ? packages
    : String(raw ?? '')
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter((item) => item !== '' && !item.startsWith('#'));
  if (wanted.length === 0) return { manager: '', packages: [] };
  const manager = detectManager(run);
  if (!manager) {
    throw new Error(`要安装额外的包（${wanted.join(' ')}），但容器里没有 apk / apt-get / dnf / yum`);
  }
  const argv = packageManagerInstall(manager, wanted);
  const result = run(argv[0], argv[1], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!result || result.status !== 0) {
    throw new Error(`安装额外的包失败（${manager} ${wanted.join(' ')}）：${String((result && result.stderr) || '')}`);
  }
  return { manager, packages: wanted };
}

/**
 * Make sure `docker buildx` works: the plugin is normally in the image, so this
 * only runs for a swapped-in minimal image. Tries the distribution package
 * first, then the stand-alone release binary.
 */
export function ensureBuildx({ env = process.env, run = spawnSync } = {}) {
  if (hasBinary('buildx', run)) return { source: 'image' };
  const manager = detectManager(run);
  if (manager === 'apk') run('apk', ['add', '--no-cache', 'docker-cli-buildx'], { stdio: 'inherit' });
  else if (manager) packageManagerInstallRun(manager, ['docker-buildx-plugin'], run);
  if (hasBinary('buildx', run)) return { source: manager || 'image' };

  const arch = hostArch(run);
  const url = readOptional(env.DOCKER_BUILDX_URL)
    || `https://github.com/docker/buildx/releases/latest/download/buildx-linux-${arch}`;
  const dest = readOptional(env.DOCKER_BUILDX_PATH) || '/usr/local/libexec/docker/cli-plugins/docker-buildx';
  process.stdout.write(`==> 安装 buildx 插件：${url} → ${dest}\n`);
  run('sh', ['-c', `mkdir -p "$(dirname '${dest}')" && curl -fsSL '${url}' -o '${dest}' && chmod +x '${dest}'`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (hasBinary('buildx', run)) return { source: 'download' };

  throw new Error(
    '容器里没有 docker buildx，自动安装也失败了：本 Action 只用 `docker buildx build`，没有经典构建回退。\n' +
      '  默认 docker:dind / docker:cli 自带 buildx；换工作台镜像时请换回自带 buildx 的镜像，' +
      '或设置 DOCKER_BUILDX_URL / DOCKER_BUILDX_PATH 指向内网镜像。',
  );
}

function packageManagerInstallRun(manager, packages, run) {
  const argv = packageManagerInstall(manager, packages);
  if (argv) run(argv[0], argv[1], { stdio: 'inherit' });
}

function readLogTail(path, readFile = readFileSync, lines = 20) {
  try {
    return String(readFile(path, 'utf8')).split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A reachable daemon, starting `dockerd` when nothing is reachable and the
 * binary exists. Returns `{docker, started, driver, log}`; throws with
 * DOCKER_PREREQUISITE when neither route works.
 */
export async function ensureDaemon({
  env = process.env,
  run = spawnSync,
  spawnDetached = spawn,
  sleep = defaultSleep,
  exists = existsSync,
  readFile = readFileSync,
  probe = probeDocker,
} = {}) {
  const probeNow = () => probe(env, run, { exists });
  let docker = probeNow();
  if (!docker.cli) {
    throw new Error(
      'job 容器里没有 docker 命令：默认 docker:dind 工作台自带 docker CLI，' +
        '换镜像时请选择带 docker CLI 的镜像。',
    );
  }
  if (docker.daemon) return { docker, started: false, driver: '', log: '' };
  if (!hasBinary('dockerd', run)) throw new Error(DOCKER_PREREQUISITE);

  const logPath = readOptional(env.DOCKER_DIND_LOG) || '/var/log/dockerd.log';
  const explicitDriver = readOptional(env.DOCKER_DIND_STORAGE_DRIVER);
  const waitSeconds = Number(readOptional(env.DOCKER_DIND_WAIT)) > 0 ? Number(readOptional(env.DOCKER_DIND_WAIT)) : 90;
  // First the daemon's own default, then vfs: nested overlay-on-overlay is the
  // one failure a plain dockerd hit in a container most often reports.
  const attempts = explicitDriver ? [explicitDriver] : ['', 'vfs'];

  for (const [index, driver] of attempts.entries()) {
    const args = driver ? [`--storage-driver=${driver}`] : [];
    process.stdout.write(`==> 启动容器内 dockerd${driver ? `（--storage-driver=${driver}）` : ''}，日志：${logPath}\n`);
    let fd;
    try {
      fd = openSync(logPath, 'a');
    } catch (error) {
      throw new Error(`无法写入 dockerd 日志 ${logPath}：${error.message}`);
    }
    let child;
    try {
      child = spawnDetached('dockerd', args, { detached: true, stdio: ['ignore', fd, fd] });
      if (child && typeof child.unref === 'function') child.unref();
    } finally {
      closeSync(fd);
    }

    const seconds = index === 0 ? waitSeconds : Math.max(30, Math.round(waitSeconds / 2));
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      if (child && child.exitCode !== null && child.exitCode !== 0) break;
      docker = probeNow();
      if (docker.daemon) return { docker, started: true, driver, log: logPath };
      if (Date.now() >= deadline) break;
      await sleep(2000);
    }
    const tail = readLogTail(logPath, readFile);
    process.stderr.write(`[WARN] dockerd 启动失败${driver ? `（--storage-driver=${driver}）` : ''}${tail ? `：\n${tail}` : ''}\n`);
  }

  throw new Error(
    `容器内 dockerd 启动失败（日志尾部见上，完整日志：${logPath}）。\n${DOCKER_PREREQUISITE}`,
  );
}

/**
 * Register QEMU handlers for the architectures this run needs that the host
 * cannot execute natively. Best effort: a missing handler is a warning, because
 * a host that already has binfmt from outside works fine, and a native-only run
 * needs none of this.
 */
export async function ensureBinfmt({
  env = process.env,
  run = spawnSync,
  exists = existsSync,
  arch = '',
  platforms = [],
  root = BINFMT_ROOT,
} = {}) {
  const host = arch || hostArch(run);
  const wanted = archesOf(platforms).filter((candidate) => candidate !== host);
  if (isTruthy(env.DOCKER_SKIP_BINFMT)) return { skipped: true, wanted, registered: [], remaining: [] };
  const missing = wanted.filter((candidate) => !exists(join(root, binfmtHandler(candidate))));
  if (missing.length === 0) return { skipped: false, wanted, registered: [], remaining: [] };

  const image = readOptional(env.DOCKER_BINFMT_IMAGE) || 'tonistiigi/binfmt';
  process.stdout.write(`==> 注册 QEMU binfmt：${missing.join(',')}（${image}）\n`);
  const result = run('docker', ['run', '--privileged', '--rm', image, '--install', missing.join(',')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const remaining = missing.filter((candidate) => !exists(join(root, binfmtHandler(candidate))));
  return {
    skipped: false,
    wanted,
    registered: missing.filter((candidate) => !remaining.includes(candidate)),
    remaining,
    error: result && result.status === 0 ? '' : String((result && result.stderr) || ''),
  };
}

/**
 * Everything the build steps need, in order. Hard failures throw with an
 * actionable message; binfmt is the one best-effort part (warning only).
 */
export async function prepare({
  env = process.env,
  run = spawnSync,
  spawnDetached = spawn,
  sleep = defaultSleep,
  exists = existsSync,
  readFile = readFileSync,
  probe = probeDocker,
  table = '',
  arch = '',
} = {}) {
  const daemon = await ensureDaemon({ env, run, spawnDetached, sleep, exists, readFile, probe });
  const buildx = ensureBuildx({ env, run });
  const extra = installPackages(env.DOCKER_JOB_PACKAGES, { run });
  const platforms = requestedPlatforms(env, { table });
  const host = arch || hostArch(run);
  const binfmt = await ensureBinfmt({ env, run, exists, arch: host, platforms });
  if (binfmt.remaining.length > 0) {
    process.stderr.write(
      `[WARN] 未能注册 ${binfmt.remaining.join(',')} 的 QEMU 处理器：跨架构构建可能在 RUN 步骤报 "exec format error"。\n` +
        '       宿主机需要 binfmt_misc（常见做法：宿主上安装 qemu-user-static 并注册），' +
        '或让本 job 容器以 privileged 运行；确认不需要时可用 DOCKER_SKIP_BINFMT=1 关掉这段。\n' +
        (binfmt.error ? `       docker run 的报错：${binfmt.error}\n` : ''),
    );
  }
  const summary = {
    server: daemon.docker.server || '',
    daemonStarted: daemon.started,
    buildx: buildx.source,
    packages: extra.packages,
    platforms,
    binfmt: binfmt.skipped ? 'skipped' : binfmt.remaining.length > 0 ? `missing:${binfmt.remaining.join(',')}` : 'ok',
  };
  process.stdout.write(
    `[prepare] docker=${summary.server || '?'}（${summary.daemonStarted ? '本次启动' : '已可达'}） ` +
      `buildx=${summary.buildx} packages=${summary.packages.join(',') || '-'} ` +
      `platforms=${summary.platforms.join(',') || '(本机)'} binfmt=${summary.binfmt}\n`,
  );
  return summary;
}

async function main() {
  await prepare({
    env: process.env,
    run: spawnSync,
    spawnDetached: spawn,
  });
}

if (IS_DIRECT) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`构建环境准备失败：${error.message}\n`);
    process.exit(1);
  }
}
