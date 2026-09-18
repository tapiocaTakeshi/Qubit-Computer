import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { isResult, Process } from '../os/kernel';
import { Program, programKind } from '../os/programs';
import { Body, Button, Card, Chip, Field, Mono, Row } from './components';
import { useKernel } from './KernelContext';
import { ResultView } from './ResultView';
import { colors, spacing } from './theme';

function buildArgv(prog: Program, values: Record<string, string>): string[] {
  const argv: string[] = [];
  for (const p of prog.params) {
    const v = (values[p.name] ?? p.default).trim();
    if (!v) continue;
    if (p.flag) argv.push(p.flag, v);
    else argv.push(...v.split(/\s+/));
  }
  return argv;
}

export function ProgramsScreen() {
  const { kernel } = useKernel();
  const names = Object.keys(kernel.programs);
  const [selected, setSelected] = useState(names[0]);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [shots, setShots] = useState('512');
  const [seed, setSeed] = useState('');
  const [proc, setProc] = useState<Process | null>(null);
  const prog = kernel.programs[selected];
  const vals = values[selected] ?? {};

  const run = () => {
    const argv = buildArgv(prog, vals);
    const p = kernel.sysRun(prog.name, argv, Math.max(0, parseInt(shots, 10) || 0), seed.trim() ? parseInt(seed, 10) : undefined);
    setProc(p);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
      <Card title="Programs">
        <Row>
          {names.map((n) => (
            <Chip key={n} title={n} active={n === selected} onPress={() => { setSelected(n); setProc(null); }} />
          ))}
        </Row>
      </Card>
      <Card title={`${prog.name}  (${programKind(prog)})`}>
        <Body>{prog.description}</Body>
        <Mono color={colors.dim} style={{ fontSize: 11, marginBottom: spacing.sm }}>{`usage: ${prog.usage}`}</Mono>
        <Row>
          {prog.params.map((p) => (
            <Field key={p.name} label={p.label} value={vals[p.name] ?? p.default} onChangeText={(t) => setValues({ ...values, [selected]: { ...vals, [p.name]: t } })} style={{ flexGrow: 1 }} />
          ))}
          {programKind(prog) === 'circuit' ? (
            <>
              <Field label="shots" value={shots} onChangeText={setShots} keyboardType="number-pad" />
              <Field label="seed" value={seed} onChangeText={setSeed} keyboardType="number-pad" placeholder="random" />
            </>
          ) : null}
        </Row>
        <Row>
          <Button title="Run" onPress={run} />
          {programKind(prog) === 'circuit' ? <Button title="Draw" kind="ghost" onPress={() => { try { const c = prog.circuit!(buildArgv(prog, vals)); setProc(Object.assign(new Process(0, prog.name, [], prog, 5, 0), { circuit: c, state: 'done' as const, logs: [`${c.name}: ${c.numQubits} qubits, ${c.length} instructions, depth ${c.depth}`] })); } catch (e) { setProc(Object.assign(new Process(0, prog.name, [], prog, 5, 0), { state: 'failed' as const, error: (e as Error).message })); } }} /> : null}
        </Row>
      </Card>
      {proc ? (
        <Card title={proc.pid ? `pid ${proc.pid} · ${proc.state}` : 'circuit'}>
          {proc.logs.map((l, i) => (
            <Mono key={i} color={colors.dim}>{l}</Mono>
          ))}
          {proc.error ? <Mono color={colors.danger}>{proc.error}</Mono> : null}
          {isResult(proc.result) ? <ResultView result={proc.result} circuit={proc.circuit} /> : null}
          {!isResult(proc.result) && proc.result !== null && proc.result !== undefined ? (
            <ScrollView horizontal><Mono color={colors.accent2}>{JSON.stringify(proc.result, null, 2)}</Mono></ScrollView>
          ) : null}
          {!proc.pid && proc.circuit ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}><Mono style={{ fontSize: 11, lineHeight: 15 }}>{proc.circuit.draw()}</Mono></ScrollView>
          ) : null}
        </Card>
      ) : null}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
