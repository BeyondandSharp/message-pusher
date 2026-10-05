import { Marked, Tokenizer } from 'marked';

// 消息内容经常是一段 JSON（例如自定义通道的请求体
// 「{"content":"https://www.example.com/id","title":"NPM: Name"}」），
// 而 marked 的 GFM 裸链规则会把 URL 后面的引号、逗号、花括号一起吞进链接里
// （…/id","title":"NPM），于是「查看」弹窗里的蓝色链接带着一串 JSON 残留。
// 这里覆盖默认的 url tokenizer：只有当默认匹配里出现引号/反引号时才改用
// 更严格的匹配，只把真正的 URL 变成链接，后面的 JSON 标点留给普通文本。
const defaultUrlTokenizer = Tokenizer.prototype.url;

if (typeof defaultUrlTokenizer !== 'function') {
  throw new Error('marked 的 url tokenizer 不可用，无法安全渲染消息内容');
}

// 与 marked 默认规则保持一致的协议/前缀，但额外排除引号和反引号
const STRICT_URL = /^(?:(?:https?|ftp):\/\/|www\.)[^\s<>"'`]+/;
// marked 默认会回退的结尾标点，另补上 JSON 里常见的 } 和 ]
const TRAILING_PUNCTUATION = /[?!.,:;*_'"~)\]}]+$/;
// marked 默认回退的结尾标点里没有 } 和 ]，而它们几乎只可能是 JSON 收尾，补上
const TRAILING_JSON_CLOSERS = /[}\]]+$/;

// 用独立实例，避免污染其它页面（关于页、公告）使用的 marked 单例
const markdown = new Marked();

markdown.use({
  tokenizer: {
    url(src) {
      const token = defaultUrlTokenizer.call(this, src);
      if (!token) {
        return token;
      }
      const defaultText = token.text;
      let text;
      if (defaultText.includes('"')) {
        // 双引号只可能来自 JSON/JS 字符串分隔符，说明默认规则把 URL 后面的
        // 「","title":"NPM」一起吞了：改用严格匹配，只保留真正的 URL。
        // 单引号/撇号可能是 URL 的合法字符（如 O'Brien），不在默认匹配里特殊处理。
        const matched = STRICT_URL.exec(src);
        if (!matched) {
          return token;
        }
        text = matched[0].replace(TRAILING_PUNCTUATION, '');
      } else {
        text = defaultText.replace(TRAILING_JSON_CLOSERS, '');
      }
      // 没有可改进的地方就原样沿用 marked 的默认 token（含 href 编码等行为）
      if (text === '' || text === defaultText) {
        return token;
      }
      const href = text.startsWith('www.') ? `http://${text}` : text;
      // raw 用修剪后的文本，剩下的字符会回到文本流继续渲染，不会被丢掉
      return {
        type: 'link',
        raw: text,
        text,
        href,
        autolink: true,
        tokens: [{ type: 'text', raw: text, text }],
      };
    },
  },
});

export function renderMarkdown(content) {
  return markdown.parse(content);
}
