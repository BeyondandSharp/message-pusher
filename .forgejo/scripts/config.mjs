// config.mjs — turn the repository's variables into one normalized config.
//
// Everything the Action can be told arrives as environment variables (the
// workflow maps secrets/vars into `env:`), so this module is pure: it reads a
// plain object and returns data. No process state, no side effects, no tokens.
//
// Deliberate design points:
//   * a registry is enabled by the presence of its token — nothing else;
//   * image bases are derived from the repository unless DOCKER_META_IMAGES
//     says otherwise, and are always lowercased (ghcr.io requires it);
//   * variants are data, not code: DOCKER_VARIANTS describes how each variant
//     is built, and every variant is built by its own `docker build` call.
//
// Tokens never leave this module inside a returned structure: entries carry the
// *name* of the variable holding the token, so a caller cannot accidentally
// serialise a credential into the state file.

/** The built-in variant table: the Alpine and Debian (trixie) builds. */
export const DEFAULT_VARIANTS = ['alpine|Dockerfile.alpine', 'trixie|Dockerfile.trixie'].join('\n');

/** trixie owns `latest` and the unsuffixed tags; alpine is suffixed only. */
export const DEFAULT_DEFAULT_VARIANT = 'trixie';

/** Registries this Action knows how to log in to and push to. */
export const REGISTRIES = {
  ghcr: { id: 'ghcr', registry: 'ghcr.io', tokenVar: 'GHCR_TOKEN' },
  dockerhub: { id: 'dockerhub', registry: 'docker.io', tokenVar: 'DOCKERHUB_TOKEN' },
};

export function readOptional(value) {
  return String(value ?? '').trim();
}

export function isTrue(value) {
  return ['1', 'true', 'yes', 'on'].includes(readOptional(value).toLowerCase());
}

/** Newline / comma / semicolon separated list, `#` comments dropped. */
export function splitList(raw) {
  return String(raw ?? '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '' && !item.startsWith('#'));
}

/**
 * Newline-separated list. Used where the value itself may contain a comma:
 * `GOPROXY=http://proxy,direct` is one build arg, not two.
 */
export function splitLines(raw) {
  return String(raw ?? '')
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item !== '' && !item.startsWith('#'));
}

/**
 * `KEY=VALUE` lines (build args, labels). A line without `=` is an error: it is
 * almost always a typo, and silently dropping it would build a different image
 * than the one asked for.
 */
export function parseKeyValues(raw, what = 'KEY=VALUE') {
  return splitLines(raw).map((line) => {
    const index = line.indexOf('=');
    if (index <= 0) throw new Error(`${what} 需要 KEY=VALUE 形式（每行一条），收到：${line}`);
    return { key: line.slice(0, index).trim(), value: line.slice(index + 1) };
  });
}

const VARIANT_NAME = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Parse the variant table.
 *
 *   <name>|<dockerfile>|<target>|<suffix>|<is-default>
 *
 * Only the name is required; the rest defaults to `Dockerfile.<name>`, no
 * target, `-<name>` suffix, and "not the default variant". The literal suffix
 * `none` means "no suffix at all" (useful when DOCKER_META_TAGS already
 * distinguishes variants). DOCKER_DEFAULT_VARIANT wins over the fifth field.
 */
