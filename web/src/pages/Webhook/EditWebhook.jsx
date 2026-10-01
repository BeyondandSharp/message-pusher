import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Select,
  Typography,
} from 'antd';
import { useParams } from 'react-router-dom';
import FormGroup from '../../components/FormGroup';
import CodeEditor from '../../components/CodeEditor';
import { API, showError, showSuccess, verifyJSON } from '../../helpers';
import { loadUserChannels } from '../../helpers/loader';

// 前置脚本的默认内容：演示写法，处理之后的结果与输入完全一致（浅拷贝）。
const DEFAULT_PRE_SCRIPT = `// 前置脚本：用 JavaScript 处理本次请求的 JSON，处理结果会作为「提取规则」和「构建规则」的输入。
// 需要定义 main(json) 函数：json 是请求体（对象 / 数组 / 标量），用 return 返回处理后的数据。
// 变量 __msg_send__ 控制本次是否真的发送消息：默认为 true，设为 false（或 0 / '' / null 等假值）时
// 只把结果返回给调用方、不发送消息。写在顶层或 main 里都可以。
// 下面这个默认脚本演示两件事：把 title 编辑成「【消息】+ 原 title」，
// 以及显式把 __msg_send__ 设为 true；除 title 的值以外，返回的数据结构与输入完全一致。
function main(json) {
  if (json !== null && typeof json === 'object' && !Array.isArray(json)) {
    json.title = '【消息】' + (json.title === undefined ? '' : json.title);
  }
  __msg_send__ = true;
  return json;
}`;

const EditWebhook = () => {
  const params = useParams();
  const webhookId = params.id;
  const isEditing = webhookId !== undefined;
  const [loading, setLoading] = useState(isEditing);
  const originInputs = {
    name: '',
    extract_rule: `{
  "title": "attr1",
  "description": "attr2.sub_attr",
  "content": "attr3",
  "url": "attr4"
}`,
    construct_rule:
      '{\n' +
      '  "title": "$title",\n' +
      '  "description": "描述信息：$description",\n' +
      '  "content": "内容：$content",\n' +
      '  "url": "https://example.com/$title"\n' +
      '}',
    channel: 'default',
    pre_script_enabled: false,
    pre_script: DEFAULT_PRE_SCRIPT,
  };

  const [inputs, setInputs] = useState(originInputs);
  const {
    name,
    extract_rule,
    construct_rule,
    channel,
    pre_script_enabled,
    pre_script,
  } = inputs;
  let [channels, setChannels] = useState([]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };

  // 代码编辑框直接给值，不走事件对象
  const setInputValue = (name, value) => {
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };

  const loadWebhook = async () => {
    let res = await API.get(`/api/webhook/${webhookId}`);
    const { success, message, data } = res.data;
    if (success) {
      if (data.channel === '') {
        data.channel = 'default';
      }
      if (!data.pre_script) {
        // 老数据没有前置脚本，给个默认内容方便直接改
        data.pre_script = DEFAULT_PRE_SCRIPT;
      }
      setInputs(data);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  useEffect(() => {
    const loader = async () => {
      if (isEditing) {
        loadWebhook().then();
      }
      let channels = await loadUserChannels();
      if (channels) {
        channels.unshift({
          key: 'default',
          text: '默认通道',
          value: 'default',
          description: '使用默认通道',
        });
        setChannels(channels);
      }
    };
    loader().then();
  }, []);

  const submit = async () => {
    if (!name) return;
    if (!verifyJSON(extract_rule)) {
      showError('提取规则不是合法的 JSON 格式！');
      return;
    }
    if (!verifyJSON(construct_rule)) {
      showError('构造规则不是合法的 JSON 格式！');
      return;
    }
    if (pre_script_enabled && !(pre_script || '').trim()) {
      showError('启用了前置脚本，但脚本内容为空！');
      return;
    }
    let res = undefined;
    let localInputs = { ...inputs };
    if (localInputs.channel === 'default') {
      localInputs.channel = '';
    }
    if (isEditing) {
      res = await API.put(`/api/webhook/`, {
        ...localInputs,
        id: parseInt(webhookId),
      });
    } else {
      res = await API.post(`/api/webhook`, localInputs);
    }
    const { success, message } = res.data;
    if (success) {
      if (isEditing) {
        showSuccess('接口信息更新成功！');
      } else {
        showSuccess('接口创建成功！');
        setInputs(originInputs);
      }
    } else {
      showError(message);
    }
  };

  return (
    <>
      <Card loading={loading}>
        <Typography.Title level={3}>
          {isEditing ? '更新接口配置' : '新建消息接口'}
        </Typography.Title>
        <Form layout='vertical' autoComplete='new-password'>
          <Form.Item label='名称'>
            <Input
              name='name'
              placeholder={'请输入接口名称'}
              onChange={handleInputChange}
              value={name}
              autoComplete='new-password'
            />
          </Form.Item>
          <Form.Item label='通道'>
            <Select
              options={channels.map(({ text, value }) => ({
                value,
                label: text,
              }))}
              placeholder={'请选择消息通道'}
              onChange={(value) =>
                setInputs((inputs) => ({ ...inputs, channel: value }))
              }
              value={channel}
            />
          </Form.Item>
          <Alert
            type='info'
            title={
              <>
                如果你不知道如何写提取规则和构建规则，请看
                <a
                  href='https://iamazing.cn/page/message-pusher-webhook'
                  target='_blank'
                >
                  此教程
                </a>
                。前置脚本在提取规则、构建规则之前执行，用 JavaScript
                处理请求数据，处理结果会作为后两者的输入；脚本里可以用
                __msg_send__ 变量控制本次是否发送消息（默认 true，设为 false
                则只返回结果、不发送）。
              </>
            }
          />
          <Form.Item>
            <Checkbox
              checked={pre_script_enabled}
              onChange={(e) =>
                setInputs((inputs) => ({
                  ...inputs,
                  pre_script_enabled: e.target.checked,
                }))
              }
            >
              启用前置脚本（在提取规则和构建规则之前，用 JavaScript
              处理请求数据）
            </Checkbox>
          </Form.Item>
          {pre_script_enabled && (
            <FormGroup>
              <Form.Item label='前置脚本（__msg_send__ 控制是否发送，默认 true）'>
                <CodeEditor
                  placeholder='在此输入 JavaScript：需要定义 main(json) 函数并 return 处理后的数据；把 __msg_send__ 设为 false 可跳过本次发送'
                  value={pre_script}
                  language='javascript'
                  minHeight={220}
                  onChange={(value) => setInputValue('pre_script', value)}
                />
              </Form.Item>
            </FormGroup>
          )}
          <FormGroup>
            <Form.Item label='提取规则'>
              <CodeEditor
                placeholder='在此输入提取规则，为一个 JSON，键为模板变量，值为 JSONPath 表达式'
                value={inputs.extract_rule}
                language='json'
                minHeight={200}
                onChange={(value) => setInputValue('extract_rule', value)}
              />
            </Form.Item>
          </FormGroup>
          <FormGroup>
            <Form.Item label='构建规则'>
              <CodeEditor
                placeholder='在此输入构建规则，键为 title / description / content / url；值可以引用模板变量（格式为 $VAR），也可以写成 JSON 对象或数组（例如飞书卡片），嵌套在其中的变量同样会被替换'
                value={inputs.construct_rule}
                language='json'
                minHeight={200}
                onChange={(value) => setInputValue('construct_rule', value)}
              />
            </Form.Item>
          </FormGroup>
          <Button onClick={submit}>提交</Button>
        </Form>
      </Card>
    </>
  );
};

export default EditWebhook;
