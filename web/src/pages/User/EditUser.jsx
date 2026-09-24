import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { API, showError, showSuccess } from '../../helpers';

const EditUser = () => {
  const params = useParams();
  const userId = params.id;
  const [loading, setLoading] = useState(true);
  const [inputs, setInputs] = useState({
    username: '',
    display_name: '',
    password: '',
    github_id: '',
    wechat_id: '',
    email: '',
  });
  const { username, display_name, password, github_id, wechat_id, email } =
    inputs;
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };

  const loadUser = async () => {
    let res = undefined;
    if (userId) {
      res = await API.get(`/api/user/${userId}`);
    } else {
      res = await API.get(`/api/user/self`);
    }
    const { success, message, data } = res.data;
    if (success) {
      data.password = '';
      setInputs(data);
    } else {
      showError(message);
    }
    setLoading(false);
  };
  useEffect(() => {
    loadUser().then();
  }, []);

  const submit = async () => {
    let res = undefined;
    if (userId) {
      res = await API.put(`/api/user/`, { ...inputs, id: parseInt(userId) });
    } else {
      res = await API.put(`/api/user/self`, inputs);
    }
    const { success, message } = res.data;
    if (success) {
      showSuccess('用户信息更新成功！');
    } else {
      showError(message);
    }
  };

  return (
    <>
      <Card loading={loading}>
        <Typography.Title level={3}>更新用户信息</Typography.Title>
        <Form autoComplete='new-password'>
          <Form.Item label='用户名'>
            <Input
              name='username'
              placeholder={'请输入新的用户名'}
              onChange={handleInputChange}
              value={username}
              autoComplete='new-password'
            />
          </Form.Item>
          <Form.Item label='密码'>
            <Input.Password
              name='password'
              placeholder={'请输入新的密码'}
              onChange={handleInputChange}
              value={password}
              autoComplete='new-password'
            />
          </Form.Item>
          <Form.Item label='显示名称'>
            <Input
              name='display_name'
              placeholder={'请输入新的显示名称'}
              onChange={handleInputChange}
              value={display_name}
              autoComplete='new-password'
            />
          </Form.Item>
          <Form.Item label='已绑定的 GitHub 账户'>
            <Input
              name='github_id'
              value={github_id}
              autoComplete='new-password'
              placeholder='此项只读，需要用户通过个人设置页面的相关绑定按钮进行绑定，不可直接修改'
              readOnly
            />
          </Form.Item>
          <Form.Item label='已绑定的微信账户'>
            <Input
              name='wechat_id'
              value={wechat_id}
              autoComplete='new-password'
              placeholder='此项只读，需要用户通过个人设置页面的相关绑定按钮进行绑定，不可直接修改'
              readOnly
            />
          </Form.Item>
          <Form.Item label='已绑定的邮箱账户'>
            <Input
              name='email'
              value={email}
              autoComplete='new-password'
              placeholder='此项只读，需要用户通过个人设置页面的相关绑定按钮进行绑定，不可直接修改'
              readOnly
            />
          </Form.Item>
          <Button onClick={submit}>提交</Button>
        </Form>
      </Card>
    </>
  );
};

export default EditUser;