export function parseVariants(raw = DEFAULT_VARIANTS, defaultVariant = DEFAULT_DEFAULT_VARIANT) {
  const lines = splitList(raw);
  if (lines.length === 0) throw new Error('DOCKER_VARIANTS 为空：至少要有一个变体');
  const variants = [];
  const seen = new Set();
  for (const line of lines) {
    const [name = '', dockerfile = '', target = '', suffix, flag = ''] = line.split('|').map((part) => part.trim());
    if (!VARIANT_NAME.test(name)) {
      throw new Error(`变体名非法：${name || '<empty>'}（只允许小写字母/数字/._-，且以字母或数字开头）`);
    }
    if (seen.has(name)) throw new Error(`变体名重复：${name}`);
    seen.add(name);
    variants.push({
      name,
      dockerfile: dockerfile || `Dockerfile.${name}`,
      target,
      suffix: suffix === undefined || suffix === '' ? `-${name}` : suffix === 'none' ? '' : suffix,
      isDefault: flag === 'true',
    });
  }
  const wanted = readOptional(defaultVariant) || DEFAULT_DEFAULT_VARIANT;
  for (const variant of variants) variant.isDefault = variant.name === wanted;
  if (!variants.some((variant) => variant.isDefault)) {
    throw new Error(`DOCKER_DEFAULT_VARIANT=${wanted} 不在 DOCKER_VARIANTS 里（可选：${variants.map((v) => v.name).join(', ')}）`);
  }
  return variants;
}

/** Keep only the variants named in `raw` (empty = all). Unknown names throw. */
export function variantSelection(variants, raw) {
  const wanted = splitList(raw);
  if (wanted.length === 0) return variants;
  const names = new Set(variants.map((variant) => variant.name));
  const unknown = wanted.filter((name) => !names.has(name));
  if (unknown.length > 0) {
    throw new Error(`未知变体：${unknown.join(', ')}（可选：${[...names].join(', ')}）`);
  }
  return variants.filter((variant) => wanted.includes(variant.name));
}

/**
 * A docker tag may contain ASCII letters, digits, `_`, `.` and `-`, may not
 * start with `.` or `-`, and is at most 128 characters. Invalid runs collapse
 * into a single `-`, exactly like metadata-action does.
 */
export function sanitizeTagName(value) {
  let name = String(value ?? '').trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[.-]+/, '');
  if (name === '') throw new Error(`无法从 ${JSON.stringify(String(value ?? ''))} 生成合法 tag`);
  if (name.length > 128) throw new Error(`tag 超过 128 字符：${name}`);
  return name;
}

/** Image bases are lowercased; a host part other than ghcr.io/docker.io is out of scope. */
export function normalizeImageBase(base) {
  let value = readOptional(base).replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
  if (value === '') throw new Error('镜像名为空');
  if (value.startsWith('docker.io/')) value = value.slice('docker.io/'.length);
  const [head] = value.split('/');
  if (head.includes('.') || head.includes(':')) {
    if (head !== 'ghcr.io') throw new Error(`只支持 ghcr.io 与 Docker Hub，收到：${base}`);
    if (!value.startsWith('ghcr.io/')) throw new Error(`ghcr.io 镜像名非法：${base}`);
  }
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(value)) throw new Error(`镜像名非法（只允许小写字母/数字/._-）：${base}`);
  return value;
}

/** Which registry an image base belongs to. */
export function imageRegistryOf(base) {
  const value = normalizeImageBase(base);
  if (value.startsWith('ghcr.io/')) return 'ghcr';
  if (value.split('/').length >= 2) return 'dockerhub';
  throw new Error(`镜像名需要 <命名空间>/<仓库> 形式：${base}`);
}

/**
 * The GHCR namespace: an explicit GHCR_IMAGE is the most specific statement
 * about the image, so it wins over GHCR_OWNER, which in turn wins over the
 * Forgejo owner (the two are frequently different accounts).
 */
export function ghcrNamespaceFrom(env = process.env) {
  const repoOwner = readOptional(env.GITHUB_REPOSITORY).split('/')[0] || '';
  const image = readOptional(env.GHCR_IMAGE).replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
  if (image) {
    const parts = image.split('/');
    return parts[0] === 'ghcr.io' ? parts[1] || '' : parts[0] || '';
  }
  return readOptional(env.GHCR_OWNER) || repoOwner;
}

/**
 * Which registries are configured, and as whom. `enabled` is driven purely by
 * the presence of the credentials, so a repository that only wants ghcr.io
 * simply does not set the Docker Hub variables.
 */
