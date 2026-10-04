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
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /build/web
RUN npm install -g pnpm --registry=${NPM_REGISTRY}
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --ignore-scripts --registry=${NPM_REGISTRY}
COPY web/ ./
RUN pnpm run build

FROM golang:1.27-alpine AS backend
ARG VERSION=dev
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}
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
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /build/web
RUN npm install -g pnpm --registry=${NPM_REGISTRY}
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --ignore-scripts --registry=${NPM_REGISTRY}
COPY web/ ./
RUN pnpm run build

FROM golang:1.27-trixie AS backend
ARG VERSION=dev
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}
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

### runner 不展开 `${{ inputs.* }}` 时

`workflow_dispatch` 的输入由 workflow 映射进环境变量（`INPUT_VERSION: ${{ inputs.version }}` 等）。Forgejo 的表达式求值器遇到**当前事件里不存在的上下文**时会**原样保留字面量**：tag 触发时没有 `inputs`，于是 `INPUT_VERSION` 的值就是字符串 `${{ inputs.version }}`，而不是空串。

脚本对此有兜底，不需要你做什么：

- **长得像未展开表达式的 `INPUT_*` 一律按「未填写」处理**，并在日志里打一条警告说明是哪个输入、以及最终用了什么值；
- 真正的来源改为 `$GITHUB_EVENT_PATH` 指向的**事件载荷**（`{"inputs": {...}}`），它不依赖表达式引擎，所以分支上的 `workflow_dispatch` 即使 runner 不求值也能拿到你填的 `version` / `variants` / `dry_run`；
- 环境变量里的**真实值仍然优先**（在会正常求值的 runner 上行为不变）。

效果：tag 推送不会再被这个坑拦下（版本照旧来自 tag）；dispatch 输入也能正常生效。日志里出现 `INPUT_VERSION 是未被展开的表达式` 只是说明你的 runner 有该行为，不需要处理。

**运行期才知道的值会自动作为 build arg 传入**：每次构建都带 `--build-arg VERSION=<本次版本>`，以及（配了才会带的）`GOPROXY`、`NPM_REGISTRY`。所以下面示例里的 `ARG VERSION` / `ARG GOPROXY` / `ARG NPM_REGISTRY` 直接可用，**不需要为它们写 DOCKER_BUILD_ARGS**；想自己控制就在 `DOCKER_BUILD_ARGS` 里写同名项，以你的为准。

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

> **留空 = 未配置**：workflow 里是 `X: ${{ vars.X }}`，变量没配时导出的是**空字符串**，脚本会把空值/纯空白一律当作"没设置"并使用默认值（不会报"配置为空"）。



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
| 代理 / 镜像变量 | 空 | 见下面「代理、镜像与 registry」 |

### 代理、镜像与 registry（内网怎么接）

runner 没有直连外网时，先分清三件不同的事：**代理**（forward proxy）、**镜像/仓库**（repository）、**registry**。填错变量的典型症状是 `unable to select packages`、`HTTP 404/308`、`Connection refused`。变量名与用法和 [npm-publish](../npm-publish/README.md) **完全一致**，同一套内网配置两个 Action 都能直接用。

**最省事的用法：只填下面这几个地址。**
`APT_PROXY` / `NPM_PROXY` 的值可以是**真代理**，也可以是**内网镜像/registry**：`Ensure container tools` 会**探测一次**（取该地址自己的仓库索引 / `/-/ping`），再决定怎么用。

| 变量 | 你填什么 | 判为**镜像 / registry** | 判为**代理** |
| --- | --- | --- | --- |
| `APT_PROXY` | Debian/Ubuntu 镜像根，如 `https://apt.internal` | 生成临时 sources（`<根>/debian` 或 `/ubuntu` + 镜像里的 codename）→ `apt-get -o Dir::Etc::sourcelist=…` 装 docker CLI | 作为 apt 的 `http_proxy`/`https_proxy` |
| `NPM_PROXY` | 内网 npm registry，如 `https://npm.internal` | 构建时注入 `--build-arg NPM_REGISTRY=<url>`（Dockerfile 里写 `ARG NPM_REGISTRY` 即可给 `pnpm install --registry` 用） | 作为 npm 自己的 `proxy` 设置 |
| `GOPROXY`（或 `GO_PROXY`） | Go module proxy（Athens 等） | 构建时注入 `--build-arg GOPROXY=<url>`（Dockerfile 里写 `ARG GOPROXY`） | — |

