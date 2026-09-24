import React, { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Form, Input, Select, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { API, showError, showSuccess } from '../../helpers';
import { loadUser, loadUserChannels } from '../../helpers/loader';
import FormGroup from '../../components/FormGroup';

const JSON_MSG_TYPE_OPTIONS = [
  { label: '消息卡片 interactive', value: 'interactive' },
  { label: '富文本 post', value: 'post' },
  { label: '图片 image', value: 'image' },
  { label: '群名片 share_chat', value: 'share_chat' },
  { label: '个人名片 share_user', value: 'share_user' },
  { label: '语音 audio', value: 'audio' },
  { label: '视频 media', value: 'media' },
  { label: '文件 file', value: 'file' },
  { label: '表情包 sticker', value: 'sticker' },
];

const EditMessage = () => {
  const params = useParams();
  const messageId = params.id;
  const isEditing = messageId !== undefined;
  let [user, setUser] = useState({
    id: '',
    username: '',
    channel: '',
    token: '',
  });
  let [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(isEditing);
  const [jsonMode, setJsonMode] = useState(false);
  const originInputs = {
    title: '',
    description: '',
    content: '',
    url: '',
    channel: localStorage.getItem('editor_channel') || '',
    to: '',
    async: false,
    msg_type: '',
  };

  const [inputs, setInputs] = useState(originInputs);
  const { title, description, content, url, channel, to, async } = inputs;

  const setInputValue = (name, value) => {
    setInputs((inputs) => ({ ...inputs, [name]: value }));
    if (name === 'channel') {
      localStorage.setItem('editor_channel', value);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setInputValue(name, value);
  };

  const handleJsonModeChange = (checked) => {
    setJsonMode(checked);
    setInputValue('msg_type', checked ? inputs.msg_type || 'interactive' : '');
  };

  const loadMessage = async () => {
    let res = await API.get(`/api/message/${messageId}`);
    const { success, message, data } = res.data;
    if (success) {
      data.id = 0;
      setInputs(data);
      setJsonMode(!!data.msg_type);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isEditing) {
      loadMessage().then();
    }
    const loader = async () => {
      let user = await loadUser();
      if (user) {
        setUser(user);
      }
      let channels = await loadUserChannels();
      if (channels) {
        setChannels(channels);
      }
    };
    loader().then();
  }, []);

  const send = async () => {
    if (!description && !content) return;
    let msgContent = content;
    if (jsonMode) {
      msgContent = (content || '').trim();
      if (msgContent === '') {
        showError('JSON 内容不能为空！');
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(msgContent);
      } catch (e) {
        showError('JSON 解析失败：' + e.message);
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        showError('JSON 内容必须是一个对象，例如 {"image_key":"img_xxx"}');
        return;
      }
    }
    let res = await API.post(`/push/${user.username}/`, {
      ...inputs,
      content: msgContent,
      token: user.token,
    });
    const { success, message } = res.data;
    if (success) {
      if (isEditing) {
        showSuccess('消息重发成功！');
      } else {
        showSuccess('消息发送成功！');
        setInputs(originInputs);
        setJsonMode(false);
      }
    } else {
      showError(message);
    }
  };

  return (
    <>
      <Card loading={loading}>
        <Typography.Title level={3}>消息编辑</Typography.Title>
        <Form>
          <FormGroup>
            <Form.Item label='标题'>
              <Input
                placeholder='请输入消息标题'
                value={inputs.title}
                name='title'
                onChange={handleInputChange}
              />
            </Form.Item>
            <Form.Item label='接收者'>
              <Input
                placeholder='请输入接收者，不填使用默认接收者'
                value={inputs.to}
                name='to'
                onChange={handleInputChange}
              />
            </Form.Item>
            <Form.Item label='推送方式'>
              <Select
                placeholder='请选择推送方式，否则使用默认方式'
                options={channels.map((channel) => ({
                  value: channel.value,
                  label: channel.text,
                }))}
                value={inputs.channel}
                onChange={(value) => setInputValue('channel', value)}
              />
            </Form.Item>
          </FormGroup>
          <FormGroup>
            <Form.Item label='描述'>
              <Input
                placeholder='请输入消息描述'
                value={inputs.description}
                name='description'
                onChange={handleInputChange}
              />
            </Form.Item>
          </FormGroup>
          <FormGroup>
            <Form.Item label='内容'>
              <Input.TextArea
                placeholder={
                  jsonMode
                    ? '请输入 JSON 内容，例如 {"image_key":"img_xxx"}'
                    : '请输入消息内容'
                }
                value={inputs.content}
                name='content'
                onChange={handleInputChange}
                style={{ minHeight: 200, fontFamily: 'JetBrains Mono, Consolas' }}
              />
            </Form.Item>
          </FormGroup>
          <FormGroup>
            <Form.Item>
              <Checkbox
                checked={jsonMode}
                onChange={(e) => handleJsonModeChange(e.target.checked)}
              >
                内容为 JSON（直接填写要发送的 content）
              </Checkbox>
            </Form.Item>
            {jsonMode && (
              <Form.Item label='消息类型（目前仅 lark_app 生效）'>
                <Select
                  placeholder='请选择消息类型'
                  options={JSON_MSG_TYPE_OPTIONS}
                  value={inputs.msg_type}
                  onChange={(value) => setInputValue('msg_type', value)}
                />
              </Form.Item>
            )}
          </FormGroup>
          <FormGroup>
            <Form.Item label='链接'>
              <Input
                placeholder='请输入消息链接'
                value={inputs.url}
                type={'url'}
                name='url'
                onChange={handleInputChange}
              />
            </Form.Item>
          </FormGroup>
          <Button htmlType='submit' onClick={send}>
            发送
          </Button>
          <Button
            onClick={() => {
              setInputValue('async', !async);
            }}
          >
            {async ? '异步' : '同步'}
          </Button>
        </Form>
      </Card>
    </>
  );
};

export default EditMessage;
