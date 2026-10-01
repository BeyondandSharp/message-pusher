import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import Header from './components/Header';
import Footer from './components/Footer';
import ToastBridge from './components/ToastBridge';
import 'antd/dist/reset.css';
import './index.css';
import { UserProvider } from './context/User';
import { StatusProvider } from './context/Status';
import { ThemeProvider, useTheme } from './context/Theme';
import { HEADER_HEIGHT, THEME_TOKENS } from './helpers/theme';

// 主题必须包裹在 ConfigProvider 外层，才能把算法和令牌传给它
const Root = () => {
  const { resolved } = useTheme();
  const tokens = THEME_TOKENS[resolved];
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm:
          resolved === 'dark'
            ? antdTheme.darkAlgorithm
            : antdTheme.defaultAlgorithm,
        token: {
          colorBgLayout: tokens.colorBgLayout,
          colorBgContainer: tokens.colorBgContainer,
          colorBorder: tokens.colorBorder,
          colorBorderSecondary: tokens.colorBorderSecondary,
          borderRadius: 8,
        },
        components: {
          Layout: {
            headerBg: tokens.colorBgContainer,
            headerHeight: HEADER_HEIGHT,
            headerPadding: '0 16px',
          },
        },
      }}
    >
      <AntdApp>
        <ToastBridge />
        <StatusProvider>
          <UserProvider>
            <BrowserRouter>
              <Header />
              <div
                className={'main-content'}
                style={{ maxWidth: 1127, margin: '0 auto' }}
              >
                <App />
              </div>
              <Footer />
            </BrowserRouter>
          </UserProvider>
        </StatusProvider>
      </AntdApp>
    </ConfigProvider>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </React.StrictMode>,
);
