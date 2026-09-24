import React from 'react';
import { Alert, Typography } from 'antd';

const NotFound = () => (
  <>
    <Typography.Title level={4}>404</Typography.Title>
    <Alert type='info' showIcon title='未找到所请求的页面' />
  </>
);

export default NotFound;
