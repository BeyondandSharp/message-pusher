# docker-build-push

Forgejo Action：**推送 tag 即构建并推送容器镜像**，发布到 **ghcr.io** 与 **Docker Hub**（其余 registry 不在范围内）。

实现参照 Docker 官方三个 Action —— `docker/build-push-action` v7.4.0、`docker/metadata-action` v6.2.0、`docker/login-action` v4.6.0（源码以 submodule 形式放在仓库的 `ref/docker-build-push/`，仅供对照，**不随本目录复制**）。官方用 action inputs，这里换成**仓库变量 → 环境变量 → 脚本**，因此复制到目标仓库后**只需要配变量**，不需要改 YAML。

```
push tag v1.2.3
      │
      ├─ 解析版本与变体（tag 即版本）                    resolve
      ├─ 预检：凭据 / 变体 Dockerfile / tag 冲突 / docker 守护进程   preflight
      ├─ docker login ghcr.io、docker.io（token 走 stdin）        login
      ├─ 推导 tags 与 OCI labels（每个变体一份）          meta
      ├─ 每个变体各自构建一次 buildx build --push        build-push
      └─ digest 汇总（job summary + 日志）               summary
```

```
alpine  → 1.2.3-alpine / 1.2-alpine / sha-…-alpine / alpine
trixie  → 1.2.3 / 1.2 / latest / sha-…            ← 默认变体，独占无后缀标签
          + 1.2.3-trixie / 1.2-trixie / sha-…-trixie / trixie
```

## 安装

把整个 `docker-build-push/` 目录复制到目标仓库并改名为 `.forgejo`：

```bash
cp -r docker-build-push /path/to/target-repo/.forgejo
```

```
.forgejo/
├── workflows/
│   └── docker-publish.yml    # 只有编排；唯一的 shell 是定位入口那 3 行
└── scripts/                  # 全部逻辑，普通 .mjs 文件
    ├── run.mjs               # 分发器：每个步骤一行调用它
    ├── deps.mjs              # 缺工具时用 apk/apt/yum 安装 + 代理映射 + docker 探测
    ├── locate-action.mjs     # 找 Action 目录（github.action_path 为空的情况）
    ├── config.mjs            # 仓库变量 → 归一化配置（registry/镜像名/变体/构建选项）
    ├── resolve.mjs           # tag → 版本、变体、状态文件
    ├── preflight.mjs         # 预检（凭据、Dockerfile、tag 冲突、daemon）
    ├── meta.mjs              # tags 与 OCI labels 推导（对应 metadata-action）
    ├── login.mjs             # docker login（对应 login-action）
    ├── build-push.mjs        # 每变体一次构建并推送（对应 build-push-action）
    └── summary.mjs           # digest 汇总
```

workflow 里每一步都长这样（`配置里没有内嵌脚本`）：

```yaml
      - name: Build and push
        run: |
          dir="${{ steps.locate.outputs.forgejo_dir }}"
          node "$dir/scripts/run.mjs" build-push
```

唯一的例外是定位步骤本身 —— 它必须先找到 `run.mjs` 才能调用它，所以有 3 行引导。

可用子命令：`locate-action`、`ensure-tools`、`verify-action`、`resolve`、`preflight`、`login`、`meta`、`build-push`、`summary`；都能在本地直接跑，例如
`GITHUB_WORKSPACE=$PWD GITHUB_REPOSITORY=a/b RUNNER_TEMP=/tmp node scripts/run.mjs locate-action`。

复制不全会被 `verify-action` 拦下并逐个列出缺哪个文件。

## 目标仓库需要准备什么

1. `设置 → Actions`：勾选 **Enable Repository Actions**。
2. **两个变体的 Dockerfile**：默认约定 `Dockerfile.alpine` 与 `Dockerfile.trixie`（可用 `DOCKER_VARIANTS` 改）。
3. 至少一套 registry 凭据（见下表）。
4. 一个能访问 Docker 守护进程的 runner（见「runner 前置条件」）。

### 变体 Dockerfile 示例（alpine / trixie，各自独立编译）

两个变体**各编译各的**：不共享编译产物、不依赖静态链接，因此各自链接各自 libc（musl / glibc）。下面是 Go + 前端项目的写法（把 `web/` 换成你自己的构建步骤）：

```dockerfile
# Dockerfile.alpine
FROM node:24-alpine AS frontend
WORKDIR /build/web
RUN npm install -g pnpm
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --ignore-scripts
COPY web/ ./
RUN pnpm run build

FROM golang:1.27-alpine AS backend
ARG VERSION=dev
RUN apk add --no-cache build-base              # go-sqlite3 需要 CGO 工具链
WORKDIR /build
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
COPY --from=frontend /build/web/build ./web/build
# 注意：不要 -extldflags '-static' —— 动态链接到 musl
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -ldflags "-s -w -X 'message-pusher/common.Version=${VERSION}'" -o message-pusher

FROM alpine:3.24
RUN apk add --no-cache ca-certificates tzdata
COPY --from=backend /build/message-pusher /
EXPOSE 3000
WORKDIR /data
ENTRYPOINT ["/message-pusher"]
```