判别规则：直接 GET 索引文件，**2xx = 镜像**；拿到明确的 HTTP 错误（404/400/308…）= 代理；**完全没有响应**（连不上/超时）= 仍按镜像处理 —— 那正是你填的地址，报错信息也更贴切。
本 Action 自己**不跑 npm**（前端构建发生在 `docker build` 里），所以 `NPM_PROXY` 的判别结果是通过 build arg 传给构建的，而不是本地安装用。

apk / yum 的镜像用这两个（显式指定，**不探测**；设了就优先于任何 `*_PROXY`）：

| 变量 | 指向什么 |
| --- | --- |
| `APK_REPO` | Alpine 镜像**根地址或完整仓库 URL**（逗号分隔）：根地址会按镜像里的 `VERSION_ID` 展开成 `<根>/alpine/vX.Y/{main,community}` |
| `YUM_REPO` | yum/dnf 镜像**根地址或完整 baseurl**（逗号分隔；根地址按 `VERSION_ID` 展开成 `<根>/centos/<N>-stream/{BaseOS,AppStream}/x86_64/os`）；生成 `.repo` 目录 + `--setopt=reposdir=`，镜像自带的 `/etc/pki/rpm-gpg/RPM-GPG-KEY*` 会写进 `gpgkey`（`gpgcheck=1`），一个密钥都没有时才降级为 `gpgcheck=0` 并在日志里说明。旧的 `APK_REPOSITORY` / `YUM_REPOSITORY` 仍可识别 |
| `APK_PROXY` / `YUM_PROXY` | **已删除**：apk/yum 的镜像是仓库而不是代理，填到 `APK_REPO` / `YUM_REPO`；真要给它们配代理就用下面的通用变量 |

**真正的 HTTP 转发代理**（它们只当代理，不做判别；BuildKit 会自动把 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` 转发进构建容器）：

| 变量 | 作用 |
| --- | --- |
| `ALL_PROXY` | 通用兜底（`socks5://…` 也可以） |
| `HTTP_PROXY` / `HTTPS_PROXY` | 标准 HTTP 代理 |
| `NO_PROXY` | 不走代理的地址（如 `localhost,.internal`） |

取值优先级（以 apt 为例）：`APT_PROXY`（判为代理时）→ `HTTP_PROXY`/`HTTPS_PROXY` → `ALL_PROXY`。变量会同时以大写和小写形式导出（`http_proxy`/`HTTP_PROXY`），因为不同工具认不同写法；`NO_PROXY` 也一样。

想自己确认某个地址是哪一类：

```bash
curl -sI https://HOST/alpine/v3.24/main/x86_64/APKINDEX.tar.gz | head -1   # Alpine 镜像（分支带 v）
curl -sI https://HOST/debian/dists/trixie/InRelease | head -1              # Debian/Ubuntu 镜像
curl -s  https://HOST/-/ping                                               # npm registry <- 返回 {}
curl -x http://HOST:PORT -o /dev/null -w '%{http_code}\n' https://registry-1.docker.io/v2/   # 代理
```

socks5 代理只能给 `ALL_PROXY`/`HTTP(S)_PROXY` 用，apt/apk 不能；内网源形式特殊（多组件、多 suite、非 CentOS 的 RPM 发行版）时，直接写进镜像的 `sources.list` / `.repo` 更省事。

### 自动注入的 build arg

`resolve` 会把运行期才知道的值作为 `--build-arg` 传进构建，**Dockerfile 里声明了 `ARG` 才会被消费**：

