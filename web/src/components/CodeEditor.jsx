import React, { Suspense, lazy, useCallback, useMemo, useRef } from 'react';
import { Button, Spin, Tooltip } from 'antd';
import { CopyOutlined, FormatPainterOutlined } from '@ant-design/icons';
import { copy, showError, showSuccess, showWarning } from '../helpers';
import { detectLanguage } from '../helpers/language';
import { formatterOf } from '../helpers/format';

// CodeMirror（含语法解析器）约 600 kB，按需加载：只有真正渲染出代码编辑框的页面才会下载它。
const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditor'));

// CodeEditor 是带行号、语法高亮和语言检测的代码编辑框，用来替换原来的 Input.TextArea。
// language 是「预期语言」，当内容为空或检测不出时作为兜底。
// 右上角的操作按钮默认隐藏，鼠标悬浮到代码框上才出现（图标形式，悬浮出注释）。
const CodeEditor = ({
  value,
  onChange,
  language,
  minHeight = 200,
  maxHeight = 640,
  placeholder,
}) => {
  const detected = useMemo(
    () => detectLanguage(value, language),
    [value, language],
  );

  // 调用方通常传内联箭头函数（每次渲染都是新引用），而 CodeMirror 的封装会把 onChange
  // 变化当成需要 reconfigure 的信号。这里固定成稳定引用，避免「reconfigure -> 回灌旧值」。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handleChange = useCallback((next) => {
    if (onChangeRef.current) {
      onChangeRef.current(next);
    }
  }, []);

  // 支持格式化的语言才显示「格式化」按钮（JSON、JavaScript）
  const formatter = formatterOf(detected);

  const handleFormat = async () => {
    if (!formatter) {
      return;
    }
    const result = await formatter(value);
    if (!result.ok) {
      showError(`格式化失败：${result.error}`);
      return;
    }
    if (onChangeRef.current) {
      onChangeRef.current(result.value);
    }
  };

  const handleCopy = async () => {
    if (await copy(value || '')) {
      showSuccess('已复制到剪贴板！');
    } else {
      showWarning('无法复制到剪贴板！');
    }
  };

  return (
    <div className='code-block'>
      <div
        style={{
          border: '1px solid var(--code-border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <Suspense
          fallback={
            <Spin
              description='正在加载代码编辑器…'
              style={{ minHeight, paddingTop: minHeight / 2 - 24 }}
            />
          }
        >
          <CodeMirrorEditor
            value={value}
            onChange={handleChange}
            language={detected}
            minHeight={minHeight}
            maxHeight={maxHeight}
            placeholder={placeholder}
          />
        </Suspense>
      </div>
      <div className='code-actions'>
        {formatter ? (
          <Tooltip title='格式化'>
            <Button
              size='small'
              icon={<FormatPainterOutlined />}
              onClick={handleFormat}
              aria-label='格式化'
            />
          </Tooltip>
        ) : null}
        <Tooltip title='复制'>
          <Button
            size='small'
            icon={<CopyOutlined />}
            onClick={handleCopy}
            aria-label='复制'
          />
        </Tooltip>
      </div>
    </div>
  );
};

export default CodeEditor;
