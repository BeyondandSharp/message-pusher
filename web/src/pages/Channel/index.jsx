import React from 'react';
import { Card, Typography } from 'antd';
import ChannelsTable from '../../components/ChannelsTable';

const Channel = () => (
  <>
    <Card>
      <Typography.Title level={3}>我的通道</Typography.Title>
      <ChannelsTable />
    </Card>
  </>
);

export default Channel;