| build arg | 来源 | 覆盖方式 |
| --- | --- | --- |
| `VERSION` | 本次 tag 的版本（去掉 `v` 前缀） | `DOCKER_BUILD_ARGS: VERSION=...` |
| `GOPROXY` | 变量 `GOPROXY` 或 `GO_PROXY` | 同上 |
| `NPM_REGISTRY` | 变量 `NPM_REGISTRY`（显式），或 `NPM_PROXY` 被判为 registry 的结果 | 同上 |
| `APT_PROXY` | 变量 `APT_PROXY`，**仅当它被判为镜像**（此时值是镜像根地址，Dockerfile 用它改写 sources） | 同上 |
| `APK_PROXY` | 变量 `APK_REPO` / `APK_REPOSITORY`（兼容旧名 `APK_PROXY`），没有则退回上面的 apt 镜像根 | 同上 |
| 变体自己的参数 | `DOCKER_VARIANTS` 第六列，例如 `NODE_IMAGE=node:lts-alpine` | `DOCKER_BUILD_ARGS` 里写同名项 |

这些值和 `build-image.sh` 传的是同一组，所以本地构建与 CI 行为一致：Dockerfile 里 `ARG APT_PROXY` / `ARG APK_PROXY` / `ARG NPM_REGISTRY` / `ARG GOPROXY` / `ARG VERSION` 声明了哪个，就消费哪个；每个值为空时都不会注入，Dockerfile 没声明对应的 `ARG` 时会被忽略。

> **判别为真代理时不会注入 `APT_PROXY`**：镜像（repository）与代理（forward proxy）不是一回事，把代理地址塞给一个会做 `s|^https?://|<root>/|` 的 Dockerfile 会生成坏掉的 sources。真正的转发代理由 BuildKit 自动带进构建容器（`HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`），Dockerfile 无需任何 `ARG`。

### `DOCKER_VARIANTS` 语法

**每行一个变体**（不能用逗号分隔：第六列里可能有 `;` 和 `,`）：

```
<名字>|<Dockerfile>|<target>|<后缀>|<是否默认>|<KEY=VALUE;KEY=VALUE>
```

只有名字必需；其余默认 `Dockerfile.<名字>`、无 target、`-<名字>`、非默认、无额外构建参数。后缀写 `none` 表示**不加后缀**。缺省值等价于：

```
DOCKER_VARIANTS: |
  alpine|Dockerfile.alpine
  trixie|Dockerfile.trixie
```

**第六列是每个变体自己的 build args**，这就是"让仓库指定工具链镜像"的通用做法——Dockerfile 里声明 `ARG`，值随变体走，不需要改 workflow、也不需要为每个变体单独写 job：

```yaml
DOCKER_VARIANTS: |
  alpine|Dockerfile.alpine||-alpine|false|NODE_IMAGE=node:lts-alpine;GO_IMAGE=golang:1.27-alpine
  trixie|Dockerfile.trixie||-trixie|true|NODE_IMAGE=node:lts
```

对应 Dockerfile（`ARG` 必须在**第一个 `FROM` 之前**声明才能用于 `FROM`）：

```dockerfile
ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS frontend
```

于是 alpine 变体的前端用 `node:lts-alpine`、trixie 变体用 `node:lts`，各自独立构建；换版本只改仓库变量，两个 Dockerfile 都不用动。任何 `KEY=VALUE` 都行（Go 工具链镜像、构建标记、`GOFLAGS`…），不限于 node。

优先级：**`DOCKER_BUILD_ARGS` > 变体第六列 > 自动注入**（同一 key 冲突时）。

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

### 为什么 job 里还需要 `docker` 命令

“runner 本来就能起 docker”是对的，但**能起 docker 的是 runner 进程，不是 job 容器**：

- Forgejo runner 用 `docker run` 起 job 容器，它自己通过宿主机 socket 调 docker —— 这个 `docker` 二进制在**宿主机（或 runner 容器）里**；
- 我们的脚本运行在 **job 容器内部**，那里既没有 `docker` 命令，默认也没有 `/var/run/docker.sock`；
- GitHub 官方 runner 的镜像自带 docker CLI 与 daemon，所以官方三个 Action 不用管；Forgejo 的 `container:` 任务不是这样。

因此本 Action 需要两样东西：**job 容器里能执行 `docker`**，以及**它连得上一个 daemon**。

### 别把三层 image 混淆（`Start image=` 不是你的产物）

一次运行里会出现三个不同层面的镜像，日志里各自出现：

