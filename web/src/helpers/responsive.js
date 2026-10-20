import { useEffect, useState } from 'react';

// 移动端断点。CSS 里 index.css 的 @media (max-width: 768px) 必须与这里保持一致。
export const MOBILE_BREAKPOINT = 768;
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

function matchesMobile() {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false;
  }
  return window.matchMedia(MOBILE_QUERY).matches;
}

// 响应式的 isMobile：监听 matchMedia，屏幕旋转/窗口缩放时会重新渲染。
// 初值同步计算，避免首帧先按桌面布局渲染再跳成移动布局。
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(matchesMobile);

  useEffect(() => {
    if (!window.matchMedia) {
      return undefined;
    }
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = (event) => setIsMobile(event.matches);
    setIsMobile(query.matches);
    if (query.addEventListener) {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    // 老浏览器回退
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  return isMobile;
}
