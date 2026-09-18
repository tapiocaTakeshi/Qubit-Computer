/**
 * The APQB lives on the X-Z great circle of the Bloch sphere:
 * b(theta) = (sin 2theta, 0, cos 2theta). Drawn with plain Views.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, mono } from './theme';

export function BlochCircle({ theta, size = 220, extra }: { theta: number; size?: number; extra?: Array<{ x: number; z: number; color: string; label?: string }> }) {
  const R = size / 2 - 16;
  const cx = size / 2;
  const cy = size / 2;
  const x = Math.sin(2 * theta);
  const z = Math.cos(2 * theta);
  const px = cx + R * x;
  const py = cy - R * z;
  const dots = [{ x, z, color: colors.accent, label: 'ψ(θ)' }, ...(extra ?? [])];
  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }}>
      <View style={[styles.circle, { left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, borderRadius: R }]} />
      <View style={[styles.axis, { left: cx - R, top: cy, width: 2 * R, height: 1 }]} />
      <View style={[styles.axis, { left: cx, top: cy - R, width: 1, height: 2 * R }]} />
      <Text style={[styles.tick, { left: cx - 10, top: cy - R - 16 }]}>|0⟩ r=+1</Text>
      <Text style={[styles.tick, { left: cx - 10, top: cy + R + 2 }]}>|1⟩ r=−1</Text>
      <Text style={[styles.tick, { left: cx + R + 2, top: cy - 8 }]}>η=1</Text>
      <Text style={[styles.tick, { left: cx - R - 24, top: cy - 8 }]}>−X</Text>
      <View style={[styles.arrow, { left: cx, top: cy, width: R * Math.hypot(x, z), transform: [{ translateY: -1 }, { rotate: `${Math.atan2(-z, x)}rad` }] }]} />
      {dots.map((d, i) => (
        <View key={i} style={[styles.dot, { left: cx + R * d.x - 6, top: cy - R * d.z - 6, backgroundColor: d.color }]} />
      ))}
      <Text style={[styles.tick, { left: Math.min(px + 8, size - 60), top: Math.max(py - 18, 0), color: colors.accent }]}>{`θ=${theta.toFixed(2)}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.2)' },
  axis: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.15)' },
  arrow: { position: 'absolute', height: 2, backgroundColor: colors.accent, transformOrigin: 'left center' },
  dot: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#ffffff' },
  tick: { position: 'absolute', color: colors.dim, fontFamily: mono, fontSize: 10 },
});
