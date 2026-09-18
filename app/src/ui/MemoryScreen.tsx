import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { APQB } from '../core/apqb';
import * as G from '../core/gates';
import { Kernel, Segment } from '../os/kernel';
import { num } from '../os/programs';
import { Button, Card, Chip, Field, Histogram, KV, Label, Mono, ReadoutTable, Row } from './components';
import { useKernel } from './KernelContext';
import { EntanglementView } from './ResultView';
import { colors, spacing } from './theme';

const GATES = ['apqb', 'apqb_r', 'h', 'x', 'y', 'z', 's', 't', 'rx', 'ry', 'rz', 'p', 'cx', 'cz', 'cry', 'cp', 'swap', 'ccx'];

function SegmentCard({ seg, kernel, onError }: { seg: Segment; kernel: Kernel; onError: (m: string) => void }) {
  const [gate, setGate] = useState('h');
  const [targets, setTargets] = useState('0');
  const [param, setParam] = useState('0.4');
  const [shots, setShots] = useState('100');
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const arity = G.GATE_ARITY[gate];
  const needsParam = gate in G.PARAM_GATES;

  const safe = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <Card title={`segment ${seg.sid} · ${seg.name} · physical qubits [${seg.qubits.join(', ')}]`}>
      <Label>state</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}><Mono color={colors.accent2}>{seg.state.toString()}</Mono></ScrollView>
      <Label>APQB readout</Label>
      <ReadoutTable readouts={seg.state.apqbReadouts()} />
      {(seg.qubits.length === 2 || seg.qubits.length === 3) ? <EntanglementView info={Kernel.entanglementOf(seg.state)} /> : null}
      <Label>apply gate</Label>
      <Row>
        {GATES.map((g) => (
          <Chip key={g} title={g} active={g === gate} onPress={() => { setGate(g); setTargets([...Array(G.GATE_ARITY[g]).keys()].join(',')); }} />
        ))}
      </Row>
      <Row>
        <Field label={`targets (${arity})`} value={targets} onChangeText={setTargets} />
        {needsParam ? <Field label={gate === 'apqb_r' ? 'r' : gate === 'apqb' ? 'θ' : 'angle'} value={param} onChangeText={setParam} /> : null}
        <Button title="apply" small onPress={() => safe(() => { kernel.sysApply(seg.sid, gate, targets.split(',').map((t) => Math.round(num(t))), needsParam ? [num(param)] : []); setCounts(null); setOutcome(null); })} />
      </Row>
      <Label>measure</Label>
      <Row>
        <Field label="shots" value={shots} onChangeText={setShots} keyboardType="number-pad" />
        <Button title="sample" small kind="ghost" onPress={() => safe(() => { const r = kernel.sysMeasure(seg.sid, undefined, Math.max(2, parseInt(shots, 10) || 2)); setCounts(r.counts ?? null); })} />
        <Button title="measure (collapse)" small onPress={() => safe(() => { const r = kernel.sysMeasure(seg.sid); setOutcome(r.outcome ?? null); setCounts(null); })} />
        <Button title="reset" small kind="ghost" onPress={() => safe(() => { kernel.sysReset(seg.sid); setCounts(null); setOutcome(null); })} />
        <Button title="free" small kind="danger" onPress={() => safe(() => kernel.sysFree(seg.sid))} />
      </Row>
      {outcome ? <Mono color={colors.warn}>{`outcome ${outcome} — register collapsed`}</Mono> : null}
      {counts ? <Histogram counts={counts} /> : null}
      {seg.history.length ? <Mono color={colors.dim} style={{ fontSize: 11 }}>{`ops: ${seg.history.slice(-6).join(' → ')}`}</Mono> : null}
    </Card>
  );
}

export function MemoryScreen() {
  const { kernel } = useKernel();
  const [n, setN] = useState('2');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'zero' | 'theta' | 'r'>('r');
  const [init, setInit] = useState('0.6,-0.2');
  const [error, setError] = useState('');
  const mem = kernel.sysMem();

  const alloc = () => {
    setError('');
    try {
      const size = Math.round(num(n));
      let apqbs: APQB[] | undefined;
      if (mode === 'theta') apqbs = init.split(',').map((v) => new APQB(num(v)));
      if (mode === 'r') apqbs = init.split(',').map((v) => APQB.fromR(num(v)));
      kernel.sysAlloc(size, name, apqbs);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
      <Card title="qubit memory">
        <KV k="physical qubits" v={String(mem.total)} />
        <KV k="allocated" v={String(mem.used)} color={colors.warn} />
        <KV k="free" v={String(mem.free)} color={colors.ok} />
        <View style={styles.memBar}>
          {[...Array(mem.total).keys()].map((q) => (
            <View key={q} style={[styles.memCell, { backgroundColor: kernel.freeQubits.includes(q) ? colors.panel2 : colors.accent }]} />
          ))}
        </View>
      </Card>
      <Card title="alloc — a new APQB register">
        <Row>
          <Field label="qubits" value={n} onChangeText={setN} keyboardType="number-pad" />
          <Field label="name" value={name} onChangeText={setName} placeholder="auto" />
        </Row>
        <Row>
          <Chip title="|0…0⟩" active={mode === 'zero'} onPress={() => setMode('zero')} />
          <Chip title="from θ list" active={mode === 'theta'} onPress={() => setMode('theta')} />
          <Chip title="from r list" active={mode === 'r'} onPress={() => setMode('r')} />
        </Row>
        {mode !== 'zero' ? <Field label={mode === 'theta' ? 'θ₀,θ₁,…' : 'r₀,r₁,…'} value={init} onChangeText={setInit} /> : null}
        <Row>
          <Button title="alloc" onPress={alloc} />
          {error ? <Mono color={colors.danger}>{error}</Mono> : null}
        </Row>
      </Card>
      {[...kernel.segments.values()].map((seg) => (
        <SegmentCard key={seg.sid} seg={seg} kernel={kernel} onError={setError} />
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  memBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: spacing.sm },
  memCell: { width: 16, height: 16, borderRadius: 3 },
});
