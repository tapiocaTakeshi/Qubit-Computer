import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useKernel } from './KernelContext';
import { Card, KV, Label, Mono, Row, Stat } from './components';
import { colors, spacing } from './theme';

const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

/** Live motherboard view: each card corresponds to a working QubitOS service. */
export function ComputerApp() {
  const { kernel } = useKernel();
  const hw = kernel.sysHardware();
  return <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
    <Card title="APQB Personal Computer">
      <Mono color={colors.accent}>APQB IR → QVM → {hw.gpuNpu.backend} → QubitOS</Mono>
      <Label>This is a classical APQB simulator. Hardware cards describe the virtual machine, not a physical quantum computer.</Label>
    </Card>
    <Card title="Motherboard and Processor">
      <KV k="motherboard" v={hw.motherboard.name} /><KV k="bus" v={hw.motherboard.bus} />
      <KV k="CPU" v={`${hw.cpu.name} · ${hw.cpu.bits}-bit`} color={colors.accent} /><Label>{hw.cpu.role}</Label>
    </Card>
    <Card title="APQB RAM">
      <Row><Stat label="total" value={String(hw.ram.totalQubits)} unit="qubits" /><Stat label="allocated" value={String(hw.ram.allocatedQubits)} color={colors.warn} /></Row>
      <Label>Use Qubit Memory or `alloc` to reserve live APQB registers.</Label>
    </Card>
    <Card title="GPU NPU and Storage">
      <KV k="accelerator" v={`${hw.gpuNpu.name} · ${hw.gpuNpu.lanes} lanes`} /><KV k="backend" v={hw.gpuNpu.backend} color={colors.accent2} />
      <KV k="SSD" v={`${hw.ssd.name} · ${mib(hw.ssd.usedBytes)} used / ${mib(hw.ssd.capacityBytes)}`} />
    </Card>
    <Card title="Power Cooling and I O">
      <Row><Stat label="power" value={hw.power.watts.toFixed(1)} unit="W" /><Stat label="CPU" value={hw.power.cpuTempC.toFixed(1)} unit="°C" color={colors.warn} /><Stat label="fan" value={hw.cooling.fanPercent.toFixed(0)} unit="%" color={colors.ok} /></Row>
      <KV k="network" v={hw.network.join(' · ')} /><KV k="sound" v={hw.sound} />
    </Card>
    <View style={{ height: 40 }} />
  </ScrollView>;
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
