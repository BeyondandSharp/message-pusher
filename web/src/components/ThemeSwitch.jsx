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
  light: '亮',
  dark: '暗',
  system: '系统',
};

// 主题切换：右上角、用户名左侧。三个选项：亮 / 暗 / 系统（默认跟随系统）。
// 按反馈：不加悬浮注释；按钮收窄（去掉箭头、减小左右内边距），并与右侧的登录/用户名保持间距。
const ThemeSwitch = () => {
  const { state, dispatch } = useTheme();
  const mode = state.mode;
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          { key: 'light', icon: <SunOutlined />, label: '亮' },
          { key: 'dark', icon: <MoonOutlined />, label: '暗' },
          { key: 'system', icon: <DesktopOutlined />, label: '系统' },
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
      >
        {MODE_LABELS[mode]}
      </Button>
    </Dropdown>
  );
};

export default ThemeSwitch;
