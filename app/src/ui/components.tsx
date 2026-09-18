import React from 'react';
import { Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { APQBReadout } from '../core/state';
import { colors, mono, radius, sans, spacing } from './theme';

export const Mono = ({ children, style, color }: { children: React.ReactNode; style?: object; color?: string }) => (
  <Text style={[styles.mono, color ? { color } : null, style]}>{children}</Text>
);

export const Body = ({ children, style, color }: { children: React.ReactNode; style?: object; color?: string }) => (
  <Text style={[styles.body, color ? { color } : null, style]}>{children}</Text>
);

export const Label = ({ children }: { children: React.ReactNode }) => <Text style={styles.label}>{children}</Text>;

/** Inset-grouped panel, like a macOS settings group. */
export const Card = ({ title, children, style }: { title?: string; children: React.ReactNode; style?: ViewStyle }) => (
  <View style={styles.group}>
    {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
    <View style={[styles.card, style]}>{children}</View>
  </View>
);

export const Row = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[styles.row, style]}>{children}</View>;

export const Divider = () => <View style={styles.divider} />;

/** macOS push button: filled blue for the default action, white bordered otherwise. */
export function Button({ title, onPress, kind = 'primary', small, disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; small?: boolean; disabled?: boolean }) {
  const filled = kind !== 'ghost';
  const bg = kind === 'primary' ? colors.accent : kind === 'danger' ? colors.danger : colors.panel;
  const fg = filled ? colors.onAccent : colors.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }, !filled && styles.btnGhost, small && styles.btnSmall]}>
      <Text style={[styles.btnText, { color: fg }, small && { fontSize: 12 }]}>{title}</Text>
    </Pressable>
  );
}

/** Segmented-control style pill. */
export function Chip({ title, active, onPress }: { title: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.7 }]}>
      <Text style={[styles.chipText, active && { color: colors.onAccent }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, style, inputStyle, ...props }: Omit<TextInputProps, 'style'> & { label?: string; style?: ViewStyle; inputStyle?: object }) {
  return (
    <View style={[styles.field, style]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.dim} autoCapitalize="none" autoCorrect={false} {...props} style={[styles.input, inputStyle]} />
    </View>
  );
}

export function Histogram({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const entries = Object.entries(counts);
  if (!entries.length) return <Body color={colors.dim}>No shots.</Body>;
  return (
    <View>
      {entries.map(([k, v]) => (
        <View key={k} style={styles.histRow}>
          <Mono style={{ width: 20 + 9 * k.length }}>{k}</Mono>
          <View style={styles.histTrack}>
            <View style={[styles.histBar, { width: `${(100 * v) / total}%` }]} />
          </View>
          <Mono color={colors.dim} style={{ width: 96, textAlign: 'right' }}>{`${v} ${((100 * v) / total).toFixed(1)}%`}</Mono>
        </View>
      ))}
    </View>
  );
}

export function ReadoutTable({ readouts }: { readouts: APQBReadout[] }) {
  const fmt = (v: number, sign = false) => (sign && v >= 0 ? '+' : '') + v.toFixed(3);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <Row style={styles.tableHead}>
          {['q', 'r = ⟨Z⟩', 'η = |⟨X⟩|', 'θ', 'P(1)', 'S_vn', ''].map((h, i) => (
            <Text key={h + i} style={[styles.th, { width: i === 0 ? 30 : 64 }]}>{h}</Text>
          ))}
        </Row>
        {readouts.map((ro, i) => (
          <Row key={ro.qubit} style={[styles.tr, i % 2 === 1 && { backgroundColor: colors.panel2 }]}>
            <Mono style={{ width: 30 }}>{`q${ro.qubit}`}</Mono>
            <Mono style={{ width: 64 }} color={colors.accent}>{fmt(ro.r, true)}</Mono>
            <Mono style={{ width: 64 }} color={colors.accent2}>{fmt(ro.T)}</Mono>
            <Mono style={{ width: 64 }}>{fmt(ro.theta)}</Mono>
            <Mono style={{ width: 64 }}>{fmt(ro.p1)}</Mono>
            <Mono style={{ width: 64 }}>{fmt(ro.vonNeumann)}</Mono>
            <Body style={{ width: 90, fontSize: 12 }} color={colors.warn}>{ro.vonNeumann > 1e-9 ? 'entangled' : ''}</Body>
          </Row>
        ))}
      </View>
    </ScrollView>
  );
}

export function KV({ k, v, color }: { k: string; v: string | number; color?: string }) {
  return (
    <Row style={styles.kv}>
      <Body color={colors.dim}>{k}</Body>
      <Mono color={color}>{typeof v === 'number' ? v.toFixed(4) : v}</Mono>
    </Row>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: mono, color: colors.text, fontSize: 12.5, lineHeight: 18 },
  body: { fontFamily: sans, color: colors.text, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: sans, color: colors.dim, fontSize: 12, marginBottom: 4, marginTop: 8 },
  group: { marginBottom: spacing.lg },
  groupTitle: { fontFamily: sans, color: colors.dim, fontSize: 13, fontWeight: '600', marginBottom: 6, marginLeft: 4 },
  card: { backgroundColor: colors.panel, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  btn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 5 },
  btnGhost: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.2)' },
  btnText: { fontFamily: sans, fontWeight: '600', fontSize: 13 },
  chip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.fill },
  chipActive: { backgroundColor: colors.accent },
  chipText: { fontFamily: sans, color: colors.text, fontSize: 12.5, fontWeight: '500' },
  field: { marginBottom: spacing.sm, minWidth: 90 },
  fieldLabel: { fontFamily: sans, color: colors.dim, fontSize: 11, marginBottom: 3 },
  input: { backgroundColor: colors.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.25)', borderRadius: radius.sm, color: colors.text, paddingHorizontal: 9, paddingVertical: 6, fontFamily: mono, fontSize: 13 },
  histRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  histTrack: { flex: 1, height: 10, backgroundColor: colors.fill, borderRadius: 5, overflow: 'hidden', marginHorizontal: 6 },
  histBar: { height: '100%', backgroundColor: colors.bar, borderRadius: 5 },
  tableHead: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingBottom: 4, flexWrap: 'nowrap' },
  th: { fontFamily: sans, color: colors.dim, fontSize: 11, fontWeight: '600' },
  tr: { paddingVertical: 2, flexWrap: 'nowrap', borderRadius: 4 },
  kv: { justifyContent: 'space-between', paddingVertical: 4, flexWrap: 'nowrap' },
});
