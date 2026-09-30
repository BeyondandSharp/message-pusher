import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';

// 与 antd 风格一致的浅色主题
const editorTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    backgroundColor: '#ffffff',
  },
  '.cm-scroller': {
    fontFamily: 'JetBrains Mono, Consolas, Menlo, monospace',
    lineHeight: '1.6',
  },
  '.cm-gutters': {
    backgroundColor: '#fafafa',
    color: '#8c8c8c',
    borderRight: '1px solid #f0f0f0',
  },
  '.cm-activeLine': { backgroundColor: '#f5faff' },
  '.cm-activeLineGutter': { backgroundColor: '#eaf4ff' },
  '.cm-content': { caretColor: '#1677ff' },
});

const languageExtensions = {
  json: [json()],
  javascript: [javascript()],
  markdown: [markdown()],
  html: [html()],
};

// 这个文件会被 CodeEditor 动态 import，避免 CodeMirror（约 600 kB）进入首屏。
// 改这里时注意：不要让它被任何静态引入的模块 import，否则又会回到首屏。
const CodeMirrorEditor = ({
  value,
  onChange,
  language,
  minHeight,
  maxHeight,
  placeholder,
}) => (
  <CodeMirror
    value={value || ''}
    minHeight={`${minHeight}px`}
    maxHeight={`${maxHeight}px`}
    placeholder={placeholder}
    extensions={[...(languageExtensions[language] || []), editorTheme]}
    onChange={onChange}
    basicSetup={{
      lineNumbers: true,
      foldGutter: true,
      highlightActiveLine: true,
      highlightActiveLineGutter: true,
      bracketMatching: true,
      closeBrackets: true,
      autocompletion: false,
      highlightSelectionMatches: false,
    }}
  />
);

export default CodeMirrorEditor;
