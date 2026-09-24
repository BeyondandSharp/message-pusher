import React, { useEffect, useState } from 'react';
import {
  Button,
  Dropdown,
  Form,
  Input,
  Pagination,
  Popconfirm,
  Table,
  Tag,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { API, showError, showSuccess } from '../helpers';

import { ITEMS_PER_PAGE } from '../constants';

function renderRole(role) {
  switch (role) {
    case 1:
      return <Tag>普通用户</Tag>;
    case 10:
      return <Tag color='yellow'>管理员</Tag>;
    case 100:
      return <Tag color='orange'>超级管理员</Tag>;
    default:
      return <Tag color='red'>未知身份</Tag>;
  }
}

const UsersTable = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searching, setSearching] = useState(false);

  const loadUsers = async (startIdx) => {
    const res = await API.get(`/api/user/?p=${startIdx}`);
    const { success, message, data } = res.data;
    if (success) {
      if (startIdx === 0) {
        setUsers(data);
      } else {
        let newUsers = users;
        newUsers.push(...data);
        setUsers(newUsers);
      }
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const onPaginationChange = (page) => {
    (async () => {
      if (page === Math.ceil(users.length / ITEMS_PER_PAGE) + 1) {
        // In this case we have to load more data and then append them.
        await loadUsers(page - 1);
      }
      setActivePage(page);
    })();
  };

  useEffect(() => {
    loadUsers(0)
      .then()
      .catch((reason) => {
        showError(reason);
      });
  }, []);

  const manageUser = (username, action, user) => {
    (async () => {
      const res = await API.post('/api/user/manage', {
        username,
        action,
      });
      const { success, message } = res.data;
      if (success) {
        showSuccess('操作成功完成！');
        let newUser = res.data.data;
        let newUsers = [...users];
        if (action === 'delete') {
          user.deleted = true;
        } else {
          user.status = newUser.status;
          user.role = newUser.role;
          user.send_email_to_others = newUser.send_email_to_others;
          user.save_message_to_database = newUser.save_message_to_database;
        }
        setUsers(newUsers);
      } else {
        showError(message);
      }
    })();
  };

  const renderStatus = (status) => {
    switch (status) {
      case 1:
        return <Tag variant='outlined'>已激活</Tag>;
      case 2:
        return (
          <Tag variant='outlined' color='red'>
            已封禁
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

  const searchUsers = async () => {
    if (searchKeyword === '') {
      // if keyword is blank, load files instead.
      await loadUsers(0);
      setActivePage(1);
      return;
    }
    setSearching(true);
    const res = await API.get(`/api/user/search?keyword=${searchKeyword}`);
    const { success, message, data } = res.data;
    if (success) {
      setUsers(data);
      setActivePage(1);
    } else {
      showError(message);
    }
    setSearching(false);
  };

  const handleKeywordChange = async (e) => {
    setSearchKeyword(e.target.value.trim());
  };

  const sortUser = (key) => {
    if (users.length === 0) return;
    setLoading(true);
    let sortedUsers = [...users];
    sortedUsers.sort((a, b) => {
      return ('' + a[key]).localeCompare(b[key]);
    });
    if (sortedUsers[0].id === users[0].id) {
      sortedUsers.reverse();
    }
    setUsers(sortedUsers);
    setLoading(false);
  };

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortUser('username');
        },
      }),
    },
    {
      title: '显示名称',
      dataIndex: 'display_name',
      key: 'display_name',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortUser('display_name');
        },
      }),
    },
    {
      title: '邮箱地址',
      dataIndex: 'email',
      key: 'email',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortUser('email');
        },
      }),
      render: (email) => (email ? email : '无'),
    },
    {
      title: '用户角色',
      dataIndex: 'role',
      key: 'role',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortUser('role');
        },
      }),
      render: (role) => renderRole(role),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortUser('status');
        },
      }),
      render: (status) => renderStatus(status),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, user) => (
        <div>
          <Button
            type='primary'
            size={'small'}
            onClick={() => {
              manageUser(user.username, 'promote', user);
            }}
          >
            提升
          </Button>
          <Button
            size={'small'}
            onClick={() => {
              manageUser(user.username, 'demote', user);
            }}
          >
            降级
          </Button>
          <Popconfirm
            title='确定删除？'
            description={'删除账户 ' + user.username}
            onConfirm={() => {
              manageUser(user.username, 'delete', user);
            }}
          >
            <Button size={'small'} danger>
              删除
            </Button>
          </Popconfirm>
          <Button
            size={'small'}
            onClick={() => {
              manageUser(
                user.username,
                user.status === 1 ? 'disable' : 'enable',
                user
              );
            }}
          >
            {user.status === 1 ? '禁用' : '启用'}
          </Button>
          <Link to={'/user/edit/' + user.id}>
            <Button size={'small'}>编辑</Button>
          </Link>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'send_email_to_others',
                  label:
                    user.send_email_to_others === 1
                      ? '撤回发送任意邮件的权限'
                      : '授予发送任意邮件的权限',
                },
                {
                  key: 'save_message_to_database',
                  label:
                    user.save_message_to_database === 1
                      ? '撤回消息持久化的权限'
                      : '授予消息持久化的权限',
                },
              ],
              onClick: ({ key }) => {
                if (key === 'send_email_to_others') {
                  manageUser(
                    user.username,
                    user.send_email_to_others === 1
                      ? 'disallow_send_email_to_others'
                      : 'allow_send_email_to_others',
                    user
                  );
                } else if (key === 'save_message_to_database') {
                  manageUser(
                    user.username,
                    user.save_message_to_database === 1
                      ? 'disallow_save_message_to_database'
                      : 'allow_save_message_to_database',
                    user
                  );
                }
              },
            }}
          >
            <Button size={'small'}>更多</Button>
          </Dropdown>
        </div>
      ),
    },
  ];

  const totalPages =
    Math.ceil(users.length / ITEMS_PER_PAGE) +
    (users.length % ITEMS_PER_PAGE === 0 ? 1 : 0);

  return (
    <>
      <Form onFinish={searchUsers}>
        <Form.Item>
          <Input
            prefix={<SearchOutlined />}
            placeholder='搜索用户的 ID，用户名，显示名称，以及邮箱地址 ...'
            value={searchKeyword}
            onChange={handleKeywordChange}
          />
        </Form.Item>
      </Form>

      <Table
        columns={columns}
        dataSource={users
          .slice(
            (activePage - 1) * ITEMS_PER_PAGE,
            activePage * ITEMS_PER_PAGE
          )
          .filter((user) => !user.deleted)}
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
        <Link to='/user/add'>
          <Button size='small' loading={loading}>
            添加新的用户
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

export default UsersTable;
