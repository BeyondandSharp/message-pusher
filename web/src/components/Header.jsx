import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserContext } from '../context/User';

import { Button, Dropdown, Layout, Menu, Space } from 'antd';
import { DownOutlined, UserOutlined } from '@ant-design/icons';
import { API, isAdmin, showSuccess, useIsMobile } from '../helpers';
import { NAV_ITEMS } from '../constants/navigation';
import ThemeSwitch from './ThemeSwitch';
import '../index.css';

const containerStyle = {
  maxWidth: 1127,
  margin: '0 auto',
  padding: '0 1em',
};

const headerStyle = {
  // 固定在页面顶部（index.css 里 body 预留了同等高度的 padding-top）。
  // 背景色交给 antd 的 Layout.headerBg 令牌（随亮/暗主题变化），这里只留边框。
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 100,
  width: '100%',
  borderBottom: '1px solid var(--header-border)',
  padding: 0,
  height: 48,
  lineHeight: 'normal',
};

const Header = () => {
  const isMobile = useIsMobile();
  const [userState, userDispatch] = useContext(UserContext);
  const navigate = useNavigate();

  async function logout() {
    await API.get('/api/user/logout');
    showSuccess('注销成功!');
    userDispatch({ type: 'logout' });
    localStorage.removeItem('user');
    navigate('/login');
  }

  // 与底部导航共用 NAV_ITEMS，管理员才看得到「用户」。
  const visibleButtons = NAV_ITEMS.filter(
    (button) => !(button.admin && !isAdmin()),
  );

  const menuItems = visibleButtons.map((button) => {
    const Icon = button.icon;
    return {
      key: button.to,
      icon: <Icon />,
      label: <Link to={button.to}>{button.name}</Link>,
    };
  });

  const renderMobileAccount = () => {
    if (!userState.user) {
      return (
        <Link to='/login' style={{ color: 'inherit', whiteSpace: 'nowrap' }}>
          登录
        </Link>
      );
    }
    return (
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'setting', label: '设置' },
            { key: 'logout', label: '注销', danger: true },
          ],
          onClick: ({ key }) => {
            if (key === 'setting') {
              navigate('/setting');
            } else if (key === 'logout') {
              logout();
            }
          },
        }}
      >
        <Button type='text' aria-label='账户菜单' icon={<UserOutlined />} />
      </Dropdown>
    );
  };

  const renderDesktopAccount = () => {
    if (!userState.user) {
      return (
        <Link to='/login' style={{ color: 'inherit', whiteSpace: 'nowrap' }}>
          登录
        </Link>
      );
    }
    return (
      <Dropdown
        menu={{
          items: [{ key: 'logout', label: '注销' }],
          onClick: ({ key }) => {
            if (key === 'logout') logout();
          },
        }}
      >
        <a
          onClick={(e) => e.preventDefault()}
          style={{ color: 'inherit', whiteSpace: 'nowrap' }}
        >
          {userState.user.username} <DownOutlined />
        </a>
      </Dropdown>
    );
  };

  return (
    <Layout.Header style={headerStyle}>
      <div
        style={{
          ...containerStyle,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link to='/' className='header-brand'>
          <img
            src='/logo.png'
            alt='logo'
            style={{ height: 32, marginRight: '0.75em' }}
          />
          <span className='header-brand-text'>
            <b>消息推送服务</b>
          </span>
        </Link>
        {!isMobile && (
          <Menu
            mode='horizontal'
            items={menuItems}
            style={{
              flex: 1,
              minWidth: 0,
              borderBottom: 'none',
              background: 'transparent',
            }}
          />
        )}
        <Space size={0}>
          <ThemeSwitch />
          {isMobile ? renderMobileAccount() : renderDesktopAccount()}
        </Space>
      </div>
    </Layout.Header>
  );
};

export default Header;
