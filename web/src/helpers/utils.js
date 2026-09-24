import { getToastApi } from './toast';
import { toastConstants } from '../constants';
import { API } from './api';

export function isAdmin() {
  let user = localStorage.getItem('user');
  if (!user) return false;
  user = JSON.parse(user);
  return user.role >= 10;
}

export function isRoot() {
  let user = localStorage.getItem('user');
  if (!user) return false;
  user = JSON.parse(user);
  return user.role >= 100;
}

export async function copy(text) {
  let okay = true;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      var textarea = document.createElement('textarea');

      textarea.value = text;

      textarea.style.opacity = 0;
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';

      document.body.appendChild(textarea);

      var range = document.createRange();
      range.selectNode(textarea);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);

      document.execCommand('copy');

      document.body.removeChild(textarea);
      window.getSelection().removeAllRanges();
    }
  } catch (e) {
    okay = false;
    console.error(e);
  }
  return okay;
}

export function isMobile() {
  return window.innerWidth <= 600;
}

// antd 的 message/notification 用 duration（秒）控制自动关闭，0 表示不自动关闭。
// 原来是 react-toastify 的毫秒级 autoClose，这里做等值换算。
const showErrorDuration = toastConstants.ERROR_TIMEOUT / 1000;
const showWarningDuration = toastConstants.WARNING_TIMEOUT / 1000;
const showSuccessDuration = toastConstants.SUCCESS_TIMEOUT / 1000;
const showInfoDuration = toastConstants.INFO_TIMEOUT / 1000;
const showNoticeDuration = 0;

export function showError(error) {
  // 拦截器已经在请求失败时提示过一次，并返回 success: false 的占位响应；
  // 调用方的失败分支常常再 showError(message)，此时 message 为空，直接忽略，
  // 免得出现「错误：undefined」这类无意义提示。
  if (!error) {
    return;
  }
  console.error(error);
  const { notification } = getToastApi();
  if (error.message) {
    if (error.name === 'AxiosError') {
      switch (error.response?.status) {
        case 401:
          // 未登录或登录已过期，直接跳转登录页
          window.location.href = '/login?expired=true';
          break;
        case 429:
          notification.error({
            message: '错误：请求次数过多，请稍后再试！',
            duration: showErrorDuration,
          });
          break;
        case 500:
          notification.error({
            message: '错误：服务器内部错误，请联系管理员！',
            duration: showErrorDuration,
          });
          break;
        case 405:
          notification.info({ message: '本站仅作演示之用，无服务端！' });
          break;
        default:
          notification.error({
            message: '错误：' + error.message,
            duration: showErrorDuration,
          });
      }
      return;
    }
    notification.error({
      message: '错误：' + error.message,
      duration: showErrorDuration,
    });
  } else {
    notification.error({
      message: '错误：' + error,
      duration: showErrorDuration,
    });
  }
}

export function showWarning(text) {
  getToastApi().notification.warning({
    message: text,
    duration: showWarningDuration,
  });
}

export function showSuccess(text) {
  getToastApi().notification.success({
    message: text,
    duration: showSuccessDuration,
  });
}

export function showInfo(text) {
  getToastApi().notification.info({
    message: text,
    duration: showInfoDuration,
  });
}

export function showNotice(text) {
  getToastApi().notification.info({
    message: text,
    duration: showNoticeDuration,
  });
}

export function openPage(url) {
  window.open(url);
}

export function removeTrailingSlash(url) {
  if (url.endsWith('/')) {
    return url.slice(0, -1);
  } else {
    return url;
  }
}

export function timestamp2string(timestamp) {
  let date = new Date(timestamp * 1000);
  let year = date.getFullYear().toString();
  let month = (date.getMonth() + 1).toString();
  let day = date.getDate().toString();
  let hour = date.getHours().toString();
  let minute = date.getMinutes().toString();
  let second = date.getSeconds().toString();
  if (month.length === 1) {
    month = '0' + month;
  }
  if (day.length === 1) {
    day = '0' + day;
  }
  if (hour.length === 1) {
    hour = '0' + hour;
  }
  if (minute.length === 1) {
    minute = '0' + minute;
  }
  if (second.length === 1) {
    second = '0' + second;
  }
  return (
    year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ':' + second
  );
}

export function downloadTextAsFile(text, filename) {
  let blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

export async function testChannel(username, token, channel) {
  let res = await API.post(`/push/${username}/`, {
    token,
    channel,
    title: '消息推送服务',
    description:
      channel === ''
        ? '消息推送通道测试成功'
        : `消息推送通道 ${channel} 测试成功`,
    content: '欢迎使用消息推送服务，这是一条测试消息。',
  });
  const { success, message } = res.data;
  if (success) {
    showSuccess('测试消息已发送');
  } else {
    showError(message);
  }
}

export const verifyJSON = (str) => {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
};

export const generateToken = (byteNum) => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteNum));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
};
