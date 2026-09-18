import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { calculate } from '../core/calculator';
import { useKernel } from './KernelContext';
import { colors, mono, sans } from './theme';

export function CalculatorApp() {
  const { kernel } = useKernel();
  const [input, setInput] = useState('');
  const [result, setResult] = useState('0');
  const [history, setHistory] = useState<string[]>(() => {
    try { return kernel.fs.read('/home/user/Documents/Calculations.txt').trim().split('\n').slice(-20); } catch { return []; }
  });
  const solve = () => {
    try {
      const answer = String(calculate(input)); setResult(answer);
      const next = [...history, `${input} = ${answer}`].slice(-20);
      setHistory(next); kernel.fs.write('/home/user/Documents/Calculations.txt', next.join('\n') + '\n'); kernel.notify();
    } catch (e) { setResult((e as Error).message); }
  };
  return <View style={styles.root}>
    <Text style={styles.caption}>CALCULATOR</Text>
    <TextInput accessibilityLabel="Arithmetic expression" value={input} onChangeText={setInput} onSubmitEditing={solve}
      autoCapitalize="none" autoCorrect={false} style={styles.input} placeholder="(12 + 6) / 3" />
    <Text selectable accessibilityLabel="Calculation result" style={styles.result}>{result}</Text>
    <View style={styles.grid}>{['C', '(', ')', '⌫', '7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '=', '+'].map(key =>
      <Pressable accessibilityRole="button" accessibilityLabel={key === '⌫' ? 'Backspace' : key} key={key}
        onPress={() => key === '=' ? solve() : key === 'C' ? (setInput(''), setResult('0')) : setInput(x => key === '⌫' ? x.slice(0, -1) : x + key)}
        style={[styles.key, key === '=' && { backgroundColor: colors.accent }]}>
        <Text style={[styles.keyText, key === '=' && { color: '#fff' }]}>{key === '*' ? '×' : key === '/' ? '÷' : key}</Text>
      </Pressable>)}</View>
    <ScrollView style={{ marginTop: 12 }}>{history.slice().reverse().map((entry, i) => <Text selectable key={i} style={styles.history}>{entry}</Text>)}</ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, padding: 18, backgroundColor: colors.panel },
  caption: { fontFamily: sans, color: colors.dim, fontSize: 11, letterSpacing: 2, marginBottom: 12 },
  input: { fontFamily: mono, fontSize: 18, padding: 10, backgroundColor: colors.panel2, borderRadius: 8, color: colors.text },
  result: { fontFamily: sans, fontSize: 30, textAlign: 'right', marginVertical: 16, color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  key: { width: '23%', flexGrow: 1, minHeight: 44, paddingVertical: 12, backgroundColor: colors.panel2, alignItems: 'center', borderRadius: 10 },
  keyText: { fontSize: 22, color: colors.text },
  history: { fontFamily: mono, fontSize: 12, color: colors.dim, paddingVertical: 5 },
});
