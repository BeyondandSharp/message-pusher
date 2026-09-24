import React, { useState } from 'react';
import { Button, Card, Form, Input, Typography } from 'antd';
import { API, showError, showSuccess } from '../../helpers';

const AddUser = () => {
  const originInputs = {
    username: '',
    display_name: '',
    password: '',
  };
  const [inputs, setInputs] = useState(originInputs);
  const { username, display_name, password } = inputs;

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };

  const submit = async () => {
    if (inputs.username === '' || inputs.password === '') return;
    const res = await API.post(`/api/user/`, inputs);
    const { success, message } = res.data;
    if (success) {
      showSuccess('用户账户创建成功！');
      setInputs(originInputs);
    } else {
      showError(message);
    }
  };

  return (
    <>
      <Card>
        <Typography.Title level={3}>创建新用户账户</Typography.Title>
        <Form autoComplete='new-password'>
          <Form.Item label='用户名'>
            <Input
              name='username'
              placeholder={'请输入用户名'}
              onChange={handleInputChange}
              value={username}
              autoComplete='new-password'
              required
            />
          </Form.Item>
          <Form.Item label='显示名称'>
            <Input
              name='display_name'
              placeholder={'请输入显示名称'}
              onChange={handleInputChange}
              value={display_name}
              autoComplete='new-password'
            />
          </Form.Item>
          <Form.Item label='密码'>
            <Input.Password
              name='password'
              placeholder={'请输入密码'}
              onChange={handleInputChange}
              value={password}
              autoComplete='new-password'
              required
            />
          </Form.Item>
          <Button htmlType='submit' onClick={submit}>
            提交
          </Button>
        </Form>
      </Card>
    </>
  );
};

export default AddUser;
