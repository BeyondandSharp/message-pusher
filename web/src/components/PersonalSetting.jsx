import React, { useEffect, useState } from 'react';
import {
  Button,
  Divider,
  Form,
  Image,
  Input,
  Modal,
  Space,
  Typography,
} from 'antd';
import { Link } from 'react-router-dom';
import { API, copy, showError, showInfo, showSuccess } from '../helpers';
import Turnstile from 'react-turnstile';

const PersonalSetting = () => {
  const [inputs, setInputs] = useState({
    wechat_verification_code: '',
    email_verification_code: '',
    email: '',
  });
  const [status, setStatus] = useState({});
  const [showWeChatBindModal, setShowWeChatBindModal] = useState(false);
  const [showEmailBindModal, setShowEmailBindModal] = useState(false);
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let status = localStorage.getItem('status');
    if (status) {
      status = JSON.parse(status);
      setStatus(status);
      if (status.turnstile_check) {
        setTurnstileEnabled(true);
        setTurnstileSiteKey(status.turnstile_site_key);
      }
    }
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };

  const generateToken = async () => {
    const res = await API.get('/api/user/token');
    const { success, message, data } = res.data;
    if (success) {
      await copy(data);
      showSuccess(`令牌已重置并已复制到剪贴板：${data}`);
    } else {
      showError(message);
    }
  };

  const bindWeChat = async () => {
    if (inputs.wechat_verification_code === '') return;
    const res = await API.get(
      `/api/oauth/wechat/bind?code=${inputs.wechat_verification_code}`
    );
    const { success, message } = res.data;
    if (success) {
      showSuccess('微信账户绑定成功！');
      setShowWeChatBindModal(false);
    } else {
      showError(message);
    }
  };

  const openGitHubOAuth = () => {
    window.open(
      `https://github.com/login/oauth/authorize?client_id=${status.github_client_id}&scope=user:email`
    );
  };

  const sendVerificationCode = async () => {
    if (inputs.email === '') return;
    if (turnstileEnabled && turnstileToken === '') {
      showInfo('请稍后几秒重试，Turnstile 正在检查用户环境！');
      return;
    }
    setLoading(true);
    const res = await API.get(
      `/api/verification?email=${inputs.email}&turnstile=${turnstileToken}`
    );
    const { success, message } = res.data;
    if (success) {
      showSuccess('验证码发送成功，请检查邮箱！');
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const bindEmail = async () => {
    if (inputs.email_verification_code === '') return;
    setLoading(true);
    const res = await API.get(
      `/api/oauth/email/bind?email=${inputs.email}&code=${inputs.email_verification_code}`
    );
    const { success, message } = res.data;
    if (success) {
      showSuccess('邮箱账户绑定成功！');
      setShowEmailBindModal(false);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  return (
    <div style={{ lineHeight: '40px' }}>
      <Typography.Title level={3}>通用设置</Typography.Title>
      <Link to={`/user/edit/`}>
        <Button>更新个人信息</Button>
      </Link>
      {/*<Button onClick={generateToken}>生成访问令牌</Button>*/}
      <Divider />
      <Typography.Title level={3}>账号绑定</Typography.Title>
      {status.wechat_login && (
        <Button
          onClick={() => {
            setShowWeChatBindModal(true);
          }}
        >
          绑定微信账号
        </Button>
      )}
      <Modal
        onCancel={() => setShowWeChatBindModal(false)}
        open={showWeChatBindModal}
        width={400}
        footer={null}
      >
        <Image src={status.wechat_qrcode} style={{ width: '100%' }} />
        <div style={{ textAlign: 'center' }}>
          <p>微信扫码关注公众号，输入「验证码」获取验证码（三分钟内有效）</p>
        </div>
        <Form size='large'>
          <Form.Item>
            <Input
              placeholder='验证码'
              name='wechat_verification_code'
              value={inputs.wechat_verification_code}
              onChange={handleInputChange}
            />
          </Form.Item>
          <Button type='primary' block size='large' onClick={bindWeChat}>
            绑定
          </Button>
        </Form>
      </Modal>
      {status.github_oauth && (
        <Button onClick={openGitHubOAuth}>绑定 GitHub 账号</Button>
      )}
      <Button
        onClick={() => {
          setShowEmailBindModal(true);
        }}
      >
        绑定邮箱地址
      </Button>
      <Modal
        onCancel={() => setShowEmailBindModal(false)}
        open={showEmailBindModal}
        width={450}
        title='绑定邮箱地址'
        footer={null}
      >
        <Form size='large'>
          <Form.Item>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder='输入邮箱地址'
                onChange={handleInputChange}
                name='email'
                type='email'
              />
              <Button onClick={sendVerificationCode} disabled={loading}>
                获取验证码
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item>
            <Input
              placeholder='验证码'
              name='email_verification_code'
              value={inputs.email_verification_code}
              onChange={handleInputChange}
            />
          </Form.Item>
          {turnstileEnabled ? (
            <Turnstile
              sitekey={turnstileSiteKey}
              onVerify={(token) => {
                setTurnstileToken(token);
              }}
            />
          ) : (
            <></>
          )}
          <Button
            type='primary'
            block
            size='large'
            onClick={bindEmail}
            loading={loading}
          >
            绑定
          </Button>
        </Form>
      </Modal>
    </div>
  );
};

export default PersonalSetting;
