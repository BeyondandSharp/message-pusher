// run.mjs — the single entry point the workflow invokes.
//
// Every workflow step is one line:
//     run: |
//       dir="${{ steps.locate.outputs.forgejo_dir }}"; node "$dir/scripts/run.mjs" <subcommand>
// so the YAML contains orchestration only, and all behaviour (including the
// shell-level work) lives in real, testable files.
//
// Subcommands:
//   locate-action      find the copied Action directory, emit forgejo_dir
//   ensure-tools       install docker (and buildx when the image provides it)
//   verify-action      assert every shipped program is present, print capabilities
//   resolve            derive version/variants/images from the tag
//   preflight          credentials, Dockerfiles, tag collisions, docker daemon
//   login              docker login to ghcr.io and/or Docker Hub
//   meta               compute tags and labels per variant
//   build-push         one build per variant, then push
//   summary            digest table

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANAGER_PROXY_VARS,
  OPTIONAL_TOOLS,
  REQUIRED_TOOLS,
  canInstall,
  commandPrefix,
  detectPackageManager,
  installCommand,
  installTools,
  missingTools,
  packagesFor,
  probeDocker,
  proxyEnv,
  resolveEndpoint,
  writeAptSources,
  writeYumRepos,
} from './deps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

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

/** Programs that are executed as their own process (they own process.exit). */
const PROGRAMS = {
  'locate-action': 'locate-action.mjs',
  resolve: 'resolve.mjs',
  preflight: 'preflight.mjs',
  login: 'login.mjs',
  meta: 'meta.mjs',
  'build-push': 'build-push.mjs',
  summary: 'summary.mjs',
};

/** Everything the Action ships; verify-action insists on all of it. */
export const REQUIRED_SCRIPTS = [
  'deps.mjs',
  'locate-action.mjs',
  'run.mjs',
  'config.mjs',
  'resolve.mjs',
  'preflight.mjs',
  'login.mjs',
  'meta.mjs',
  'build-push.mjs',
  'summary.mjs',
];

export const SUBCOMMANDS = [
  'locate-action',
  'ensure-tools',
  'verify-action',
  'resolve',
  'preflight',
  'login',
  'meta',
  'build-push',
  'summary',
];

/** The repository being built (GITHUB_WORKSPACE, falling back to cwd). */
export function workspaceDir(env = process.env) {
  return (env.GITHUB_WORKSPACE || process.cwd()).replace(/\/+$/, '');
}

