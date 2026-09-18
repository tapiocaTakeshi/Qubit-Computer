import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Shell } from '../os/shell';
import { Chip, Mono } from './components';
import { useKernel } from './KernelContext';
import { colors, mono, spacing } from './theme';

interface Line {
  id: number;
  text: string;
  kind: 'out' | 'cmd' | 'err';
}

const QUICK = ['help', 'run bell', 'run bell_apqb 0.4; ent last', 'run grover 101', 'apqb 0.3', 'alloc 2 --r 0.6,-0.2', 'open finder', 'windows', 'ps', 'dmesg 10', 'sh /home/user/hello.qsh', 'run qbnn_train xor --epochs 40'];

/** Terminal window content: a qsh session bound to the kernel. */
export function TerminalScreen() {
  const { kernel } = useKernel();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const idRef = useRef(0);
  const listRef = useRef<FlatList<Line>>(null);

  const push = (text: string, kind: Line['kind'] = 'out') => {
    const items = text.split('\n').map((t) => ({ id: idRef.current++, text: t, kind }));
    setLines((prev) => [...prev, ...items].slice(-2000));
  };

  const shell = useMemo(() => {
    const sh = new Shell(kernel, (l) => push(l, l.startsWith('qsh:') ? 'err' : 'out'));
    sh.onClear = () => setLines([]);
    return sh;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel]);

  useEffect(() => {
    setLines([]);
    push(`Last login: ${new Date().toLocaleString()} on qubitos`);
    shell.executeLine('motd');
  }, [kernel, shell]);

  const submit = (cmd?: string) => {
    const line = (cmd ?? input).trim();
    if (!line) return;
    push(`${shell.prompt()}${line}`, 'cmd');
    shell.executeLine(line);
    setHistory((h) => [line, ...h].slice(0, 100));
    setHistIdx(-1);
    setInput('');
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  };

  const recall = (dir: 1 | -1) => {
    const next = Math.min(history.length - 1, Math.max(-1, histIdx + dir));
    setHistIdx(next);
    setInput(next === -1 ? '' : history[next]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={lines}
        keyExtractor={(l) => String(l.id)}
        style={styles.output}
        contentContainerStyle={{ padding: spacing.sm }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <Mono color={item.kind === 'cmd' ? colors.accent : item.kind === 'err' ? colors.danger : colors.text}>{item.text || ' '}</Mono>}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />
      <View style={styles.inputRow}>
        <Text style={styles.prompt}>{shell.prompt()}</Text>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => submit()}
          placeholder="type a command (help)"
          placeholderTextColor={colors.dim}
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          returnKeyType="send"
          onKeyPress={(e) => {
            if (e.nativeEvent.key === 'ArrowUp') recall(1);
            if (e.nativeEvent.key === 'ArrowDown') recall(-1);
          }}
        />
        <Text style={styles.enter} onPress={() => submit()}>↩</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quick} contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.sm }} keyboardShouldPersistTaps="always">
        {QUICK.map((q) => (
          <Chip key={q} title={q} onPress={() => submit(q)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.panel },
  output: { flex: 1 },
  quick: { maxHeight: 38, paddingVertical: 5, backgroundColor: colors.panel2, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.panel, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  prompt: { fontFamily: mono, color: colors.accent, fontSize: 12 },
  input: { flex: 1, color: colors.text, fontFamily: mono, fontSize: 13.5, paddingVertical: 6, paddingHorizontal: 6 },
  enter: { color: colors.accent, fontSize: 18, paddingHorizontal: 8 },
});
