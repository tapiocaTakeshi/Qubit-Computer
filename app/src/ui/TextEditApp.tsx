import React, { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Body, Button, Field, Mono, Row } from './components';
import { useKernel } from './KernelContext';
import { Shell } from '../os/shell';
import { colors, mono, spacing } from './theme';

/** Each document gets its own window. Drafts survive closing and restarting the app. */
export function TextEditApp({ path: initial }: { path?: string }) {
  const { kernel } = useKernel();
  const defaultPath = initial ?? '/home/user/Documents/Untitled.txt';
  const draftPath = '/home/user/.drafts/' + encodeURIComponent(defaultPath) + '.txt';
  const [path, setPath] = useState(defaultPath);
  const [text, setText] = useState(() => kernel.fs.exists(draftPath) ? kernel.fs.read(draftPath) : kernel.fs.exists(defaultPath) ? kernel.fs.read(defaultPath) : '');
  const [status, setStatus] = useState(kernel.fs.exists(draftPath) ? 'Draft restored' : 'Ready');
  const [output, setOutput] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const edit = (value: string) => {
    setText(value);
    try { kernel.fs.write(draftPath, value); kernel.notify(); setStatus('Draft saved • Save to update file'); }
    catch (e) { setStatus((e as Error).message); }
  };
  const save = () => {
    if (!path.trim()) throw new Error('Enter a file path');
    kernel.fs.write(path.trim(), text);
    if (kernel.fs.exists(draftPath)) kernel.fs.rm(draftPath);
    kernel.notify();
    setStatus('Saved to ' + kernel.fs.resolve(path.trim()));
  };
  const action = (fn: () => void) => { try { fn(); } catch (e) { setStatus((e as Error).message); } };
  const run = async () => {
    setBusy(true); setOutput([]);
    try {
      save();
      const sh = new Shell(kernel, l => setOutput(prev => [...prev, l].slice(-200)));
      if (path.endsWith('.qasm')) {
        const p = kernel.sysRun('qvm', [path]);
        setOutput(p.error ? [p.error] : [...p.logs, JSON.stringify(p.result, null, 2)]);
      } else { sh.runScript(text); await sh.pending; }
    } catch (e) { setStatus((e as Error).message); }
    finally { setBusy(false); }
  };
  return <View style={styles.root}>
    <Field label="File in QubitFS" value={path} onChangeText={setPath} accessibilityLabel="Document path" />
    <Row>
      <Button title="Save" onPress={() => action(save)} disabled={busy} />
      <Button title="Open" kind="ghost" onPress={() => action(() => {
        const content = kernel.fs.read(path);
        kernel.wm?.open('textedit', kernel.fs.resolve(path), true);
        setStatus(`Opened ${content.length} characters in a new window`);
      })} />
      {path.endsWith('.qasm') || path.endsWith('.qsh') ? <Button title="Save & Run" disabled={busy} onPress={() => { void run(); }} /> : null}
    </Row>
    <TextInput accessibilityLabel="Document content" value={text} onChangeText={edit} multiline textAlignVertical="top"
      autoCapitalize="none" autoCorrect={false} style={styles.editor} placeholder="Write a note, a qsh script or a QVM program…" />
    <Body color={colors.dim} style={{ fontSize: 12 }}>{status} · {text.length} characters</Body>
    {output.length ? <ScrollView style={styles.console}>{output.map((line, i) => <Mono key={i} color={colors.inkText}>{line}</Mono>)}</ScrollView> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.md, backgroundColor: colors.panel },
  editor: { flex: 1, minHeight: 120, marginVertical: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, fontSize: 16, lineHeight: 23, fontFamily: mono, color: colors.text, backgroundColor: '#fff' },
  console: { maxHeight: 180, backgroundColor: colors.ink, borderRadius: 8, padding: 10, marginTop: 8 },
});
