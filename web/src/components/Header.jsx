import React, { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserContext } from '../context/User';

import { Button, Dropdown, Layout, Menu, Space } from 'antd';
import {
  ApartmentOutlined,
  CloseOutlined,
  CodeOutlined,
  DownOutlined,
  EditOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  MailOutlined,
  MenuOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { API, isAdmin, isMobile, showSuccess } from '../helpers';
import '../index.css';

// Header Buttons
const headerButtons = [
  {
    name: '首页',
    to: '/',
    icon: <HomeOutlined />,
  },
  {
    name: '消息',
    to: '/message',
    icon: <MailOutlined />,
  },
  {
    name: '编辑',
    to: '/editor',
    icon: <EditOutlined />,
  },
  {
    name: '通道',
    to: '/channel',
    icon: <ApartmentOutlined />,
  },
  {
    name: '接口',
    to: '/webhook',
    icon: <CodeOutlined />,
  },
  {
    name: '用户',
    to: '/user',
    icon: <UserOutlined />,
    admin: true,
  },
  {
    name: '设置',
    to: '/setting',
    icon: <SettingOutlined />,
  },
  {
    name: '关于',
    to: '/about',
    icon: <InfoCircleOutlined />,
  },
];

const containerStyle = {
  maxWidth: 1127,
  margin: '0 auto',
  padding: '0 1em',
};

const headerStyle = {
  background: '#fff',
  borderBottom: '1px solid #f0f0f0',
  padding: 0,
  height: 52,
  lineHeight: 'normal',
};

const Header = () => {
  const [userState, userDispatch] = useContext(UserContext);
  let navigate = useNavigate();

  const [showSidebar, setShowSidebar] = useState(false);

  async function logout() {
    setShowSidebar(false);
    await API.get('/api/user/logout');
    showSuccess('注销成功!');
    userDispatch({ type: 'logout' });
    localStorage.removeItem('user');
    navigate('/login');
  }

  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  const visibleButtons = headerButtons.filter(
    (button) => !(button.admin && !isAdmin()),
  );

  const renderButtons = (mobile) => {
    return visibleButtons.map((button) => {
      if (mobile) {
        return {
          key: button.to,
          label: button.name,
          onClick: () => {
            navigate(button.to);
            setShowSidebar(false);
          },
        };
      }
      return {
        key: button.to,
        icon: button.icon,
        label: <Link to={button.to}>{button.name}</Link>,
      };
    });
  };

  if (isMobile()) {
    return (
      <>
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
            <Link
              to='/'
              style={{
                display: 'flex',
                alignItems: 'center',
                color: 'inherit',
              }}
            >
              <img
                src='/logo.png'
                alt='logo'
                style={{ height: 32, marginRight: '0.75em' }}
              />
              <span style={{ fontSize: '20px' }}>
                <b>消息推送服务</b>
              </span>
            </Link>
            <Button
              type='text'
              aria-label='menu'
              icon={showSidebar ? <CloseOutlined /> : <MenuOutlined />}
              onClick={toggleSidebar}
            />
          </div>
        </Layout.Header>
        {showSidebar ? (
          <div style={containerStyle}>
            <Menu
              mode='inline'
              items={renderButtons(true)}
              style={{ width: '100%', borderInlineEnd: 'none' }}
            />
            <div style={{ padding: '8px 0' }}>
              {userState.user ? (
                <Button onClick={logout}>注销</Button>
              ) : (
                <Space>
                  <Button
                    onClick={() => {
                      setShowSidebar(false);
                      navigate('/login');
                    }}
                  >
                    登录
                  </Button>
                  <Button
                    onClick={() => {
                      setShowSidebar(false);
                      navigate('/register');
                    }}
                  >
                    注册
                  </Button>
                </Space>
              )}
            </div>
          </div>
        ) : (
          <></>
        )}
      </>
    );
  }

  return (
    <>
      <Layout.Header style={headerStyle}>
        <div
          style={{
            ...containerStyle,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Link
            to='/'
            className={'hide-on-mobile'}
            style={{
              display: 'flex',
              alignItems: 'center',
              color: 'inherit',
              marginRight: '1em',
            }}
          >
            <img
              src='/logo.png'
              alt='logo'
              style={{ height: 32, marginRight: '0.75em' }}
            />
            <span style={{ fontSize: '20px' }}>
              <b>消息推送服务</b>
            </span>
          </Link>
          <Menu
            mode='horizontal'
            items={renderButtons(false)}
            style={{
              flex: 1,
              minWidth: 0,
              borderBottom: 'none',
              background: 'transparent',
            }}
          />
          {userState.user ? (
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
          ) : (
            <Link
              to='/login'
              style={{ color: 'inherit', whiteSpace: 'nowrap' }}
            >
              登录
            </Link>
          )}
        </div>
      </Layout.Header>
    </>
  );
};

export default Header;
