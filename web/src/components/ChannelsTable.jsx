import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Pagination, Popconfirm, Table, Tag } from 'antd';
import { LoadingOutlined, SearchOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { API, showError, showSuccess, testChannel } from '../helpers';

import { ITEMS_PER_PAGE } from '../constants';
import { renderChannel, renderTimestamp } from '../helpers/render';

const ChannelsTable = () => {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [user, setUser] = useState({ username: '', token: '' });

  const loadChannels = async (startIdx) => {
    const res = await API.get(`/api/channel/?p=${startIdx}`);
    const { success, message, data } = res.data;
    if (success) {
      if (startIdx === 0) {
        setChannels(data);
      } else {
        let newChannels = channels;
        newChannels.push(...data);
        setChannels(newChannels);
      }
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const onPaginationChange = (page) => {
    (async () => {
      if (page === Math.ceil(channels.length / ITEMS_PER_PAGE) + 1) {
        // In this case we have to load more data and then append them.
        await loadChannels(page - 1);
      }
      setActivePage(page);
    })();
  };

  useEffect(() => {
    loadChannels(0)
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

  const manageChannel = async (id, action) => {
    let data = { id };
    let res;
    switch (action) {
      case 'delete':
        res = await API.delete(`/api/channel/${id}/`);
        break;
      case 'enable':
        data.status = 1;
        res = await API.put('/api/channel/?status_only=true', data);
        break;
      case 'disable':
        data.status = 2;
        res = await API.put('/api/channel/?status_only=true', data);
        break;
    }
    const { success, message } = res.data;
    if (success) {
      showSuccess('操作成功完成！');
      let channel = res.data.data;
      let newChannels = [...channels];
      let realIdx = newChannels.findIndex((item) => item.id === id);
      if (action === 'delete') {
        newChannels[realIdx].deleted = true;
      } else {
        newChannels[realIdx].status = channel.status;
      }
      setChannels(newChannels);
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

  const searchChannels = async () => {
    if (searchKeyword === '') {
      // if keyword is blank, load files instead.
      await loadChannels(0);
      setActivePage(1);
      return;
    }
    setSearching(true);
    const res = await API.get(`/api/channel/search?keyword=${searchKeyword}`);
    const { success, message, data } = res.data;
    if (success) {
      setChannels(data);
      setActivePage(1);
    } else {
      showError(message);
    }
    setSearching(false);
  };

  const handleKeywordChange = async (e) => {
    setSearchKeyword(e.target.value.trim());
  };

  const sortChannel = (key) => {
    if (channels.length === 0) return;
    setLoading(true);
    let sortedChannels = [...channels];
    sortedChannels.sort((a, b) => {
      return ('' + a[key]).localeCompare(b[key]);
    });
    if (sortedChannels[0].id === channels[0].id) {
      sortedChannels.reverse();
    }
    setChannels(sortedChannels);
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
          sortChannel('id');
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
          sortChannel('name');
        },
      }),
    },
    {
      title: '备注',
      dataIndex: 'description',
      key: 'description',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortChannel('description');
        },
      }),
      render: (description) => (description ? description : '无备注信息'),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortChannel('type');
        },
      }),
      render: (type) => renderChannel(type),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortChannel('status');
        },
      }),
      render: (status) => renderStatus(status),
    },
    {
      title: '创建时间',
      dataIndex: 'created_time',
      key: 'created_time',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortChannel('created_time');
        },
      }),
      render: (created_time) => renderTimestamp(created_time),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, channel) => (
        <div>
          <Button
            type='primary'
            size={'small'}
            onClick={() => {
              testChannel(user.username, user.token, channel.name).then();
            }}
          >
            测试
          </Button>
          <Button
            size={'small'}
            onClick={() => {
              manageChannel(
                channel.id,
                channel.status === 1 ? 'disable' : 'enable',
              ).then();
            }}
          >
            {channel.status === 1 ? '禁用' : '启用'}
          </Button>
          <Link to={'/channel/edit/' + channel.id}>
            <Button type='primary' size={'small'}>
              编辑
            </Button>
          </Link>
          <Popconfirm
            title='确定删除？'
            description={'删除通道 ' + channel.name}
            onConfirm={() => {
              manageChannel(channel.id, 'delete').then();
            }}
          >
            <Button size={'small'} danger>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const totalPages =
    Math.ceil(channels.length / ITEMS_PER_PAGE) +
    (channels.length % ITEMS_PER_PAGE === 0 ? 1 : 0);

  return (
    <>
      <Form onFinish={searchChannels}>
        <Form.Item>
          <Input
            prefix={<SearchOutlined />}
            suffix={searching ? <LoadingOutlined /> : null}
            placeholder='搜索通道的 ID 或名称 ...'
            value={searchKeyword}
            onChange={handleKeywordChange}
          />
        </Form.Item>
      </Form>

      <Table
        columns={columns}
        dataSource={channels
          .slice((activePage - 1) * ITEMS_PER_PAGE, activePage * ITEMS_PER_PAGE)
          .filter((channel) => !channel.deleted)}
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
        <Link to='/channel/add'>
          <Button size='small' loading={loading}>
            添加新的通道
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

export default ChannelsTable;
