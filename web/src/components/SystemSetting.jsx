import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Col,
  Divider,
  Form,
  Input,
  Row,
  Spin,
  Typography,
} from 'antd';
import FormGroup from './FormGroup';
import { API, removeTrailingSlash, showError } from '../helpers';

const SystemSetting = () => {
  let [inputs, setInputs] = useState({
    PasswordLoginEnabled: '',
    PasswordRegisterEnabled: '',
    EmailVerificationEnabled: '',
    GitHubOAuthEnabled: '',
    GitHubClientId: '',
    GitHubClientSecret: '',
    Notice: '',
    SMTPServer: '',
    SMTPPort: '',
    SMTPAccount: '',
    SMTPToken: '',
    ServerAddress: '',
    Footer: '',
    WeChatAuthEnabled: '',
    WeChatServerAddress: '',
    WeChatServerToken: '',
    WeChatAccountQRCodeImageURL: '',
    TurnstileCheckEnabled: '',
    TurnstileSiteKey: '',
    TurnstileSecretKey: '',
    RegisterEnabled: '',
    MessagePersistenceEnabled: '',
    MessageRenderEnabled: '',
  });
  const [originInputs, setOriginInputs] = useState({});
  let [loading, setLoading] = useState(false);

  const getOptions = async () => {
    const res = await API.get('/api/option/');
    const { success, message, data } = res.data;
    if (success) {
      let newInputs = {};
      data.forEach((item) => {
        newInputs[item.key] = item.value;
      });
      setInputs(newInputs);
      setOriginInputs(newInputs);
    } else {
      showError(message);
    }
  };

  useEffect(() => {
    getOptions().then();
  }, []);

  const updateOption = async (key, value) => {
    setLoading(true);
    switch (key) {
      case 'PasswordLoginEnabled':
      case 'PasswordRegisterEnabled':
      case 'EmailVerificationEnabled':
      case 'GitHubOAuthEnabled':
      case 'WeChatAuthEnabled':
      case 'TurnstileCheckEnabled':
      case 'RegisterEnabled':
      case 'MessagePersistenceEnabled':
      case 'MessageRenderEnabled':
        value = inputs[key] === 'true' ? 'false' : 'true';
        break;
      default:
        break;
    }
    const res = await API.put('/api/option/', {
      key,
      value,
    });
    const { success, message } = res.data;
    if (success) {
      setInputs((inputs) => ({ ...inputs, [key]: value }));
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const handleInputChange = async (e) => {
    const { name, value } = e.target;
    if (
      name === 'Notice' ||
      name.startsWith('SMTP') ||
      name === 'ServerAddress' ||
      name === 'GitHubClientId' ||
      name === 'GitHubClientSecret' ||
      name === 'WeChatServerAddress' ||
      name === 'WeChatServerToken' ||
      name === 'WeChatAccountQRCodeImageURL' ||
      name === 'TurnstileSiteKey' ||
      name === 'TurnstileSecretKey'
    ) {
      setInputs((inputs) => ({ ...inputs, [name]: value }));
    } else {
      await updateOption(name, value);
    }
  };

  const submitServerAddress = async () => {
    let ServerAddress = removeTrailingSlash(inputs.ServerAddress);
    await updateOption('ServerAddress', ServerAddress);
  };

  const submitSMTP = async () => {
    if (originInputs['SMTPServer'] !== inputs.SMTPServer) {
      await updateOption('SMTPServer', inputs.SMTPServer);
    }
    if (originInputs['SMTPAccount'] !== inputs.SMTPAccount) {
      await updateOption('SMTPAccount', inputs.SMTPAccount);
    }
    if (
      originInputs['SMTPPort'] !== inputs.SMTPPort &&
      inputs.SMTPPort !== ''
    ) {
      await updateOption('SMTPPort', inputs.SMTPPort);
    }
    if (
      originInputs['SMTPToken'] !== inputs.SMTPToken &&
      inputs.SMTPToken !== ''
    ) {
      await updateOption('SMTPToken', inputs.SMTPToken);
    }
  };

  const submitWeChat = async () => {
    if (originInputs['WeChatServerAddress'] !== inputs.WeChatServerAddress) {
      await updateOption(
        'WeChatServerAddress',
        removeTrailingSlash(inputs.WeChatServerAddress)
      );
    }
    if (
      originInputs['WeChatAccountQRCodeImageURL'] !==
      inputs.WeChatAccountQRCodeImageURL
    ) {
      await updateOption(
        'WeChatAccountQRCodeImageURL',
        inputs.WeChatAccountQRCodeImageURL
      );
    }
    if (
      originInputs['WeChatServerToken'] !== inputs.WeChatServerToken &&
      inputs.WeChatServerToken !== ''
    ) {
      await updateOption('WeChatServerToken', inputs.WeChatServerToken);
    }
  };

  const submitGitHubOAuth = async () => {
    if (originInputs['GitHubClientId'] !== inputs.GitHubClientId) {
      await updateOption('GitHubClientId', inputs.GitHubClientId);
    }
    if (
      originInputs['GitHubClientSecret'] !== inputs.GitHubClientSecret &&
      inputs.GitHubClientSecret !== ''
    ) {
      await updateOption('GitHubClientSecret', inputs.GitHubClientSecret);
    }
  };

  const submitTurnstile = async () => {
    if (originInputs['TurnstileSiteKey'] !== inputs.TurnstileSiteKey) {
      await updateOption('TurnstileSiteKey', inputs.TurnstileSiteKey);
    }
    if (
      originInputs['TurnstileSecretKey'] !== inputs.TurnstileSecretKey &&
      inputs.TurnstileSecretKey !== ''
    ) {
      await updateOption('TurnstileSecretKey', inputs.TurnstileSecretKey);
    }
  };

  return (
    <Row>
      <Col span={24}>
        <Spin spinning={loading}>
          <Form>
            <Typography.Title level={3}>通用设置</Typography.Title>
            <FormGroup>
              <Form.Item label='服务器地址'>
                <Input
                  placeholder='例如：https://yourdomain.com'
                  value={inputs.ServerAddress}
                  name='ServerAddress'
                  onChange={handleInputChange}
                />
              </Form.Item>
            </FormGroup>
            <Button onClick={submitServerAddress}>更新服务器地址</Button>
            <FormGroup>
              <Form.Item>
                <Checkbox
                  checked={inputs.MessagePersistenceEnabled === 'true'}
                  name='MessagePersistenceEnabled'
                  onChange={handleInputChange}
                >
                  保存消息到数据库（此项为否时，用户推送的消息将不会保存到数据库）
                </Checkbox>
              </Form.Item>
              <Form.Item>
                <Checkbox
                  checked={inputs.MessageRenderEnabled === 'true'}
                  name='MessageRenderEnabled'
                  onChange={handleInputChange}
                >
                  允许消息渲染（此项为否时，将禁用消息渲染）
                </Checkbox>
              </Form.Item>
            </FormGroup>
            <Divider />
            <Typography.Title level={3}>配置登录注册</Typography.Title>
            <FormGroup>
              <Form.Item>
                <Checkbox
                  checked={inputs.PasswordLoginEnabled === 'true'}
                  name='PasswordLoginEnabled'
                  onChange={handleInputChange}
                >
                  允许通过密码进行登录
                </Checkbox>
              </Form.Item>
              <Form.Item>
                <Checkbox
                  checked={inputs.PasswordRegisterEnabled === 'true'}
                  name='PasswordRegisterEnabled'
                  onChange={handleInputChange}
                >
                  允许通过密码进行注册
                </Checkbox>
              </Form.Item>
              <Form.Item>
                <Checkbox
                  checked={inputs.EmailVerificationEnabled === 'true'}
                  name='EmailVerificationEnabled'
                  onChange={handleInputChange}
                >
                  通过密码注册时需要进行邮箱验证
                </Checkbox>
              </Form.Item>
              <Form.Item>
                <Checkbox
                  checked={inputs.GitHubOAuthEnabled === 'true'}
                  name='GitHubOAuthEnabled'
                  onChange={handleInputChange}
                >
                  允许通过 GitHub 账户登录 & 注册
                </Checkbox>
              </Form.Item>
              <Form.Item>
                <Checkbox
                  checked={inputs.WeChatAuthEnabled === 'true'}
                  name='WeChatAuthEnabled'
                  onChange={handleInputChange}
                >
                  允许通过微信登录 & 注册
                </Checkbox>
              </Form.Item>
            </FormGroup>
            <FormGroup>
              <Form.Item>
                <Checkbox
                  checked={inputs.RegisterEnabled === 'true'}
                  name='RegisterEnabled'
                  onChange={handleInputChange}
                >
                  允许新用户注册（此项为否时，新用户将无法以任何方式进行注册）
                </Checkbox>
              </Form.Item>
              <Form.Item>
                <Checkbox
                  checked={inputs.TurnstileCheckEnabled === 'true'}
                  name='TurnstileCheckEnabled'
                  onChange={handleInputChange}
                >
                  启用 Turnstile 用户校验
                </Checkbox>
              </Form.Item>
            </FormGroup>
            <Divider />
            <Typography.Title level={3}>配置 SMTP</Typography.Title>
            <Typography.Text type='secondary'>
              用以支持系统的邮件发送
            </Typography.Text>
            <FormGroup>
              <Form.Item label='SMTP 服务器地址'>
                <Input
                  name='SMTPServer'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.SMTPServer}
                  placeholder='例如：smtp.qq.com'
                />
              </Form.Item>
              <Form.Item label='SMTP 端口'>
                <Input
                  name='SMTPPort'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.SMTPPort}
                  placeholder='默认: 587'
                />
              </Form.Item>
              <Form.Item label='SMTP 账户'>
                <Input
                  name='SMTPAccount'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.SMTPAccount}
                  placeholder='通常是邮箱地址'
                />
              </Form.Item>
              <Form.Item label='SMTP 访问凭证'>
                <Input.Password
                  name='SMTPToken'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.SMTPToken}
                  placeholder='敏感信息不会发送到前端显示'
                />
              </Form.Item>
            </FormGroup>
            <Button onClick={submitSMTP}>保存 SMTP 设置</Button>
            <Divider />
            <Typography.Title level={3}>配置 GitHub OAuth App</Typography.Title>
            <Typography.Text type='secondary'>
              用以支持通过 GitHub 进行登录注册，
              <a href='https://github.com/settings/developers' target='_blank'>
                点击此处
              </a>
              管理你的 GitHub OAuth App
            </Typography.Text>
            <Alert
              type='info'
              title={
                <>
                  Homepage URL 填 <code>{inputs.ServerAddress}</code>
                  ，Authorization callback URL 填{' '}
                  <code>{`${inputs.ServerAddress}/oauth/github`}</code>
                </>
              }
            />
            <FormGroup>
              <Form.Item label='GitHub Client ID'>
                <Input
                  name='GitHubClientId'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.GitHubClientId}
                  placeholder='输入你注册的 GitHub OAuth APP 的 ID'
                />
              </Form.Item>
              <Form.Item label='GitHub Client Secret'>
                <Input.Password
                  name='GitHubClientSecret'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.GitHubClientSecret}
                  placeholder='敏感信息不会发送到前端显示'
                />
              </Form.Item>
            </FormGroup>
            <Button onClick={submitGitHubOAuth}>保存 GitHub OAuth 设置</Button>
            <Divider />
            <Typography.Title level={3}>配置 WeChat Server</Typography.Title>
            <Typography.Text type='secondary'>
              用以支持通过微信进行登录注册，
              <a
                href='https://github.com/songquanpeng/wechat-server'
                target='_blank'
              >
                点击此处
              </a>
              了解 WeChat Server
            </Typography.Text>
            <FormGroup>
              <Form.Item label='WeChat Server 服务器地址'>
                <Input
                  name='WeChatServerAddress'
                  placeholder='例如：https://yourdomain.com'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.WeChatServerAddress}
                />
              </Form.Item>
              <Form.Item label='WeChat Server 访问凭证'>
                <Input.Password
                  name='WeChatServerToken'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.WeChatServerToken}
                  placeholder='敏感信息不会发送到前端显示'
                />
              </Form.Item>
              <Form.Item label='微信公众号二维码图片链接'>
                <Input
                  name='WeChatAccountQRCodeImageURL'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.WeChatAccountQRCodeImageURL}
                  placeholder='输入一个图片链接'
                />
              </Form.Item>
            </FormGroup>
            <Button onClick={submitWeChat}>保存 WeChat Server 设置</Button>
            <Divider />
            <Typography.Title level={3}>配置 Turnstile</Typography.Title>
            <Typography.Text type='secondary'>
              用以支持用户校验，
              <a href='https://dash.cloudflare.com/' target='_blank'>
                点击此处
              </a>
              管理你的 Turnstile Sites，推荐选择 Invisible Widget Type
            </Typography.Text>
            <FormGroup>
              <Form.Item label='Turnstile Site Key'>
                <Input
                  name='TurnstileSiteKey'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.TurnstileSiteKey}
                  placeholder='输入你注册的 Turnstile Site Key'
                />
              </Form.Item>
              <Form.Item label='Turnstile Secret Key'>
                <Input.Password
                  name='TurnstileSecretKey'
                  onChange={handleInputChange}
                  autoComplete='new-password'
                  value={inputs.TurnstileSecretKey}
                  placeholder='敏感信息不会发送到前端显示'
                />
              </Form.Item>
            </FormGroup>
            <Button onClick={submitTurnstile}>保存 Turnstile 设置</Button>
          </Form>
        </Spin>
      </Col>
    </Row>
  );
};

export default SystemSetting;
