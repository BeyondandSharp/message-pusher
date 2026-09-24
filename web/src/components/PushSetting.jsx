import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Typography,
} from 'antd';
import FormGroup from './FormGroup';
import {
  API,
  generateToken,
  showError,
  showSuccess,
  testChannel,
} from '../helpers';
import { loadUser, loadUserChannels } from '../helpers/loader';

const PushSetting = () => {
  let [user, setUser] = useState({
    id: '',
    username: '',
    channel: '',
    token: '',
  });
  let [channels, setChannels] = useState([]);
  let [loading, setLoading] = useState(true);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setUser((inputs) => ({ ...inputs, [name]: value }));
  };

  useEffect(() => {
    const loader = async () => {
      let user = await loadUser();
      if (user) {
        setUser(user);
      }
      let channels = await loadUserChannels();
      if (channels) {
        setChannels(channels);
      }
      setLoading(false);
    };
    loader().then();
  }, []);

  const submit = async (which) => {
    let data = {};
    switch (which) {
      case 'general':
        data.channel = user.channel;
        data.token = user.token;
        if (data.token === '') {
          data.token = ' ';
        }
        break;
      default:
        showError(`无效的参数：${which}`);
        return;
    }
    let res = await API.put(`/api/user/self`, data);
    const { success, message } = res.data;
    if (success) {
      showSuccess('设置已更新！');
    } else {
      showError(message);
    }
  };

  return (
    <Row>
      <Col span={24}>
        <Spin spinning={loading}>
          <Form>
            <Typography.Title level={3}>通用设置</Typography.Title>
            <Alert
              type='info'
              title='注意：敏感配置信息不会发送到前端显示。另外浏览器可能会错误填充账户和密钥信息，请留意。'
            />
            <FormGroup>
              <Form.Item label='默认推送方式'>
                <Select
                  name='channel'
                  options={channels.map((channel) => ({
                    value: channel.value,
                    label: channel.text,
                  }))}
                  value={user.channel}
                  onChange={(value) =>
                    setUser((inputs) => ({ ...inputs, channel: value }))
                  }
                />
              </Form.Item>
              <Form.Item label='全局鉴权令牌'>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    placeholder='优先级高于通道维度令牌，但为了安全期间建议使用通道维度的令牌'
                    value={user.token}
                    name='token'
                    onChange={handleInputChange}
                  />
                  <Button
                    onClick={() => {
                      console.log('generate token');
                      setUser((inputs) => ({
                        ...inputs,
                        token: generateToken(16),
                      }));
                    }}
                  >
                    随机生成
                  </Button>
                </Space.Compact>
              </Form.Item>
            </FormGroup>
            <Button onClick={() => submit('general')} loading={loading}>
              保存
            </Button>
            <Button onClick={() => testChannel(user.username, user.token, '')}>
              测试
            </Button>
          </Form>
        </Spin>
      </Col>
    </Row>
  );
};

export default PushSetting;
