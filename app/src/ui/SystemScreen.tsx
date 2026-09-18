import Slider from '@react-native-community/slider';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as Q from '../core/qbnn';
import { Button, Card, Chip, Field, KV, Label, Mono, Row } from './components';
import { useKernel } from './KernelContext';
import { colors, spacing } from './theme';

export function SystemScreen() {
  const { kernel, resetFilesystem } = useKernel();
  const [tab, setTab] = useState<'proc' | 'qbnn' | 'dmesg' | 'fs'>('proc');
  const u = kernel.sysUname();
  const theta = Number(kernel.sysctl['apqb.theta']);
  const sys = kernel.systemAPQB();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
      <Card title={`${u.os} ${u.version}`}>
        <KV k="hardware" v={`${u.hardware} · ${u.numQubits} qubits`} />
        <KV k="uptime" v={`${(u.uptimeMs / 1000).toFixed(0)} s`} />
        <KV k="processes" v={String(kernel.processes.size)} />
        <KV k="programs in /bin" v={String(u.programs.length)} />
      </Card>
      <Card title="APQB scheduler — sysctl apqb.theta">
        <Mono color={colors.dim} style={{ fontSize: 12 }}>eps = p_min + (p_max − p_min)·η(θ): explore a random READY process with probability eps, else run the highest priority.</Mono>
        <Label>θ = {theta.toFixed(3)}  r = {sys.r.toFixed(3)}  η = {sys.T.toFixed(3)}  →  eps = {kernel.explorationRate().toFixed(3)}</Label>
        <Slider minimumValue={0} maximumValue={Math.PI / 2} value={theta} onSlidingComplete={(v) => kernel.sysSysctl('apqb.theta', String(v))} minimumTrackTintColor={colors.warn} maximumTrackTintColor={colors.border} thumbTintColor={colors.warn} />
      </Card>
      <Row style={{ marginBottom: spacing.md }}>
        <Chip title="processes" active={tab === 'proc'} onPress={() => setTab('proc')} />
        <Chip title="qbnn" active={tab === 'qbnn'} onPress={() => setTab('qbnn')} />
        <Chip title="dmesg" active={tab === 'dmesg'} onPress={() => setTab('dmesg')} />
        <Chip title="filesystem" active={tab === 'fs'} onPress={() => setTab('fs')} />
      </Row>
      {tab === 'proc' ? <ProcessPanel /> : null}
      {tab === 'qbnn' ? <QBNNPanel /> : null}
      {tab === 'dmesg' ? (
        <Card title="dmesg">
          {kernel.sysDmesg(60).map((l, i) => (
            <Mono key={i} style={{ fontSize: 11 }}>{l}</Mono>
          ))}
        </Card>
      ) : null}
      {tab === 'fs' ? <FSPanel onReset={resetFilesystem} /> : null}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function ProcessPanel() {
  const { kernel } = useKernel();
  const procs = [...kernel.processes.values()].reverse();
  const demo = () => {
    kernel.sysSpawn('bell', [], 1, 64);
    kernel.sysSpawn('ghz', ['4'], 9, 64);
    kernel.sysSpawn('qft', ['3'], 5, 64);
    kernel.sysSpawn('bell_apqb', ['0.3'], 7, 64);
  };
  return (
    <Card title="process table">
      <Row style={{ marginBottom: spacing.sm }}>
        <Button title="spawn 4 demo jobs" small kind="ghost" onPress={demo} />
        <Button title="sched (run ready queue)" small onPress={() => kernel.sysSchedule()} />
        <Button title="step 1" small kind="ghost" onPress={() => kernel.sysSchedule(1)} />
      </Row>
      <Mono color={colors.dim} style={{ fontSize: 11 }}>{' PID  STATE    PRI   ELAPSED  COMMAND'}</Mono>
      {procs.length ? procs.map((p) => (
        <Row key={p.pid} style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <Mono style={{ fontSize: 11, flex: 1 }} color={p.state === 'failed' ? colors.danger : p.state === 'ready' ? colors.warn : p.state === 'done' ? colors.ok : colors.text}>{p.row()}</Mono>
          {p.state === 'ready' ? <Button title="kill" small kind="danger" onPress={() => kernel.sysKill(p.pid)} /> : null}
        </Row>
      )) : <Mono color={colors.dim}>(none yet — run a program or spawn demo jobs)</Mono>}
    </Card>
  );
}

function QBNNPanel() {
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
    setNet(n);
    setHistory([]);
    setRunning(true);
    const total = Math.max(1, parseInt(epochs, 10) || 80);
    const hist: number[] = [];
    let e = 0;
    const step = () => {
      for (let i = 0; i < 5 && e < total; i++, e++) hist.push(Q.trainStep(n, data, 0.2));
      setHistory([...hist]);
      if (e < total) setTimeout(step, 0);
      else {
        setRunning(false);
        kernel.fs.writeJSON(`/lib/qbnn/${task}_K${K}.json`, n.toJSON());
        kernel.log(`qbnn ui: trained ${task} K=${K} lam=${lam} loss=${hist[hist.length - 1].toExponential(2)} acc=${Q.accuracy(n, data)}`);
        kernel.notify();
      }
    };
    setTimeout(step, 0);
  };

  const loss = history[history.length - 1];
  return (
    <Card title="QBNN — multiplicative APQB gating (Eq. 23–30)">
      <Row>
        <Chip title="XOR" active={task === 'xor'} onPress={() => setTask('xor')} />
        <Chip title="3-bit parity" active={task === 'parity'} onPress={() => setTask('parity')} />
        <Field label="K" value={K} onChangeText={setK} keyboardType="number-pad" />
        <Field label="λ" value={lam} onChangeText={setLam} />
        <Field label="epochs" value={epochs} onChangeText={setEpochs} keyboardType="number-pad" />
      </Row>
      <Row>
        <Button title={running ? 'training…' : '▶ train'} onPress={start} disabled={running} />
        <Button title="λ=0 (plain NN)" small kind="ghost" onPress={() => setLam('0')} />
      </Row>
      {history.length ? (
        <View style={{ marginTop: spacing.sm }}>
          <Label>loss  epoch {history.length}  ·  {loss.toExponential(3)}  ·  acc {net ? Q.accuracy(net, data).toFixed(2) : '-'}</Label>
          <View style={styles.lossPlot}>
            {history.filter((_, i) => i % Math.max(1, Math.floor(history.length / 60)) === 0).map((l, i) => (
              <View key={i} style={{ flex: 1, height: `${Math.max(2, 100 * Math.min(1, l / (history[0] || 1)))}%`, backgroundColor: colors.accent2, marginHorizontal: 0.5 }} />
            ))}
          </View>
          {net ? (
            <>
              <Label>hidden-unit η (uncertainty) after the last forward pass</Label>
              <Mono color={colors.accent2}>{net.uncertainties()[0].map((e) => e.toFixed(3)).join('  ')}</Mono>
              <Label>predictions</Label>
              {data.map(([x, y], i) => (
                <Mono key={i} style={{ fontSize: 12 }} color={net.forward(x)[0] > 0 === y[0] > 0 ? colors.ok : colors.danger}>{`f(${x.join(',')}) = ${net.forward(x)[0].toFixed(3)}  target ${y[0]}`}</Mono>
              ))}
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function FSPanel({ onReset }: { onReset: () => Promise<void> }) {
  const { kernel } = useKernel();
  const [path, setPath] = useState('/etc/motd');
  let content = '';
  try {
    content = kernel.fs.isDir(path) ? kernel.fs.ls(path).join('\n') : kernel.fs.read(path);
  } catch (e) {
    content = (e as Error).message;
  }
  return (
    <Card title="QubitFS (persisted with AsyncStorage)">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Mono style={{ fontSize: 11 }}>{['/', ...kernel.fs.tree('/')].join('\n')}</Mono>
      </ScrollView>
      <Field label="path" value={path} onChangeText={setPath} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Mono color={colors.accent2} style={{ fontSize: 11 }}>{content}</Mono>
      </ScrollView>
      <Row style={{ marginTop: spacing.sm }}>
        <Button title="reset filesystem" small kind="danger" onPress={() => { onReset().catch(() => undefined); }} />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  lossPlot: { height: 80, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: colors.panel2, borderRadius: 6, padding: 4 },
});
