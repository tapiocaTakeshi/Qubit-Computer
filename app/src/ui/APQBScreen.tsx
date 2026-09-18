import Slider from '@react-native-community/slider';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { APQB } from '../core/apqb';
import * as Q from '../core/qbnn';
import { BlochCircle } from './BlochCircle';
import { Body, Button, Card, KV, Label, Mono, Row } from './components';
import { useKernel } from './KernelContext';
import { colors, spacing } from './theme';

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Row style={{ marginVertical: 2 }}>
      <Mono color={colors.dim} style={{ width: 96 }}>{label}</Mono>
      <View style={styles.track}>
        <View style={[styles.zero]} />
        <View style={[styles.fill, { backgroundColor: color, left: value >= 0 ? '50%' : `${50 + 50 * value}%`, width: `${50 * Math.abs(value)}%` }]} />
      </View>
      <Mono style={{ width: 64, textAlign: 'right' }}>{(value >= 0 ? '+' : '') + value.toFixed(3)}</Mono>
    </Row>
  );
}

export function APQBScreen() {
  const { kernel } = useKernel();
  const [theta, setTheta] = useState(0.3);
  const q = new APQB(theta);
  const [c, s] = q.amplitudes;
  const [p0, p1] = q.probabilities;
  const [re, im] = q.features(4);
  const eta = q.T;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Card title="Adjustable Pseudo Quantum Bit">
        <Mono color={colors.accent} style={{ fontSize: 15 }}>{`|ψ(θ)⟩ = ${c.toFixed(4)}|0⟩ + ${s.toFixed(4)}|1⟩`}</Mono>
        <Label>θ = {theta.toFixed(4)} rad ({((theta * 180) / Math.PI).toFixed(1)}°)</Label>
        <Slider minimumValue={0} maximumValue={Math.PI / 2} value={theta} onValueChange={setTheta} minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.border} thumbTintColor={colors.accent} />
        <Row>
          <Button title="|0⟩" small kind="ghost" onPress={() => setTheta(0)} />
          <Button title="π/8" small kind="ghost" onPress={() => setTheta(Math.PI / 8)} />
          <Button title="|+⟩ π/4" small kind="ghost" onPress={() => setTheta(Math.PI / 4)} />
          <Button title="|1⟩ π/2" small kind="ghost" onPress={() => setTheta(Math.PI / 2)} />
        </Row>
        <BlochCircle theta={theta} />
      </Card>
      <Card title="r² + η² = 1">
        <Bar label="r = cos2θ" value={q.r} color={colors.accent} />
        <Bar label="η = |sin2θ|" value={eta} color={colors.accent2} />
        <KV k="r² + η²" v={q.constraint()} color={colors.ok} />
        <KV k="P(0) = (1+r)/2" v={p0} />
        <KV k="P(1) = (1−r)/2" v={p1} />
        <KV k="H_Z (bit)" v={q.entropy} />
        <KV k="z = e^{i2θ}" v={`${q.z.re >= 0 ? '+' : ''}${q.z.re.toFixed(4)} ${q.z.im >= 0 ? '+' : '−'} ${Math.abs(q.z.im).toFixed(4)}i`} />
        <KV k="Bloch (x, y, z)" v={`(${q.bloch.map((v) => v.toFixed(3)).join(', ')})`} />
      </Card>
      <Card title="η as a Control Signal (Eq. 11 / 32)">
        <KV k="temperature τ(η) on [0.1, 1.0]" v={Q.controlSignal(eta, 0.1, 1.0)} color={colors.warn} />
        <KV k="dropout p(η) on [0.0, 0.5]" v={Q.controlSignal(eta, 0, 0.5)} color={colors.warn} />
        <KV k="scheduler eps(η) on [p_min, p_max]" v={Q.controlSignal(eta, Number(kernel.sysctl['sched.p_min']), Number(kernel.sysctl['sched.p_max']))} color={colors.warn} />
        <Row style={{ marginTop: spacing.sm }}>
          <Button title="Use as system APQB" small onPress={() => kernel.sysSysctl('apqb.theta', String(theta))} />
        </Row>
        <Mono color={colors.dim} style={{ fontSize: 11, marginTop: 4 }}>{`current system APQB θ=${kernel.systemAPQB().theta.toFixed(3)} → eps=${kernel.explorationRate().toFixed(3)}`}</Mono>
      </Card>
      <Card title="Chebyshev Features (Prop. 2)">
        {re.map((v, k) => (
          <Bar key={`re${k}`} label={`Re z^${k + 1}`} value={v} color={colors.accent} />
        ))}
        {im.map((v, k) => (
          <Bar key={`im${k}`} label={`Im z^${k + 1}`} value={v} color={colors.accent2} />
        ))}
        <Mono color={colors.dim} style={{ fontSize: 11 }}>Re z^k = T_k(r), Im z^k = η·U_{'{k−1}'}(r)</Mono>
      </Card>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  track: { flex: 1, height: 12, backgroundColor: colors.panel2, borderRadius: 4, overflow: 'hidden' },
  zero: { position: 'absolute', left: '50%', width: 1, height: '100%', backgroundColor: colors.border },
  fill: { position: 'absolute', height: '100%' },
});
