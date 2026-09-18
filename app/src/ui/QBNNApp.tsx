import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as Q from '../core/qbnn';
import { Body, Button, Card, Chip, Field, Label, Mono, Row } from './components';
import { useKernel } from './KernelContext';
import { colors, radius, spacing } from './theme';

/** QBNN Lab: train the multiplicative APQB gating layer (paper Eq. 23-30). */
export function QBNNApp() {
  const { kernel } = useKernel();
  const [task, setTask] = useState<'xor' | 'parity'>('xor');
  const [K, setK] = useState('2');
  const [lam, setLam] = useState('1');
  const [epochs, setEpochs] = useState('80');
  const [net, setNet] = useState<Q.QBNN | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const data = task === 'xor' ? Q.xorDataset() : Q.parityDataset(3);

  const start = () => {
    const nIn = task === 'xor' ? 2 : 3;
    const n = new Q.QBNN([nIn, 4, 1], Math.round(Number(K)) || 1, Number(lam), 'tanh', 'identity', 1);
    const proc = kernel.spawnService(`qbnn:${task}`, [`K=${K}`, `lam=${lam}`]);
    setNet(n);
    setHistory([]);
    setRunning(true);
    const total = Math.max(1, parseInt(epochs, 10) || 80);
    const hist: number[] = [];
    let e = 0;
    const step = () => {
      if (kernel.process(proc.pid).state !== 'running') {
        setRunning(false);
        return;
      }
      for (let i = 0; i < 5 && e < total; i++, e++) hist.push(Q.trainStep(n, data, 0.2));
      setHistory([...hist]);
      if (e < total) setTimeout(step, 0);
      else {
        setRunning(false);
        kernel.fs.writeJSON(`/lib/qbnn/${task}_K${K}.json`, n.toJSON());
        proc.log(`trained ${task} K=${K} lam=${lam} loss=${hist[hist.length - 1].toExponential(2)} acc=${Q.accuracy(n, data)}`);
        proc.state = 'done';
        proc.finished = Date.now();
        kernel.log(`pid=${proc.pid} ${proc.name} -> done`);
        kernel.notify();
      }
    };
    setTimeout(step, 0);
  };

  const loss = history[history.length - 1];
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
      <Card title="Task and Layer">
        <Body color={colors.dim} style={{ fontSize: 12 }}>r = tanh(h) · g = Jᵀ φ_S(r) · Δ = q ⊙ g · ã = a + λΔ. XOR needs K = 2; with λ = 0 the layer is a plain neural network.</Body>
        <Row style={{ marginTop: spacing.sm }}>
          <Chip title="XOR" active={task === 'xor'} onPress={() => setTask('xor')} />
          <Chip title="3-bit parity" active={task === 'parity'} onPress={() => setTask('parity')} />
        </Row>
        <Row>
          <Field label="K" value={K} onChangeText={setK} keyboardType="number-pad" />
          <Field label="λ" value={lam} onChangeText={setLam} />
          <Field label="epochs" value={epochs} onChangeText={setEpochs} keyboardType="number-pad" />
        </Row>
        <Row>
          <Button title={running ? 'Training…' : 'Train'} onPress={start} disabled={running} />
          <Button title="λ = 0" small kind="ghost" onPress={() => setLam('0')} />
        </Row>
      </Card>
      {history.length ? (
        <Card title="Training">
          <Label>loss  epoch {history.length}  ·  {loss.toExponential(3)}  ·  acc {net ? Q.accuracy(net, data).toFixed(2) : '-'}</Label>
          <View style={styles.lossPlot}>
            {history.filter((_, i) => i % Math.max(1, Math.floor(history.length / 60)) === 0).map((l, i) => (
              <View key={i} style={{ flex: 1, height: `${Math.max(3, 100 * Math.min(1, l / (history[0] || 1)))}%`, backgroundColor: colors.accent2, opacity: 0.55 + 0.45 * (i / 60), marginHorizontal: 0.5, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
            ))}
          </View>
          {net ? (
            <>
              <Label>hidden-unit η after the last forward pass</Label>
              <Mono color={colors.accent2}>{net.uncertainties()[0].map((e) => e.toFixed(3)).join('  ')}</Mono>
              <Label>predictions</Label>
              {data.map(([x, y], i) => (
                <Mono key={i} style={{ fontSize: 12 }} color={net.forward(x)[0] > 0 === y[0] > 0 ? colors.ok : colors.danger}>{`f(${x.join(',')}) = ${net.forward(x)[0].toFixed(3)}   target ${y[0]}`}</Mono>
              ))}
              <Body color={colors.dim} style={{ fontSize: 11, marginTop: 6 }}>{`weights saved to /lib/qbnn/${task}_K${K}.json`}</Body>
            </>
          ) : null}
        </Card>
      ) : null}
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  lossPlot: { height: 96, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: colors.panel2, borderRadius: radius.sm + 2, padding: 8, borderWidth: 1, borderColor: colors.border },
});
