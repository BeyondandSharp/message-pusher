import React from 'react';
import { Button, Dropdown, Empty, Spin } from 'antd';
import { SortAscendingOutlined } from '@ant-design/icons';

// 移动端把表格的每一行渲染成一张卡片：主字段放头部，其余字段「标签 + 值」
// 竖排，长文本自动换行。列定义（title/dataIndex/render）完全复用桌面表格，
// 这样两个视图不会出现字段或渲染逻辑不一致。
function renderColumn(column, record, index) {
  if (!column) {
    return null;
  }
  const value = column.dataIndex ? record[column.dataIndex] : undefined;
  return column.render ? column.render(value, record, index) : value;
}

const MobileCardList = ({
  columns,
  data = [],
  rowKey = 'id',
  primaryKey,
  secondaryKey,
  actionsKey = 'action',
  loading = false,
  emptyText = '暂无数据',
}) => {
  const primaryColumn = columns.find((column) => column.key === primaryKey);
  const secondaryColumn = columns.find((column) => column.key === secondaryKey);
  const actionColumn = columns.find((column) => column.key === actionsKey);
  const fieldColumns = columns.filter(
    (column) =>
      column.key !== primaryKey &&
      column.key !== secondaryKey &&
      column.key !== actionsKey,
  );

  // 复用各表格表头上已有的排序函数：点击“排序”里的某一项等价于点击
  // 桌面表格对应表头（同一个 onClick，升降序切换逻辑保持不变）。
  const sortableColumns = columns.filter(
    (column) => typeof column.onHeaderCell === 'function',
  );
  const sortItems = sortableColumns.map((column) => ({
    key: column.key,
    label: `按${column.title}排序`,
  }));
  const handleSort = ({ key }) => {
    const column = sortableColumns.find((item) => item.key === key);
    const headerProps = column && column.onHeaderCell();
    if (headerProps && typeof headerProps.onClick === 'function') {
      headerProps.onClick();
    }
  };

  return (
    <Spin spinning={loading}>
      {sortItems.length > 0 && (
        <div className='mobile-card-toolbar'>
          <Dropdown
            trigger={['click']}
            menu={{ items: sortItems, onClick: handleSort }}
          >
            <Button size='small' icon={<SortAscendingOutlined />}>
              排序
            </Button>
          </Dropdown>
        </div>
      )}
      {data.length === 0 ? (
        <Empty
          description={emptyText}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ margin: '24px 0' }}
        />
      ) : (
        <div className='mobile-card-list'>
          {data.map((record, index) => (
            <article
              className='mobile-card'
              key={record[rowKey] !== undefined ? record[rowKey] : index}
            >
              <div className='mobile-card-header'>
                <div className='mobile-card-title'>
                  {renderColumn(primaryColumn, record, index)}
                </div>
                {secondaryColumn && (
                  <div className='mobile-card-extra'>
                    {renderColumn(secondaryColumn, record, index)}
                  </div>
                )}
              </div>
              {fieldColumns.length > 0 && (
                <dl className='mobile-card-fields'>
                  {fieldColumns.map((column) => (
                    <div className='mobile-card-field' key={column.key}>
                      <dt>{column.title}</dt>
                      <dd>{renderColumn(column, record, index)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {actionColumn && (
                <div className='mobile-card-actions'>
                  {renderColumn(actionColumn, record, index)}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </Spin>
  );
};

export default MobileCardList;
