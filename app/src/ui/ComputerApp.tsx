import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useKernel } from './KernelContext';
import { Button, Card, KV, Label, Mono, Row, Stat } from './components';
import { colors, spacing } from './theme';

const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

/** Report implemented services and explicit capability gaps. */
export function ComputerApp() {
  const { kernel, storageError } = useKernel();
  const [result, setResult] = useState('');
  const hw = kernel.sysHardware();
  return <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
    <Card title="APQB Personal Computer">
      <Mono color={colors.accent}>QubitOS → QVM64 → RAM / APQB / QubitFS</Mono>
      <Label>Hosted virtual computer, not a physical quantum PC or a bootable native OS. Ordinary apps run in JavaScript, not on the QVM CPU.</Label>
      <Button title="Open CPU + disk example" onPress={() => kernel.wm?.open('textedit', '/home/user/Examples/pc-check.qasm', true)} />
      <Label>The example writes 43 to Documents/pc-result.txt. Inspect it in TextEdit, then use Save & Run.</Label>
      <Button title="Inspect saved result" kind="ghost" onPress={() => {
        try { setResult(kernel.fs.read('/home/user/Documents/pc-result.txt')); }
        catch (e) { setResult((e as Error).message); }
      }} />
      {result ? <Mono>{result}</Mono> : null}
      {storageError ? <Mono color={colors.danger}>{storageError}</Mono> : null}
    </Card>
    <Card title="Motherboard and Processor">
      <KV k="motherboard" v={hw.motherboard.name} /><KV k="bus" v={hw.motherboard.bus} />
      <KV k="CPU" v={`${hw.cpu.name} · ${hw.cpu.bits}-bit`} color={colors.accent} /><Label>{hw.cpu.role}</Label>
      <KV k="boot self-test" v={kernel.bootReport.halted ? 'passed' : 'failed'} />
      <KV k="program runs" v={hw.cpu.runs} /><KV k="last instructions" v={hw.cpu.lastSteps ?? 'none'} />
      {hw.cpu.lastError ? <Mono color={colors.danger}>{hw.cpu.lastError}</Mono> : null}
      <Mono>{hw.cpu.registers.map((r, i) => `R${i}=${r}`).join('  ')}</Mono>
    </Card>
    <Card title="CPU RAM and APQB pool">
      <KV k="CPU RAM" v={`${hw.ram.wordCount} × 64-bit = ${hw.ram.byteLength} bytes`} />
      <KV k="nonzero RAM words" v={hw.ram.nonzeroWords} />
      <Row><Stat label="total" value={String(hw.ram.totalQubits)} unit="qubits" /><Stat label="allocated" value={String(hw.ram.allocatedQubits)} color={colors.warn} /></Row>
      <Label>CPU RAM resets for each program. QALLOC shares the APQB pool with Qubit Memory; HALT and errors release its allocation.</Label>
    </Card>
    <Card title="GPU NPU and Storage">
      <KV k="backend" v={`${hw.gpuNpu.backend} / ${hw.gpuNpu.engine}`} color={colors.accent2} />
      <Label>{hw.gpuNpu.detail}</Label>
      <KV k="SSD" v={`${hw.ssd.name} · ${mib(hw.ssd.usedBytes)} used / ${mib(hw.ssd.capacityBytes)}`} />
      <Label>{hw.ssd.detail}</Label>
    </Card>
    <Card title="Power Cooling and I O">
      <KV k="power" v={hw.power.status} /><KV k="cooling" v={hw.cooling.status} />
      <KV k="network" v={hw.network.join(' · ')} /><KV k="sound" v={hw.sound} />
    </Card>
    <View style={{ height: 40 }} />
  </ScrollView>;
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
