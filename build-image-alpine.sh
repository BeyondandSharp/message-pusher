#!/usr/bin/env bash
#
# 一键构建 message-pusher 的 Docker 镜像（全 Alpine 一体化构建），
# 并导出成可直接 docker load 的镜像文件。
#
# 与 build-image.sh 的区别：前端和后端都在容器内的 Alpine 里编译，
# 宿主机只需要有 docker，不需要本机安装 pnpm / node / go。
#
# 用法：
#   ./build-image-alpine.sh                        # 镜像默认叫 message-pusher:<git 版本>
#   ./build-image-alpine.sh message-pusher:test    # 指定镜像名
#   ./build-image-alpine.sh -o out                 # 指定镜像文件输出目录（默认 dist）
#   ./build-image-alpine.sh --no-save              # 只构建镜像，不导出镜像文件
#
# 若 Go 模块或 npm 下载慢，可以指定代理，例如：
#   GOPROXY=https://goproxy.cn,direct NPM_REGISTRY=https://registry.npmmirror.com ./build-image-alpine.sh
#
# apk / apt 的包缓存代理默认是 http://192.168.2.12:3142，
# 可用 APK_PROXY / APT_PROXY 覆盖，设为空字符串则禁用（APK_PROXY= ./build-image-alpine.sh）。

set -euo pipefail

IMAGE=""
OUTPUT_DIR="dist"
DO_SAVE=1

usage() {
  cat <<'EOF'
用法：./build-image-alpine.sh [选项] [镜像名[:标签]]

选项：
  -o, --output-dir DIR   镜像文件输出目录，默认 dist
      --no-save          只构建镜像，不导出镜像文件
  -h, --help             显示本帮助

示例：
  ./build-image-alpine.sh
  ./build-image-alpine.sh message-pusher:v1
  ./build-image-alpine.sh --no-save
  GOPROXY=https://goproxy.cn,direct ./build-image-alpine.sh
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "${1}" in
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

# 版本号：优先取 git 描述，取不到就用 dev
VERSION="$(git describe --tags --always --dirty 2>/dev/null || true)"
[[ -z "${VERSION}" ]] && VERSION="dev"
# docker 标签不允许斜杠等字符，做一次替换
VERSION_SLUG="$(printf '%s' "${VERSION}" | tr -c 'A-Za-z0-9_.-' '-')"
IMAGE="${IMAGE:-message-pusher:${VERSION_SLUG}}"

case "$(uname -m)" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) ARCH="$(uname -m)" ;;
esac

echo "==> 版本：${VERSION}"
echo "==> 镜像：${IMAGE}"

# 包缓存代理：默认指向局域网里的 apk/apt 缓存代理；设为空字符串可禁用。
# 例如：APK_PROXY= ./build-image-alpine.sh
APK_PROXY="${APK_PROXY-http://192.168.2.12:3142}"
APT_PROXY="${APT_PROXY-http://192.168.2.12:3142}"

BUILD_ARGS=(--build-arg "VERSION=${VERSION}" \
            --build-arg "APK_PROXY=${APK_PROXY}" \
            --build-arg "APT_PROXY=${APT_PROXY}")
if [[ -n "${GOPROXY:-}" ]]; then
  BUILD_ARGS+=(--build-arg "GOPROXY=${GOPROXY}")
fi
if [[ -n "${NPM_REGISTRY:-}" ]]; then
  BUILD_ARGS+=(--build-arg "NPM_REGISTRY=${NPM_REGISTRY}")
fi
[[ -n "${APK_PROXY}" ]] && echo "==> apk/apt 代理：${APK_PROXY}"

echo "==> 构建镜像（前端 pnpm 依赖 + go-sqlite3 都在容器内编译，首次会比较慢）"
docker build -f Dockerfile.alpine -t "${IMAGE}" "${BUILD_ARGS[@]}" .

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
