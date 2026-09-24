import { Tag } from 'antd';
import { timestamp2string } from './utils';
import React from 'react';
import { CHANNEL_OPTIONS } from '../constants';

let channelMap = undefined;

export function renderChannel(key) {
  if (channelMap === undefined) {
    channelMap = new Map();
    CHANNEL_OPTIONS.forEach((option) => {
      channelMap[option.key] = option;
    });
  }
  let channel = channelMap[key];
  if (channel) {
    return <Tag color={channel.color}>{channel.text}</Tag>;
  }
  return <Tag color='red'>未知通道</Tag>;
}

export function renderTimestamp(timestamp) {
  return <>{timestamp2string(timestamp)}</>;
}
