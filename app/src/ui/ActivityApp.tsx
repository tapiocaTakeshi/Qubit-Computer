import Slider from '@react-native-community/slider';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Body, Button, Card, Chip, Label, Mono, Row } from './components';
import { useKernel } from './KernelContext';
import { colors, spacing } from './theme';

/** Activity Monitor: process table, APQB scheduler, kernel log. */
export function ActivityApp() {
  const { kernel } = useKernel();
  const [tab, setTab] = useState<'proc' | 'net' | 'log'>('proc');
  const procs = [...kernel.processes.values()].reverse();
  const theta = Number(kernel.sysctl['apqb.theta']);
  const sys = kernel.systemAPQB();
  const demo = () => {
    kernel.sysSpawn('bell', [], 1, 64);
    kernel.sysSpawn('ghz', ['4'], 9, 64);
    kernel.sysSpawn('qft', ['3'], 5, 64);
    kernel.sysSpawn('bell_apqb', ['0.3'], 7, 64);
  };
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Row style={{ marginBottom: spacing.md }}>
        <Chip title="Processes" active={tab === 'proc'} onPress={() => setTab('proc')} />
        <Chip title="Network" active={tab === 'net'} onPress={() => setTab('net')} />
        <Chip title="Kernel Log" active={tab === 'log'} onPress={() => setTab('log')} />
      </Row>
      {tab === 'proc' ? (
        <>
          <Card title="APQB Scheduler">
            <Body color={colors.dim} style={{ fontSize: 12 }}>eps = p_min + (p_max − p_min)·η(θ): explore a random READY process with probability eps, else run the highest priority.</Body>
            <Label>θ = {theta.toFixed(3)}  r = {sys.r.toFixed(3)}  η = {sys.T.toFixed(3)}  →  eps = {kernel.explorationRate().toFixed(3)}</Label>
            <Slider minimumValue={0} maximumValue={Math.PI / 2} value={theta} onSlidingComplete={(v) => kernel.sysSysctl('apqb.theta', String(v))} minimumTrackTintColor={colors.warn} maximumTrackTintColor={colors.fill} thumbTintColor="#fff" />
          </Card>
          <Card title="Processes">
            <Row style={{ marginBottom: spacing.sm }}>
              <Button title="Spawn demo jobs" small kind="ghost" onPress={demo} />
              <Button title="Run scheduler" small onPress={() => kernel.sysSchedule()} />
              <Button title="Step" small kind="ghost" onPress={() => kernel.sysSchedule(1)} />
            </Row>
            <Mono color={colors.dim} style={{ fontSize: 11 }}>{' PID  STATE    PRI   ELAPSED  COMMAND'}</Mono>
            {procs.length ? procs.map((p) => (
              <Row key={p.pid} style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <Mono style={{ fontSize: 11, flex: 1 }} color={p.state === 'failed' ? colors.danger : p.state === 'ready' ? colors.warn : p.state === 'killed' ? colors.dim : p.state === 'running' ? colors.accent : colors.text}>{p.row()}</Mono>
                {p.state === 'ready' || p.state === 'running' ? <Button title="Kill" small kind="danger" onPress={() => kernel.sysKill(p.pid)} /> : null}
              </Row>
            )) : <Body color={colors.dim}>No processes yet. Open an app, run a program or spawn the demo jobs.</Body>}
          </Card>
        </>
      ) : tab === 'net' ? (
        <Card title={`Network (${kernel.net.enabled ? 'online' : 'offline'})`}>
          <Body color={colors.dim} style={{ fontSize: 12 }}>Every request made by the kernel's network stack (curl, wget, qpm, App Store).</Body>
          <Row style={{ marginVertical: spacing.sm }}>
            <Button title={kernel.net.enabled ? 'Go Offline' : 'Go Online'} small kind="ghost" onPress={() => kernel.sysSysctl('net.enabled', kernel.net.enabled ? 'false' : 'true')} />
          </Row>
          {kernel.net.history.length ? [...kernel.net.history].reverse().map((r) => (
            <Mono key={r.id} style={{ fontSize: 11 }} color={r.error ? colors.danger : colors.text}>{`${r.method} ${r.url}\n    ${r.error ? r.error : `${r.status} · ${r.bytes} B · ${r.ms} ms`}`}</Mono>
          )) : <Body color={colors.dim}>No requests yet.</Body>}
        </Card>
      ) : (
        <Card title="dmesg">
          {kernel.sysDmesg(80).map((l, i) => (
            <Mono key={i} style={{ fontSize: 11 }}>{l}</Mono>
          ))}
        </Card>
      )}
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
