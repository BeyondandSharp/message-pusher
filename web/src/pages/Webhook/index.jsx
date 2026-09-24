import React from 'react';
import { Card, Typography } from 'antd';
import WebhooksTable from '../../components/WebhooksTable';

const Webhook = () => (
  <>
    <Card>
      <Typography.Title level={3}>我的接口</Typography.Title>
      <WebhooksTable />
    </Card>
  </>
);

export default Webhook;
