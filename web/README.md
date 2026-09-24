# React Template

## Basic Usages

```shell
# Install dependencies
pnpm install

# Runs the app in the development mode
pnpm dev

# Builds the app for production to the `build` folder
pnpm run build
```

构建工具是 Vite（由 Create React App 迁移而来），产物输出到 `build/`，因为 `main.go` 里有 `//go:embed web/build`。
开发模式下的接口请求由 `vite.config.js` 里的 proxy 转发到本地的 Go 服务（`http://localhost:3000`）。

If you want to change the default server, please set `VITE_APP_SERVER` environment variables before build,
for example: `VITE_APP_SERVER=http://your.domain.com`.

`VITE_APP_VERSION` 用于页脚展示的版本号，Dockerfile 与 CI 会在构建时注入。

Before you start editing, make sure your `Actions on Save` options have `Optimize imports` & `Run Prettier` enabled.

## Reference

1. https://github.com/OIerDb-ng/OIerDb
2. https://github.com/cornflourblue/react-hooks-redux-registration-login-example
