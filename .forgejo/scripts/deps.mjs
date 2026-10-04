// deps.mjs — install the container tools the Action needs, using whatever
// package manager the image provides, through the configured proxy.
//
// What is genuinely required:
//   * `docker` — the whole Action drives the daemon (build + push);
//   * `buildx` — optional: without it build-push.mjs falls back to
//     `docker build` + `docker tag` + `docker push` (single platform, no cache
//     export, no provenance), and preflight fails only when multiple platforms
//     were requested.
//
// Proxy support: containers are routinely built without direct network access,
// so every proxy variable the surrounding infrastructure may export is honoured
// and mapped to the spelling each package manager reads.
//
// Mirror support (the same model as npm-publish/scripts/deps.mjs, from which
// this module is derived): an internal package MIRROR is a repository, not a
// proxy. apk and yum take it in APK_REPO / YUM_REPO (a generated --repository
// flag and a generated reposdir); apt and npm have no separate mirror variable,
// so APT_PROXY / NPM_PROXY are classified at run time (mirror vs forward proxy).
// Pointing a proxy variable at a mirror makes the manager speak proxy to a plain
// web server and fail with "unable to select packages" / 404 / 308.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Prefix of the files this Action generates (sources list, reposdir, stanza). */
export const LABEL = 'docker-build-push';

