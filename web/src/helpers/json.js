// JSON 文本处理：格式化（缩进美化）与压缩（去掉空白）。
// 返回 { ok: true, value } 或 { ok: false, error }，调用方好把错误信息显示出来。
export function formatJSON(text, { minify = false, indent = 2 } = {}) {
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
    return {
      ok: true,
      value: minify
        ? JSON.stringify(parsed)
        : JSON.stringify(parsed, null, indent),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
