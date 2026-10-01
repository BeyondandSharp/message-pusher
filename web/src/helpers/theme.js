// 主题模式与设计令牌的唯一来源。
//
// 模式：light | dark | system，存在 localStorage.theme，默认 system（跟随系统）。
// 令牌取值与 design-preview 里确认过的预览一致。

export const THEME_MODES = ['light', 'dark', 'system'];
export const THEME_STORAGE_KEY = 'theme';

export function readStoredMode() {
  try {
    const mode = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.includes(mode) ? mode : 'system';
  } catch (e) {
    return 'system';
  }
}

export function storeMode(mode) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch (e) {
    // localStorage 不可用（隐私模式等）时只影响持久化，不报错
  }
}

export function systemPrefersDark() {
  try {
    return !!(
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
  } catch (e) {
    return false;
  }
}

// 把三态模式解析成实际生效的 light / dark
export function resolveMode(mode) {
  if (mode === 'light' || mode === 'dark') {
    return mode;
  }
  return systemPrefersDark() ? 'dark' : 'light';
}

// 两套令牌里「算法给不出、需要我们指定」的部分
export const THEME_TOKENS = {
  light: {
    colorBgLayout: '#f5f6f8',
    colorBgContainer: '#ffffff',
    colorBorder: '#d9d9d9',
    colorBorderSecondary: '#f0f0f0',
  },
  dark: {
    colorBgLayout: '#0d0d0d',
    colorBgContainer: '#1a1a1a',
    colorBorder: '#424242',
    colorBorderSecondary: '#2e2e2e',
  },
};

// 顶栏高度（index.css 里 body 的 padding-top 与之对应）
export const HEADER_HEIGHT = 56;
