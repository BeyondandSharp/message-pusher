import React, { Suspense, lazy, useMemo } from 'react';
import { Spin, Tag } from 'antd';
import {
  detectLanguage,
  LANGUAGE_COLORS,
  LANGUAGE_LABELS,
} from '../helpers/language';

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
  return (
    <div>
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
            onChange={onChange}
            language={detected}
            minHeight={minHeight}
            maxHeight={maxHeight}
            placeholder={placeholder}
          />
        </Suspense>
      </div>
      <div style={{ marginTop: 4, textAlign: 'right' }}>
        <Tag color={LANGUAGE_COLORS[detected]}>
          语言检测：{LANGUAGE_LABELS[detected]}
        </Tag>
      </div>
    </div>
  );
};

export default CodeEditor;
