import React, { useContext, useEffect } from 'react';
import { Card, Col, Row, Typography } from 'antd';
import { API, showError, showNotice, timestamp2string } from '../../helpers';
import { StatusContext } from '../../context/Status';

// 系统配置总览里的启用状态：已启用用绿色、未启用用红色（用 antd 的语义色，跟随亮暗主题）
const renderSwitchState = (enabled) => (
  <Typography.Text type={enabled ? 'success' : 'danger'}>
    {enabled ? '已启用' : '未启用'}
  </Typography.Text>
);

const Home = () => {
  const [statusState, statusDispatch] = useContext(StatusContext);
  const homePageLink = localStorage.getItem('home_page_link') || '';

  const displayNotice = async () => {
    const res = await API.get('/api/notice');
    const { success, message, data } = res.data;
    if (success) {
      let oldNotice = localStorage.getItem('notice');
      if (data !== oldNotice && data !== '') {
        showNotice(data);
        localStorage.setItem('notice', data);
      }
    } else {
      showError(message);
    }
  };

  const getStartTimeString = () => {
    const timestamp = statusState?.status?.start_time;
    return timestamp2string(timestamp);
  };

  useEffect(() => {
    displayNotice().then();
  }, []);
  return (
    <>
      {homePageLink !== '' ? (
        <>
          <iframe
            src={homePageLink}
            style={{ width: '100%', height: '100vh', border: 'none' }}
          />
        </>
      ) : (
        <>
          <Card>
            <Typography.Title level={3}>系统状况</Typography.Title>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Card
                  title='系统信息'
                  extra={
                    <Typography.Text type='secondary'>
                      系统信息总览
                    </Typography.Text>
                  }
                >
                  <p>名称：{statusState?.status?.system_name}</p>
                  <p>版本：{statusState?.status?.version}</p>
                  <p>
                    源码：
                    <a
                      href='https://github.com/BeyondandSharp/message-pusher'
                      target='_blank'
                    >
                      https://github.com/BeyondandSharp/message-pusher
                    </a>
                  </p>
                  <p>启动时间：{getStartTimeString()}</p>
                  <p>
                    自从上次启动已发送消息数目：
                    {statusState?.status?.message_count}
                  </p>
                  <p>
                    自从上次启动新注册用户数目：
                    {statusState?.status?.user_count}
                  </p>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card
                  title='系统配置'
                  extra={
                    <Typography.Text type='secondary'>
                      系统配置总览
                    </Typography.Text>
                  }
                >
                  <p>
                    邮箱验证：
                    {renderSwitchState(
                      statusState?.status?.email_verification === true,
                    )}
                  </p>
                  <p>
                    GitHub 身份验证：
                    {renderSwitchState(
                      statusState?.status?.github_oauth === true,
                    )}
                  </p>
                  <p>
                    微信身份验证：
                    {renderSwitchState(
                      statusState?.status?.wechat_login === true,
                    )}
                  </p>
                  <p>
                    Turnstile 用户校验：
                    {renderSwitchState(
                      statusState?.status?.turnstile_check === true,
                    )}
                  </p>
                  <p>
                    全局消息持久化：
                    {renderSwitchState(
                      statusState?.status?.message_persistence === true,
                    )}
                  </p>
                  <p>
                    全局消息渲染：
                    {renderSwitchState(
                      statusState?.status?.message_render === true,
                    )}
                  </p>
                </Card>
              </Col>
            </Row>
          </Card>
        </>
      )}
    </>
  );
};

export default Home;
