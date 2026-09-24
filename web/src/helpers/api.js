import { showError } from './utils';
import axios from 'axios';

export const API = axios.create({
  baseURL: import.meta.env.VITE_APP_SERVER
    ? import.meta.env.VITE_APP_SERVER
    : '',
});

// 服务端限流是 60 次/3 分钟的滑动窗口（common/constants.go）。一旦收到 429，
// 进入冷却期并暂停自动刷新这类周期性请求：冷却时长必须**大于**服务端的窗口，
// 否则请求只会把窗口一直占满、永远恢复不了（实测冷却 60 秒时，60 秒一次的自动刷新
// 正好卡在冷却结束的瞬间又发一次请求）。这里取 3 分钟 + 30 秒余量。
const RATE_LIMIT_COOLDOWN_MS = 210 * 1000;
let rateLimitedUntil = 0;

export function isRateLimited() {
  return Date.now() < rateLimitedUntil;
}

export function getRateLimitRemainSeconds() {
  return Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
}

API.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 429) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    }
    showError(error);
    // 注意：这里不 re-throw。原来的实现直接返回值（undefined），调用方接着读
    // res.data 就会抛 "can't access property \"data\" of undefined"。
    // 改为返回一个结构完整的失败响应：调用方照常读 res.data，
    // 按 success === false 走各自的失败分支（提示已由上面的 showError 给出）。
    return {
      data: { success: false, message: undefined, data: null },
      status,
      config: error?.config,
      error,
    };
  },
);
