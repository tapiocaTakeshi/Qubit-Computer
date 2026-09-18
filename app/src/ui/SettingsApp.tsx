import Slider from '@react-native-community/slider';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Body, Button, Card, Divider, Field, KV, Label, Row } from './components';
import { InstallCard } from './InstallCard';
import { useState } from 'react';
import { useKernel } from './KernelContext';
import { colors, spacing } from './theme';

/** System Settings: about, sysctl knobs, filesystem reset. */
export function SettingsApp() {
  const { kernel, resetFilesystem } = useKernel();
  const u = kernel.sysUname();
  const theta = Number(kernel.sysctl['apqb.theta']);
  const sys = kernel.systemAPQB();
  const pmax = Number(kernel.sysctl['sched.p_max']);
  const shots = Number(kernel.sysctl['run.shots']);
  const [registry, setRegistry] = useState(String(kernel.sysctl['net.registry']));
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Card title="About This Computer">
        <KV k="system" v={`${u.os} ${u.version}`} />
        <KV k="hardware" v={`${u.hardware} · ${u.numQubits} qubits`} />
        <KV k="uptime" v={`${(u.uptimeMs / 1000).toFixed(0)} s`} />
        <KV k="processes" v={String(kernel.processes.size)} />
        <KV k="windows" v={String(kernel.wm?.windows.length ?? 0)} />
        <KV k="programs in /bin" v={String(u.programs.length)} />
      </Card>
      <InstallCard />
      <Card title="System APQB (apqb.theta)">
        <Body color={colors.dim} style={{ fontSize: 12 }}>The kernel's own qubit. Its uncertainty η drives the scheduler's exploration rate and any η-mapped control signal.</Body>
        <Label>θ = {theta.toFixed(3)}  ·  r = {sys.r.toFixed(3)}  ·  η = {sys.T.toFixed(3)}</Label>
        <Slider minimumValue={0} maximumValue={Math.PI / 2} value={theta} onSlidingComplete={(v) => kernel.sysSysctl('apqb.theta', String(v))} minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.fill} thumbTintColor="#fff" />
        <Divider />
        <Label>sched.p_max = {pmax.toFixed(2)}  →  eps = {kernel.explorationRate().toFixed(3)}</Label>
        <Slider minimumValue={0} maximumValue={1} value={pmax} onSlidingComplete={(v) => kernel.sysSysctl('sched.p_max', String(v))} minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.fill} thumbTintColor="#fff" />
        <Divider />
        <Label>run.shots = {shots}</Label>
        <Slider minimumValue={16} maximumValue={4096} step={16} value={shots} onSlidingComplete={(v) => kernel.sysSysctl('run.shots', String(Math.round(v)))} minimumTrackTintColor={colors.accent} maximumTrackTintColor={colors.fill} thumbTintColor="#fff" />
      </Card>
      <Card title="Network">
        <KV k="status" v={kernel.net.enabled ? 'online' : 'offline'} color={kernel.net.enabled ? colors.ok : colors.dim} />
        <KV k="requests" v={String(kernel.net.history.length)} />
        <KV k="installed apps" v={String(kernel.pkg.list().length)} />
        <Row style={{ marginTop: spacing.sm }}>
          <Button title={kernel.net.enabled ? 'Disable Network' : 'Enable Network'} small kind="ghost" onPress={() => kernel.sysSysctl('net.enabled', kernel.net.enabled ? 'false' : 'true')} />
        </Row>
        <Label>package registries (comma separated, tried in order)</Label>
        <Field value={registry} onChangeText={setRegistry} multiline />
        <Row>
          <Button title="Save" small onPress={() => kernel.sysSysctl('net.registry', registry)} />
        </Row>
      </Card>
      <Card title="Storage">
        <Body color={colors.dim} style={{ fontSize: 12 }}>QubitFS is saved to this device automatically. Resetting restores the factory filesystem and reboots the kernel.</Body>
        <Row style={{ marginTop: spacing.sm }}>
          <Button title="Reset Filesystem…" small kind="danger" onPress={() => { resetFilesystem().catch(() => undefined); }} />
        </Row>
      </Card>
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