export function registriesFrom(env = process.env) {
  const ghcrNamespace = ghcrNamespaceFrom(env);
  const ghcrUser = readOptional(env.GHCR_USER) || ghcrNamespace;
  const dockerhubUser = readOptional(env.DOCKERHUB_USERNAME);

  return [
    {
      ...REGISTRIES.ghcr,
      user: ghcrUser,
      namespace: ghcrNamespace,
      enabled: readOptional(env[REGISTRIES.ghcr.tokenVar]) !== '',
    },
    {
      ...REGISTRIES.dockerhub,
      user: dockerhubUser,
      namespace: dockerhubUser,
      enabled: readOptional(env[REGISTRIES.dockerhub.tokenVar]) !== '' && dockerhubUser !== '',
    },
  ];
}

/**
 * The image bases to publish to, one per enabled registry (unless
 * DOCKER_META_IMAGES overrides them). Explicit entries for a disabled registry
 * are an error — publishing is impossible without credentials, and silently
 * skipping an image the repository asked for is worse than failing.
 *
 * `preview` (dry runs) derives a ghcr.io base even with no credentials at all,
 * so a repository can validate its variants, tags and Dockerfiles before any
 * token exists. A preview image is never pushed.
 */
export function imagesFrom(env = process.env, registries = registriesFrom(env), repoName = '', { preview = false } = {}) {
  const explicit = splitList(env.DOCKER_META_IMAGES);
  const enabled = new Set(registries.filter((entry) => entry.enabled).map((entry) => entry.id));

  if (explicit.length > 0) {
    return explicit.map((raw) => {
      const base = normalizeImageBase(raw);
      const id = imageRegistryOf(base);
      if (!enabled.has(id) && !preview) {
        throw new Error(`DOCKER_META_IMAGES 里的 ${raw} 需要 ${REGISTRIES[id].tokenVar}，但该凭据未配置`);
      }
      return { base, registryId: id };
    });
  }

  const images = [];
  const name = readOptional(env.DOCKER_IMAGE_NAME) || readOptional(repoName);
  if (!name) throw new Error('无法推导镜像名：GITHUB_REPOSITORY 为空，请设置 DOCKER_IMAGE_NAME 或 DOCKER_META_IMAGES');
  for (const entry of registries) {
    if (!entry.enabled) continue;
    if (entry.id === 'ghcr') {
      images.push({ base: normalizeImageBase(`ghcr.io/${entry.namespace}/${name}`), registryId: 'ghcr' });
    } else {
      images.push({ base: normalizeImageBase(`${entry.namespace}/${name}`), registryId: 'dockerhub' });
    }
  }
  if (images.length === 0 && preview) {
    const owner = readOptional(env.GHCR_OWNER) || readOptional(env.GITHUB_REPOSITORY).split('/')[0];
    if (owner) images.push({ base: normalizeImageBase(`ghcr.io/${owner}/${name}`), registryId: 'ghcr', preview: true });
  }
  return images;
}

/** Build behaviour, from the variables, for this run. */
export function buildOptionsFrom(env = process.env, { dryRun = false } = {}) {
  const pushFlag = readOptional(env.DOCKER_PUSH);
  return {
    context: readOptional(env.DOCKER_CONTEXT) || '.',
    platforms: splitList(env.DOCKER_PLATFORMS),
    buildArgs: parseKeyValues(env.DOCKER_BUILD_ARGS, 'DOCKER_BUILD_ARGS'),
    cacheFrom: splitList(env.DOCKER_CACHE_FROM),
    cacheTo: splitList(env.DOCKER_CACHE_TO),
    pull: isTrue(env.DOCKER_PULL),
    noCache: isTrue(env.DOCKER_NO_CACHE),
    provenance: isTrue(env.DOCKER_PROVENANCE),
    dryRun: Boolean(dryRun),
    // `true` on a tag push, `false` for a dry run; DOCKER_PUSH=false forces a
    // build-only run even on a tag.
    push: !dryRun && (pushFlag === '' ? true : isTrue(pushFlag)),
  };
}
