import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Container } from 'semantic-ui-react';
import App from './App';
import Header from './components/Header';
import Footer from './components/Footer';
import ToastBridge from './components/ToastBridge';
import 'antd/dist/reset.css';
import 'semantic-ui-css/semantic.min.css';
import './index.css';
import { UserProvider } from './context/User';
import { StatusProvider } from './context/Status';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <ToastBridge />
        <StatusProvider>
          <UserProvider>
            <BrowserRouter>
              <Header />
              <Container className={'main-content'}>
                <App />
              </Container>
              <Footer />
            </BrowserRouter>
          </UserProvider>
        </StatusProvider>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>
);