/** Run a command in `cwd`, streaming output; resolves with its exit code. */
export function runCommand(command, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    process.stdout.write(`$ ${command} ${args.join(' ')}\n`);
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', (error) => {
      process.stderr.write(`无法启动 ${command}：${error.message}\n`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function runSubprocessProgram(name, env) {
  const program = PROGRAMS[name];
  const path = join(HERE, program);
  if (!existsSync(path)) {
    process.stderr.write(`缺少程序：${path}\n`);
    return 1;
  }
  return runCommand(process.execPath, [path], { cwd: workspaceDir(env), env });
}

async function verifyAction(env) {
  const dir = (env.GITHUB_ACTION_PATH || HERE.replace(/\/scripts$/, '')).replace(/\/+$/, '');
  const missing = REQUIRED_SCRIPTS.filter((name) => !existsSync(join(dir, 'scripts', name)));
  if (missing.length > 0) {
    for (const name of missing) process.stderr.write(`缺少 ${dir}/scripts/${name}\n`);
    process.stderr.write(
      `Action 目录不完整：请整目录复制 docker-build-push/（workflows/ 与 scripts/ 都要）后改名为 .forgejo\n`,
    );
    return 1;
  }
  process.stdout.write(`Action 脚本齐全：${dir}/scripts（${REQUIRED_SCRIPTS.length} 个文件）\n`);

  const docker = probeDocker(env);
  process.stdout.write(
    `运行环境：docker=${docker.cli ? `ok${docker.server ? `(${docker.server})` : ''}` : '缺失'} ` +
      `daemon=${docker.daemon ? 'ok' : '不可达'} buildx=${docker.buildx ? 'ok' : '缺失'}\n`,
  );
  if (!docker.daemon) {
    process.stdout.write(
      '提示：本 Action 需要 runner 提供可访问的 Docker 守护进程（挂载 /var/run/docker.sock），' +
        'preflight 会在真正构建前再次检查。\n',
    );
  }
  if (!docker.buildx) {
    process.stdout.write('提示：没有 buildx 也能用（降级为 docker build + docker push，单平台、无缓存导出）。\n');
  }
  return 0;
}

/**
 * Install the container tools the build needs, with the image's own package
 * manager and through the configured proxy.
 *
 * `docker` is required; `buildx` is best effort. Set SKIP_TOOL_INSTALL=true to
 * opt out (air-gapped images that prepackage the tools). Failure is a warning,
 * not an error: preflight reports the real problem with a runner-side checklist.
 */
async function ensureTools(env) {
  const { spawnSync } = await import('node:child_process');

  // NPM_PROXY may be a real proxy or an internal registry; classify it once and
  // pass the verdict on, because the build consumes it as a build argument.
  await resolveNpmEndpoint(env);

  const missing = missingTools(REQUIRED_TOOLS, spawnSync);
  const missingOptional = missingTools(OPTIONAL_TOOLS, spawnSync);
  const wanted = [...missing, ...missingOptional];
  if (wanted.length === 0) {
    process.stdout.write(`工具齐全（${[...REQUIRED_TOOLS, ...OPTIONAL_TOOLS].join(', ')}），无需安装\n`);
    return 0;
  }
  process.stdout.write(`缺少工具：${wanted.join(', ')}\n`);

  const manager = detectPackageManager(env, spawnSync);
  if (!manager) {
    process.stderr.write('没有可用的包管理器（apk/apt-get/yum），请改用自带 docker 的 runner\n');
    return 0;
  }
  const packages = packagesFor(manager, wanted);

  // A `*_PROXY` value may be a mirror rather than a proxy: resolveEndpoint probes
  // it once (does it serve its own repository index?) and the answer decides
  // whether apt gets a generated sources file or a proxy setting.
  const plan = await resolveEndpoint(manager, env);
  if (plan.source === 'proxy-as-mirror') {
    process.stdout.write(`${managerEndpointVar(manager)} 指向的是镜像（探测到仓库索引），按仓库使用\n`);
  }
  const repositories = plan.mirror;
  const proxy = proxyEnv(manager, env, { explicit: plan.proxy });
  const aptSourcesFile = manager === 'apt-get' ? writeAptSources(repositories, env) : '';
  const yumReposDir = isYumFamily(manager)
    ? writeYumRepos(repositories, env, { warn: (message) => process.stderr.write(`${message}\n`) })
    : '';
  const resolved = { repositories, aptSourcesFile, yumReposDir };

  const proxyNote =
    Object.keys(proxy).length > 0 ? `（代理：${plan.proxy || Object.keys(proxy).join(', ')}）` : '（未配置代理）';
  const repoNote = repositories.length > 0 ? `（附加仓库：${repositories.join(', ')}）` : '';
  process.stdout.write(`使用 ${manager} 安装：${packages.join(', ')} ${proxyNote}${repoNote}\n`);

  if (!canInstall(env)) {
    process.stderr.write(`不是 root 且没有 sudo，跳过安装；请手动执行：${installHint(manager, packages, env, resolved)}\n`);
    return 0;
  }

  const result = installTools({ manager, tools: wanted, env, proxy, ...resolved });
  const stillRequired = missingTools(REQUIRED_TOOLS, spawnSync);
  const stillOptional = missingTools(OPTIONAL_TOOLS, spawnSync);
  if (stillRequired.length === 0) {
    process.stdout.write(`docker 可用${stillOptional.length === 0 ? '，buildx 可用' : '，buildx 仍缺失（将走降级路径）'}\n`);
    return 0;
  }
  process.stderr.write(`docker 仍不可用（尝试过：${result.attempts.join(' | ') || '无'}）\n`);
  process.stderr.write(`请手动执行：${installHint(manager, packages, env, resolved)}\n`);
  return 0;
}

/** The `*_PROXY` variable that names this manager's endpoint, for log lines. */
export function managerEndpointVar(manager) {
  return (MANAGER_PROXY_VARS[manager] || [])[0] || `${String(manager).toUpperCase()}_PROXY`;
}

function isYumFamily(manager) {
  return manager === 'yum' || manager === 'dnf' || manager === 'microdnf';
}

/** Make a resolved value visible to the following workflow steps. */
function exportEnv(key, value) {
  process.env[key] = value;
  const file = process.env.GITHUB_ENV;
  if (!file) return;
  try {
    appendFileSync(file, `${key}=${value}\n`);
  } catch {
    /* the value still applies to this process */
  }
}

/**
 * Decide what `NPM_PROXY` means and pass the verdict on.
 *
 * A registry mirror is handed to the build as `--build-arg NPM_REGISTRY=…`
 * (resolve.mjs adds it), which is what a Dockerfile's `ARG NPM_REGISTRY` — the
 * knob our example Dockerfiles use for `pnpm install --registry` — consumes. A
 * real proxy becomes npm's own proxy setting.
 *
 * This Action never runs npm itself (the frontend build happens inside
 * `docker build`), so the verdict is exported rather than used directly here.
 */
async function resolveNpmEndpoint(env) {
  const plan = await resolveEndpoint('npm', env);
  if (plan.source === 'proxy-as-mirror') {
    exportEnv('NPM_REGISTRY', plan.mirror[0]);
    process.stdout.write(`NPM_PROXY 指向的是 registry：构建将使用 --build-arg NPM_REGISTRY=${plan.mirror[0]}\n`);
  } else if (plan.source === 'proxy') {
    exportEnv('NPM_CONFIG_PROXY', plan.proxy);
    process.stdout.write(`NPM_PROXY 指向的是代理：npm 将使用 ${plan.proxy}\n`);
  }
}

/** The command a human would run, for log messages. */
export function installHint(manager, packages, env = process.env, resolved = {}) {
  const built = installCommand(manager, packages, {
    repositories: resolved.repositories ?? [],
    aptSourcesFile: resolved.aptSourcesFile ?? '',
    yumReposDir: resolved.yumReposDir ?? '',
  });
  if (!built) return `用 ${manager} 安装 ${packages.join(' ')}`;
  return [...commandPrefix(env), built[0], ...built[1]].join(' ');
}

export async function dispatch(name, env = process.env) {
  if (!SUBCOMMANDS.includes(name)) {
    process.stderr.write(`未知子命令：${name || '<empty>'}（可选：${SUBCOMMANDS.join(', ')}）\n`);
    return 2;
  }
  switch (name) {
    case 'ensure-tools':
      return ensureTools(env);
    case 'verify-action':
      return verifyAction(env);
    default:
      return runSubprocessProgram(name, env);
  }
}

if (IS_DIRECT) {
  const name = process.argv[2] || '';
  dispatch(name).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`执行 ${name} 失败：${error.message}\n`);
      process.exit(1);
    },
  );
}
