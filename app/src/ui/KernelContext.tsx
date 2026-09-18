/**
 * Boots one QubitOS kernel for the whole app, re-renders subscribers on
 * kernel notifications and persists the virtual filesystem to AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { FSDir } from '../os/fs';
import { Kernel } from '../os/kernel';

const FS_KEY = 'qubitos.fs.v1';

interface KernelCtx {
  kernel: Kernel;
  version: number;
  ready: boolean;
  resetFilesystem: () => Promise<void>;
}

const Ctx = createContext<KernelCtx | null>(null);

export function KernelProvider({ children, numQubits = 16, theta = 0.2 }: { children: React.ReactNode; numQubits?: number; theta?: number }) {
  const [kernel, setKernel] = useState<Kernel | null>(null);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let snapshot: FSDir | undefined;
      try {
        const raw = await AsyncStorage.getItem(FS_KEY);
        if (raw) snapshot = JSON.parse(raw) as FSDir;
      } catch {
        snapshot = undefined;
      }
      if (cancelled) return;
      const k = new Kernel({ numQubits, theta, fsSnapshot: snapshot });
      setKernel(k);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [numQubits, theta]);

  useEffect(() => {
    if (!kernel) return undefined;
    const unsub = kernel.subscribe(() => {
      setVersion((v) => v + 1);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        AsyncStorage.setItem(FS_KEY, kernel.fs.snapshot()).catch(() => undefined);
      }, 500);
    });
    return () => {
      unsub();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [kernel]);

  const value = useMemo<KernelCtx | null>(() => {
    if (!kernel) return null;
    return {
      kernel,
      version,
      ready,
      resetFilesystem: async () => {
        await AsyncStorage.removeItem(FS_KEY).catch(() => undefined);
        const k = new Kernel({ numQubits, theta });
        setKernel(k);
        setVersion(0);
      },
    };
  }, [kernel, version, ready, numQubits, theta]);

  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKernel(): KernelCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useKernel must be used inside KernelProvider');
  return ctx;
}