```dockerfile
# Dockerfile.trixie（默认变体，承载 latest）
FROM node:24-trixie AS frontend
WORKDIR /build/web
RUN npm install -g pnpm
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --ignore-scripts
COPY web/ ./
RUN pnpm run build

FROM golang:1.27-trixie AS backend
ARG VERSION=dev
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
COPY --from=frontend /build/web/build ./web/build
# 同样不静态链接 —— 动态链接到 glibc
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -ldflags "-s -w -X 'message-pusher/common.Version=${VERSION}'" -o message-pusher

FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
COPY --from=backend /build/message-pusher /
EXPOSE 3000
WORKDIR /data
ENTRYPOINT ["/message-pusher"]
```

> 用 `--target` 的单文件写法也支持：`DOCKER_VARIANTS` 的第二、三段分别是 Dockerfile 与 target。

## 触发方式

| 触发 | 说明 |
| --- | --- |
| 推送 tag `v1.2.3` / `1.2.3` | 主路径，版本 = tag（允许 `v` 前缀，允许 `1.2.3-rc.1` 预发布） |
| 手工 `workflow_dispatch` | 在**分支**上运行时必须填 `version`（它就是本次发布的版本）；在 **tag ref** 上运行时 `version` 必须与之一致；`variants` 只构建指定变体；`dry_run` 只验证构建（不登录、不推送） |

预发布版本（含 `-`）**不会**产出 `latest`，但 `alpine` / `trixie` 浮动标签仍会更新。
非 semver 的 tag 默认被拒绝；确实需要时设 `DOCKER_ALLOW_ANY_TAG=true`（此时 `semver` 规则不产出，`ref`/`sha`/`raw` 照常）。

**版本会自动作为 build arg 传入**：每次构建都带 `--build-arg VERSION=<本次版本>`，所以下面示例里的 `ARG VERSION` 直接可用，**不需要为它配置任何变量**。想自己控制就在 `DOCKER_BUILD_ARGS` 里写 `VERSION=...`，以你的为准。

## 配置项

### Secrets（token；放 Variables 里也能用，workflow 两边都读）

| 名称 | 必需 | 说明 |
| --- | --- | --- |
| `GHCR_TOKEN` | 二选一 | 带 `write:packages` 的 GitHub PAT（classic）或 fine-grained token（Packages: write）。**存在即启用 ghcr.io** |
| `DOCKERHUB_TOKEN` | 二选一 | Docker Hub access token（不是账号密码）。**存在即启用 Docker Hub** |
| `GHCR_OWNER` / `GHCR_IMAGE` / `GHCR_USER` | 否 | GHCR 命名空间通常与 Forgejo 的 owner **不同名**：`GHCR_IMAGE=ghcr.io/<账号>/<仓库>` 最直接；`GHCR_OWNER` 只给命名空间；`GHCR_USER` 用于 fine-grained org token |
| `DOCKERHUB_USERNAME` | Docker Hub 必需 | 同时作为登录用户与命名空间 |

> token 只以环境变量进入脚本：`docker login --password-stdin`，**不进命令行**；`preflight` 拒绝在没有任何凭据时发布（dry run 除外）。

### Variables（构建与标签策略，全部可选）

