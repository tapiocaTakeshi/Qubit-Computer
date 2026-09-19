/**
 * Boots one QubitOS kernel for the whole app, re-renders subscribers on
 * kernel notifications and persists the virtual filesystem to AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { FSDir } from '../os/fs';
import { Kernel } from '../os/kernel';

const FS_KEY = 'qubitos.fs.v1';

interface KernelCtx {
  kernel: Kernel;
  version: number;
  ready: boolean;
  storageError: string | null;
  resetFilesystem: () => Promise<void>;
}

const Ctx = createContext<KernelCtx | null>(null);

export function KernelProvider({ children, numQubits = 16, theta = 0.2 }: { children: React.ReactNode; numQubits?: number; theta?: number }) {
  const [kernel, setKernel] = useState<Kernel | null>(null);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const resetting = useRef(false);
  const temporary = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let snapshot: FSDir | undefined;
      try {
        const raw = await AsyncStorage.getItem(FS_KEY);
        if (raw) snapshot = JSON.parse(raw) as FSDir;
      } catch (e) {
        if (!cancelled) setBootError(`Could not read saved files: ${(e as Error).message}`);
        return;
      }
      if (cancelled) return;
      try {
        const k = new Kernel({ numQubits, theta, fsSnapshot: snapshot });
        setKernel(k);
        setReady(true);
      } catch (e) { setBootError(`Could not boot QubitOS: ${(e as Error).message}`); }
    })();
    return () => {
      cancelled = true;
    };
  }, [numQubits, theta]);

  useEffect(() => {
    if (!kernel) return undefined;
    resetting.current = false;
    const flush = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (resetting.current || temporary.current) return;
      const snapshot = kernel.fs.snapshot();
      saves.current = saves.current.then(() => AsyncStorage.setItem(FS_KEY, snapshot))
        .then(() => setStorageError(null))
        .catch(e => setStorageError(`Files could not be saved: ${(e as Error).message}`));
    };
    const unsub = kernel.subscribe(() => {
      setVersion((v) => v + 1);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 250);
    });
    const appState = AppState.addEventListener('change', state => { if (state !== 'active') flush(); });
    const hidden = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', hidden);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);
    return () => {
      unsub();
      appState.remove();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', hidden);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [kernel]);

  const value = useMemo<KernelCtx | null>(() => {
    if (!kernel) return null;
    return {
      kernel,
      version,
      ready,
      storageError,
      resetFilesystem: async () => {
        resetting.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        await saves.current;
        try { await AsyncStorage.removeItem(FS_KEY); }
        catch (e) { resetting.current = false; setStorageError(`Reset failed: ${(e as Error).message}`); throw e; }
        temporary.current = false;
        const k = new Kernel({ numQubits, theta });
        setKernel(k);
        setVersion(0);
      },
    };
  }, [kernel, version, ready, numQubits, theta, storageError]);

  if (bootError) return <View style={{ flex: 1, padding: 32, justifyContent: 'center', backgroundColor: '#eef0fa' }}>
    <Text style={{ fontSize: 20, marginBottom: 12 }}>QubitOS could not start</Text>
    <Text selectable>{bootError}</Text>
    <Text style={{ marginVertical: 12 }}>Your existing saved files have not been overwritten. A temporary session will not save over them.</Text>
    <Pressable accessibilityRole="button" onPress={() => { setKernel(new Kernel({ numQubits, theta })); setReady(true); setBootError(null); temporary.current = true; setStorageError('Temporary session: changes will not be persisted.'); }}>
      <Text>Open temporary session</Text>
    </Pressable>
  </View>;
  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKernel(): KernelCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useKernel must be used inside KernelProvider');
  return ctx;
}
