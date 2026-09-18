import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { APQBScreen } from './src/ui/APQBScreen';
import { KernelProvider } from './src/ui/KernelContext';
import { MemoryScreen } from './src/ui/MemoryScreen';
import { ProgramsScreen } from './src/ui/ProgramsScreen';
import { SystemScreen } from './src/ui/SystemScreen';
import { TerminalScreen } from './src/ui/TerminalScreen';
import { colors, mono } from './src/ui/theme';

type Tab = 'terminal' | 'programs' | 'memory' | 'apqb' | 'system';
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'terminal', label: 'qsh', icon: '>_' },
  { id: 'programs', label: 'run', icon: '▶' },
  { id: 'memory', label: 'memory', icon: '▦' },
  { id: 'apqb', label: 'APQB', icon: 'θ' },
  { id: 'system', label: 'system', icon: '⚙' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('terminal');
  return (
    <KernelProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.title}>QubitOS</Text>
          <Text style={styles.subtitle}>|ψ(θ)⟩ = cosθ|0⟩ + sinθ|1⟩ · r = cos2θ · η = |sin2θ|</Text>
        </View>
        <View style={styles.body}>
          <View style={[styles.screen, tab !== 'terminal' && styles.hidden]}><TerminalScreen /></View>
          <View style={[styles.screen, tab !== 'programs' && styles.hidden]}><ProgramsScreen /></View>
          <View style={[styles.screen, tab !== 'memory' && styles.hidden]}><MemoryScreen /></View>
          <View style={[styles.screen, tab !== 'apqb' && styles.hidden]}><APQBScreen /></View>
          <View style={[styles.screen, tab !== 'system' && styles.hidden]}><SystemScreen /></View>
        </View>
        <View style={styles.tabBar}>
          {TABS.map((t) => (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={styles.tab}>
              <Text style={[styles.tabIcon, tab === t.id && styles.tabActive]}>{t.icon}</Text>
              <Text style={[styles.tabLabel, tab === t.id && styles.tabActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </KernelProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  title: { color: colors.accent, fontFamily: mono, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.dim, fontFamily: mono, fontSize: 10, marginTop: 2 },
  body: { flex: 1 },
  screen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hidden: { display: 'none' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tabIcon: { color: colors.dim, fontFamily: mono, fontSize: 16 },
  tabLabel: { color: colors.dim, fontSize: 10, marginTop: 2 },
  tabActive: { color: colors.accent },
});