| 名称 | 默认 | 说明 |
| --- | --- | --- |
| `DOCKER_IMAGE_NAME` | 仓库名 | 镜像仓库名，两个 registry 共用 |
| `DOCKER_META_IMAGES` | 空（按 registry 推导） | 覆盖镜像基名，换行/逗号分隔，例如 `ghcr.io/acme/app` |
| `DOCKER_VARIANTS` | 见下 | 变体表：`名字\|Dockerfile\|target\|后缀\|是否默认` |
| `DOCKER_DEFAULT_VARIANT` | `trixie` | 独占 `latest` 与无后缀标签的变体 |
| `DOCKER_CONTEXT` | `.` | 构建上下文 |
| `DOCKER_META_TAGS` | `type=ref,event=tag` / `type=semver,pattern={{version}}` / `type=semver,pattern={{major}}.{{minor}}` / `type=sha` | 每行一条规则；见下 |
| `DOCKER_META_FLAVOR` | `latest=auto` | `latest=auto\|true\|false`、`prefix=`、`suffix=`（可带 `,onlatest=true`） |
| `DOCKER_META_LABELS` | 空 | 覆盖/追加 OCI label，每行 `KEY=VALUE` |
| `DOCKER_BUILD_ARGS` | 空 | 每行 `KEY=VALUE`（值里可以有逗号）。`VERSION` 已自动注入，这里写了就覆盖它 |
| `DOCKER_PLATFORMS` | 空（= runner 平台） | 例如 `linux/amd64,linux/arm64`；>1 平台时自动建 `docker-container` builder |
| `DOCKER_CACHE_FROM` / `DOCKER_CACHE_TO` | 空 | 原样透传（`type=gha` 不可用） |
| `DOCKER_PULL` / `DOCKER_NO_CACHE` | 空 | `true` → `--pull` / `--no-cache` |
| `DOCKER_PROVENANCE` | 空 | 默认**不加** attestation（`--provenance=false`）；`true` 才加 |
| `DOCKER_PUSH` | tag 触发为 `true` | `false` 只构建不推送 |
| `DOCKER_ALLOW_ANY_TAG` | 空 | `true` 允许非 semver tag |
| `SKIP_TOOL_INSTALL` | 空 | `true` 关闭自动安装 docker/buildx |
| `ALL_PROXY` / `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` / `APT_PROXY` / `APK_PROXY` / `YUM_PROXY` | 空 | 包管理器装 docker、以及 build 容器内走网时使用 |

### `DOCKER_VARIANTS` 语法

```
<名字>|<Dockerfile>|<target>|<后缀>|<是否默认>
```

只有名字必需；其余默认 `Dockerfile.<名字>`、无 target、`-<名字>`、非默认。后缀写 `none` 表示**不加后缀**。缺省值等价于：

```
DOCKER_VARIANTS: |
  alpine|Dockerfile.alpine
  trixie|Dockerfile.trixie
```

每个变体**恰好一次** `docker build` 调用，各自 `--file`/`--target`，**不会**用「编译一次、复制进两个 runtime stage」或「打一个 tag 再 retag」的做法；同一镜像上出现重复 tag 会被 preflight 直接拒绝。

### `DOCKER_META_TAGS` 支持的规则

`type=semver`（`pattern` 支持 `{{version}}`/`{{major}}`/`{{minor}}`/`{{patch}}`/`{{raw}}`，可带 `match`/`value`）、`type=ref`（`event=branch|tag|pr`）、`type=sha`（`format=short|long`，默认前缀 `sha-`）、`type=raw`（`value`）、`type=match`（`pattern`/`group`）。
通用属性：`enable`、`priority`、`prefix`、`suffix`；表达式只支持 `{{branch}}`、`{{tag}}`、`{{sha}}`。

**未实现的一律报错，不会静默产出别的 tag**：`type=schedule|pep440|edge`、`{{date}}`、`{{commit_date}}`、`{{is_default_branch}}`、`{{is_not_default_branch}}`。

标签规则（以 tag `v1.2.3`、sha `abc1234` 为例）：

| 变体 | ghcr.io / Docker Hub 上得到的标签 |
| --- | --- |
| `alpine` | `v1.2.3-alpine`、`1.2.3-alpine`、`1.2-alpine`、`sha-abc1234-alpine`、`alpine` |
| `trixie`（默认） | 上面一套（换成 `-trixie`）**＋** 无后缀：`v1.2.3`、`1.2.3`、`1.2`、`sha-abc1234`、`latest` |

## runner 前置条件（重要）

这个 Action 必须能访问 **Docker 守护进程**，job 容器里还要有 `node`（脚本是 `.mjs`）。两种可用接法：

```yaml
    runs-on: docker
    container:
      image: node:22-bookworm
      options: --volume /var/run/docker.sock:/var/run/docker.sock   # 需要 runner 配置 valid_volumes 允许
```

- **容器任务**：必须把 socket 挂进容器（上面 `options` 那行），并在 runner 配置里把该路径加进 `valid_volumes`；否则 `docker` 连不上 daemon。
- **宿主机 runner**：workflow 里不写 `container:`，只要 runner 用户能访问 `/var/run/docker.sock`。
- `docker` 命令缺失时，`ensure-tools` 会用镜像自带的包管理器尝试装 `docker.io`/`docker-cli`（走上面的代理变量）；装不上会打印需要手动执行的命令。
- **没有 `buildx` 也能用**：自动降级为 `docker build` + `docker tag` + `docker push`（单平台、无缓存导出、无 provenance），日志里会有醒目提示。`DOCKER_PLATFORMS` 指定多平台时则必须有 buildx，否则 preflight 失败。
- `buildx < 0.11` 不支持 `--provenance`，此时自动不传该参数。

## 本地校验（不需要 docker daemon / registry）

