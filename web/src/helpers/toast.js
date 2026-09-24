import {
  message as staticMessage,
  notification as staticNotification,
} from 'antd';

// antd 的 message/notification 需要处在 React 上下文里，才能拿到 ConfigProvider 的主题与语言配置。
// 但 showError 这类函数会被 axios 响应拦截器这种「非组件」代码调用，拿不到 hook，
// 所以这里放一个模块级 holder：<ToastBridge/> 在组件树里用 App.useApp() 拿到实例后注册进来。
// 注册前回退到 antd 的静态 API（功能可用，只是不参与主题定制）。
let toastApi = {
  message: staticMessage,
  notification: staticNotification,
};

export function setToastApi(api) {
  toastApi = api;
}

export function getToastApi() {
  return toastApi;
}
