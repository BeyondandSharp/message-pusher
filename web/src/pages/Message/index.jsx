import React from 'react';
import { Card, Typography } from 'antd';
import MessagesTable from '../../components/MessagesTable';

const Message = () => (
  <>
    <Card>
      <Typography.Title level={3}>我的消息</Typography.Title>
      <MessagesTable />
    </Card>
  </>
);

export default Message;
