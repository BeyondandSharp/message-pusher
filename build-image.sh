#!/usr/bin/env bash
#
# 一键构建 message-pusher 的 Docker 镜像（前端 + 后端都在容器内编译），
# 并导出成可直接 docker load 的镜像文件。
#
# 支持两个变体（与 CI 的发布变体一一对应）：
#   trixie-slim  运行时 Debian trixie（glibc）—— 默认变体，对应 latest、无后缀标签与 -trixie-slim 后缀标签
#   alpine  运行时 Alpine（musl）      —— 标签带 -alpine 后缀
# 两个变体各自独立编译，互不共享产物。
#
# 前端和后端都在容器内编译，
# 宿主机只需要有 docker，不需要本机安装 pnpm / node / go。
#
# 用法：
#   ./build-image.sh                          # trixie-slim 变体，镜像叫 message-pusher:<git 版本>
#   ./build-image.sh --variant alpine         # alpine 变体
#   ./build-image.sh message-pusher:test      # 指定镜像名
#   ./build-image.sh -o out                   # 指定镜像文件输出目录（默认 dist）
#   ./build-image.sh --no-save                # 只构建镜像，不导出镜像文件
#
# 三类包下载代理全部通过环境变量传入，都没有默认值；不设置就走各语言的官方源：
#   APK_PROXY / APK_REPO / APT_PROXY   apk / apt 包缓存代理（改写容器内仓库地址）
#   YUM_REPO                yum/dnf 仓库（Dockerfile 声明了 ARG YUM_REPO 时才生效）
#   GOPROXY                 Go 模块代理（不设置则用 Go 官方代理 proxy.golang.org）
#   NPM_PROXY / NPM_REGISTRY  前端 npm registry（不设置则用官方源）
#   HTTP_PROXY / HTTPS_PROXY / NO_PROXY / ALL_PROXY  真代理：显式作为 --build-arg 转发
#     （docker CLI 只从 ~/.docker/config.json 自动补代理 build arg，不读自己的环境变量）
# 例如：NPM_PROXY=https://registry.npmmirror.com ./build-image.sh

set -euo pipefail

IMAGE=""
OUTPUT_DIR="dist"
DO_SAVE=1
VARIANT="trixie-slim"

usage() {
  cat <<'EOF'
用法：./build-image.sh [选项] [镜像名[:标签]]

选项：
      --variant NAME     构建哪个变体：trixie-slim（默认，运行时 Debian）或 alpine（运行时 Alpine）
                          （trixie 作为旧名仍然接受）
  -o, --output-dir DIR   镜像文件输出目录，默认 dist
      --no-save          只构建镜像，不导出镜像文件
  -h, --help             显示本帮助

示例：
  ./build-image.sh                                # trixie-slim（默认）
  ./build-image.sh --variant alpine               # alpine
  ./build-image.sh --variant alpine message-pusher:v1
  ./build-image.sh --no-save
  NPM_PROXY=https://registry.npmmirror.com ./build-image.sh
  APK_PROXY= APT_PROXY= GOPROXY= ./build-image.sh    # 显式留空，强制走各语言官方源
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "${1}" in
    --variant)
      [[ $# -ge 2 ]] || { echo "错误：--variant 缺少参数。" >&2; exit 1; }
      VARIANT="${2}"
      shift 2
      ;;
    -o|--output-dir)
      [[ $# -ge 2 ]] || { echo "错误：--output-dir 缺少参数。" >&2; exit 1; }
      OUTPUT_DIR="${2}"
      shift 2
      ;;
    --no-save)
      DO_SAVE=0
      shift
      ;;
    -h|--help)
      usage 0
      ;;
    -*)
      echo "错误：未知选项 ${1}。" >&2
      usage 1
      ;;
    *)
      IMAGE="${1}"
      shift
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

command -v docker >/dev/null 2>&1 || { echo "错误：未找到 docker 命令。" >&2; exit 1; }

# 变体 -> Dockerfile 与标签后缀（与 CI 的发布策略一致：trixie-slim 是默认变体，拥有 latest
# 以及无后缀标签；CI 另外会推一套 -trixie-slim 后缀标签、并为每个变体推 amd64 + arm64，
# 本地只出一个本机架构的镜像名）
case "${VARIANT}" in
  trixie-slim|trixie)
    DOCKERFILE="Dockerfile.trixie-slim"
    TAG_SUFFIX=""
    ;;
  alpine)
    DOCKERFILE="Dockerfile.alpine"
    TAG_SUFFIX="-alpine"
    ;;
  *)
    echo "错误：未知变体 ${VARIANT}（可选：trixie-slim / alpine）。" >&2
    exit 1
    ;;
esac

[[ -f "${DOCKERFILE}" ]] || { echo "错误：找不到 ${DOCKERFILE}。" >&2; exit 1; }

