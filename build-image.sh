#!/usr/bin/env bash
#
# 一键构建 message-pusher 的 Docker 镜像（前端 + 后端都在容器内编译），
# 并导出成可直接 docker load 的镜像文件。
#
# 支持两个变体（与 CI 的发布变体一一对应）：
#   trixie  运行时 Debian trixie（glibc）—— 默认变体，对应 latest 与无后缀标签
#   alpine  运行时 Alpine（musl）      —— 标签带 -alpine 后缀
# 两个变体各自独立编译，互不共享产物。
#
# 前端和后端都在容器内编译，
# 宿主机只需要有 docker，不需要本机安装 pnpm / node / go。
#
# 用法：
#   ./build-image.sh                          # trixie 变体，镜像叫 message-pusher:<git 版本>
#   ./build-image.sh --variant alpine         # alpine 变体
#   ./build-image.sh message-pusher:test      # 指定镜像名
#   ./build-image.sh -o out                   # 指定镜像文件输出目录（默认 dist）
#   ./build-image.sh --no-save                # 只构建镜像，不导出镜像文件
#
# 三类包下载代理都默认指向局域网里的缓存服务，均可用环境变量覆盖，
# 设为空字符串则改用默认源：
#   apk / apt 包缓存：http://192.168.2.12:3142   （APK_PROXY / APT_PROXY）
#   Go 模块代理：http://192.168.2.12:50100      （GOPROXY，局域网内的 Athens）
#   npm registry：默认官方源，可用 NPM_REGISTRY 指定镜像
# 例如：NPM_REGISTRY=https://registry.npmmirror.com ./build-image.sh

set -euo pipefail

IMAGE=""
OUTPUT_DIR="dist"
DO_SAVE=1
VARIANT="trixie"

usage() {
  cat <<'EOF'
用法：./build-image.sh [选项] [镜像名[:标签]]

选项：
      --variant NAME     构建哪个变体：trixie（默认，运行时 Debian）或 alpine（运行时 Alpine）
  -o, --output-dir DIR   镜像文件输出目录，默认 dist
      --no-save          只构建镜像，不导出镜像文件
  -h, --help             显示本帮助

示例：
  ./build-image.sh                                # trixie（默认）
  ./build-image.sh --variant alpine               # alpine
  ./build-image.sh --variant alpine message-pusher:v1
  ./build-image.sh --no-save
  NPM_REGISTRY=https://registry.npmmirror.com ./build-image.sh
  APK_PROXY= APT_PROXY= GOPROXY= ./build-image.sh    # 不用局域网缓存代理，走公网默认源
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

# 变体 -> Dockerfile 与默认标签后缀（与 CI 的发布策略保持一致：trixie 是默认变体，拥有 latest）
case "${VARIANT}" in
  trixie)
    DOCKERFILE="Dockerfile.trixie"
    TAG_SUFFIX=""
    ;;
  alpine)
    DOCKERFILE="Dockerfile.alpine"
    TAG_SUFFIX="-alpine"
    ;;
  *)
    echo "错误：未知变体 ${VARIANT}（可选：trixie / alpine）。" >&2
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

# 包缓存代理：默认指向局域网里的 apk/apt 缓存代理；设为空字符串可禁用。
# 例如：APK_PROXY= ./build-image.sh
APK_PROXY="${APK_PROXY-http://192.168.2.12:3142}"
APT_PROXY="${APT_PROXY-http://192.168.2.12:3142}"
# Go 模块代理：默认走局域网里的 Athens；设为空字符串则用 Go 自带默认（proxy.golang.org）
GOPROXY="${GOPROXY-http://192.168.2.12:50100,direct}"

BUILD_ARGS=(--build-arg "VERSION=${VERSION}" \
            --build-arg "APK_PROXY=${APK_PROXY}" \
            --build-arg "APT_PROXY=${APT_PROXY}" \
            --build-arg "GOPROXY=${GOPROXY}")
if [[ -n "${NPM_REGISTRY:-}" ]]; then
  BUILD_ARGS+=(--build-arg "NPM_REGISTRY=${NPM_REGISTRY}")
fi
[[ -n "${APK_PROXY}" ]] && echo "==> apk/apt 代理：${APK_PROXY}"
[[ -n "${GOPROXY}" ]] && echo "==> Go 模块代理：${GOPROXY}"

echo "==> 构建镜像（前端 pnpm 依赖 + go-sqlite3 都在容器内编译，首次会比较慢）"
docker build -f "${DOCKERFILE}" -t "${IMAGE}" "${BUILD_ARGS[@]}" .

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
