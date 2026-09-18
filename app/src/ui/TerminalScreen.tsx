import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Shell } from '../os/shell';
import { Mono } from './components';
import { useKernel } from './KernelContext';
import { PressState, colors, mono, radius, sans, spacing, web } from './theme';

interface Line {
  id: number;
  text: string;
  kind: 'out' | 'cmd' | 'err';
}

const QUICK = ['help', 'run bell', 'run bell_apqb 0.4; ent last', 'run grover 101', 'apqb 0.3', 'alloc 2 --r 0.6,-0.2', 'open finder', 'windows', 'ps', 'dmesg 10', 'sh /home/user/hello.qsh', 'run qbnn_train xor --epochs 40'];

/** Chip variant for the dark terminal chrome. */
function QuickChip({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed, hovered }: PressState) => [styles.quickChip, hovered && styles.quickChipHover, pressed && { opacity: 0.6 }]}>
      <Text style={styles.quickChipText}>{title}</Text>
    </Pressable>
  );
}

/** Terminal window content: a qsh session bound to the kernel, on dark glass. */
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

  const lineColor = (kind: Line['kind']) => (kind === 'cmd' ? '#c4b5fd' : kind === 'err' ? '#fb7185' : colors.inkText);

  return (
    <View style={styles.container}>
      <View pointerEvents="none" style={styles.glowTop} />
      <FlatList
        ref={listRef}
        data={lines}
        keyExtractor={(l) => String(l.id)}
        style={styles.output}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.sm }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <Mono color={lineColor(item.kind)} style={item.kind === 'cmd' ? styles.cmdLine : undefined}>{item.text || ' '}</Mono>}
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
          placeholderTextColor={colors.inkDim}
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          returnKeyType="send"
          onKeyPress={(e) => {
            if (e.nativeEvent.key === 'ArrowUp') recall(1);
            if (e.nativeEvent.key === 'ArrowDown') recall(-1);
          }}
        />
        <Pressable onPress={() => submit()} style={({ pressed }) => [styles.enter, pressed && { opacity: 0.7 }]}>
          <Text style={styles.enterText}>↩</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quick} contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.sm, alignItems: 'center' }} keyboardShouldPersistTaps="always">
        {QUICK.map((q) => (
          <QuickChip key={q} title={q} onPress={() => submit(q)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  glowTop: { position: 'absolute', top: -120, left: '20%', width: 360, height: 240, borderRadius: 180, backgroundColor: 'rgba(91,91,240,0.28)', ...web({ filter: 'blur(60px)' }) },
  output: { flex: 1 },
  cmdLine: { fontWeight: '500' },
  quick: { maxHeight: 40, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.03)', borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
  quickChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', ...web({ cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '120ms' }) },
  quickChipHover: { backgroundColor: 'rgba(255,255,255,0.14)' },
  quickChipText: { fontFamily: mono, color: colors.inkText, fontSize: 11.5 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ink2, borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: spacing.md, paddingVertical: 4, gap: 4 },
  prompt: { fontFamily: mono, color: '#a5b4fc', fontSize: 12.5, fontWeight: '500' },
  input: { flex: 1, color: colors.inkText, fontFamily: mono, fontSize: 13.5, paddingVertical: 7, paddingHorizontal: 6, ...web({ outlineStyle: 'none', caretColor: '#c4b5fd' }) },
  enter: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', ...web({ cursor: 'pointer' }) },
  enterText: { color: '#fff', fontSize: 15, fontFamily: sans, lineHeight: 18 },
});
