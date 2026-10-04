// deps.mjs — install the container tools the Action needs, using whatever
// package manager the image provides, through the configured proxy.
//
// This Action drives the host's Docker daemon: it needs the `docker` CLI, and
// `buildx` when multi-platform builds or cache export are wanted. Minimal
// Debian/Alpine/yum images frequently ship neither, so both are declared here
// with a best-effort installer.
//
// A missing `buildx` is not fatal: build-push.mjs falls back to
// `docker build` + `docker tag` + `docker push` (single platform, no cache
// export). A missing `docker` CLI is fatal, and preflight says so with the
// runner-side checklist.
//
// Proxy support: containers are routinely built without direct network access,
// so every proxy variable the surrounding infrastructure may export is honoured
// and mapped to the spelling each package manager reads.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Proxy variables in the order they should win, for each consumer. */
export const PROXY_VARS = [
  'ALL_PROXY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'APT_PROXY',
  'APK_PROXY',
  'YUM_PROXY',
  'NPM_CONFIG_PROXY',
];

/**
 * Proxy values for one consumer, from the variables that apply to it.
 *
 * `pkgProxy` (APT_PROXY / APK_PROXY / YUM_PROXY) wins for its own manager; then
 * the standard HTTP(S) variables; then ALL_PROXY as the universal fallback.
 * Both upper and lower case spellings are set, because tools disagree.
 */
export function proxyEnv(manager, env = process.env) {
  const read = (...names) => {
    for (const name of names) {
      const value = env[name] ?? env[name.toLowerCase()];
      if (value && String(value).trim()) return String(value).trim();
    }
    return '';
  };

  // A manager-specific override wins: it exists precisely because the generic
  // variables may point somewhere that manager cannot use (apt cannot speak
  // socks5, and a NON-http ALL_PROXY must not clobber a working APT_PROXY).
  // The variable name is the family, not the binary: apt-get -> APT_PROXY.
  const FAMILY = { 'apt-get': 'APT', apk: 'APK', yum: 'YUM', dnf: 'DNF', microdnf: 'MICRODNF' };
  const managerKey = FAMILY[manager] || String(manager).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const explicit = read(`${managerKey}_PROXY`);
  const https = read('HTTPS_PROXY');
  const http = read('HTTP_PROXY');
  const all = read('ALL_PROXY');

  const out = {};
  if (explicit) {
    out.http_proxy = explicit;
    out.https_proxy = explicit;
  } else if (http || https) {
    out.http_proxy = http || https;
    out.https_proxy = https || http;
  } else if (all) {
    out.http_proxy = all;
    out.https_proxy = all;
  }
  if (out.http_proxy) {
    out.HTTP_PROXY = out.http_proxy;
    out.HTTPS_PROXY = out.https_proxy;
    out.ftp_proxy = out.http_proxy;
  }
  if (all) out.ALL_PROXY = all;
  const noProxy = read('NO_PROXY');
  if (noProxy) {
    out.no_proxy = noProxy;
    out.NO_PROXY = noProxy;
  }
  return out;
}

