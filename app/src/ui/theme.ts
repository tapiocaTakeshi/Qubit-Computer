import { Platform } from 'react-native';

/** macOS-like light palette: system grays, white panels, hairlines, blue accent. */
export const colors = {
  bg: '#f5f5f7',
  panel: '#ffffff',
  panel2: '#f2f2f7',
  fill: '#e5e5ea',
  border: 'rgba(0,0,0,0.09)',
  text: '#1d1d1f',
  dim: '#6e6e73',
  accent: '#007aff',
  accent2: '#5856d6',
  warn: '#ff9500',
  danger: '#ff3b30',
  ok: '#34c759',
  bar: '#007aff',
  bar2: '#5856d6',
  onAccent: '#ffffff',
};

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'SF Mono, Menlo, Consolas, monospace' }) as string;
/** System UI font (San Francisco on Apple platforms). */
export const sans = Platform.select({ ios: 'System', android: 'sans-serif', default: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif' }) as string;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 6, md: 10, lg: 12 };
