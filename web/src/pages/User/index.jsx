import React from 'react';
import { Card, Typography } from 'antd';
import UsersTable from '../../components/UsersTable';

const User = () => (
  <>
    <Card>
      <Typography.Title level={3}>管理用户</Typography.Title>
      <UsersTable />
    </Card>
  </>
);

export default User;
