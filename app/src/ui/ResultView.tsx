import React from 'react';
import { ScrollView, View } from 'react-native';
import { Circuit } from '../core/circuit';
import { Result } from '../core/computer';
import { Kernel } from '../os/kernel';
import { Body, Histogram, KV, Label, Mono, ReadoutTable } from './components';
import { colors, spacing } from './theme';

export function EntanglementView({ info }: { info: ReturnType<typeof Kernel.entanglementOf> }) {
  return (
    <View>
      {info.concurrence !== undefined ? (
        <>
          <KV k="concurrence C₂" v={info.concurrence} color={colors.warn} />
          <KV k="C₂² + r²" v={info.c2Check!} color={Math.abs(info.c2Check! - 1) < 1e-9 ? colors.ok : colors.dim} />
          <Body color={colors.dim} style={{ fontSize: 11 }}>{`Eq. 13-14: C₂ = η, C₂² + r² = 1 for |Ψ₂(θ)⟩ — ${Math.abs(info.c2Check! - 1) < 1e-9 ? 'satisfied' : 'outside that family'}`}</Body>
        </>
      ) : null}
      {info.threeTangle !== undefined ? (
        <>
          <KV k="three-tangle τ₃" v={info.threeTangle} color={colors.warn} />
          <KV k="τ₃ + r²" v={info.tau3Check!} color={Math.abs(info.tau3Check! - 1) < 1e-9 ? colors.ok : colors.dim} />
          <Body color={colors.dim} style={{ fontSize: 11 }}>{`Eq. 16-17: τ₃ = η², τ₃ + r² = 1 for |Ψ₃(θ)⟩ — ${Math.abs(info.tau3Check! - 1) < 1e-9 ? 'satisfied' : 'outside that family'}`}</Body>
        </>
      ) : null}
      {info.concurrence === undefined && info.threeTangle === undefined ? <Mono color={colors.dim}>{`von Neumann entropy per qubit: ${info.vonNeumann.map((v) => v.toFixed(3)).join(', ')}`}</Mono> : null}
    </View>
  );
}

export function CircuitDiagram({ circuit }: { circuit: Circuit }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Mono style={{ fontSize: 11, lineHeight: 15 }}>{circuit.draw()}</Mono>
    </ScrollView>
  );
}

export function ResultView({ result, circuit }: { result: Result; circuit?: Circuit | null }) {
  return (
    <View>
      <Mono color={colors.dim}>{`${result.circuitName} · ${result.numQubits} qubits · ${result.shots} shots${result.seed !== undefined ? ` · seed ${result.seed}` : ''} · ${result.elapsedMs} ms`}</Mono>
      {circuit ? (
        <View style={{ marginTop: spacing.sm }}>
          <Label>circuit (depth {circuit.depth})</Label>
          <CircuitDiagram circuit={circuit} />
        </View>
      ) : null}
      <View style={{ marginTop: spacing.sm }}>
        <Label>state</Label>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Mono color={colors.accent2}>{result.state.toString()}</Mono>
        </ScrollView>
      </View>
      <View style={{ marginTop: spacing.sm }}>
        <Label>counts</Label>
        <Histogram counts={result.counts} />
      </View>
      <View style={{ marginTop: spacing.sm }}>
        <Label>APQB readout</Label>
        <ReadoutTable readouts={result.apqb} />
      </View>
      {result.numQubits === 2 || result.numQubits === 3 ? (
        <View style={{ marginTop: spacing.sm }}>
          <Label>entanglement</Label>
          <EntanglementView info={Kernel.entanglementOf(result.state)} />
        </View>
      ) : null}
    </View>
  );
}
