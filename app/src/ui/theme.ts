import { Platform, StyleSheet, TextStyle, ViewStyle } from 'react-native';

/**
 * QubitOS design tokens.
 *
 * Frosted-glass light theme: an indigo/violet accent on a soft mesh wallpaper,
 * translucent chrome (menu bar, dock, window title bars), layered soft shadows
 * instead of hard borders, and a dark glass terminal for contrast.
 */
export const colors = {
  bg: '#f4f5fa',
  panel: '#ffffff',
  panel2: '#f3f4f9',
  fill: '#e8eaf2',
  border: 'rgba(20,24,48,0.08)',
  borderStrong: 'rgba(20,24,48,0.16)',
  text: '#15172b',
  dim: '#6b7089',
  faint: '#9a9fb5',
  accent: '#5b5bf0',
  accent2: '#a855f7',
  accentSoft: 'rgba(91,91,240,0.12)',
  accentGlow: 'rgba(91,91,240,0.35)',
  teal: '#14b8a6',
  warn: '#f59e0b',
  danger: '#ef4444',
  ok: '#22c55e',
  bar: '#5b5bf0',
  bar2: '#a855f7',
  onAccent: '#ffffff',
  /** Dark glass surfaces (terminal, boot). */
  ink: '#0d0f1f',
  ink2: '#161a30',
  inkText: '#e6e8f5',
  inkDim: '#8b91b0',
};

export const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
}) as string;

/** System UI font (San Francisco on Apple platforms, Inter on the web). */
export const sans = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'Inter, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
}) as string;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 14, lg: 18, xl: 24, pill: 999 };

/** Style props that only make sense on the web (backdrop blur, cursor). */
export const web = (style: Record<string, unknown>): ViewStyle => (Platform.OS === 'web' ? (style as ViewStyle) : {});

/** Layered soft shadows. `boxShadow` is supported natively (new architecture) and on react-native-web. */
export const shadow = StyleSheet.create({
  sm: { boxShadow: '0 1px 2px rgba(20,24,48,0.06), 0 2px 8px rgba(20,24,48,0.05)' },
  md: { boxShadow: '0 2px 4px rgba(20,24,48,0.06), 0 10px 24px rgba(20,24,48,0.08)' },
  lg: { boxShadow: '0 4px 10px rgba(20,24,48,0.10), 0 24px 60px rgba(20,24,48,0.18)' },
  glow: { boxShadow: `0 6px 18px ${colors.accentGlow}` },
  inset: { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)' },
});

/** Translucent frosted surface. */
export const glass = (opacity = 0.72, blur = 24): ViewStyle => ({
  backgroundColor: `rgba(255,255,255,${opacity})`,
  borderColor: 'rgba(255,255,255,0.55)',
  ...web({ backdropFilter: `saturate(180%) blur(${blur}px)`, WebkitBackdropFilter: `saturate(180%) blur(${blur}px)` }),
});

export const type: Record<'title' | 'heading' | 'caption' | 'overline', TextStyle> = {
  title: { fontFamily: sans, fontSize: 17, fontWeight: '700', letterSpacing: -0.3, color: colors.text },
  heading: { fontFamily: sans, fontSize: 13, fontWeight: '600', letterSpacing: -0.1, color: colors.text },
  caption: { fontFamily: sans, fontSize: 11.5, color: colors.dim, lineHeight: 16 },
  overline: { fontFamily: sans, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, color: colors.faint },
};

/** Pressable state; `hovered` is only delivered on the web. */
export type PressState = { pressed: boolean; hovered?: boolean };