| 层面 | 日志里长什么样 | 由谁决定 |
| --- | --- | --- |
| ① job 容器：跑脚本的「工作台」 | runner 启动时 `🚀 Start image=node:lts-alpine`（或 `node:lts`，取决于 matrix 条目） | workflow 的 `container.image`（当前是 `${{ matrix.image }}`）。换它只影响脚本在哪跑，**不影响产物** |
| ② 构建阶段：Dockerfile 里的 `FROM … AS frontend/backend` | `docker buildx build --file Dockerfile.trixie …` 过程中拉取 `node:24-trixie-slim`、`golang:1.27-trixie` 等 | 你的 Dockerfile |
| ③ 最终产物：推送出去的镜像 | 同一条命令的 `--tag …:1.0.0-trixie` 列表 | 变体表 + Dockerfile **最后一个** `FROM` |

所以看到 `Start image=node:lts-…` 不代表「打包用错了 Dockerfile」：它只是 job 容器。产物里是 Debian 还是 Alpine，只取决于该变体用的是哪个 Dockerfile。

验证产物（不依赖日志）：

```bash
docker run --rm --entrypoint sh <镜像:tag> -c 'head -2 /etc/os-release'
docker image inspect <镜像:tag> --format '{{.Config.Labels}}'
```

### 三种接法（按推荐顺序）

**1. 把宿主机的 CLI 与 socket 一起挂进 job 容器（推荐，零安装、版本一致）**

```yaml
    runs-on: docker
    container:
      image: node:22-bookworm
      options: >-
        --volume /var/run/docker.sock:/var/run/docker.sock
        --volume /usr/bin/docker:/usr/bin/docker:ro
        --volume /usr/libexec/docker/cli-plugins:/usr/libexec/docker/cli-plugins:ro
```

这三个路径都要在 runner 配置的 `valid_volumes` 里放行。第三行是 buildx 插件目录（有些发行版是 `/usr/lib/docker/cli-plugins`），不需要多平台/缓存导出时可以省略。

**2. 用自带 docker CLI 的 job 镜像**

例如 `docker:cli`（Alpine，带 CLI 与 buildx），再让 `ensure-tools` 补 node；或自己构建一个 node + docker CLI 的镜像。这需要把 workflow 里的 `container.image` 改成你的镜像（本 Action 刻意没有提供镜像变量）。

**3. 让 Action 自己装（默认行为，最省事但依赖镜像源）**

`ensure-tools` 会用镜像自带的包管理器尝试安装，走上面的代理/镜像变量：

- Debian/Ubuntu：`docker.io`（Debian 主源里就有，但**同时会装上没用到的 dockerd**，体积偏大）；
- Alpine：`docker-cli`；
- yum/dnf：`docker` / `docker-ce-cli`。

**buildx 在纯 Debian 源里不存在**（`docker-buildx` / `docker-buildx-plugin` 只在 Docker CE 仓库里），所以这条路通常只能拿到 CLI → 自动降级为单平台构建。想要 buildx 就用接法 1 或 2，或者给镜像加上 Docker CE 的 apt 源。

### 一变体一 job 容器（matrix，已内置）

workflow 默认就是 matrix：**每个变体一个 job、一个自己的 job 容器**。alpine 变体在 Alpine 的 node 里跑，Debian 变体在 Debian 的 node 里跑——这样 `ensure-tools` 会走对应的包管理器，两个变体也真正并行。

```yaml
jobs:
  publish:
    name: docker build and push (${{ matrix.variant }})
    runs-on: docker
    strategy:
      fail-fast: false          # 一个变体失败不取消另一个（各自独立发布）
      matrix:
        include:
          - variant: alpine
            image: node:lts-alpine
          - variant: trixie
            image: node:lts
    container:
      image: ${{ matrix.image }}
    env:
      # …其余 env 不变…
      INPUT_VARIANTS: ${{ matrix.variant }}   # 每个 job 只构建自己的变体
```

**再加一个 job 容器 = 加三行**：

```yaml
          - variant: bookworm      # ① matrix 里加一条
            image: node:lts
```

② 在仓库变量 `DOCKER_VARIANTS` 里加同名变体（决定 Dockerfile、后缀、是否默认、以及它的 build args）：

