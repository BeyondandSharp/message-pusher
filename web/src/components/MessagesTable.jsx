import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Pagination,
  Popconfirm,
  Table,
  Tag,
} from 'antd';
import { LoadingOutlined, SearchOutlined } from '@ant-design/icons';
import {
  API,
  openPage,
  showError,
  showInfo,
  showSuccess,
  showWarning,
} from '../helpers';

import { ITEMS_PER_PAGE } from '../constants';
import { renderTimestamp } from '../helpers/render';
import { Link } from 'react-router-dom';
import { marked } from 'marked';

function renderStatus(status) {
  switch (status) {
    case 1:
      return (
        <Tag variant='outlined' color='lime'>
          正在发送
        </Tag>
      );
    case 2:
      return (
        <Tag variant='outlined' color='green'>
          发送成功
        </Tag>
      );
    case 3:
      return (
        <Tag variant='outlined' color='red'>
          发送失败
        </Tag>
      );
    case 4:
      return (
        <Tag variant='outlined' color='orange'>
          已在队列
        </Tag>
      );
    default:
      return (
        <Tag variant='outlined' color='default'>
          未知状态
        </Tag>
      );
  }
}

const MessagesTable = () => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(10);
  const autoRefreshSecondsRef = useRef(autoRefreshSeconds);
  const [activePage, setActivePage] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState({
    title: '消息标题',
    description: '消息描述',
    content: '消息内容',
    link: '',
  }); // Message to be viewed
  const [viewModalOpen, setViewModalOpen] = useState(false);

  const loadMessages = async (startIdx) => {
    setLoading(true);
    const res = await API.get(`/api/message/?p=${startIdx}`);
    const { success, message, data } = res.data;
    if (success) {
      if (startIdx === 0) {
        setMessages(data);
      } else {
        let newMessages = messages;
        newMessages.push(...data);
        setMessages(newMessages);
      }
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const onPaginationChange = (page) => {
    (async () => {
      if (page === Math.ceil(messages.length / ITEMS_PER_PAGE) + 1) {
        // In this case we have to load more data and then append them.
        await loadMessages(page - 1);
      }
      setActivePage(page);
    })();
  };

  const checkPermission = async () => {
    // Check global permission
    let res = await API.get('/api/status');
    const { success, data } = res.data;
    if (success) {
      if (data.message_persistence) {
        return;
      }
    }
    // Check user permission
    {
      let res = await API.get('/api/user/self');
      const { success, message, data } = res.data;
      if (success) {
        if (data.save_message_to_database !== 1) {
          showWarning('您没有消息持久化的权限，消息未保存，请联系管理员。');
        }
      } else {
        showError(message);
      }
    }
  };

  useEffect(() => {
    loadMessages(0)
      .then()
      .catch((reason) => {
        showError(reason);
      });
    checkPermission().then();
    const connectEventSource = () => {
      const eventSource = new EventSource('/api/message/stream');
      eventSource.onmessage = (e) => {
        const newMessage = JSON.parse(e.data);
        insertNewMessage(newMessage);
      };
      eventSource.onerror = () => {
        showError('服务端消息推送流连接出错！即将重试...');
        eventSource.close();
        setTimeout(connectEventSource, 1000); // 1000ms
      };
      return eventSource;
    };
    const eventSource = connectEventSource();
    showInfo('服务器消息推送流已连接，您将实时收到新消息');
    return () => {
      eventSource.close();
    };
  }, []);

  const viewMessage = async (id) => {
    setLoading(true);
    const res = await API.get(`/api/message/${id}`);
    const { success, message, data } = res.data;
    if (success) {
      setMessage(data);
      setViewModalOpen(true);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const resendMessage = async (id) => {
    setLoading(true);
    const res = await API.post(`/api/message/resend/${id}`);
    const { success, message } = res.data;
    if (success) {
      showSuccess('消息已重新发送！');
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const deleteMessage = async (id, record) => {
    setLoading(true);
    const res = await API.delete(`/api/message/${id}`);
    const { success, message } = res.data;
    if (success) {
      showSuccess('操作成功完成！');
      let newMessages = [...messages];
      record.deleted = true;
      setMessages(newMessages);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const searchMessages = async () => {
    if (searchKeyword === '') {
      // if keyword is blank, load files instead.
      await loadMessages(0);
      setActivePage(1);
      return;
    }
    setSearching(true);
    const res = await API.get(`/api/message/search?keyword=${searchKeyword}`);
    const { success, message, data } = res.data;
    if (success) {
      setMessages(data);
      setActivePage(1);
    } else {
      showError(message);
    }
    setSearching(false);
  };

  const handleKeywordChange = async (e) => {
    setSearchKeyword(e.target.value.trim());
  };

  const sortMessage = (key) => {
    if (messages.length === 0) return;
    setLoading(true);
    let sortedMessages = [...messages];
    sortedMessages.sort((a, b) => {
      return ('' + a[key]).localeCompare(b[key]);
    });
    if (sortedMessages[0].id === messages[0].id) {
      sortedMessages.reverse();
    }
    setMessages(sortedMessages);
    setLoading(false);
  };

  const insertNewMessage = (message) => {
    console.log(messages);
    setMessages((messages) => {
      let newMessages = [message];
      newMessages.push(...messages);
      return newMessages;
    });
    setActivePage(1);
  };

  const refresh = async () => {
    await loadMessages(0);
    setActivePage(1);
  };

  useEffect(() => {
    let intervalId;

    if (autoRefresh) {
      intervalId = setInterval(() => {
        if (autoRefreshSecondsRef.current === 0) {
          refresh().then();
          setAutoRefreshSeconds(10);
          autoRefreshSecondsRef.current = 10;
        } else {
          autoRefreshSecondsRef.current -= 1;
          setAutoRefreshSeconds((autoRefreshSeconds) => autoRefreshSeconds - 1); // Important!
        }
      }, 1000);
    }

    return () => clearInterval(intervalId);
  }, [autoRefresh]);

  const columns = [
    {
      title: '消息 ID',
      dataIndex: 'id',
      key: 'id',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortMessage('id');
        },
      }),
      render: (id) => '#' + id,
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortMessage('title');
        },
      }),
      render: (title) => (title ? title : '无标题'),
    },
    {
      title: '通道',
      dataIndex: 'channel',
      key: 'channel',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortMessage('channel');
        },
      }),
      render: (channel) => <Tag>{channel}</Tag>,
    },
    {
      title: '发送时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortMessage('timestamp');
        },
      }),
      render: (timestamp) => renderTimestamp(timestamp),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      onHeaderCell: () => ({
        style: { cursor: 'pointer' },
        onClick: () => {
          sortMessage('status');
        },
      }),
      render: (status) => renderStatus(status),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <div>
          <Button
            type='primary'
            size={'small'}
            loading={loading}
            onClick={() => {
              viewMessage(record.id).then();
            }}
          >
            查看
          </Button>
          <Link to={'/editor/' + record.id}>
            <Button type='primary' size={'small'} loading={loading}>
              编辑
            </Button>
          </Link>
          <Button
            size={'small'}
            loading={loading}
            onClick={() => {
              resendMessage(record.id).then();
            }}
          >
            重发
          </Button>
          <Popconfirm
            title='确定删除？'
            description={'删除消息 #' + record.id}
            okButtonProps={{ danger: true, loading }}
            onConfirm={() => {
              deleteMessage(record.id, record).then();
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
    Math.ceil(messages.length / ITEMS_PER_PAGE) +
    (messages.length % ITEMS_PER_PAGE === 0 ? 1 : 0);

  return (
    <>
      <Form onFinish={searchMessages}>
        <Form.Item>
          <Input
            prefix={<SearchOutlined />}
            suffix={searching ? <LoadingOutlined /> : null}
            placeholder='搜索消息的 ID，标题，描述，以及消息内容 ...'
            value={searchKeyword}
            onChange={handleKeywordChange}
          />
        </Form.Item>
      </Form>
      <Table
        columns={columns}
        dataSource={messages
          .slice((activePage - 1) * ITEMS_PER_PAGE, activePage * ITEMS_PER_PAGE)
          .filter((message) => !message.deleted)}
        rowKey='id'
        pagination={false}
        size='small'
        loading={loading}
      />
      <div
        style={{
          marginTop: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            size='small'
            loading={loading}
            onClick={() => {
              refresh().then();
            }}
          >
            手动刷新
          </Button>
          <Button
            size='small'
            loading={loading}
            onClick={() => {
              setAutoRefresh(!autoRefresh);
              setAutoRefreshSeconds(10);
            }}
          >
            {autoRefresh
              ? `自动刷新中（${autoRefreshSeconds} 秒后刷新）`
              : '自动刷新'}
          </Button>
        </div>
        <Pagination
          current={activePage}
          onChange={onPaginationChange}
          total={totalPages * ITEMS_PER_PAGE}
          pageSize={ITEMS_PER_PAGE}
          size='small'
          showSizeChanger={false}
        />
      </div>
      <Modal
        title={message.title ? message.title : '无标题'}
        open={viewModalOpen}
        onCancel={() => {
          setViewModalOpen(false);
        }}
        width={520}
        footer={
          <>
            <Button
              onClick={() => {
                if (message.URL) {
                  openPage(message.URL);
                } else {
                  openPage(`/message/${message.link}`);
                }
              }}
            >
              访问链接
            </Button>
            <Button
              onClick={() => {
                setViewModalOpen(false);
              }}
            >
              关闭
            </Button>
          </>
        }
      >
        {message.description ? (
          <p className={'quote'}>{message.description}</p>
        ) : (
          ''
        )}
        {message.content ? (
          <div
            dangerouslySetInnerHTML={{
              __html: marked.parse(message.content),
            }}
          ></div>
        ) : (
          ''
        )}
      </Modal>
    </>
  );
};

export default MessagesTable;
