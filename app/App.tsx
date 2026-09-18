import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { Desktop } from './src/ui/Desktop';
import { KernelProvider } from './src/ui/KernelContext';

/** QubitOS: the kernel boots, then the desktop (window manager, dock, menu bar) takes over. */
export default function App() {
  return (
    <KernelProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <Desktop />
      </SafeAreaView>
    </KernelProvider>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#e6ecf5' } });
