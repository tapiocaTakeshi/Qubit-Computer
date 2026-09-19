/**
 * A crash safety net for the whole app.
 *
 * React Native's default behaviour for *any* uncaught JS exception -- in render, in an effect, in
 * an event handler, anywhere -- is to report it as fatal and terminate the native process (see
 * `ErrorUtils`/`RCTExceptionsManager`). A React error boundary only catches exceptions thrown while
 * rendering, so it cannot prevent that: an effect that throws on mount still takes the whole app
 * down. This module replaces the global handler so a bug shows a recoverable screen with the error
 * instead of a hard crash, wherever in the app it happens.
 */
import React, { useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export interface CrashInfo {
  message: string;
  stack?: string;
}

let current: CrashInfo | null = null;
const listeners = new Set<() => void>();

function setCrash(info: CrashInfo | null): void {
  current = info;
  for (const fn of [...listeners]) fn();
}

function getCrash(): CrashInfo | null {
  return current;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearCrash(): void {
  setCrash(null);
}

export function useCrash(): CrashInfo | null {
  return useSyncExternalStore(subscribe, getCrash, getCrash);
}

type ErrorHandler = (error: Error, isFatal?: boolean) => void;
interface ErrorUtilsGlobal {
  ErrorUtils?: { setGlobalHandler: (fn: ErrorHandler) => void; getGlobalHandler?: () => ErrorHandler };
}

let installed = false;

/** Route otherwise-fatal exceptions to the crash screen instead of letting the app be killed. */
export function installGlobalErrorHandler(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as unknown as ErrorUtilsGlobal;
  if (!g.ErrorUtils || typeof g.ErrorUtils.setGlobalHandler !== 'function') return;
  const previous = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler((error, isFatal) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('QubitOS: unhandled error', { isFatal, message, stack });
    setCrash({ message, stack });
    // Skip the default handler for fatal errors: that's what would otherwise report the exception
    // to native and terminate the process. Non-fatal errors keep the app's normal behaviour.
    if (!isFatal) previous?.(error, isFatal);
  });
}

export function CrashScreen({ error, onReset }: { error: CrashInfo; onReset: () => void }) {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>QubitOS hit an unexpected error</Text>
        <Text style={styles.hint}>Your files were not lost. Take a screenshot of this if you want to report it.</Text>
        <Text selectable style={styles.message}>{error.message}</Text>
        {error.stack ? <Text selectable style={styles.stack}>{error.stack}</Text> : null}
        <Pressable accessibilityRole="button" onPress={onReset} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1c1e33' },
  scroll: { padding: 24, paddingTop: 48 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  hint: { color: '#94a3b8', fontSize: 12, marginBottom: 16 },
  message: { color: '#fca5a5', fontSize: 14, marginBottom: 16 },
  stack: { color: '#94a3b8', fontSize: 11, fontFamily: 'Courier', marginBottom: 24 },
  button: { backgroundColor: '#3b82f6', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, alignSelf: 'flex-start' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