```bash
# 在临时仓库里把目录复制成 .forgejo，然后用假的 docker 跑通全链路：
cp -r docker-build-push /tmp/fixture/.forgejo
GITHUB_WORKSPACE=/tmp/fixture node /tmp/fixture/.forgejo/scripts/run.mjs locate-action

# 只验证标签推导（完全不碰 docker）：
node --input-type=module -e "
const { resolveRelease } = await import('/tmp/fixture/.forgejo/scripts/resolve.mjs');
const { computeBuilds } = await import('/tmp/fixture/.forgejo/scripts/meta.mjs');
const state = resolveRelease({ GITHUB_REPOSITORY: 'acme/app', GITHUB_REF: 'refs/tags/v1.2.3', GITHUB_REF_NAME: 'v1.2.3',
  GITHUB_SHA: 'abc1234567890', GITHUB_EVENT_NAME: 'push', GHCR_TOKEN: 'x', RUNNER_TEMP: '/tmp' });
for (const build of computeBuilds({ state })) console.log(build.variant.padEnd(7), build.tagNames.join(' '));
"
```

`test/docker-layout-e2e.test.mjs` 就是这么做的：PATH 上放一个假 `docker`（记录 argv、伪造 `buildx build` 与 `login`），按真实步骤顺序跑 `locate → ensure-tools → verify → resolve → preflight → login → meta → build-push → summary`，并断言「每个变体一次构建」「token 不进 argv/日志/状态文件」。

## 行为细节

- **只发布、不改仓库**：不 commit、不 push、不打 tag，也不修改工作区里的版本号。
- **幂等性**：重复推同一个 tag 会重新构建并覆盖同名 tag（Docker 本身就是这个语义），不会报错。
- **digest**：`buildx` 路径用 `--metadata-file` 读 `containerimage.digest`；降级路径用 `docker inspect` 的 `RepoDigests`。汇总写在日志与 `$GITHUB_STEP_SUMMARY`（Forgejo 没有该变量时只打日志）。
- **label**：`created/revision/version/source/url/title` 由脚本生成，`DOCKER_META_LABELS` 可覆盖。
- **dry run**：`--output type=cacheonly`，不登录、不推送、不写 image store；没有任何凭据也能跑（会用 `ghcr.io/<owner>/<仓库>` 作为预览镜像名）。
- **多 registry**：一次构建同时打上两个 registry 的标签，一次 push 推到两边；两个 registry 各登录一次。

## 已知限制

- 只支持 **ghcr.io 与 Docker Hub**；其它 registry、`registry-auth` 多 registry YAML、`scope`、OIDC、ECR 相关能力未实现（超出范围）。
- 不支持 Docker Bake（HCL）、annotations 输出、`--secret`/`--ssh`、named contexts、`add-hosts`/`ulimit`/`shm-size`/`network`。
- 不实现 `type=gha` 缓存（GitHub Actions Cache 服务在 Forgejo 不存在）；用 `type=registry` 或 `type=local`。
- 没有 webhook 通知：推送失败或成功都以 job 状态与日志呈现（不像 npm-publish 需要人工点链接）。
- `secrets.X || vars.X` 依赖 Forgejo 的表达式兼容实现；若你使用的版本不支持，把 token 直接放 Secrets 并改成 `${{ secrets.X }}` 即可。
- 依赖 `actions/checkout@v4`（Forgejo 默认 actions registry）。若实例无法访问，改成全限定 URL `https://code.forgejo.org/actions/checkout@v4`。
- 一个变体的产物不能复用给另一个变体（**这是设计目标**）：两个变体必须是各自可独立构建的 Dockerfile。

## 首次使用需要在真实实例上确认的点

本目录的代码在源仓库经过了 78 个用例的单元测试与假 docker 端到端（见下），但以下几项只有真实 Forgejo + runner + registry 才能确认，建议先 `dry_run: true` 演练一次：

1. runner 是否能让 job 访问 Docker 守护进程（socket 挂载 + `valid_volumes`，或宿主机 runner）。
2. `actions/checkout@v4` 在该实例是否可达。
3. `docker buildx version` 是否存在（没有会走降级路径，功能会少：单平台、无缓存导出）。
4. `GHCR_TOKEN` / `DOCKERHUB_TOKEN` 的权限是否足够（`write:packages` / Docker Hub 读写+删除）。
5. `secrets.GHCR_TOKEN || vars.GHCR_TOKEN` 这类表达式在该实例的解析结果是否符合预期。

## 测试

```bash
node --test test/docker-*.test.mjs      # 本 Action 的 78 个用例
node --test test/*.test.mjs test/npm-publish/*.test.mjs   # 本仓库全部用例
```

用例直接 import 这里发布的同一批 `.mjs` 文件（`test/action-files.mjs` 的 `dockerBuildPush` 绑定），并有把整目录复制成 `.forgejo` 后按真实步骤跑通的端到端用例。
