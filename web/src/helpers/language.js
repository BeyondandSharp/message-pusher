// 代码语言检测：供代码编辑框使用（决定语法高亮，并把检测结果显示给用户）。
export const LANGUAGE_LABELS = {
  json: 'JSON',
  javascript: 'JavaScript',
  markdown: 'Markdown',
  html: 'HTML',
  plaintext: '纯文本',
};

export const LANGUAGE_COLORS = {
  json: 'blue',
  javascript: 'gold',
  markdown: 'green',
  html: 'orange',
  plaintext: 'default',
};

// detectLanguage 尽量从内容本身判断语言，判断不出来时退回调用方给的预期语言（expected）。
export function detectLanguage(text, expected) {
  const value = (text || '').trim();
  if (!value) {
    return expected || 'plaintext';
  }
  // 1) 能完整解析成 JSON 的，就是 JSON
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      JSON.parse(value);
      return 'json';
    } catch (e) {
      // 解析失败，继续按形态判断（可能是写到一半的 JSON）
    }
  }
  // 2) 看起来像 JSON：带引号的键（如 {"title": "..."}）
  if (/^[[{][\s\S]*["'][^"']*["']\s*:/.test(value)) {
    return 'json';
  }
  // 3) HTML / XML
  if (/^<[a-zA-Z!/?]/.test(value)) {
    return 'html';
  }
  // 4) JavaScript
  if (
    /\b(function|const|let|var|return|require|import|export|=>|new)\b/.test(
      value,
    )
  ) {
    return 'javascript';
  }
  // 5) Markdown：标题 / 列表 / 引用 / 代码块 / 链接
  if (
    /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|~~~)/m.test(value) ||
    /\[[^\]]*\]\([^)]*\)/.test(value)
  ) {
    return 'markdown';
  }
  return expected || 'plaintext';
}
