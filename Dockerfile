FROM node:16 as builder

WORKDIR /build
COPY ./web .
COPY ./VERSION .
RUN yarn install
RUN VITE_APP_VERSION=$(cat VERSION) yarn build

FROM golang AS builder2

ARG APK_PROXY=""
ARG APT_PROXY=""

ENV GO111MODULE=on \
    CGO_ENABLED=1 \
    GOOS=linux

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

FROM alpine

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
