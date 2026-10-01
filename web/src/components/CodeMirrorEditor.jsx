import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { useTheme } from '../context/Theme';

// 只管排版相关的样式；配色整体交给 vscode 主题（亮/暗两套），避免两套 EditorView.theme 抢属性。
// 主题没处理活动行，这里按当前亮暗给一组协调的淡色。
const editorTheme = (dark) =>
  EditorView.theme({
    '&': {
      fontSize: '13px',
    },
    '.cm-scroller': {
      fontFamily: 'JetBrains Mono, Consolas, Menlo, monospace',
      lineHeight: '1.6',
    },
    '.cm-activeLine': { backgroundColor: dark ? '#1f2226' : '#f5f7fa' },
    '.cm-activeLineGutter': { backgroundColor: dark ? '#23262b' : '#eef1f5' },
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
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  // 必须记忆化：@uiw/react-codemirror 里有「extensions 变化就 reconfigure」的 effect，
  // 每次渲染都传新数组会不断 reconfigure，并借 onUpdate 把旧内容回灌给 onChange。
  const extensions = useMemo(
    () => [...(languageExtensions[language] || []), editorTheme(dark)],
    [language, dark],
  );
  return (
    <CodeMirror
      theme={dark ? vscodeDark : vscodeLight}
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
