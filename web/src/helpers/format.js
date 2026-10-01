// 代码格式化：JSON 用精确解析，JavaScript 用 js-beautify（动态加载）。

// JSON：解析后按两空格缩进重新输出，格式错误时返回错误信息、不改动内容
export function formatJSON(text) {
  const source = text || '';
  if (!source.trim()) {
    return { ok: false, error: '内容为空' };
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  try {
    return { ok: true, value: JSON.stringify(parsed, null, 2) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// JavaScript：js-beautify 重排缩进与空白。
// 动态 import：约 110KB，只有真正点「格式化」时才下载，不进入路由 chunk。
export async function formatJavaScript(text) {
  const source = text || '';
  if (!source.trim()) {
    return { ok: false, error: '内容为空' };
  }
  try {
    const mod = await import('js-beautify');
    const beautify =
      typeof mod.default === 'function' ? mod.default : mod.default.js;
    return {
      ok: true,
      value: beautify(source, {
        indent_size: 2,
        preserve_newlines: true,
        max_preserve_newlines: 2,
        end_with_newline: false,
      }),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 按语言返回对应的格式化函数；返回 null 表示该语言暂不支持格式化（不显示按钮）
export function formatterOf(language) {
  if (language === 'json') {
    return formatJSON;
  }
  if (language === 'javascript') {
    return formatJavaScript;
  }
  return null;
}
