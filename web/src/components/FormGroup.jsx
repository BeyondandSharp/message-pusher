import React from 'react';
import { Col, Row } from 'antd';

// 表单分组布局：把一组表单项按等宽列排成一行，窄屏（<768px）自动堆叠。
// 对应旧组件库的 Form.Group widths='equal'。
const FormGroup = ({ children, gutter = 16 }) => {
  const items = React.Children.toArray(children).filter(Boolean);
  const span = items.length > 0 ? Math.floor(24 / items.length) : 24;
  return (
    <Row gutter={gutter}>
      {items.map((child, index) => (
        <Col key={index} xs={24} md={span}>
          {child}
        </Col>
      ))}
    </Row>
  );
};

export default FormGroup;