```yaml
DOCKER_VARIANTS: |
  alpine|Dockerfile.alpine||-alpine|false|NODE_IMAGE=node:lts-alpine
  trixie|Dockerfile.trixie||-trixie|true|NODE_IMAGE=node:lts
  bookworm|Dockerfile.bookworm||-bookworm|false|NODE_IMAGE=node:lts
```

③ 加对应的 `Dockerfile.bookworm`。三处名字一致即可，脚本不需要改。

标签归属不受影响：只有**默认变体**产无后缀标签与 `latest`，其余变体只产 `<后缀>` 系列；两个 job 各自有独立的 `RUNNER_TEMP`，状态文件不冲突。每个 job 也只需要自己那个 Dockerfile 存在（alpine job 不会因为缺少 `Dockerfile.trixie` 而失败）。

注意事项：

- **`container.image` 里的 `${{ matrix.image }}` 必须能被求值**。你的 runner 之前出现过 `inputs.*` 不求值的情况，所以第一次改完请先跑一次 `dry_run` 确认日志里没有把表达式原样当成镜像名（那会报拉取失败）。
- **挂载宿主机的 docker CLI 比在每个容器里各装一次划算**（Alpine 要 `apk`、Debian 要 `apt`，而且 Debian 源里通常没有 buildx）：把上面 `container.options` 的三行挂载打开即可。
- 想少写 YAML 也可以让 matrix 来自变量：`matrix: ${{ fromJSON(vars.DOCKER_MATRIX) }}`——但 `fromJSON` 依赖 runner 的表达式实现，先用 `dry_run` 验证；不确定时用上面的显式写法。

### 其他要点

- **socket 必须可达**：容器任务要挂 `/var/run/docker.sock`（如上）并在 runner 的 `valid_volumes` 里放行；宿主机 runner 则要求 runner 用户能访问该 socket。连不上时 `preflight` 会带上这份检查清单直接失败。
- **`buildx` 缺失不是错误**：自动降级为 `docker build` + `docker tag` + `docker push`（单平台、无缓存导出、无 provenance），日志里有醒目提示；`DOCKER_PLATFORMS` 指定多平台时才会失败。降级时会带上 `DOCKER_BUILDKIT=1`，因此示例 Dockerfile 里的 `RUN --mount=type=cache` 仍然有效。
- **`buildx < 0.11`** 不支持 `--provenance`，此时自动不传该参数。
- **一个包缺失不会拖垮必需的包**：镜像里没有 `docker-buildx` 而只有 `docker.io` 时，批量安装会整体失败，Action 会把每个候选包单独重试，因此 `docker.io` 仍能装上（`docker` 必需、`buildx` 可选）。

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

本目录的代码在源仓库经过了 118 个用例的单元测试与假 docker 端到端（见下），但以下几项只有真实 Forgejo + runner + registry 才能确认，建议先 `dry_run: true` 演练一次：

1. runner 是否能让 job 访问 Docker 守护进程（socket 挂载 + `valid_volumes`，或宿主机 runner）。
2. `actions/checkout@v4` 在该实例是否可达。
3. `docker buildx version` 是否存在（没有会走降级路径，功能会少：单平台、无缓存导出）。
4. `GHCR_TOKEN` / `DOCKERHUB_TOKEN` 的权限是否足够（`write:packages` / Docker Hub 读写+删除）。
5. `secrets.GHCR_TOKEN || vars.GHCR_TOKEN` 这类表达式在该实例的解析结果是否符合预期。
6. `${{ inputs.* }}` 是否被求值：不被求值时脚本会退回事件载荷并打警告（见「runner 不展开 `${{ inputs.* }}` 时」），功能不受影响。

## 测试

```bash
node --test test/docker-*.test.mjs      # 本 Action 的 118 个用例
node --test test/*.test.mjs test/npm-publish/*.test.mjs   # 本仓库全部用例
```

用例直接 import 这里发布的同一批 `.mjs` 文件（`test/action-files.mjs` 的 `dockerBuildPush` 绑定），并有把整目录复制成 `.forgejo` 后按真实步骤跑通的端到端用例。
