import React, { useEffect, useState } from 'react';
import { Button, Card, Col, Form, Image, Input, Row, Typography } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { API, showError, showInfo, showSuccess } from '../helpers';
import Turnstile from 'react-turnstile';

const PasswordResetForm = () => {
  const [inputs, setInputs] = useState({
    email: '',
  });
  const { email } = inputs;

  const [loading, setLoading] = useState(false);
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');

  useEffect(() => {
    let status = localStorage.getItem('status');
    if (status) {
      status = JSON.parse(status);
      if (status.turnstile_check) {
        setTurnstileEnabled(true);
        setTurnstileSiteKey(status.turnstile_site_key);
      }
    }
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  }

  async function handleSubmit(e) {
    if (!email) return;
    if (turnstileEnabled && turnstileToken === '') {
      showInfo('请稍后几秒重试，Turnstile 正在检查用户环境！');
      return;
    }
    setLoading(true);
    const res = await API.get(
      `/api/reset_password?email=${email}&turnstile=${turnstileToken}`,
    );
    const { success, message } = res.data;
    if (success) {
      showSuccess('重置邮件发送成功，请检查邮箱！');
      setInputs({ ...inputs, email: '' });
    } else {
      showError(message);
    }
    setLoading(false);
  }

  return (
    <Row justify='center' style={{ marginTop: '48px' }}>
      <Col flex='1' style={{ maxWidth: 450 }}>
        <Typography.Title level={2} style={{ textAlign: 'center' }}>
          <Image src='/logo.png' preview={false} /> 密码重置
        </Typography.Title>
        <Form size='large'>
          <Card>
            <Form.Item>
              <Input
                prefix={<MailOutlined />}
                placeholder='邮箱地址'
                name='email'
                value={email}
                onChange={handleChange}
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
              onClick={handleSubmit}
              loading={loading}
            >
              提交
            </Button>
          </Card>
        </Form>
      </Col>
    </Row>
  );
};

export default PasswordResetForm;
