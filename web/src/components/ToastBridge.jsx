import { App } from 'antd';
import { setToastApi } from '../helpers/toast';

// 把 antd App 上下文里的 message/notification 实例注册到 helpers/toast，
// 这样 axios 拦截器那种非组件代码也能弹出带主题的提示。
// 在首次渲染期间（早于任何 useEffect）注册，保证用到时一定已就绪。
const ToastBridge = () => {
  const { message, notification } = App.useApp();
  setToastApi({ message, notification });
  return null;
};

export default ToastBridge;
