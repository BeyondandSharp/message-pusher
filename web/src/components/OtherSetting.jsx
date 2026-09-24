import React, { useEffect, useState } from 'react';
import {
  Button,
  Col,
  Divider,
  Form,
  Input,
  Modal,
  Row,
  Spin,
  Typography,
} from 'antd';
import FormGroup from './FormGroup';
import { API, showError, showSuccess } from '../helpers';
import { marked } from 'marked';

const OtherSetting = () => {
  let [inputs, setInputs] = useState({
    Footer: '',
    Notice: '',
    About: '',
    HomePageLink: '',
  });
  let [loading, setLoading] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateData, setUpdateData] = useState({
    tag_name: '',
    content: '',
  });

  const getOptions = async () => {
    const res = await API.get('/api/option/');
    const { success, message, data } = res.data;
    if (success) {
      let newInputs = {};
      data.forEach((item) => {
        if (item.key in inputs) {
          newInputs[item.key] = item.value;
        }
      });
      setInputs(newInputs);
    } else {
      showError(message);
    }
  };

  useEffect(() => {
    getOptions().then();
  }, []);

  const updateOption = async (key, value) => {
    setLoading(true);
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
    setInputs((inputs) => ({ ...inputs, [name]: value }));
  };

  const submitNotice = async () => {
    await updateOption('Notice', inputs.Notice);
  };

  const submitFooter = async () => {
    await updateOption('Footer', inputs.Footer);
  };

  const submitHomePageLink = async () => {
    await updateOption('HomePageLink', inputs.HomePageLink);
  };

  const submitAbout = async () => {
    await updateOption('About', inputs.About);
  };

  const openGitHubRelease = () => {
    window.location =
      'https://github.com/songquanpeng/message-pusher/releases/latest';
  };

  const checkUpdate = async () => {
    const res = await API.get(
      'https://api.github.com/repos/songquanpeng/message-pusher/releases/latest'
    );
    const { tag_name, body } = res.data;
    if (tag_name === import.meta.env.VITE_APP_VERSION) {
      showSuccess(`已是最新版本：${tag_name}`);
    } else {
      setUpdateData({
        tag_name: tag_name,
        content: marked.parse(body),
      });
      setShowUpdateModal(true);
    }
  };

  return (
    <Row>
      <Col span={24}>
        <Spin spinning={loading}>
          <Form>
            <Typography.Title level={3}>通用设置</Typography.Title>
            <Button htmlType='submit' onClick={checkUpdate}>
              检查更新
            </Button>
            <FormGroup>
              <Form.Item label='公告'>
                <Input.TextArea
                  placeholder='在此输入新的公告内容'
                  value={inputs.Notice}
                  name='Notice'
                  onChange={handleInputChange}
                  style={{
                    minHeight: 150,
                    fontFamily: 'JetBrains Mono, Consolas',
                  }}
                />
              </Form.Item>
            </FormGroup>
            <Button htmlType='submit' onClick={submitNotice}>
              保存公告
            </Button>
            <Divider />
            <Typography.Title level={3}>个性化设置</Typography.Title>
            <FormGroup>
              <Form.Item label='首页链接'>
                <Input
                  placeholder='在此输入首页链接，设置后将通过 iframe 方式嵌入该网页'
                  value={inputs.HomePageLink}
                  name='HomePageLink'
                  onChange={handleInputChange}
                  type='url'
                />
              </Form.Item>
            </FormGroup>
            <Button htmlType='submit' onClick={submitHomePageLink}>
              设置首页链接
            </Button>
            <FormGroup>
              <Form.Item label='关于'>
                <Input.TextArea
                  placeholder='在此输入新的关于内容，支持 Markdown & HTML 代码'
                  value={inputs.About}
                  name='About'
                  onChange={handleInputChange}
                  style={{
                    minHeight: 150,
                    fontFamily: 'JetBrains Mono, Consolas',
                  }}
                />
              </Form.Item>
            </FormGroup>
            <Button htmlType='submit' onClick={submitAbout}>
              保存关于
            </Button>
            <FormGroup>
              <Form.Item label='页脚'>
                <Input
                  placeholder='在此输入新的页脚，留空则使用默认页脚，支持 HTML 代码'
                  value={inputs.Footer}
                  name='Footer'
                  onChange={handleInputChange}
                />
              </Form.Item>
            </FormGroup>
            <Button htmlType='submit' onClick={submitFooter}>
              设置页脚
            </Button>
          </Form>
        </Spin>
      </Col>
      <Modal
        open={showUpdateModal}
        onCancel={() => setShowUpdateModal(false)}
        title={`新版本：${updateData.tag_name}`}
        footer={[
          <Button key='close' onClick={() => setShowUpdateModal(false)}>
            关闭
          </Button>,
          <Button
            key='detail'
            type='primary'
            onClick={() => {
              setShowUpdateModal(false);
              openGitHubRelease();
            }}
          >
            详情
          </Button>,
        ]}
      >
        <div dangerouslySetInnerHTML={{ __html: updateData.content }}></div>
      </Modal>
    </Row>
  );
};

export default OtherSetting;
