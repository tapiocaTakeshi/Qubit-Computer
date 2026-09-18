import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Shell } from '../os/shell';
import { Body, Button, Mono, Row } from './components';
import { useKernel } from './KernelContext';
import { colors, sans, spacing } from './theme';

/** Window for an installed script package: runs its main .qsh and shows the output. */
export function ScriptApp({ name }: { name: string }) {
  const { kernel } = useKernel();
  const app = kernel.pkg.get(name);
  const [lines, setLines] = useState<string[]>([]);
  const shell = useMemo(() => new Shell(kernel, (l) => setLines((prev) => [...prev, l].slice(-1500))), [kernel]);

  const run = () => {
    if (!app?.main) return;
    setLines([]);
    const proc = kernel.spawnService(`app:${name}`, ['run']);
    try {
      shell.runScript(kernel.fs.read(app.main));
      proc.state = 'done';
    } catch (e) {
      setLines((p) => [...p, `error: ${(e as Error).message}`]);
      proc.state = 'failed';
    }
    proc.finished = Date.now();
    kernel.notify();
  };

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  if (!app) return <View style={styles.container}><Body color={colors.dim} style={{ padding: 12 }}>App "{name}" is not installed.</Body></View>;
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.icon}>{app.icon ?? '▶'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{app.title} <Text style={styles.meta}>{app.version}</Text></Text>
          <Body color={colors.dim} style={{ fontSize: 12 }}>{app.description ?? ''}</Body>
          <Mono color={colors.dim} style={{ fontSize: 10 }}>{app.main}</Mono>
        </View>
        <Row>
          <Button title="Run Again" small onPress={run} />
        </Row>
      </View>
      <ScrollView style={styles.output} contentContainerStyle={{ padding: spacing.sm }}>
        {lines.map((l, i) => (
          <Mono key={i} color={l.startsWith('qsh:') ? colors.danger : colors.text}>{l || ' '}</Mono>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.panel },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: colors.panel2, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  icon: { fontSize: 28 },
  title: { fontFamily: sans, fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontFamily: sans, fontSize: 11, fontWeight: '400', color: colors.dim },
  output: { flex: 1 },
});
