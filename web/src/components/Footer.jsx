import React, { useEffect, useState } from 'react';

import { Layout } from 'antd';

const Footer = () => {
  const [Footer, setFooter] = useState('');
  useEffect(() => {
    let savedFooter = localStorage.getItem('footer_html');
    if (!savedFooter) savedFooter = '';
    setFooter(savedFooter);
  });

  return (
    <Layout.Footer
      style={{ textAlign: 'center', background: 'transparent', padding: '1em' }}
    >
      {Footer === '' ? (
        <div className='custom-footer'>
          <a
            href='https://github.com/songquanpeng/message-pusher'
            target='_blank'
          >
            消息推送服务 {import.meta.env.VITE_APP_VERSION}{' '}
          </a>
          由{' '}
          <a href='https://github.com/songquanpeng' target='_blank'>
            JustSong
          </a>{' '}
          构建，源代码遵循{' '}
          <a href='https://opensource.org/licenses/mit-license.php'>MIT 协议</a>
        </div>
      ) : (
        <div
          className='custom-footer'
          dangerouslySetInnerHTML={{ __html: Footer }}
        ></div>
      )}
    </Layout.Footer>
  );
};

export default Footer;
