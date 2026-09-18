import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { APQBScreen } from './src/ui/APQBScreen';
import { KernelProvider } from './src/ui/KernelContext';
import { MemoryScreen } from './src/ui/MemoryScreen';
import { ProgramsScreen } from './src/ui/ProgramsScreen';
import { SystemScreen } from './src/ui/SystemScreen';
import { TerminalScreen } from './src/ui/TerminalScreen';
import { colors, sans } from './src/ui/theme';

type Tab = 'terminal' | 'programs' | 'memory' | 'apqb' | 'system';
const TABS: Array<{ id: Tab; label: string; icon: string; title: string }> = [
  { id: 'terminal', label: 'Terminal', icon: '>_', title: 'Terminal' },
  { id: 'programs', label: 'Programs', icon: '▶', title: 'Programs' },
  { id: 'memory', label: 'Memory', icon: '▦', title: 'Qubit Memory' },
  { id: 'apqb', label: 'APQB', icon: 'θ', title: 'APQB' },
  { id: 'system', label: 'System', icon: '⚙', title: 'System' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('terminal');
  return (
    <KernelProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <Text style={styles.title}>{TABS.find((t) => t.id === tab)?.title}</Text>
          <Text style={styles.subtitle}>QubitOS · |ψ(θ)⟩ = cosθ|0⟩ + sinθ|1⟩</Text>
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
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.9)' },
  title: { fontFamily: sans, color: colors.text, fontSize: 17, fontWeight: '600' },
  subtitle: { fontFamily: sans, color: colors.dim, fontSize: 11, marginTop: 1 },
  body: { flex: 1 },
  screen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hidden: { display: 'none' },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.95)', paddingBottom: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 7 },
  tabIcon: { fontFamily: sans, color: colors.dim, fontSize: 17 },
  tabLabel: { fontFamily: sans, color: colors.dim, fontSize: 10, marginTop: 2 },
  tabActive: { color: colors.accent },
});
