FROM node:24-alpine as builder

WORKDIR /build
COPY ./web .
COPY ./VERSION .
# 本机构建残留的 web/build 会随上下文一起被拷进来，Vite 会把里面的 index.html
# 也当成输入去解析，导致 "Failed to resolve /assets/xxx.js"。先清掉再构建。
RUN rm -rf build
RUN yarn install
RUN VITE_APP_VERSION=$(cat VERSION) yarn build

FROM golang:1.27 AS builder2

ARG APK_PROXY=""
ARG APT_PROXY=""
# Go 模块代理：CI（GitHub runner）访问不到局域网，所以默认用公网源；
# 本地构建如需走局域网 Athens，加 --build-arg GOPROXY=http://192.168.2.12:50100,direct
ARG GOPROXY=https://proxy.golang.org,direct

ENV GO111MODULE=on \
    CGO_ENABLED=1 \
    GOOS=linux \
    GOPROXY=${GOPROXY}

# 把包管理器指向缓存代理（Debian 系基础镜像用 apt；APK_PROXY/APT_PROXY 为空时不做任何事）
RUN if [ -f /etc/apk/repositories ] && [ -n "${APK_PROXY}" ]; then \
      sed -i "s|^https\?://|${APK_PROXY}/|" /etc/apk/repositories; \
    fi; \
    if [ -d /etc/apt/apt.conf.d ] && [ -n "${APT_PROXY}" ]; then \
      printf 'Acquire::http::Proxy "%s";\n' "${APT_PROXY}" > /etc/apt/apt.conf.d/99proxy; \
    fi

WORKDIR /build
COPY . .
COPY --from=builder /build/build ./web/build
RUN go mod download
RUN go build -ldflags "-s -w -X 'message-pusher/common.Version=$(cat VERSION)' -extldflags '-static'" -o message-pusher

FROM alpine:3.24

ARG APK_PROXY=""
ARG APT_PROXY=""

ENV PORT=3000
RUN if [ -f /etc/apk/repositories ] && [ -n "${APK_PROXY}" ]; then \
      sed -i "s|^https\?://|${APK_PROXY}/|" /etc/apk/repositories; \
    fi
RUN apk update \
    && apk upgrade \
    && apk add --no-cache ca-certificates tzdata \
    && update-ca-certificates 2>/dev/null || true
COPY --from=builder2 /build/message-pusher /
EXPOSE 3000
WORKDIR /data
ENTRYPOINT ["/message-pusher"]
