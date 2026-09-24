import React, { useEffect, useState } from 'react';
import { Button, Card, Col, Form, Input, Row, Typography } from 'antd';
import { MailOutlined } from '@ant-design/icons';
import { API, copy, showError, showSuccess } from '../helpers';
import { useSearchParams } from 'react-router-dom';

const PasswordResetConfirm = () => {
  const [inputs, setInputs] = useState({
    email: '',
    token: '',
  });
  const { email, token } = inputs;

  const [loading, setLoading] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    let token = searchParams.get('token');
    let email = searchParams.get('email');
    setInputs({
      token,
      email,
    });
  }, []);

  async function handleSubmit(e) {
    if (!email) return;
    setLoading(true);
    const res = await API.post(`/api/user/reset`, {
      email,
      token,
    });
    const { success, message } = res.data;
    if (success) {
      let password = res.data.data;
      await copy(password);
      showSuccess(`密码已重置并已复制到剪贴板：${password}`);
    } else {
      showError(message);
    }
    setLoading(false);
  }

  return (
    <Row justify='center' style={{ marginTop: '48px' }}>
      <Col style={{ maxWidth: 450 }}>
        <Typography.Title level={2} style={{ textAlign: 'center' }}>
          <img src='/logo.png' alt='logo' /> 密码重置确认
        </Typography.Title>
        <Form size='large'>
          <Card>
            <Form.Item>
              <Input
                prefix={<MailOutlined />}
                placeholder='邮箱地址'
                name='email'
                value={email}
                readOnly
              />
            </Form.Item>
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

export default PasswordResetConfirm;