# 版本号：优先取 git 描述，取不到就用 dev
VERSION="$(git describe --tags --always --dirty 2>/dev/null || true)"
[[ -z "${VERSION}" ]] && VERSION="dev"
# docker 标签不允许斜杠等字符，做一次替换
VERSION_SLUG="$(printf '%s' "${VERSION}" | tr -c 'A-Za-z0-9_.-' '-')"
IMAGE="${IMAGE:-message-pusher:${VERSION_SLUG}${TAG_SUFFIX}}"

case "$(uname -m)" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) ARCH="$(uname -m)" ;;
esac

echo "==> 变体：${VARIANT}（${DOCKERFILE}）"
echo "==> 版本：${VERSION}"
echo "==> 镜像：${IMAGE}"

# 包缓存代理：未设置则不使用（走官方源）
# 例如：APK_PROXY=https://your-apt-proxy ./build-image.sh
APK_PROXY="${APK_PROXY-}"
APT_PROXY="${APT_PROXY-}"
# 取值顺序（都不是写死的默认值）：APK_PROXY -> APK_REPO -> APT_PROXY
#   APK_REPO 是 apk 镜像单独的变量名；同一个缓存服务同时代理 apt/apk 时也可共用 APT_PROXY
APK_PROXY="${APK_PROXY:-${APK_REPO:-${APT_PROXY}}}"

# Go 模块代理：未设置则用 Go 自带默认（proxy.golang.org）
GOPROXY="${GOPROXY-}"

# yum/dnf 仓库：本仓库的两个 Dockerfile 都没有 dnf/yum 步骤，仅在自定义
# Dockerfile 声明了 ARG YUM_REPO 时才需要；未设置就不传这个 build arg。
YUM_REPO="${YUM_REPO-}"

BUILD_ARGS=(--build-arg "VERSION=${VERSION}" \
            --build-arg "APK_PROXY=${APK_PROXY}" \
            --build-arg "APT_PROXY=${APT_PROXY}" \
            --build-arg "GOPROXY=${GOPROXY}")
if [[ -n "${YUM_REPO}" ]]; then
  BUILD_ARGS+=(--build-arg "YUM_REPO=${YUM_REPO}")
fi
# 真代理：显式转发给构建容器。docker CLI 只会从 ~/.docker/config.json 的
# proxies 自动补代理 build arg，不会读自己的环境变量，所以必须自己传。
for proxy_name in HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY; do
  proxy_value="${!proxy_name-}"
  if [[ -n "${proxy_value}" ]]; then
    BUILD_ARGS+=(--build-arg "${proxy_name}=${proxy_value}")
  fi
done
# 兼容两种命名：NPM_REGISTRY（文档里用的）与 NPM_PROXY
NPM_REGISTRY="${NPM_REGISTRY:-${NPM_PROXY:-}}"
if [[ -n "${NPM_REGISTRY}" ]]; then
  BUILD_ARGS+=(--build-arg "NPM_REGISTRY=${NPM_REGISTRY}")
fi
[[ -n "${APK_PROXY}" ]] && echo "==> apk/apt 代理：${APK_PROXY}"
[[ -n "${GOPROXY}" ]] && echo "==> Go 模块代理：${GOPROXY}"

echo "==> 构建镜像（前端 pnpm 依赖 + go-sqlite3 都在容器内编译，首次会比较慢）"
# 优先 buildx（--load 把结果放回本地镜像库，后面 docker save 要用）；
# 宿主机没有 buildx 时回落到 docker build。
if docker buildx version >/dev/null 2>&1; then
  docker buildx build --load -f "${DOCKERFILE}" -t "${IMAGE}" "${BUILD_ARGS[@]}" .
else
  echo "    （未检测到 buildx，回落到 docker build）"
  docker build -f "${DOCKERFILE}" -t "${IMAGE}" "${BUILD_ARGS[@]}" .
fi

if [[ ${DO_SAVE} -eq 0 ]]; then
  echo
  echo "完成！镜像已构建：${IMAGE}"
  exit 0
fi

mkdir -p "${OUTPUT_DIR}"
SAFE_NAME="${IMAGE//:/_}"
SAFE_NAME="${SAFE_NAME//\//_}"
IMAGE_FILE="${OUTPUT_DIR}/${SAFE_NAME}-${ARCH}.tar"

echo "==> 导出镜像文件 ${IMAGE_FILE}"
docker save -o "${IMAGE_FILE}" "${IMAGE}"

echo
echo "完成！"
echo "  变体：      ${VARIANT}"
echo "  镜像：      ${IMAGE}"
echo "  镜像文件：  ${ROOT_DIR}/${IMAGE_FILE}"
echo "  文件大小：  $(du -h "${IMAGE_FILE}" | cut -f1)"
echo
echo "在目标机器上导入并运行："
echo
echo "  docker load -i ${IMAGE_FILE}"
echo "  docker run -d --name message-pusher -p 3000:3000 \\"
echo "    -v \"\$(pwd)/data:/data\" -e TZ=Asia/Shanghai ${IMAGE}"
echo
echo "（数据保存在挂载的 /data 目录中，默认管理员账号为 root / 123456，请及时修改）"
