import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Circuit, CircuitJSON } from '../core/circuit';
import { resultSummary } from '../core/computer';
import { Shell } from '../os/shell';
import { Body, Button, Field, Mono, Row } from './components';
import { useKernel } from './KernelContext';
import { PressState, colors, mono, radius, sans, spacing, web } from './theme';

/** Finder: browse QubitFS, preview files, run scripts and circuits. */
export function FinderApp({ path: initial, onOpenPath }: { path?: string; onOpenPath?: (p: string) => void }) {
  const { kernel } = useKernel();
  const fs = kernel.fs;
  const startDir = initial && fs.exists(initial) && fs.isDir(initial) ? initial : '/';
  const startFile = initial && fs.exists(initial) && !fs.isDir(initial) ? initial : null;
  const [dir, setDir] = useState(startFile ? startFile.slice(0, startFile.lastIndexOf('/')) || '/' : startDir);
  const [selected, setSelected] = useState<string | null>(startFile);
  const [output, setOutput] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const shell = useMemo(() => new Shell(kernel, (l) => setOutput((o) => [...o, l].slice(-200))), [kernel]);

  let entries: string[] = [];
  try {
    entries = fs.ls(dir);
  } catch {
    entries = [];
  }
  const crumbs = dir === '/' ? [''] : dir.split('/');
  const join = (a: string, b: string) => (a === '/' ? `/${b}` : `${a}/${b}`);
  const isScript = selected?.endsWith('.qsh');
  const isCircuit = selected?.endsWith('.json') && selected.includes('/circuits/');
  let preview = '';
  if (selected) {
    try {
      preview = fs.read(selected);
    } catch (e) {
      preview = (e as Error).message;
    }
  }

  const act = (fn: () => void) => {
    setOutput([]);
    try {
      fn();
    } catch (e) {
      setOutput([(e as Error).message]);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.crumbBar}>
        {crumbs.map((c, i) => {
          const p = i === 0 ? '/' : crumbs.slice(0, i + 1).join('/');
          return (
            <Pressable key={p} onPress={() => { setDir(p); setSelected(null); onOpenPath?.(p); }}>
              <View style={styles.crumbWrap}>
                <Text style={[styles.crumb, i === crumbs.length - 1 && styles.crumbCurrent]}>{i === 0 ? 'QubitFS' : c}</Text>
                {i < crumbs.length - 1 ? <Text style={styles.crumbSep}>›</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.split}>
        <ScrollView style={styles.list}>
          {entries.length === 0 ? <Body color={colors.dim} style={{ padding: 8 }}>Empty folder</Body> : null}
          {entries.map((name) => {
            const isDir = name.endsWith('/');
            const full = join(dir, isDir ? name.slice(0, -1) : name);
            const sel = selected === full;
            return (
              <Pressable key={name} onPress={() => { if (isDir) { setDir(full); setSelected(null); onOpenPath?.(full); } else setSelected(full); }} style={({ hovered }: PressState) => [styles.item, hovered && !sel && styles.itemHover, sel && styles.itemSel]}>
                <Text style={styles.itemIcon}>{isDir ? '📁' : name.endsWith('.qsh') ? '📜' : name.endsWith('.json') ? '🧾' : '📄'}</Text>
                <Text style={[styles.itemText, sel && { color: '#fff' }]} numberOfLines={1}>{isDir ? name.slice(0, -1) : name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.preview}>
          {selected ? (
            <>
              <Text style={styles.previewTitle} numberOfLines={1}>{selected}</Text>
              <Row style={{ marginBottom: 6 }}>
                {isScript ? <Button title="Run Script" small onPress={() => act(() => shell.runScript(fs.read(selected)))} /> : null}
                {isCircuit ? <Button title="Execute Circuit" small onPress={() => act(() => { const c = Circuit.fromJSON(fs.readJSON<CircuitJSON>(selected)); setOutput([c.draw(), resultSummary(kernel.sysExecCircuit(c, 256))]); })} /> : null}
                <Button title="Delete" small kind="danger" onPress={() => act(() => { fs.rm(selected); setSelected(null); kernel.notify(); })} />
              </Row>
              <ScrollView style={styles.previewBody}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}><Mono style={{ fontSize: 11 }}>{preview}</Mono></ScrollView>
              </ScrollView>
            </>
          ) : (
            <>
              <Body color={colors.dim}>Select a file to preview it.</Body>
              <Row style={{ marginTop: spacing.sm }}>
                <Field placeholder="new folder" value={newName} onChangeText={setNewName} style={{ flex: 1 }} />
                <Button title="New Folder" small kind="ghost" onPress={() => act(() => { if (newName.trim()) { fs.mkdir(join(dir, newName.trim())); setNewName(''); kernel.notify(); } })} />
              </Row>
            </>
          )}
          {output.length ? (
            <ScrollView style={styles.console}>
              {output.map((l, i) => (
                <Mono key={i} style={{ fontSize: 11 }} color={l.startsWith('qsh:') ? '#fb7185' : colors.inkText}>{l}</Mono>
              ))}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.panel },
  crumbBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: '#f9fafd' },
  crumbWrap: { flexDirection: 'row', alignItems: 'center' },
  crumb: { fontFamily: sans, fontSize: 12.5, color: colors.dim, fontWeight: '500', ...web({ cursor: 'pointer' }) },
  crumbCurrent: { color: colors.text, fontWeight: '600' },
  crumbSep: { fontFamily: sans, fontSize: 13, color: colors.faint, marginHorizontal: 7 },
  split: { flex: 1, flexDirection: 'row' },
  list: { width: 176, borderRightWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: '#f6f7fb', paddingVertical: 6, paddingHorizontal: 6 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5.5, paddingHorizontal: 8, gap: 7, borderRadius: radius.sm, ...web({ cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '100ms' }) },
  itemHover: { backgroundColor: 'rgba(20,24,48,0.05)' },
  itemSel: { backgroundColor: colors.accent, boxShadow: '0 2px 8px rgba(91,91,240,0.3)' },
  itemIcon: { fontSize: 13 },
  itemText: { fontFamily: sans, fontSize: 12.5, color: colors.text, flex: 1 },
  preview: { flex: 1, padding: 12 },
  previewTitle: { fontFamily: mono, fontSize: 11, color: colors.dim, marginBottom: 8 },
  previewBody: { flex: 1, backgroundColor: colors.panel2, borderRadius: radius.sm + 2, padding: 10, borderWidth: 1, borderColor: colors.border },
  console: { maxHeight: 180, marginTop: 8, backgroundColor: colors.ink, borderRadius: radius.sm + 2, padding: 10 },
});
