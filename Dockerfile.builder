# 构建环境镜像（不是产品变体 —— 产物变体是 Dockerfile.alpine / Dockerfile.trixie-slim）。
#
# 用途：给 CI 的 job 容器（以及本地 build-image.sh）提供 docker CLI + buildx + node，
# 这样就不必再从宿主机挂载 /usr/bin/docker 与 cli-plugins，job 容器只需要挂一个 socket。
#
# 为什么需要这几样：
#   - docker CLI + buildx：.forgejo/scripts/build-push.mjs 只调用 `docker buildx build`，
#     没有 classic 构建回退，缺 buildx 会直接失败（preflight 也会拦）。
#   - node：workflow 的每一步都是 `node scripts/run.mjs <cmd>`，脚本只用 node 内置模块。
#   - git / bash：本地 build-image.sh 是 bash 脚本，并用 `git describe` 取版本号。
#
# 构建与使用（镜像引用写在 .forgejo/workflows/docker-publish.yml 的矩阵里）：
#   docker build -f Dockerfile.builder -t ghcr.io/<账号>/message-pusher-builder:1 .
#   docker run --rm ghcr.io/<账号>/message-pusher-builder:1 docker buildx version
#
# 换基座或固定 docker CLI 版本时用 --build-arg DOCKER_CLI_IMAGE=...
ARG DOCKER_CLI_IMAGE=docker:cli
FROM ${DOCKER_CLI_IMAGE}

# buildx 缺失就装上；装完必须可用 —— 装不上就让镜像构建失败，
# 避免 CI 到运行时才发现没有 buildx（那时错误信息远不如这里直白）。
RUN apk add --no-cache nodejs npm git bash \
 && (docker buildx version || apk add --no-cache docker-cli-buildx) \
 && docker buildx version \
 && node --version \
 && git --version
