import React, { Suspense, lazy, useCallback, useMemo, useRef } from 'react';
import { Button, Space, Spin, Tag } from 'antd';
import { showError } from '../helpers';
import {
  detectLanguage,
  LANGUAGE_COLORS,
  LANGUAGE_LABELS,
} from '../helpers/language';
import { formatJSON } from '../helpers/json';

// CodeMirror（含语法解析器）约 600 kB，按需加载：只有真正渲染出代码编辑框的页面才会下载它。
const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditor'));

// CodeEditor 是带行号、语法高亮和语言检测的代码编辑框，用来替换原来的 Input.TextArea。
// language 是「预期语言」，当内容为空或检测不出时作为兜底。
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
  // 变化当成需要 reconfigure 的信号。这里固定成稳定引用，只在真正输入时转发出去，
  // 避免「reconfigure -> 回灌旧值 -> 覆盖外部新值」的来回打架。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handleChange = useCallback((next) => {
    if (onChangeRef.current) {
      onChangeRef.current(next);
    }
  }, []);

  // minify 为真时压缩成一行，否则按缩进格式化
  const applyJSON = (minify) => {
    const action = minify ? '压缩' : '格式化';
    const result = formatJSON(value, { minify });
    if (!result.ok) {
      showError(`JSON ${action}失败：${result.error}`);
      return;
    }
    if (onChangeRef.current) {
      onChangeRef.current(result.value);
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <Space size={4}>
          {detected === 'json' && (
            <>
              <Button size='small' onClick={() => applyJSON(false)}>
                格式化
              </Button>
              <Button size='small' onClick={() => applyJSON(true)}>
                压缩
              </Button>
            </>
          )}
        </Space>
        <Tag color={LANGUAGE_COLORS[detected]}>
          语言检测：{LANGUAGE_LABELS[detected]}
        </Tag>
      </div>
      <div
        style={{
          border: '1px solid #d9d9d9',
          borderRadius: 6,
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
    </div>
  );
};

export default CodeEditor;
