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
#   GOPROXY                 Go 模块代理（不设置则用 Go 官方代理 proxy.golang.org）
#   NPM_PROXY / NPM_REGISTRY  前端 npm registry（不设置则用官方源）
# 例如：NPM_PROXY=https://registry.npmmirror.com ./build-image.sh

# 可选：在构建镜像里构建（宿主机只需要有 docker，不需要 buildx）：
#   ./build-image.sh --save-builder      # 只把构建镜像导出成 dist/message-pusher-builder-<架构>.tar
#   ./build-image.sh --in-builder        # 自动构建构建镜像 -> 导出 tar -> 在其中构建 -> 结束后删除本机镜像
# 构建镜像引用不写死：本机 tag 为 builder:<变体>，tar 落在输出目录；也可用 --builder-image 指定已有镜像。

set -euo pipefail

IMAGE=""
OUTPUT_DIR="dist"
DO_SAVE=1
VARIANT="trixie-slim"
BUILDER_IMAGE="${BUILDER_IMAGE-}"
IN_BUILDER=0
SAVE_BUILDER=0
# 原始参数：--in-builder 重入时要原样传进容器（去掉 --in-builder 自己）
ORIG_ARGS=("$@")

usage() {
  cat <<'EOF'
用法：./build-image.sh [选项] [镜像名[:标签]]

选项：
      --variant NAME     构建哪个变体：trixie-slim（默认，运行时 Debian）或 alpine（运行时 Alpine）
                          （trixie 作为旧名仍然接受）
  -o, --output-dir DIR   镜像文件输出目录，默认 dist
      --no-save          只构建镜像，不导出镜像文件
      --in-builder       把构建放进构建镜像里跑（宿主机只需要有 docker）。
                         未指定 --builder-image 时，会自动构建构建镜像、导出成 tar，
                         并在整体构建结束后删除本机镜像（tar 保留）
      --save-builder     只构建构建镜像并导出成 tar（不构建产物）
      --builder-image REF
                         直接使用已有的构建镜像（不再自动构建/导出/清理）
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
    --in-builder)
      IN_BUILDER=1
      shift
      ;;
    --save-builder)
      SAVE_BUILDER=1
      shift
      ;;
    --builder-image)
      [[ $# -ge 2 ]] || { echo "错误：--builder-image 缺少参数。" >&2; exit 1; }
      BUILDER_IMAGE="${2}"
      shift 2
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
# 以及无后缀标签；CI 另外会推一套 -trixie-slim 后缀标签，本地只出一个镜像名）
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

# ---------------------------------------------------------------- 构建镜像
# 构建镜像（根目录 Dockerfile.builder）提供 docker CLI + buildx + node。
# 不写死任何 registry：本机 tag 用 builder:<变体>，导出成 tar 便于带到别的机器。
#   --save-builder   只构建并导出 tar
#   --in-builder     用它跑本次构建；未给 --builder-image 时自动构建/导出，
#                    并在整体构建结束后删除本机镜像（tar 保留；KEEP_BUILDER_IMAGE=1 可保留）
#   --builder-image  直接使用已有镜像（不做构建/导出/清理）
BUILDER_TAG="builder:${VARIANT}"
BUILDER_TAR="${OUTPUT_DIR}/message-pusher-builder-${ARCH}.tar"

build_builder_image() {
  echo "==> 构建构建镜像：${BUILDER_TAG}（Dockerfile.builder）"
  docker build -f Dockerfile.builder -t "${BUILDER_TAG}" .
  mkdir -p "${OUTPUT_DIR}"
  echo "==> 导出构建镜像：${BUILDER_TAR}"
  docker save -o "${BUILDER_TAR}" "${BUILDER_TAG}"
  echo "    文件大小：$(du -h "${BUILDER_TAR}" | cut -f1)"
}

remove_builder_image() {
  if [[ -n "${KEEP_BUILDER_IMAGE:-}" ]]; then
    echo "==> 保留本机构建镜像 ${BUILDER_TAG}（KEEP_BUILDER_IMAGE=1）"
    return 0
  fi
  if docker rmi -f "${BUILDER_TAG}" >/dev/null 2>&1; then
    echo "==> 已删除本机构建镜像 ${BUILDER_TAG}（tar 保留：${BUILDER_TAR}）"
  fi
}

if [[ ${SAVE_BUILDER} -eq 1 ]]; then
  build_builder_image
  echo
  echo "完成！构建镜像已导出：${ROOT_DIR}/${BUILDER_TAR}"
  echo "  在需要使用它的机器上：docker load -i ${BUILDER_TAR}"
  exit 0
fi

if [[ ${IN_BUILDER} -eq 1 ]]; then
  if [[ -n "${BUILD_IMAGE_IN_CONTAINER:-}" ]]; then
    echo "错误：已经在构建镜像内运行，不能再嵌套 --in-builder。" >&2
    exit 1
  fi
  BUILT_BUILDER=0
  if [[ -z "${BUILDER_IMAGE}" ]]; then
    build_builder_image
    BUILDER_IMAGE="${BUILDER_TAG}"
    BUILT_BUILDER=1
  fi
  REEXEC_ARGS=()
  for arg in "${ORIG_ARGS[@]}"; do
    [[ "${arg}" == "--in-builder" ]] || REEXEC_ARGS+=("${arg}")
  done
  echo "==> 在构建镜像内构建：${BUILDER_IMAGE}"
  RUN_STATUS=0
  docker run --rm \
    -e BUILD_IMAGE_IN_CONTAINER=1 \
    -e APK_PROXY -e APT_PROXY -e APK_REPO -e GOPROXY -e NPM_REGISTRY -e NPM_PROXY -e YUM_REPO \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${ROOT_DIR}:${ROOT_DIR}" \
    -w "${ROOT_DIR}" \
    "${BUILDER_IMAGE}" \
    ./build-image.sh "${REEXEC_ARGS[@]}" || RUN_STATUS=$?
  # 整体构建结束后清理（无论成败，避免本机残留镜像）
  if [[ ${BUILT_BUILDER} -eq 1 ]]; then
    remove_builder_image
  fi
  exit "${RUN_STATUS}"
fi

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

BUILD_ARGS=(--build-arg "VERSION=${VERSION}" \
            --build-arg "APK_PROXY=${APK_PROXY}" \
            --build-arg "APT_PROXY=${APT_PROXY}" \
            --build-arg "GOPROXY=${GOPROXY}")
# 兼容两种命名：NPM_REGISTRY（文档里用的）与 NPM_PROXY
NPM_REGISTRY="${NPM_REGISTRY:-${NPM_PROXY:-}}"
if [[ -n "${NPM_REGISTRY}" ]]; then
  BUILD_ARGS+=(--build-arg "NPM_REGISTRY=${NPM_REGISTRY}")
fi
[[ -n "${APK_PROXY}" ]] && echo "==> apk/apt 代理：${APK_PROXY}"
[[ -n "${GOPROXY}" ]] && echo "==> Go 模块代理：${GOPROXY}"

echo "==> 构建镜像（前端 pnpm 依赖 + go-sqlite3 都在容器内编译，首次会比较慢）"
# 与 CI 一致：优先 buildx（--load 把结果放回本地镜像库，后面 docker save 要用）；
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
