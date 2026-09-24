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

  // 列表请求的序号：只让最新一次请求的结果落地。
  // 否则一个先发出、后返回的旧响应会把刚删掉的行重新写回列表（表现为「删了又出现」）。
  const loadSeq = useRef(0);

  const loadMessages = async (startIdx) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    const res = await API.get(`/api/message/?p=${startIdx}`);
    if (seq !== loadSeq.current) {
      // 已经有更新的请求发出，丢弃这次过期响应
      return;
    }
    setLoading(false);
    const { success, message, data } = res.data;
    if (success) {
      if (startIdx === 0) {
        setMessages(data);
      } else {
        setMessages((messages) => {
          // 翻页追加时同样按 id 去重：列表在两次请求之间可能已经变化
          const known = new Set(messages.map((m) => m.id));
          return [...messages, ...data.filter((m) => !known.has(m.id))];
        });
      }
    } else {
      showError(message);
    }
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

    // 消息推送流（SSE）。这里有两个必须处理好的点：
    // 1. 重连要退避。固定 1 秒重连会在服务端限流（429，默认 60 次/3 分钟）时把限流窗口一直占满，
    //    导致此后所有请求都返回 429，而且永远恢复不了（表现为「请求次数过多」刷屏）。
    // 2. 卸载时要清掉待触发的定时器，否则离开本页会留下一个永不停止的重连循环。
    let eventSource = null;
    let retryTimer = null;
    let retryDelay = 1000;
    let retryNotified = false;
    let closed = false;

    const connectEventSource = () => {
      if (closed) return;
      eventSource = new EventSource('/api/message/stream');
      eventSource.onopen = () => {
        retryDelay = 1000;
        retryNotified = false;
      };
      eventSource.onmessage = (e) => {
        const newMessage = JSON.parse(e.data);
        insertNewMessage(newMessage);
      };
      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
        }
        if (closed) return;
        if (!retryNotified) {
          retryNotified = true;
          showWarning('消息推送流连接中断，正在重连（最长 60 秒一次）...');
        }
        console.warn(`消息推送流断开，${retryDelay / 1000} 秒后重连`);
        retryTimer = setTimeout(connectEventSource, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60000);
      };
    };

    connectEventSource();
    showInfo('服务器消息推送流已连接，您将实时收到新消息');
    return () => {
      closed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (eventSource) {
        eventSource.close();
      }
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

  const deleteMessage = async (id) => {
    setLoading(true);
    const res = await API.delete(`/api/message/${id}`);
    const { success, message } = res.data;
    if (success) {
      showSuccess('操作成功完成！');
      // 按 id 直接过滤，而不是给行对象打 deleted 标记 —— 标记会在列表刷新时丢失
      setMessages((messages) => messages.filter((m) => m.id !== id));
      // 再从服务端拉一次作为权威数据：同时让进行中的旧请求因序号过期而被丢弃
      await loadMessages(0);
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
    setMessages((messages) => {
      // 同一条消息既可能由 SSE 推来、又可能被列表接口拉到（SSE 推送是 goroutine，
      // 可能晚于列表刷新），按 id 去重，否则列表里会出现两行、删掉一行另一行还在。
      const idx = messages.findIndex((m) => m.id === message.id);
      if (idx >= 0) {
        const next = [...messages];
        next[idx] = message;
        return next;
      }
      return [message, ...messages];
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
              deleteMessage(record.id).then();
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
