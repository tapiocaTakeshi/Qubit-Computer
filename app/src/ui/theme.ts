import { Platform } from 'react-native';

export const colors = {
  bg: '#0b0f17',
  panel: '#121826',
  panel2: '#1a2234',
  border: '#26314a',
  text: '#e6edf7',
  dim: '#8b98b3',
  accent: '#5ee1c8',
  accent2: '#8ab4ff',
  warn: '#ffb86b',
  danger: '#ff6b81',
  ok: '#7ee787',
  bar: '#5ee1c8',
  bar2: '#8ab4ff',
};

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
