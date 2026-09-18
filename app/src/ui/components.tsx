import React, { useState } from 'react';
import { Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { APQBReadout } from '../core/state';
import { PressState, colors, mono, radius, sans, shadow, spacing, type, web } from './theme';

export const Mono = ({ children, style, color }: { children: React.ReactNode; style?: object; color?: string }) => (
  <Text style={[styles.mono, color ? { color } : null, style]}>{children}</Text>
);

export const Body = ({ children, style, color }: { children: React.ReactNode; style?: object; color?: string }) => (
  <Text style={[styles.body, color ? { color } : null, style]}>{children}</Text>
);

/**
 * Uppercase only ASCII letters, so Greek symbols (η, θ) and subscripts in labels are left alone
 * (CSS text-transform would turn η into Η, which reads as "H").
 */
export const asciiUpper = (node: React.ReactNode): React.ReactNode =>
  React.Children.map(node, (c) => (typeof c === 'string' ? c.replace(/[a-z]/g, (ch) => ch.toUpperCase()) : c));

/** Small uppercase section label. */
export const Label = ({ children }: { children: React.ReactNode }) => <Text style={styles.label}>{asciiUpper(children)}</Text>;

/** Frosted panel with a soft layered shadow, like a macOS inset group. */
export const Card = ({ title, children, style, accent }: { title?: string; children: React.ReactNode; style?: ViewStyle; accent?: string }) => (
  <View style={styles.group}>
    {title ? (
      <View style={styles.groupHead}>
        <View style={[styles.groupDot, { backgroundColor: accent ?? colors.accent }]} />
        <Text style={styles.groupTitle}>{title}</Text>
      </View>
    ) : null}
    <View style={[styles.card, shadow.sm, style]}>{children}</View>
  </View>
);

export const Row = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[styles.row, style]}>{children}</View>;

export const Divider = () => <View style={styles.divider} />;

/** Push button: gradient-glow indigo for the default action, frosted white otherwise. */
export function Button({ title, onPress, kind = 'primary', small, disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; small?: boolean; disabled?: boolean }) {
  const filled = kind !== 'ghost';
  const bg = kind === 'primary' ? colors.accent : kind === 'danger' ? colors.danger : 'rgba(255,255,255,0.85)';
  const fg = filled ? colors.onAccent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed, hovered }: PressState) => [
        styles.btn,
        { backgroundColor: bg },
        filled ? styles.btnFilled : styles.btnGhost,
        kind === 'primary' && !disabled && shadow.glow,
        small && styles.btnSmall,
        hovered && !pressed && { transform: [{ translateY: -1 }] },
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.85 },
        disabled && { opacity: 0.4 },
      ]}
    >
      {filled ? <View pointerEvents="none" style={styles.btnSheen} /> : null}
      <Text style={[styles.btnText, { color: fg }, small && { fontSize: 12 }]}>{title}</Text>
    </Pressable>
  );
}

/** Pill chip; the active one is filled with the accent and glows softly. */
export function Chip({ title, active, onPress }: { title: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.chip,
        active && styles.chipActive,
        hovered && !active && styles.chipHover,
        pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] },
      ]}
    >
      <Text style={[styles.chipText, active && { color: colors.onAccent }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, style, inputStyle, onFocus, onBlur, ...props }: Omit<TextInputProps, 'style'> & { label?: string; style?: ViewStyle; inputStyle?: object }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={styles.fieldLabel}>{asciiUpper(label)}</Text> : null}
      <TextInput
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        onFocus={(e) => { setFocus(true); onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); onBlur?.(e); }}
        style={[styles.input, focus && styles.inputFocus, inputStyle]}
      />
    </View>
  );
}

/** Horizontal bar with a two-tone gradient fill. */
function GradientBar({ pct, color, color2 }: { pct: number; color: string; color2?: string }) {
  return (
    <View style={[styles.gradBar, { width: `${pct}%`, backgroundColor: color }]}>
      <View style={[styles.gradBarTop, { backgroundColor: color2 ?? colors.bar2 }]} />
    </View>
  );
}

export function Histogram({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const entries = Object.entries(counts);
  if (!entries.length) return <Body color={colors.dim}>No shots.</Body>;
  const max = Math.max(...entries.map(([, v]) => v));
  return (
    <View>
      {entries.map(([k, v]) => (
        <View key={k} style={styles.histRow}>
          <Mono style={{ width: 20 + 9 * k.length }} color={v === max ? colors.accent : colors.text}>{k}</Mono>
          <View style={styles.histTrack}>
            <GradientBar pct={(100 * v) / total} color={colors.bar} />
          </View>
          <Mono color={colors.dim} style={{ width: 96, textAlign: 'right', fontSize: 11.5 }}>{`${v}  ${((100 * v) / total).toFixed(1)}%`}</Mono>
        </View>
      ))}
    </View>
  );
}

export function ReadoutTable({ readouts }: { readouts: APQBReadout[] }) {
  const fmt = (v: number, sign = false) => (sign && v >= 0 ? '+' : '') + v.toFixed(3);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.table}>
        <Row style={styles.tableHead}>
          {['q', 'r = ⟨Z⟩', 'η = |⟨X⟩|', 'θ', 'P(1)', 'S_vn', ''].map((h, i) => (
            <Text key={h + i} style={[styles.th, { width: i === 0 ? 34 : 64 }]}>{asciiUpper(h)}</Text>
          ))}
        </Row>
        {readouts.map((ro, i) => (
          <Row key={ro.qubit} style={[styles.tr, i % 2 === 1 && styles.trAlt]}>
            <Mono style={{ width: 34 }} color={colors.dim}>{`q${ro.qubit}`}</Mono>
            <Mono style={{ width: 64 }} color={colors.accent}>{fmt(ro.r, true)}</Mono>
            <Mono style={{ width: 64 }} color={colors.accent2}>{fmt(ro.T)}</Mono>
            <Mono style={{ width: 64 }}>{fmt(ro.theta)}</Mono>
            <Mono style={{ width: 64 }}>{fmt(ro.p1)}</Mono>
            <Mono style={{ width: 64 }}>{fmt(ro.vonNeumann)}</Mono>
            <View style={{ width: 90 }}>{ro.vonNeumann > 1e-9 ? <Tag color={colors.warn}>entangled</Tag> : null}</View>
          </Row>
        ))}
      </View>
    </ScrollView>
  );
}

