import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isAdmin, useIsMobile } from '../helpers';
import { NAV_ITEMS, exactNavIndex } from '../constants/navigation';

// 手势起点落在这些区域时不切换页面：可交互控件、代码编辑器、弹窗、
// 可以横向滚动的内容，以及顶栏/页脚这些非内容区。
// 否则在填表或滚动代码时容易被误判成翻页。
const IGNORE_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  '[role="button"]',
  '[contenteditable="true"]',
  '.cm-editor',
  '.code-block',
  '.ant-table-wrapper',
  '.ant-modal',
  '.ant-modal-root',
  '.ant-select',
  '.ant-dropdown',
  '.ant-tabs-nav',
  '.bottom-nav',
  '.ant-layout-header',
  '.ant-layout-footer',
  '.rendered-html',
  '.message-content',
].join(',');

const SWIPE_MIN_DISTANCE = 60; // px
const SWIPE_MAX_DURATION = 800; // ms
const SWIPE_DIRECTION_RATIO = 1.5; // 横向位移至少是纵向的 1.5 倍

const SwipeNav = ({ children }) => {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const startRef = useRef(null);

  const items = NAV_ITEMS.filter((item) => !(item.admin && !isAdmin()));
  // 只在精确的导航页之间切换：编辑/新增/详情页不参与，避免误滑丢失表单。
  // 事件监听器挂在 document 上，用 ref 拿最新状态，避免每次路由变化都重复绑定。
  const stateRef = useRef({ isMobile, activeIndex: -1, items });
  stateRef.current = {
    isMobile,
    activeIndex: exactNavIndex(location.pathname, items),
    items,
  };

  useEffect(() => {
    if (!isMobile) {
      return undefined;
    }

    const handleTouchStart = (event) => {
      startRef.current = null;
      const state = stateRef.current;
      if (state.activeIndex < 0 || event.touches.length !== 1) {
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest(IGNORE_SELECTOR)) {
        return;
      }
      const touch = event.touches[0];
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    };

    const handleTouchEnd = (event) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start || event.changedTouches.length !== 1) {
        return;
      }
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const duration = Date.now() - start.time;
      if (
        duration > SWIPE_MAX_DURATION ||
        Math.abs(deltaX) < SWIPE_MIN_DISTANCE ||
        Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_DIRECTION_RATIO
      ) {
        return;
      }
      const { activeIndex, items: currentItems } = stateRef.current;
      const nextIndex = deltaX < 0 ? activeIndex + 1 : activeIndex - 1;
      if (
        activeIndex < 0 ||
        nextIndex < 0 ||
        nextIndex >= currentItems.length
      ) {
        return;
      }
      navigate(currentItems[nextIndex].to);
      window.scrollTo(0, 0);
    };

    const handleTouchCancel = () => {
      startRef.current = null;
    };

    document.addEventListener('touchstart', handleTouchStart, {
      passive: true,
    });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchCancel, {
      passive: true,
    });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [isMobile]);

  if (!isMobile) {
    return children;
  }

  return <div className='swipe-area'>{children}</div>;
};

export default SwipeNav;
