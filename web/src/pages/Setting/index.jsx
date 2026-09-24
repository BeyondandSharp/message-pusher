import React from 'react';
import { Card, Tabs } from 'antd';
import SystemSetting from '../../components/SystemSetting';
import { isRoot } from '../../helpers';
import OtherSetting from '../../components/OtherSetting';
import PersonalSetting from '../../components/PersonalSetting';
import PushSetting from '../../components/PushSetting';

const Setting = () => {
  let items = [
    {
      key: 'personal',
      label: '个人设置',
      children: <PersonalSetting />,
    },
    {
      key: 'push',
      label: '推送设置',
      children: <PushSetting />,
    },
  ];

  if (isRoot()) {
    items.push({
      key: 'system',
      label: '系统设置',
      children: <SystemSetting />,
    });
    items.push({
      key: 'other',
      label: '其他设置',
      children: <OtherSetting />,
    });
  }

  return (
    <Card>
      <Tabs items={items} />
    </Card>
  );
};

export default Setting;
