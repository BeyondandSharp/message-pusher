import React, { useContext, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserContext } from '../context/User';
import { isAdmin, useIsMobile } from '../helpers';
import { NAV_ITEMS, isNavItemActive } from '../constants/navigation';

// 移动端底部主导航：固定在屏幕底部，菜单项可横向滑动，当前项在必要时
// 自动滚入可视区域。顶栏（Header）在移动端只保留品牌/主题/账户，不再放菜单。
const BottomNav = () => {
  const isMobile = useIsMobile();
  const location = useLocation();
  const [userState] = useContext(UserContext);
  const scrollRef = useRef(null);
  const itemRefs = useRef(new Map());

  const items = NAV_ITEMS.filter((item) => !(item.admin && !isAdmin()));

  useEffect(() => {
    if (!isMobile) {
      return;
    }
    const active = items.find((item) =>
      isNavItemActive(item.to, location.pathname),
    );
    const container = scrollRef.current;
    const element = active ? itemRefs.current.get(active.to) : null;
    if (!container || !element) {
      return;
    }
    // 只把当前项滚动到可见范围内（必要时才滚），避免每次切换都把
    // 左侧菜单项裁掉一半。
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const edgePadding = 8;
    let left = container.scrollLeft;
    if (elementRect.left < containerRect.left + edgePadding) {
      left -= containerRect.left + edgePadding - elementRect.left;
    } else if (elementRect.right > containerRect.right - edgePadding) {
      left += elementRect.right - (containerRect.right - edgePadding);
    }
    if (left !== container.scrollLeft) {
      container.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
  }, [isMobile, location.pathname, userState.user]);

  if (!isMobile) {
    return null;
  }

  return (
    <nav className='bottom-nav' aria-label='主导航'>
      <div className='bottom-nav-scroll' ref={scrollRef}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = isNavItemActive(item.to, location.pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              ref={(element) => {
                if (element) {
                  itemRefs.current.set(item.to, element);
                } else {
                  itemRefs.current.delete(item.to);
                }
              }}
              className={active ? 'bottom-nav-item active' : 'bottom-nav-item'}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className='bottom-nav-icon' />
              <span className='bottom-nav-label'>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
