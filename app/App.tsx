import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet } from 'react-native';
import { clearCrash, CrashScreen, installGlobalErrorHandler, useCrash } from './src/ui/CrashScreen';
import { Desktop } from './src/ui/Desktop';
import { KernelProvider } from './src/ui/KernelContext';

// Installed once, at module load, so it is in place before anything else in the app can throw.
installGlobalErrorHandler();

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
  const crash = useCrash();
  if (crash) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <CrashScreen error={crash} onReset={clearCrash} />
      </SafeAreaView>
    );
  }
  return (
    <KernelProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
          <Desktop />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </KernelProvider>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#e7e9fb' } });
