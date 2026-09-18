/**
 * The APQB lives on the X-Z great circle of the Bloch sphere:
 * b(theta) = (sin 2theta, 0, cos 2theta). Drawn with plain Views.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, mono, sans, web } from './theme';

export function BlochCircle({ theta, size = 220, extra }: { theta: number; size?: number; extra?: Array<{ x: number; z: number; color: string; label?: string }> }) {
  const R = size / 2 - 18;
  const cx = size / 2;
  const cy = size / 2;
  const x = Math.sin(2 * theta);
  const z = Math.cos(2 * theta);
  const px = cx + R * x;
  const py = cy - R * z;
  const dots = [{ x, z, color: colors.accent, label: 'ψ(θ)' }, ...(extra ?? [])];
  const angle = Math.atan2(-z, x);
  return (
    <View style={{ width: size, height: size, alignSelf: 'center', marginVertical: 8 }}>
      {/* sphere disc with a soft radial highlight */}
      <View style={[styles.disc, { left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, borderRadius: R }]} />
      <View style={[styles.discHighlight, { left: cx - R * 0.55, top: cy - R * 0.85, width: R * 0.9, height: R * 0.5, borderRadius: R * 0.45 }]} />
      <View style={[styles.circle, { left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, borderRadius: R }]} />
      {/* inner guide ring at r = 0.5 */}
      <View style={[styles.guide, { left: cx - R / 2, top: cy - R / 2, width: R, height: R, borderRadius: R / 2 }]} />
      <View style={[styles.axis, { left: cx - R, top: cy, width: 2 * R, height: 1 }]} />
      <View style={[styles.axis, { left: cx, top: cy - R, width: 1, height: 2 * R }]} />
      <Text style={[styles.tick, { left: cx - 40, top: cy - R - 17, width: 80, textAlign: 'center' }]} numberOfLines={1}>|0⟩  r = +1</Text>
      <Text style={[styles.tick, { left: cx - 40, top: cy + R + 3, width: 80, textAlign: 'center' }]} numberOfLines={1}>|1⟩  r = −1</Text>
      <Text style={[styles.tick, { left: cx + R - 34, top: cy + 5, width: 34 }]} numberOfLines={1}>η = 1</Text>
      <Text style={[styles.tick, { left: cx - R + 4, top: cy + 5, width: 20 }]} numberOfLines={1}>−X</Text>
      {/* sweep from |0> to the state: a tinted wedge approximated by the arc chord */}
      <View style={[styles.arrowGlow, { left: cx, top: cy, width: R * Math.hypot(x, z), transform: [{ translateY: -3 }, { rotate: `${angle}rad` }] }]} />
      <View style={[styles.arrow, { left: cx, top: cy, width: R * Math.hypot(x, z), transform: [{ translateY: -1 }, { rotate: `${angle}rad` }] }]} />
      <View style={[styles.origin, { left: cx - 3, top: cy - 3 }]} />
      {dots.map((d, i) => (
        <View key={i} style={[styles.dotHalo, { left: cx + R * d.x - 11, top: cy - R * d.z - 11, backgroundColor: `${d.color}33` }]}>
          <View style={[styles.dot, { backgroundColor: d.color }]} />
        </View>
      ))}
      <View style={[styles.thetaTag, { left: Math.min(px + 12, size - 72), top: Math.max(py - 24, 0) }]}>
        <Text style={styles.thetaText}>{`θ = ${theta.toFixed(2)}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { position: 'absolute', backgroundColor: 'rgba(91,91,240,0.05)' },
  discHighlight: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.7)', ...web({ filter: 'blur(10px)' }) },
  circle: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(20,24,48,0.18)' },
  guide: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(20,24,48,0.07)', borderStyle: 'dashed' },
  axis: { position: 'absolute', backgroundColor: 'rgba(20,24,48,0.10)' },
  arrowGlow: { position: 'absolute', height: 6, borderRadius: 3, backgroundColor: 'rgba(91,91,240,0.22)', transformOrigin: 'left center' },
  arrow: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: colors.accent, transformOrigin: 'left center' },
  origin: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text },
  dotHalo: { position: 'absolute', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#ffffff', boxShadow: '0 1px 4px rgba(20,24,48,0.25)' },
  tick: { position: 'absolute', color: colors.dim, fontFamily: mono, fontSize: 10 },
  thetaTag: { position: 'absolute', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.accent, boxShadow: '0 2px 8px rgba(91,91,240,0.35)' },
  thetaText: { color: '#fff', fontFamily: sans, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
