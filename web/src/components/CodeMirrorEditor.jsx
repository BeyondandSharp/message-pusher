import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';
import { vscodeLight } from '@uiw/codemirror-theme-vscode';

// 只管排版相关的样式；配色整体交给 vscodeLight 主题，避免两套 EditorView.theme 抢同一批属性。
// 主题没处理活动行，这里保留一个浅色下也协调的淡色背景。
const editorTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
  },
  '.cm-scroller': {
    fontFamily: 'JetBrains Mono, Consolas, Menlo, monospace',
    lineHeight: '1.6',
  },
  '.cm-activeLine': { backgroundColor: '#f5f7fa' },
  '.cm-activeLineGutter': { backgroundColor: '#eef1f5' },
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
}) => {
  // 必须记忆化：@uiw/react-codemirror 里有「extensions 变化就 reconfigure」的 effect，
  // 每次渲染都传新数组会不断 reconfigure，并借 onUpdate 把旧内容回灌给 onChange，
  // 与外部传入的新 value 互相覆盖（表现为格式化后编辑器内容不更新）。
  const extensions = useMemo(
    () => [...(languageExtensions[language] || []), editorTheme],
    [language],
  );
  return (
    <CodeMirror
      theme={vscodeLight}
      value={value || ''}
      minHeight={`${minHeight}px`}
      maxHeight={`${maxHeight}px`}
      placeholder={placeholder}
      extensions={extensions}
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
};

export default CodeMirrorEditor;
