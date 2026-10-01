import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import { initialState, reducer } from './reducer';
import { resolveMode, storeMode } from '../../helpers/theme';

// 主题上下文：mode 是用户选择的三态（light/dark/system），resolved 是实际生效的 light/dark。
export const ThemeContext = createContext({
  state: initialState,
  dispatch: () => null,
  resolved: 'light',
});

export const ThemeProvider = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  // 系统主题变化时（仅 system 模式需要）触发一次重渲染
  const [, tick] = useState(0);
  const resolved = resolveMode(state.mode);

  useEffect(() => {
    storeMode(state.mode);
  }, [state.mode]);

  useEffect(() => {
    if (!window.matchMedia) {
      return undefined;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => tick((n) => n + 1);
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    // 老浏览器
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', resolved === 'dark' ? '#1a1a1a' : '#ffffff');
    }
  }, [resolved]);

  const value = useMemo(
    () => ({ state, dispatch, resolved }),
    [state, resolved],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export function useTheme() {
  return useContext(ThemeContext);
}
