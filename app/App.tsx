import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform, SafeAreaView, StyleSheet } from 'react-native';
import { Desktop } from './src/ui/Desktop';
import { KernelProvider } from './src/ui/KernelContext';

const WEB_FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';

/** On the web, load Inter / JetBrains Mono and set the page background so the wallpaper has no white edges. */
function useWebChrome() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (!document.querySelector(`link[href="${WEB_FONTS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = WEB_FONTS;
      document.head.appendChild(link);
    }
    document.body.style.backgroundColor = '#e7e9fb';
    (document.body.style as unknown as Record<string, string>).webkitFontSmoothing = 'antialiased';
  }, []);
}

/** QubitOS: the kernel boots, then the desktop (window manager, dock, menu bar) takes over. */
export default function App() {
  useWebChrome();
  return (
    <KernelProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <Desktop />
      </SafeAreaView>
    </KernelProvider>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#e7e9fb' } });
