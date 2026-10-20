import {
  ApartmentOutlined,
  CodeOutlined,
  EditOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  MailOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';

// 顶栏（桌面）和底部导航（移动端）共用的唯一菜单定义。
// icon 存组件引用而不是 JSX，避免把 React 元素当常量缓存。
export const NAV_ITEMS = [
  {
    name: '首页',
    to: '/',
    icon: HomeOutlined,
  },
  {
    name: '消息',
    to: '/message',
    icon: MailOutlined,
  },
  {
    name: '编辑',
    to: '/editor',
    icon: EditOutlined,
  },
  {
    name: '通道',
    to: '/channel',
    icon: ApartmentOutlined,
  },
  {
    name: '接口',
    to: '/webhook',
    icon: CodeOutlined,
  },
  {
    name: '用户',
    to: '/user',
    icon: UserOutlined,
    admin: true,
  },
  {
    name: '设置',
    to: '/setting',
    icon: SettingOutlined,
  },
  {
    name: '关于',
    to: '/about',
    icon: InfoCircleOutlined,
  },
];

// 用于高亮：/ 只精确匹配，其余允许子路由（如 /editor/1）。
export function isNavItemActive(to, pathname) {
  if (to === '/') {
    return pathname === '/';
  }
  return pathname === to || pathname.startsWith(to + '/');
}

// 左右滑动只在「精确的导航页」之间切换，编辑/新增/详情页不参与，
// 避免误滑把用户填了一半的表单切走。
export function exactNavIndex(pathname, items) {
  return items.findIndex((item) => item.to === pathname);
}
