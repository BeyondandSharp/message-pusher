import React, { useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Pagination,
  Popconfirm,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { API, copy, showError, showSuccess, showWarning } from '../helpers';

import { ITEMS_PER_PAGE } from '../constants';
import { renderTimestamp } from '../helpers/render';

const WebhooksTable = () => {
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [user, setUser] = useState({ username: '', token: '' });

  const loadWebhooks = async (startIdx) => {
    const res = await API.get(`/api/webhook/?p=${startIdx}`);
    const { success, message, data } = res.data;
    if (success) {
      if (startIdx === 0) {
        setWebhooks(data);
      } else {
        let newWebhooks = webhooks;
        newWebhooks.push(...data);
        setWebhooks(newWebhooks);
      }
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const onPaginationChange = (page) => {
    (async () => {
      if (page === Math.ceil(webhooks.length / ITEMS_PER_PAGE) + 1) {
        // In this case we have to load more data and then append them.
        await loadWebhooks(page - 1);
      }
      setActivePage(page);
    })();
  };

  useEffect(() => {
    loadWebhooks(0)
      .then()
      .catch((reason) => {
        showError(reason);
      });
    loadUser()
      .then()
      .catch((reason) => {
        showError(reason);
      });
  }, []);

  const manageWebhook = async (id, action) => {
    let data = { id };
    let res;
    switch (action) {
      case 'delete':
        res = await API.delete(`/api/webhook/${id}/`);
        break;
      case 'enable':
        data.status = 1;
        res = await API.put('/api/webhook/?status_only=true', data);
        break;
      case 'disable':
        data.status = 2;
        res = await API.put('/api/webhook/?status_only=true', data);
        break;
    }
    const { success, message } = res.data;
    if (success) {
      showSuccess('操作成功完成！');
      let webhook = res.data.data;
      let newWebhooks = [...webhooks];
      let realIdx = newWebhooks.findIndex((item) => item.id === id);
      if (action === 'delete') {
        newWebhooks[realIdx].deleted = true;
      } else {
        newWebhooks[realIdx].status = webhook.status;
      }
      setWebhooks(newWebhooks);
    } else {
      showError(message);
    }
  };

  const renderStatus = (status) => {
    switch (status) {
      case 1:
        return <Tag variant='outlined'>已启用</Tag>;
      case 2:
        return (
          <Tag variant='outlined' color='red'>
            已禁用
          </Tag>
        );
      default:
        return (
          <Tag variant='outlined' color='default'>
            未知状态
          </Tag>
        );
    }
  };

  const searchWebhooks = async () => {
    if (searchKeyword === '') {
      // if keyword is blank, load files instead.
      await loadWebhooks(0);
      setActivePage(1);
      return;
    }
    setSearching(true);
    const res = await API.get(`/api/webhook/search?keyword=${searchKeyword}`);
    const { success, message, data } = res.data;
    if (success) {
      setWebhooks(data);
      setActivePage(1);
    } else {
      showError(message);
    }
    setSearching(false);
  };

  const handleKeywordChange = async (e) => {
    setSearchKeyword(e.target.value.trim());
  };

  const sortWebhook = (key) => {
    if (webhooks.length === 0) return;
    setLoading(true);
    let sortedWebhooks = [...webhooks];
    sortedWebhooks.sort((a, b) => {
      return ('' + a[key]).localeCompare(b[key]);
    });
    if (sortedWebhooks[0].id === webhooks[0].id) {
      sortedWebhooks.reverse();
    }
    setWebhooks(sortedWebhooks);
    setLoading(false);
  };

  const loadUser = async () => {
    let res = await API.get(`/api/user/self`);
    const { success, message, data } = res.data;
    if (success) {
      setUser(data);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortWebhook('id');
        },
      }),
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortWebhook('name');
        },
      }),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortWebhook('status');
        },
      }),
      render: (status) => renderStatus(status),
    },
    {
      title: '通道',
      dataIndex: 'channel',
      key: 'channel',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortWebhook('channel');
        },
      }),
      render: (channel) => <Tag>{channel ? channel : '默认通道'}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_time',
      key: 'created_time',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortWebhook('created_time');
        },
      }),
      render: (created_time) => renderTimestamp(created_time),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, webhook) => {
        const webhookUrl = `${window.location.origin}/webhook/${webhook.link}`;
        return (
          <div>
            <Tooltip title={webhookUrl}>
              <Button
                size={'small'}
                type='primary'
                onClick={async () => {
                  if (await copy(webhookUrl)) {
                    showSuccess('已复制到剪贴板！');
                  } else {
                    showWarning('无法复制到剪贴板！');
                  }
                }}
              >
                复制 Webhook 链接
              </Button>
            </Tooltip>
            <Button
              size={'small'}
              onClick={() => {
                manageWebhook(
                  webhook.id,
                  webhook.status === 1 ? 'disable' : 'enable'
                ).then();
              }}
            >
              {webhook.status === 1 ? '禁用' : '启用'}
            </Button>
            <Link to={'/webhook/edit/' + webhook.id}>
              <Button type='primary' size={'small'}>
                编辑
              </Button>
            </Link>
            <Popconfirm
              title='确定删除？'
              description={'删除 ' + webhook.name}
              onConfirm={() => {
                manageWebhook(webhook.id, 'delete').then();
              }}
            >
              <Button size={'small'} danger>
                删除
              </Button>
            </Popconfirm>
          </div>
        );
      },
    },
  ];

  const totalPages =
    Math.ceil(webhooks.length / ITEMS_PER_PAGE) +
    (webhooks.length % ITEMS_PER_PAGE === 0 ? 1 : 0);

  return (
    <>
      <Form onFinish={searchWebhooks}>
        <Form.Item>
          <Input
            prefix={<SearchOutlined />}
            placeholder='搜索接口的 ID，链接或名称 ...'
            value={searchKeyword}
            onChange={handleKeywordChange}
          />
        </Form.Item>
      </Form>

      <Table
        columns={columns}
        dataSource={webhooks
          .slice((activePage - 1) * ITEMS_PER_PAGE, activePage * ITEMS_PER_PAGE)
          .filter((webhook) => !webhook.deleted)}
        rowKey='id'
        pagination={false}
        size='small'
      />

      <div
        style={{
          marginTop: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Link to='/webhook/add'>
          <Button size='small' loading={loading}>
            添加新的接口
          </Button>
        </Link>
        <Pagination
          current={activePage}
          onChange={onPaginationChange}
          total={totalPages * ITEMS_PER_PAGE}
          pageSize={ITEMS_PER_PAGE}
          size='small'
          showSizeChanger={false}
        />
      </div>
    </>
  );
};

export default WebhooksTable;
