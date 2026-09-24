import React from 'react';
import { Spin } from 'antd';

const Loading = ({ prompt: name = 'page' }) => {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <Spin size='large' />
      <div style={{ marginTop: 12, color: 'rgba(0, 0, 0, 0.45)' }}>
        加载 {name} 中...
      </div>
    </div>
  );
};

export default Loading;
