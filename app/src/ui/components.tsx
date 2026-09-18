import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { APQBReadout } from '../core/state';
import { colors, mono, spacing } from './theme';

export const Mono = ({ children, style, color }: { children: React.ReactNode; style?: object; color?: string }) => (
  <Text style={[styles.mono, color ? { color } : null, style]}>{children}</Text>
);

export const Label = ({ children }: { children: React.ReactNode }) => <Text style={styles.label}>{children}</Text>;

export const Card = ({ title, children, style }: { title?: string; children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[styles.card, style]}>
    {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
    {children}
  </View>
);

export const Row = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[styles.row, style]}>{children}</View>;

export function Button({ title, onPress, kind = 'primary', small, disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; small?: boolean; disabled?: boolean }) {
  const bg = kind === 'primary' ? colors.accent : kind === 'danger' ? colors.danger : colors.panel2;
  const fg = kind === 'ghost' ? colors.text : colors.bg;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }, small && styles.btnSmall, kind === 'ghost' && styles.btnGhost]}>
      <Text style={[styles.btnText, { color: fg }, small && { fontSize: 12 }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ title, active, onPress }: { title: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && { color: colors.bg }]}>{title}</Text>
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
  if (!entries.length) return <Mono color={colors.dim}>(no shots)</Mono>;
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
        <Row>
          {['q', 'r=<Z>', 'η=|<X>|', 'θ', 'P(1)', 'S_vn', ''].map((h, i) => (
            <Mono key={h + i} color={colors.dim} style={{ width: i === 0 ? 30 : 64 }}>{h}</Mono>
          ))}
        </Row>
        {readouts.map((ro) => (
          <Row key={ro.qubit}>
            <Mono style={{ width: 30 }}>{`q${ro.qubit}`}</Mono>
            <Mono style={{ width: 64 }} color={colors.accent}>{fmt(ro.r, true)}</Mono>
            <Mono style={{ width: 64 }} color={colors.accent2}>{fmt(ro.T)}</Mono>
            <Mono style={{ width: 64 }}>{fmt(ro.theta)}</Mono>
            <Mono style={{ width: 64 }}>{fmt(ro.p1)}</Mono>
            <Mono style={{ width: 64 }}>{fmt(ro.vonNeumann)}</Mono>
            <Mono style={{ width: 90 }} color={colors.warn}>{ro.vonNeumann > 1e-9 ? 'entangled' : ''}</Mono>
          </Row>
        ))}
      </View>
    </ScrollView>
  );
}

export function KV({ k, v, color }: { k: string; v: string | number; color?: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
      <Mono color={colors.dim}>{k}</Mono>
      <Mono color={color}>{typeof v === 'number' ? v.toFixed(4) : v}</Mono>
    </Row>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: mono, color: colors.text, fontSize: 13, lineHeight: 18 },
  label: { color: colors.dim, fontSize: 12, marginBottom: 4, marginTop: 4, letterSpacing: 0.5 },
  card: { backgroundColor: colors.panel, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  cardTitle: { color: colors.text, fontWeight: '700', fontSize: 15, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  btn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 6 },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnText: { fontWeight: '700', fontSize: 14 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: mono, fontSize: 12 },
  field: { marginBottom: spacing.sm, minWidth: 90 },
  fieldLabel: { color: colors.dim, fontSize: 11, marginBottom: 3 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.text, paddingHorizontal: 10, paddingVertical: 8, fontFamily: mono, fontSize: 13 },
  histRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  histTrack: { flex: 1, height: 12, backgroundColor: colors.panel2, borderRadius: 4, overflow: 'hidden', marginHorizontal: 6 },
  histBar: { height: '100%', backgroundColor: colors.bar },
});