/** Proxy variables in the order they should win, for each consumer. */
export const PROXY_VARS = ['ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'APT_PROXY'];

/**
 * Proxy values for one consumer, from the variables that apply to it.
 *
 * A manager-specific variable (`APT_PROXY`, `NPM_PROXY`) wins for its own
 * manager; then the standard HTTP(S) variables; then ALL_PROXY as the universal
 * fallback. Both upper and lower case spellings are set, because tools disagree.
 *
 * apk/yum deliberately have no manager-specific variable: their mirror goes in
 * `APK_REPO` / `YUM_REPO`, and a genuine proxy for them is expressed with the
 * generic HTTP_PROXY/HTTPS_PROXY/ALL_PROXY. (The old `APK_PROXY` / `YUM_PROXY`
 * names were removed for exactly that reason.)
 *
 * `explicit` overrides the manager-specific variable. run.mjs passes '' when it
 * proved that the configured value is a MIRROR, not a proxy — otherwise the
 * manager would be handed a mirror URL as http_proxy and fail with a 308/404.
 */
export function proxyEnv(manager, env = process.env, { explicit: explicitOverride } = {}) {
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
  const explicit =
    explicitOverride !== undefined ? explicitOverride : read(...(MANAGER_PROXY_VARS[manager] || []));
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

/**
 * The Go module proxy, from `GOPROXY` or its alias `GO_PROXY`. It is passed into
 * the build as `--build-arg GOPROXY=<value>` (see resolve.mjs), so a Dockerfile
 * that declares `ARG GOPROXY` reaches an internal Athens without the repository
 * having to write `DOCKER_BUILD_ARGS`.
 */
export function goProxyFrom(env = process.env) {
  return envValue(env, ['GOPROXY', 'GO_PROXY']);
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
 * and repositories (`docker` is docker.io on Debian, docker-cli on Alpine).
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
};

/**
 * Variable names holding explicit repositories, per manager (first non-empty
 * wins). apk and yum use the short `APK_REPO` / `YUM_REPO` names; the longer
 * `*_REPOSITORY` spellings keep working for existing repositories. apt and npm
 * have no explicit variable — their endpoint is classified from `APT_PROXY` /
 * `NPM_PROXY`.
 */
const REPOSITORY_VARS = {
  apk: ['APK_REPO', 'APK_REPOSITORY'],
  yum: ['YUM_REPO', 'YUM_REPOSITORY'],
  dnf: ['YUM_REPO', 'YUM_REPOSITORY'],
  microdnf: ['YUM_REPO', 'YUM_REPOSITORY'],
};

/**
 * Extra package repositories to use, for images whose default mirror is
 * unreachable. `APK_REPO` / `YUM_REPO` take the repository URL(s), comma
 * separated; a bare mirror root is fine — `expandMirror()` turns it into the
 * distro's own paths using `/etc/os-release`.
 */
export function repositoriesFor(manager, env = process.env) {
  const names = REPOSITORY_VARS[manager];
  if (!names) return [];
  const value = envValue(env, names);
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * The `*_PROXY` variable each manager reads, in order.
 *
 * Only apt and npm have one. Those two values are documented as forward proxies
 * but are frequently pointed at an internal mirror/registry, so the value is
 * classified at run time by `resolveEndpoint`: serve the repository path
 * directly -> it is a mirror; answer with a plain HTTP error -> it is a real
 * proxy.
 *
 * apk and yum use `APK_REPO` / `YUM_REPO` for mirrors instead, and the generic
 * HTTP_PROXY/HTTPS_PROXY/ALL_PROXY for a genuine proxy.
 */
const MANAGER_PROXY_VARS = {
  'apt-get': ['APT_PROXY'],
  npm: ['NPM_PROXY'],
};

export { MANAGER_PROXY_VARS };

function envValue(env, names) {
  for (const name of names) {
    const value = env[name] ?? env[name.toLowerCase()];
    if (value && String(value).trim()) return String(value).trim().replace(/\/+$/, '');
  }
  return '';
}

/** `/etc/os-release` as an object ("" for a missing key), tolerant of quotes. */
export function parseOsRelease(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export function readOsRelease(path = '/etc/os-release') {
  try {
    return parseOsRelease(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * The Alpine branch a mirror root needs: stable repos live under `v3.24`
 * (note the `v`), which is what the image's own `/etc/apk/repositories` uses.
 */
export function alpineBranch(osRelease = {}) {
  if (String(osRelease.ID || '') !== 'alpine') return '';
  const parts = String(osRelease.VERSION_ID || '').trim().split('.');
  return parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])
    ? `v${parts[0]}.${parts[1]}`
    : '';
}

/**
 * Turn what the operator configured into concrete repository URLs.
 *
 * A bare host (`https://mirror.internal`) is expanded with what the image itself
 * says (`/etc/os-release`), while a URL that already names a repository is passed
 * through untouched. Nothing is guessed when the image gives no evidence — the
 * manager then reports the real error instead of a fabricated path.
 */
export function expandMirror(manager, base, osRelease = {}) {
  const url = String(base || '').replace(/\/+$/, '');
  if (!url) return [];
  if (manager === 'apk') {
    if (/\/alpine\/[^/]+\/(?:main|community)$/.test(url)) return [url];
    const branch = alpineBranch(osRelease);
    if (!branch) return [url];
    return [`${url}/alpine/${branch}/main`, `${url}/alpine/${branch}/community`];
  }
  if (manager === 'apt-get') {
    // Return the distro path itself so probing and the generated sources file
    // agree; aptSources() leaves a URL that already names one alone.
    const hasPath = /\/(?:debian|ubuntu|debian-security)$/.test(url);
    const path = hasPath ? '' : String(osRelease.ID || '') === 'ubuntu' ? '/ubuntu' : '/debian';
    return [`${url}${path}`];
  }
  if (manager === 'yum' || manager === 'dnf' || manager === 'microdnf') {
    if (/\/repodata$/.test(url) || /\/os$/.test(url)) return [url];
    const major = String(osRelease.VERSION_ID || '').trim().split('.')[0];
    if (!major) return [url];
    return [
      `${url}/centos/${major}-stream/BaseOS/x86_64/os`,
      `${url}/centos/${major}-stream/AppStream/x86_64/os`,
    ];
  }
  return [url]; // npm: the registry is the value itself
}

/** The one file that proves a URL is a repository index for this manager. */
export function mirrorProbeUrl(manager, repository, osRelease = {}) {
  if (manager === 'apk') return `${repository}/x86_64/APKINDEX.tar.gz`;
  if (manager === 'apt-get') {
    const suite = String(osRelease.VERSION_CODENAME || osRelease.VERSION_ID || '');
    return suite ? `${repository}/dists/${suite}/InRelease` : '';
  }
  if (manager === 'yum' || manager === 'dnf' || manager === 'microdnf') {
    return `${repository}/repodata/repomd.xml`;
  }
  if (manager === 'npm') return `${repository}/-/ping`;
  return '';
}

/**
 * Is this value a repository rather than a proxy?
 *
 * A repository answers its own index path; a proxy answers the same path with a
 * plain HTTP error (it expects absolute URIs or CONNECT). A network error means
 * "could not tell", and the value is kept as a mirror: that is what the operator
 * configured, and an unreachable proxy would fail the install just as badly.
 */
export async function probeMirror(base, manager, { fetchImpl = globalThis.fetch, osRelease = {}, timeoutMs = 8000 } = {}) {
  const repositories = expandMirror(manager, base, osRelease);
  if (repositories.length === 0) return false;
  const url = mirrorProbeUrl(manager, repositories[0], osRelease);
  if (!url) return true; // nothing to check against
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    return Boolean(response && response.ok);
  } catch {
    return true;
  }
}

/**
 * Decide how a manager should use the configured endpoint.
 *
 * Returns `{ mirror, proxy, source }`:
 *   * `source: 'repository'`      — an explicit `APK_REPO`/`YUM_REPO` was set;
 *   * `source: 'proxy-as-mirror'` — `*_PROXY` turned out to be a mirror;
 *   * `source: 'proxy'`           — `*_PROXY` really is a forward proxy;
 *   * `source: ''`                — nothing configured.
 */
export async function resolveEndpoint(manager, env = process.env, { fetchImpl, osRelease, timeoutMs } = {}) {
  const release = osRelease || readOsRelease();
  const explicit = repositoriesFor(manager, env);
  if (explicit.length > 0) {
    // An explicit repository is trusted as-is, but a bare mirror root (the usual
    // shape of APK_REPO/YUM_REPO) still needs the distro's own paths appended.
    const mirror = explicit.flatMap((base) => expandMirror(manager, base, release));
    return { mirror, proxy: '', source: 'repository' };
  }
  const candidate = envValue(env, MANAGER_PROXY_VARS[manager] || []);
  if (!candidate) return { mirror: [], proxy: '', source: '' };
  const isMirror = await probeMirror(candidate, manager, { fetchImpl, osRelease: release, timeoutMs });
  if (isMirror) {
    return { mirror: expandMirror(manager, candidate, release), proxy: '', source: 'proxy-as-mirror' };
  }
  return { mirror: [], proxy: candidate, source: 'proxy' };
}

/**
 * apt source lines for the configured mirror bases.
 *
 * The mirror root is turned into the distro's own path (`/debian`, `/ubuntu`)
 * unless the URL already names one, and the suite comes from the image itself
 * (`VERSION_CODENAME`), so `APT_PROXY=https://mirror.internal` is enough on
 * Debian and Ubuntu alike.
 */
export function aptSources(bases, osRelease) {
  const id = String(osRelease.ID || '');
  const suite = String(osRelease.VERSION_CODENAME || osRelease.VERSION_ID || '');
  if (!suite) return [];
  const components = id === 'ubuntu' ? 'main universe' : 'main';
  return bases.map((base) => {
    const url = base.replace(/\/+$/, '');
    const hasPath = /\/(?:debian|ubuntu|debian-security)$/.test(url);
    const path = hasPath ? '' : id === 'ubuntu' ? '/ubuntu' : '/debian';
    return `deb ${url}${path} ${suite} ${components}`;
  });
}

/**
 * Write the generated sources file and return its path ('' when there is
 * nothing to configure). Both `apt-get update` and `apt-get install` then run
 * with `Dir::Etc::sourcelist` pointing at it and `sourceparts=-`, so a broken
 * default mirror in the image cannot poison the install.
 */
export function writeAptSources(bases, env = process.env, osRelease = readOsRelease()) {
  const lines = aptSources(bases, osRelease);
  if (lines.length === 0) return '';
  const file = join(env.RUNNER_TEMP || tmpdir(), `${LABEL}-apt-sources.list`);
  try {
    writeFileSync(file, `${lines.join('\n')}\n`);
  } catch {
    return '';
  }
  return file;
}

/** `-o` flags that make apt use only the generated sources file. */
export function aptOptions(aptSourcesFile) {
  if (!aptSourcesFile) return [];
  return ['-o', `Dir::Etc::sourcelist=${aptSourcesFile}`, '-o', 'Dir::Etc::sourceparts=-'];
}

/** The RPM GPG keys the image ships, as `file://` URLs for a repo stanza. */
export function gpgKeyUrls(list = () => [], dir = '/etc/pki/rpm-gpg') {
  let names = [];
  try {
    names = list(dir) || [];
  } catch {
    return [];
  }
  return names
    .filter((name) => /^RPM-GPG-KEY/i.test(name))
    .sort()
    .map((name) => `file://${join(dir, name)}`);
}

/**
 * Write a `.repo` directory for `YUM_REPO` and return its path.
 *
 * `reposdir` is replaced on the command line (`--setopt=reposdir=…`), so a
 * broken `/etc/yum.repos.d` cannot poison the install while the image keeps
 * ownership of signature verification: the keys already installed under
 * `/etc/pki/rpm-gpg` are referenced from `gpgkey`, and `gpgcheck=1` is used
 * whenever at least one of them exists. Only an image that carries no key at all
 * falls back to `gpgcheck=0` (and says so in the install log).
 */
export function writeYumRepos(
  repositories,
  env = process.env,
  { list = readdirSync, dir = '/etc/pki/rpm-gpg', warn = () => {} } = {},
) {
  if (repositories.length === 0) return '';
  const keys = gpgKeyUrls(list, dir);
  if (keys.length === 0) {
    warn('未在镜像里找到 RPM GPG 公钥（/etc/pki/rpm-gpg），生成的仓库将关闭签名校验（gpgcheck=0）');
  }
  const target = join(env.RUNNER_TEMP || tmpdir(), `${LABEL}-yum-repos`);
  const body = repositories
    .map((url, index) =>
      [
        `[${LABEL}-${index}]`,
        `name=${LABEL} mirror ${index}`,
        `baseurl=${url}`,
        'enabled=1',
        `gpgcheck=${keys.length > 0 ? 1 : 0}`,
        keys.length > 0 ? `gpgkey=${keys.join(' ')}` : '',
        '',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    )
    .join('\n');
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, `${LABEL}.repo`), `${body}\n`);
  } catch {
    return '';
  }
  return target;
}

/** `--setopt` that makes yum/dnf read only the generated repository directory. */
export function yumOptions(yumReposDir) {
  if (!yumReposDir) return [];
  return [`--setopt=reposdir=${yumReposDir}`];
}

/** The command that installs packages with this manager. */
export function installCommand(
  manager,
  packages,
  { repositories = [], aptSourcesFile = '', yumReposDir = '' } = {},
) {
  switch (manager) {
    case 'apk':
      return [
        'apk',
        ['add', '--no-cache', ...repositories.flatMap((repo) => ['--repository', repo]), ...packages],
      ];
    case 'apt-get':
      return ['apt-get', [...aptOptions(aptSourcesFile), 'install', '-y', '--no-install-recommends', ...packages]];
    case 'yum':
      return ['yum', [...yumOptions(yumReposDir), 'install', '-y', ...packages]];
    case 'dnf':
      return ['dnf', [...yumOptions(yumReposDir), 'install', '-y', ...packages]];
    case 'microdnf':
      return ['microdnf', [...yumOptions(yumReposDir), 'install', '-y', ...packages]];
    default:
      return null;
  }
}

/** The command that refreshes the index first, when the manager needs one. */
export function indexRefreshCommand(manager, { aptSourcesFile = '' } = {}) {
  if (manager !== 'apt-get') return null;
  return ['apt-get', [...aptOptions(aptSourcesFile), 'update']];
}

/** Which tool binaries the Action cannot work without. */
export const REQUIRED_TOOLS = ['docker'];

/** Nice to have: without buildx the Action degrades to `docker build`+`push`. */
export const OPTIONAL_TOOLS = ['buildx'];

/**
 * Is `binary` available? `buildx` is a docker subcommand, not a binary on PATH,
 * so it is probed through `docker buildx version`.
 */
export function hasBinary(binary, run = spawnSync) {
  if (binary === 'buildx') {
    return run('docker', ['buildx', 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status === 0;
  }
  return run('sh', ['-c', `command -v ${binary}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status === 0;
}

/** Report which of `tools` are missing. */
export function missingTools(tools = REQUIRED_TOOLS, run = spawnSync) {
  return tools.filter((tool) => !hasBinary(tool, run));
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

/**
 * The preferred package per tool (the first candidate), de-duplicated — what a
 * single batched install actually asks for. Reported in the log and printed as
 * the manual hint, because it is the smallest command that can work.
 */
export function primaryPackagesFor(manager, tools) {
  const names = [];
  for (const tool of tools) {
    const first = PROVIDERS[tool]?.[manager]?.[0];
    if (first && !names.includes(first)) names.push(first);
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
 * Install `tools` with `manager`, through the proxy and the configured mirrors.
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
  repositories = repositoriesFor(manager, env),
  aptSourcesFile = manager === 'apt-get' ? writeAptSources(repositories, env) : '',
  yumReposDir =
    manager === 'yum' || manager === 'dnf' || manager === 'microdnf'
      ? writeYumRepos(repositories, env, { warn: (message) => process.stderr.write(`${message}\n`) })
      : '',
  prefix = commandPrefix(env),
  probe = (tool) => hasBinary(tool, run),
  timeoutMs = 600_000,
} = {}) {
  const attempts = [];
  if (!manager) return { ok: false, attempts, installed: [], error: 'no package manager found' };

  const runInstall = (packages) => {
    const built = installCommand(manager, packages, { repositories, aptSourcesFile, yumReposDir });
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
  const refreshBuilt = indexRefreshCommand(manager, { aptSourcesFile });
  if (refreshBuilt) {
    const [command, args] = refreshBuilt;
    const refresh = [...prefix, command, ...args];
    attempts.push(refresh.join(' '));
    run(refresh[0], refresh.slice(1), {
      env: { ...env, ...proxy },
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: timeoutMs,
    });
  }

  const primary = primaryPackagesFor(manager, tools);
  if (primary.length > 0) runInstall(primary);

  const stillMissing = tools.filter((tool) => !probe(tool));
  for (const tool of stillMissing) {
    // The batched attempt can fail because ONE package in it does not exist in
    // the configured mirror — apt then aborts the whole transaction, so a
    // perfectly available package (docker.io) is lost together with a missing one
    // (docker-buildx). Every candidate is therefore retried on its own,
    // including the primary provider.
    for (const candidate of PROVIDERS[tool]?.[manager] || []) {
      // Stop as soon as the binary exists: a successful install of a package
      // that happens not to provide this tool must not end the search.
      if (probe(tool)) break;
      runInstall([candidate]);
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
