#!/usr/bin/env bash
#
# 一键构建 message-pusher 的 Docker 镜像，并导出成可直接 docker load 的镜像文件。
#
# 用法：
#   ./build-image.sh                        # 镜像默认叫 message-pusher:<git 版本>
#   ./build-image.sh message-pusher:test    # 指定镜像名
#   ./build-image.sh -o out                 # 指定镜像文件输出目录（默认 dist）
#   ./build-image.sh --skip-frontend        # 复用已有的 web/build，不重新构建前端
#   ./build-image.sh --no-save              # 只构建镜像，不导出镜像文件
#
# 依赖：pnpm（构建前端）、docker（构建并导出镜像）。
#
# 三类包下载代理都默认指向局域网里的缓存服务，均可用环境变量覆盖，
# 设为空字符串则改用默认源（例如 APK_PROXY= ./build-image.sh）：
#   apk / apt 包缓存：http://192.168.2.12:3142   （APK_PROXY / APT_PROXY）
#   Go 模块代理：http://192.168.2.12:50100      （GOPROXY，局域网内的 Athens）
# 如需换成公网代理：GOPROXY=https://goproxy.cn,direct ./build-image.sh

set -euo pipefail

IMAGE=""
OUTPUT_DIR="dist"
SKIP_FRONTEND=0
DO_SAVE=1

usage() {
  cat <<'EOF'
用法：./build-image.sh [选项] [镜像名[:标签]]

选项：
  -o, --output-dir DIR   镜像文件输出目录，默认 dist
      --skip-frontend    跳过前端构建，直接使用已有的 web/build
      --no-save          只构建镜像，不导出镜像文件
  -h, --help             显示本帮助

示例：
  ./build-image.sh
  ./build-image.sh message-pusher:v1
  ./build-image.sh --skip-frontend --no-save
  APK_PROXY= GOPROXY= ./build-image.sh          # 不用局域网缓存代理，走公网默认源
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
    --skip-frontend)
      SKIP_FRONTEND=1
      shift
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

# ---------------------------------------------------------------- 前端
if [[ ${SKIP_FRONTEND} -eq 1 ]]; then
  echo "==> 跳过前端构建（使用已有的 web/build）"
else
  command -v pnpm >/dev/null 2>&1 || {
    echo "错误：未找到 pnpm 命令；请安装 pnpm，或加 --skip-frontend 复用已有的 web/build。" >&2
    exit 1
  }
  echo "==> 安装前端依赖"
  # pnpm 10+ 默认不执行依赖包自带的 build 脚本（本项目是 esbuild），并要求在
  # web/pnpm-workspace.yaml 的 allowBuilds 里给出明确表态；那里已经写成 esbuild: false，
  # 因此这里配合 --ignore-scripts 安装。若该文件被改回 pnpm 的占位值，install 会以
  # ERR_PNPM_IGNORED_BUILDS 失败，且 --ignore-scripts 也救不了。
  if ! (cd web && pnpm install --ignore-scripts); then
    # 兜底：清掉可能处于半成品状态的 node_modules 再装一次
    echo "==> 安装失败，清理 web/node_modules 后重试"
    rm -rf web/node_modules
    (cd web && pnpm install --ignore-scripts)
  fi
  echo "==> 构建前端"
  # Vite 在构建时把 import.meta.env.VITE_* 静态替换进产物，这里注入版本号（对应页脚的显示）
  (cd web && VITE_APP_VERSION="${VERSION}" pnpm run build)
fi

[[ -f web/build/index.html ]] || {
  echo "错误：web/build/index.html 不存在，前端未成功构建。请去掉 --skip-frontend 后重试。" >&2
  exit 1
}

# ---------------------------------------------------------------- 镜像
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
[[ -n "${APK_PROXY}" ]] && echo "==> apk/apt 代理：${APK_PROXY}"
[[ -n "${GOPROXY}" ]] && echo "==> Go 模块代理：${GOPROXY}"

echo "==> 构建镜像（首次构建需要编译 go-sqlite3，会慢一些）"
docker build -f Dockerfile.local -t "${IMAGE}" "${BUILD_ARGS[@]}" .

if [[ ${DO_SAVE} -eq 0 ]]; then
  echo
  echo "完成！镜像已构建：${IMAGE}"
  exit 0
fi

# ---------------------------------------------------------------- 导出
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
