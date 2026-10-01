import React from 'react';
import { Button, Dropdown } from 'antd';
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useTheme } from '../context/Theme';

const MODE_ICONS = {
  light: <SunOutlined />,
  dark: <MoonOutlined />,
  system: <DesktopOutlined />,
};

const MODE_LABELS = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

// 主题切换：右上角、用户名左侧。
// 按反馈：按钮只显示图标（不带文字、不加悬浮注释，点击后才在菜单里看到选项文字）；
// 三个选项为 浅色 / 深色 / 跟随系统（默认跟随系统）。
const ThemeSwitch = () => {
  const { state, dispatch } = useTheme();
  const mode = state.mode;
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          { key: 'light', icon: <SunOutlined />, label: '浅色' },
          { key: 'dark', icon: <MoonOutlined />, label: '深色' },
          { key: 'system', icon: <DesktopOutlined />, label: '跟随系统' },
        ],
        selectable: true,
        selectedKeys: [mode],
        onClick: ({ key }) => dispatch({ type: 'set', payload: key }),
      }}
    >
      <Button
        type='text'
        icon={MODE_ICONS[mode]}
        style={{ padding: '0 8px', marginRight: 12 }}
        aria-label='切换主题'
      />
    </Dropdown>
  );
};

export default ThemeSwitch;