/** Which package manager this image offers, in preference order. */
export function detectPackageManager(env = process.env, run = spawnSync) {
  const configured = String(env.PKG_MANAGER || '').trim();
  if (configured) return configured;
  const probe = (binary) =>
    run('sh', ['-c', `command -v ${binary}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status === 0;
  for (const manager of ['apk', 'apt-get', 'yum', 'dnf', 'microdnf']) {
    if (probe(manager)) return manager;
  }
  return '';
}

/**
 * Packages that provide a binary, per manager. Several candidates are listed
 * because the same executable lives in different packages across distributions
 * and repositories.
 */
export const PROVIDERS = {
  docker: {
    'apt-get': ['docker.io', 'docker-ce-cli'],
    apk: ['docker-cli', 'docker'],
    yum: ['docker', 'docker-ce-cli'],
    dnf: ['docker', 'docker-ce-cli'],
    microdnf: ['docker', 'docker-ce-cli'],
  },
  buildx: {
    'apt-get': ['docker-buildx', 'docker-buildx-plugin'],
    apk: ['docker-cli-buildx', 'docker-buildx'],
    yum: ['docker-buildx-plugin'],
    dnf: ['docker-buildx-plugin'],
    microdnf: ['docker-buildx-plugin'],
  },
  git: {
    'apt-get': ['git'],
    apk: ['git'],
    yum: ['git'],
    dnf: ['git'],
    microdnf: ['git'],
  },
};

/** The command that installs packages with this manager. */
export function installCommand(manager, packages) {
  switch (manager) {
    case 'apk':
      return ['apk', ['add', '--no-cache', ...packages]];
    case 'apt-get':
      return ['apt-get', ['install', '-y', '--no-install-recommends', ...packages]];
    case 'yum':
      return ['yum', ['install', '-y', ...packages]];
    case 'dnf':
      return ['dnf', ['install', '-y', ...packages]];
    case 'microdnf':
      return ['microdnf', ['install', '-y', ...packages]];
    default:
      return null;
  }
}

/** `apt-get install` needs a refreshed index first (and that step is slow). */
export function needsIndexRefresh(manager) {
  return manager === 'apt-get';
}

/** Which tool binaries the Action cannot work without. */
export const REQUIRED_TOOLS = ['docker'];

/** Nice to have: without buildx the Action degrades to `docker build`+`push`. */
export const OPTIONAL_TOOLS = ['buildx'];

/** Report which of `tools` are missing, using `command -v`. */
export function missingTools(tools = REQUIRED_TOOLS, run = spawnSync) {
  return tools.filter((tool) => !hasBinary(tool, run));
}

/** Is `binary` on PATH? `buildx` is a docker subcommand, so this is a probe. */
export function hasBinary(binary, run = spawnSync) {
  if (binary === 'buildx') {
    return run('docker', ['buildx', 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status === 0;
  }
  return run('sh', ['-c', `command -v ${binary}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status === 0;
}

/**
 * What the runner can actually do. `daemon` is the part that matters: a
 * container job only reaches a daemon when the runner mounted the socket (or
 * runs the job on the host), and that is the single most common setup mistake.
 */
export function probeDocker(env = process.env, run = spawnSync) {
  if (!hasBinary('docker', run)) {
    return { cli: false, daemon: false, buildx: false, server: '', error: 'docker 命令不存在' };
  }
  const version = run('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server = version.status === 0 ? String(version.stdout || '').trim() : '';
  return {
    cli: true,
    daemon: version.status === 0,
    buildx: hasBinary('buildx', run),
    server,
    error: version.status === 0 ? '' : String(version.stderr || 'docker version 失败').trim(),
  };
}

/** Are we able to install (root in the container)? */
export function canInstall(env = process.env) {
  if (String(env.SKIP_TOOL_INSTALL || '').toLowerCase() === 'true') return false;
  if (typeof process.getuid === 'function' && process.getuid() === 0) return true;
  return Boolean(env.SUDO_USER) || existsSync('/usr/bin/sudo') || existsSync('/bin/sudo');
}

/** Package names to try for a set of missing tools, de-duplicated. */
export function packagesFor(manager, tools) {
  const names = [];
  for (const tool of tools) {
    const table = PROVIDERS[tool]?.[manager];
    if (!table) continue;
    for (const name of table) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** `sudo` when not root. */
export function commandPrefix(env = process.env) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return [];
  return env.SUDO_USER || existsSync('/usr/bin/sudo') || existsSync('/bin/sudo') ? ['sudo'] : [];
}

/**
 * Which tools each provider covers, so a successful install can be attributed
 * back to the tools it provides.
 */
export function toolsFor(manager, packageName) {
  return Object.entries(PROVIDERS)
    .filter(([, perManager]) => (perManager[manager] || []).includes(packageName))
    .map(([tool]) => tool);
}

/**
 * Install `tools` with `manager`, through the proxy.
 *
 * One install for the primary provider of each tool (fast, and atomic for the
 * common case), then fallbacks only for the tools still missing afterwards.
 * Returns { ok, attempts, installed } — attempts records every command tried.
 */
export function installTools({
  manager,
  tools = REQUIRED_TOOLS,
  env = process.env,
  run = spawnSync,
  proxy = proxyEnv(manager, env),
  prefix = commandPrefix(env),
  probe = (tool) => hasBinary(tool, run),
  timeoutMs = 600_000,
} = {}) {
  const attempts = [];
  if (!manager) return { ok: false, attempts, installed: [], error: 'no package manager found' };

  const runInstall = (packages) => {
    const built = installCommand(manager, packages);
    if (!built) return false;
    const [command, args] = built;
    const full = [...prefix, command, ...args];
    attempts.push(full.join(' '));
    const result = run(full[0], full.slice(1), {
      env: { ...env, ...proxy },
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: timeoutMs,
    });
    return result.status === 0;
  };

  // apt needs a fresh index before install, and some images ship no lists at all.
  if (needsIndexRefresh(manager)) {
    const refresh = [...prefix, 'apt-get', 'update'];
    attempts.push(refresh.join(' '));
    run(refresh[0], refresh.slice(1), {
      env: { ...env, ...proxy },
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: timeoutMs,
    });
  }

  const primary = [];
  for (const tool of tools) {
    const first = PROVIDERS[tool]?.[manager]?.[0];
    if (first && !primary.includes(first)) primary.push(first);
  }
  if (primary.length > 0) runInstall(primary);

  const stillMissing = tools.filter((tool) => !probe(tool));
  for (const tool of stillMissing) {
    const candidates = (PROVIDERS[tool]?.[manager] || []).slice(1);
    for (const candidate of candidates) {
      runInstall([candidate]);
      // Stop as soon as the binary exists: a successful install of a package
      // that happens not to provide this tool must not end the search.
      if (probe(tool)) break;
    }
  }

  const installed = tools.filter((tool) => probe(tool));
  return {
    ok: installed.length === tools.length,
    attempts,
    installed,
    missing: tools.filter((tool) => !installed.includes(tool)),
    error: installed.length === tools.length ? '' : 'some tools are still missing',
  };
}
