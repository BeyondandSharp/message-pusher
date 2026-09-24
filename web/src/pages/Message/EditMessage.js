import React, { useEffect, useState } from 'react';
import { Button, Form, Header, Segment } from 'semantic-ui-react';
import { useParams } from 'react-router-dom';
import { API, showError, showSuccess } from '../../helpers';
import { loadUser, loadUserChannels } from '../../helpers/loader';

const JSON_MSG_TYPE_OPTIONS = [
  { key: 'interactive', text: '消息卡片 interactive', value: 'interactive' },
  { key: 'post', text: '富文本 post', value: 'post' },
  { key: 'image', text: '图片 image', value: 'image' },
  { key: 'share_chat', text: '群名片 share_chat', value: 'share_chat' },
  { key: 'share_user', text: '个人名片 share_user', value: 'share_user' },
  { key: 'audio', text: '语音 audio', value: 'audio' },
  { key: 'media', text: '视频 media', value: 'media' },
  { key: 'file', text: '文件 file', value: 'file' },
  { key: 'sticker', text: '表情包 sticker', value: 'sticker' },
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

  const handleInputChange = (e, { name, value }) => {
    setInputs((inputs) => ({ ...inputs, [name]: value }));
    if (name === "channel") {
      localStorage.setItem('editor_channel', value);
    }
  };

  const handleJsonModeChange = (checked) => {
    setJsonMode(checked);
    handleInputChange(null, {
      name: 'msg_type',
      value: checked ? inputs.msg_type || 'interactive' : '',
    });
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
      <Segment loading={loading} className={'clearing'}>
        <Header as='h3'>消息编辑</Header>
        <Form>
          <Form.Group widths='equal'>
            <Form.Input
              label='标题'
              placeholder='请输入消息标题'
              value={inputs.title}
              name='title'
              onChange={handleInputChange}
            />
            <Form.Input
              label='接收者'
              placeholder='请输入接收者，不填使用默认接收者'
              value={inputs.to}
              name='to'
              onChange={handleInputChange}
            />
            <Form.Select
              label='推送方式'
              placeholder='请选择推送方式，否则使用默认方式'
              name='channel'
              options={channels}
              value={inputs.channel}
              onChange={handleInputChange}
            />
          </Form.Group>
          <Form.Group widths='equal'>
            <Form.Input
              label='描述'
              placeholder='请输入消息描述'
              value={inputs.description}
              name='description'
              onChange={handleInputChange}
            />
          </Form.Group>
          <Form.Group widths='equal'>
            <Form.TextArea
              label='内容'
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
          </Form.Group>
          <Form.Group widths='equal'>
            <Form.Checkbox
              label='内容为 JSON（直接填写要发送的 content）'
              checked={jsonMode}
              onChange={(e, { checked }) => handleJsonModeChange(checked)}
            />
            {jsonMode && (
              <Form.Select
                label='消息类型（目前仅 lark_app 生效）'
                placeholder='请选择消息类型'
                name='msg_type'
                options={JSON_MSG_TYPE_OPTIONS}
                value={inputs.msg_type}
                onChange={handleInputChange}
              />
            )}
          </Form.Group>
          <Form.Group widths='equal'>
            <Form.Input
              label='链接'
              placeholder='请输入消息链接'
              value={inputs.url}
              type={'url'}
              name='url'
              onChange={handleInputChange}
            />
          </Form.Group>
          <Button type='submit' floated='right' onClick={send}>
            发送
          </Button>
          <Button
            floated='right'
            onClick={() => {
              handleInputChange(null, { name: 'async', value: !async });
            }}
          >
            {async ? '异步' : '同步'}
          </Button>
        </Form>
      </Segment>
    </>
  );
};

export default EditMessage;
