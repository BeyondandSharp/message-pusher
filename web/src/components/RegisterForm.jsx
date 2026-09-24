import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Image,
  Input,
  Row,
  Typography,
} from 'antd';
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { API, showError, showInfo, showSuccess } from '../helpers';
import Turnstile from 'react-turnstile';

const RegisterForm = () => {
  const [inputs, setInputs] = useState({
    username: '',
    password: '',
    password2: '',
    email: '',
    verification_code: '',
  });
  const { username, password, password2 } = inputs;
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let status = localStorage.getItem('status');
    if (status) {
      status = JSON.parse(status);
      setShowEmailVerification(status.email_verification);
      if (status.turnstile_check) {
        setTurnstileEnabled(true);
        setTurnstileSiteKey(status.turnstile_site_key);
      }
    }
  });

  let navigate = useNavigate();

  function handleChange(e) {
    const { name, value } = e.target;
    console.log(name, value);
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  }

  async function handleSubmit(e) {
    if (password.length < 8) {
      showInfo('密码长度不得小于 8 位！');
      return;
    }
    if (password !== password2) {
      showInfo('两次输入的密码不一致');
      return;
    }
    if (username && password) {
      if (turnstileEnabled && turnstileToken === '') {
        showInfo('请稍后几秒重试，Turnstile 正在检查用户环境！');
        return;
      }
      setLoading(true);
      const res = await API.post(
        `/api/user/register?turnstile=${turnstileToken}`,
        inputs
      );
      const { success, message } = res.data;
      if (success) {
        navigate('/login');
        showSuccess('注册成功！');
      } else {
        showError(message);
      }
      setLoading(false);
    }
  }

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
      showSuccess('验证码发送成功，请检查你的邮箱！');
    } else {
      showError(message);
    }
    setLoading(false);
  };

  return (
    <Row justify='center' style={{ marginTop: '48px', textAlign: 'center' }}>
      <Col style={{ maxWidth: 450 }}>
        <Typography.Title level={2} style={{ textAlign: 'center' }}>
          <Image src='/logo.png' /> 新用户注册
        </Typography.Title>
        <Form size='large'>
          <Card>
            <Form.Item>
              <Input
                prefix={<UserOutlined />}
                placeholder='输入用户名，最长 12 位'
                onChange={handleChange}
                name='username'
              />
            </Form.Item>
            <Form.Item>
              <Input.Password
                prefix={<LockOutlined />}
                placeholder='输入密码，最短 8 位，最长 20 位'
                onChange={handleChange}
                name='password'
              />
            </Form.Item>
            <Form.Item>
              <Input.Password
                prefix={<LockOutlined />}
                placeholder='输入密码，最短 8 位，最长 20 位'
                onChange={handleChange}
                name='password2'
              />
            </Form.Item>
            {showEmailVerification ? (
              <>
                <Form.Item>
                  <Input
                    prefix={<MailOutlined />}
                    placeholder='输入邮箱地址'
                    onChange={handleChange}
                    name='email'
                    type='email'
                    addonAfter={
                      <Button onClick={sendVerificationCode} disabled={loading}>
                        获取验证码
                      </Button>
                    }
                  />
                </Form.Item>
                <Form.Item>
                  <Input
                    prefix={<LockOutlined />}
                    placeholder='输入验证码'
                    onChange={handleChange}
                    name='verification_code'
                  />
                </Form.Item>
              </>
            ) : (
              <></>
            )}
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
              onClick={handleSubmit}
              loading={loading}
            >
              注册
            </Button>
          </Card>
        </Form>
        <Alert
          type='info'
          title={
            <>
              已有账户？
              <Link to='/login' className='btn btn-link'>
                点击登录
              </Link>
            </>
          }
        />
      </Col>
    </Row>
  );
};

export default RegisterForm;