/** Small tinted status tag. */
export function Tag({ children, color = colors.accent }: { children: React.ReactNode; color?: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: `${color}1f`, borderColor: `${color}55` }]}>
      <Text style={[styles.tagText, { color }]}>{children}</Text>
    </View>
  );
}

export function KV({ k, v, color }: { k: string; v: string | number; color?: string }) {
  return (
    <Row style={styles.kv}>
      <Body color={colors.dim} style={{ fontSize: 13 }}>{k}</Body>
      <Mono color={color} style={{ fontWeight: '500' }}>{typeof v === 'number' ? v.toFixed(4) : v}</Mono>
    </Row>
  );
}

/** Big number with a caption; a stat tile. */
export function Stat({ label, value, color, unit }: { label: string; value: string; color?: string; unit?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{asciiUpper(label)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: mono, color: colors.text, fontSize: 12.5, lineHeight: 18 },
  body: { fontFamily: sans, color: colors.text, fontSize: 14, lineHeight: 20 },
  label: { ...type.overline, marginBottom: 5, marginTop: 10 },
  group: { marginBottom: spacing.lg },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7, marginLeft: 6 },
  groupDot: { width: 6, height: 6, borderRadius: 3 },
  groupTitle: { ...type.heading, color: colors.dim },
  card: { backgroundColor: colors.panel, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)', padding: spacing.lg - 2, ...web({ outlineStyle: 'solid', outlineWidth: 1, outlineColor: colors.border }) },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  btn: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: radius.sm + 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...web({ cursor: 'pointer', transitionProperty: 'transform, opacity, box-shadow', transitionDuration: '140ms' }) },
  btnFilled: { borderWidth: 0 },
  btnSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: '50%', backgroundColor: 'rgba(255,255,255,0.16)' },
  btnSmall: { paddingHorizontal: 11, paddingVertical: 5.5 },
  btnGhost: { borderWidth: 1, borderColor: colors.borderStrong, ...shadow.sm },
  btnText: { fontFamily: sans, fontWeight: '600', fontSize: 13, letterSpacing: -0.1 },
  chip: { paddingHorizontal: 12, paddingVertical: 5.5, borderRadius: radius.pill, backgroundColor: colors.fill, ...web({ cursor: 'pointer', transitionProperty: 'background-color, transform', transitionDuration: '120ms' }) },
  chipHover: { backgroundColor: '#dfe2ee' },
  chipActive: { backgroundColor: colors.accent, ...shadow.glow },
  chipText: { fontFamily: sans, color: colors.text, fontSize: 12.5, fontWeight: '500' },
  field: { marginBottom: spacing.sm, minWidth: 90 },
  fieldLabel: { ...type.overline, fontSize: 10, marginBottom: 4 },
  input: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: 'transparent', borderRadius: radius.sm + 1, color: colors.text, paddingHorizontal: 10, paddingVertical: 7, fontFamily: mono, fontSize: 13, ...web({ outlineStyle: 'none', transitionProperty: 'border-color, box-shadow, background-color', transitionDuration: '120ms' }) },
  inputFocus: { borderColor: colors.accent, backgroundColor: colors.panel, boxShadow: `0 0 0 3px ${colors.accentSoft}` },
  histRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
  histTrack: { flex: 1, height: 12, backgroundColor: colors.fill, borderRadius: 6, overflow: 'hidden', marginHorizontal: 8 },
  gradBar: { height: '100%', borderRadius: 6, overflow: 'hidden', ...web({ transitionProperty: 'width', transitionDuration: '300ms' }) },
  gradBarTop: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '55%', opacity: 0.75, borderRadius: 6, ...web({ maskImage: 'linear-gradient(to right, transparent, black)', WebkitMaskImage: 'linear-gradient(to right, transparent, black)' }) },
  table: { borderRadius: radius.sm, overflow: 'hidden' },
  tableHead: { paddingBottom: 6, paddingHorizontal: 6, flexWrap: 'nowrap' },
  th: { ...type.overline, fontSize: 10 },
  tr: { paddingVertical: 4, paddingHorizontal: 6, flexWrap: 'nowrap', borderRadius: 6 },
  trAlt: { backgroundColor: colors.panel2 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: radius.pill, borderWidth: 1 },
  tagText: { fontFamily: sans, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.2 },
  kv: { justifyContent: 'space-between', paddingVertical: 5, flexWrap: 'nowrap', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  stat: { flex: 1, minWidth: 90, backgroundColor: colors.panel2, borderRadius: radius.sm + 2, paddingHorizontal: 12, paddingVertical: 10 },
  statLabel: { ...type.overline, fontSize: 9.5, marginBottom: 2 },
  statValue: { fontFamily: sans, fontSize: 22, fontWeight: '700', letterSpacing: -0.6, color: colors.text, fontVariant: ['tabular-nums'] },
  statUnit: { fontFamily: sans, fontSize: 11, color: colors.dim, fontWeight: '500' },
});
