/**
 * The QubitOS desktop: menu bar, draggable windows and a dock.
 * Windows are kernel service processes managed by the OS WindowManager.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { APPS, AppId, BuiltinAppId, OSWindow, WindowManager, isBuiltinApp } from '../os/wm';
import { BrowserApp } from './BrowserApp';
import { ScriptApp } from './ScriptApp';
import { StoreApp } from './StoreApp';
import { ActivityApp } from './ActivityApp';
import { APQBScreen } from './APQBScreen';
import { FinderApp } from './FinderApp';
import { useKernel } from './KernelContext';
import { MemoryScreen } from './MemoryScreen';
import { ProgramsScreen } from './ProgramsScreen';
import { QBNNApp } from './QBNNApp';
import { SettingsApp } from './SettingsApp';
import { TerminalScreen } from './TerminalScreen';
import { colors, mono, sans } from './theme';

const MENU_H = 28;
const DOCK_H = 66;
const TITLE_H = 30;

function useWindowManager(): WindowManager {
  const { kernel } = useKernel();
  const wm = useMemo(() => kernel.wm ?? new WindowManager(kernel), [kernel]);
  const [, setTick] = useState(0);
  useEffect(() => wm.subscribe(() => setTick((t) => t + 1)), [wm]);
  return wm;
}

function AppContent({ win, wm }: { win: OSWindow; wm: WindowManager }) {
  switch (win.app) {
    case 'terminal': return <TerminalScreen />;
    case 'finder': return <FinderApp path={win.arg} onOpenPath={(p) => wm.setTitle(win.id, p === '/' ? 'Finder' : `Finder — ${p.split('/').pop()}`)} />;
    case 'programs': return <ProgramsScreen initial={win.arg} />;
    case 'memory': return <MemoryScreen />;
    case 'apqb': return <APQBScreen />;
    case 'activity': return <ActivityApp />;
    case 'settings': return <SettingsApp />;
    case 'qbnn': return <QBNNApp />;
    case 'store': return <StoreApp onOpen={(app) => wm.open(app as AppId)} />;
    case 'browser': return <BrowserApp url={win.arg} onTitle={(t) => { if (t) wm.setTitle(win.id, t); }} />;
    default: {
      if (win.app.startsWith('app:')) {
        const pkg = wm.kernel.pkg.get(win.app.slice(4));
        if (pkg?.kind === 'web') return <BrowserApp url={pkg.url} onTitle={(t) => { if (t) wm.setTitle(win.id, t); }} />;
        return <ScriptApp name={win.app.slice(4)} />;
      }
      return null;
    }
  }
}

function WindowFrame({ win, wm, focused, area }: { win: OSWindow; wm: WindowManager; focused: boolean; area: { w: number; h: number } }) {
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 2,
      onPanResponderGrant: () => wm.focus(win.id),
      onPanResponderMove: (_e, g) => {
        wm.move(win.id, g.dx - last.current.x, g.dy - last.current.y);
        last.current = { x: g.dx, y: g.dy };
      },
      onPanResponderRelease: () => { last.current = { x: 0, y: 0 }; },
      onPanResponderTerminate: () => { last.current = { x: 0, y: 0 }; },
    }),
  ).current;
  const last = useRef({ x: 0, y: 0 });
  if (win.minimized) return null;
  const frame = win.maximized ? { left: 0, top: 0, width: area.w, height: area.h } : { left: win.x, top: win.y, width: win.w, height: win.h };
  return (
    <View style={[styles.window, frame, { zIndex: win.z, elevation: win.z }, focused ? styles.windowFocused : styles.windowBlurred]} onTouchStart={() => { if (!focused) wm.focus(win.id); }}>
      <View style={styles.titleBar} {...pan.panHandlers}>
        <View style={styles.lights}>
          <Pressable onPress={() => wm.close(win.id)} hitSlop={6}><View style={[styles.light, { backgroundColor: focused ? '#ff5f57' : '#ddd' }]} /></Pressable>
          <Pressable onPress={() => wm.minimize(win.id)} hitSlop={6}><View style={[styles.light, { backgroundColor: focused ? '#febc2e' : '#ddd' }]} /></Pressable>
          <Pressable onPress={() => wm.toggleMaximize(win.id)} hitSlop={6}><View style={[styles.light, { backgroundColor: focused ? '#28c840' : '#ddd' }]} /></Pressable>
        </View>
        <Text style={[styles.windowTitle, !focused && { color: '#9a9a9a' }]} numberOfLines={1}>{win.title}</Text>
        <Text style={styles.pidTag}>pid {win.pid}</Text>
      </View>
      <View style={styles.content}>
        <AppContent win={win} wm={wm} />
      </View>
    </View>
  );
}

function Clock({ compact }: { compact?: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return <Text style={styles.menuText}>{compact ? `${hh}:${mm}` : `${days[now.getDay()]} ${now.getDate()}  ${hh}:${mm}`}</Text>;
}

function BootSplash({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setP((v) => Math.min(100, v + 9)), 60);
    const done = setTimeout(onDone, 900);
    return () => { clearInterval(t); clearTimeout(done); };
  }, [onDone]);
  return (
    <View style={styles.boot}>
      <Text style={styles.bootLogo}>|ψ⟩</Text>
      <Text style={styles.bootTitle}>QubitOS</Text>
      <View style={styles.bootTrack}><View style={[styles.bootFill, { width: `${p}%` }]} /></View>
    </View>
  );
}

export function Desktop() {
  const { kernel } = useKernel();
  const wm = useWindowManager();
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [booted, setBooted] = useState(false);
  const focused = wm.focused;
  const activeTitle = focused ? wm.appInfo(focused.app)?.title ?? focused.title : 'Finder';
  const mem = kernel.sysMem();
  const narrow = useWindowDimensions().width < 600;

  useEffect(() => {
    if (booted && area.w > 0 && wm.windows.length === 0) wm.open('terminal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, area.w > 0]);

  const wallpaperStops = ['#dfe7f3', '#e9eef6', '#f1f3f8', '#e4ebf5'];
  return (
    <View style={styles.root}>
      <View style={styles.menuBar}>
        <Text style={[styles.menuText, styles.menuLogo]}>|ψ⟩</Text>
        <Text style={[styles.menuText, styles.menuApp]} numberOfLines={1}>{activeTitle}</Text>
        {!narrow ? (
          <>
            <Pressable onPress={() => wm.open('finder')}><Text style={styles.menuText}>File</Text></Pressable>
            <Pressable onPress={() => { if (focused) wm.close(focused.id); }}><Text style={styles.menuText}>Close</Text></Pressable>
            <Pressable onPress={() => wm.open('terminal', undefined, true)}><Text style={styles.menuText}>New Terminal</Text></Pressable>
            <Pressable onPress={() => wm.open('store')}><Text style={styles.menuText}>App Store</Text></Pressable>
          </>
        ) : (
          <Pressable onPress={() => { if (focused) wm.close(focused.id); }}><Text style={styles.menuText}>Close</Text></Pressable>
        )}
        <View style={{ flex: 1 }} />
        {!narrow ? <Text style={styles.menuStat}>{`${mem.free}/${mem.total} q free`}</Text> : null}
        <Text style={styles.menuStat}>{`η ${kernel.systemAPQB().T.toFixed(2)}`}</Text>
        <Text style={[styles.menuStat, { color: kernel.net.enabled ? colors.ok : colors.dim }]}>{kernel.net.enabled ? '⌾ online' : '⌾ offline'}</Text>
        <Clock compact={narrow} />
      </View>
      <View
        style={styles.desktop}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setArea({ w: width, h: height });
          wm.setArea(width, height);
        }}
      >
        {wallpaperStops.map((c, i) => (
          <View key={i} pointerEvents="none" style={[styles.wallpaperBand, { top: `${i * 25}%`, backgroundColor: c }]} />
        ))}
        <View pointerEvents="none" style={styles.wallpaperOrb} />
        <View pointerEvents="none" style={styles.wallpaperOrb2} />
        {area.w > 0 ? [...wm.windows].sort((a, b) => a.z - b.z).map((win) => (
          <WindowFrame key={win.id} win={win} wm={wm} focused={focused?.id === win.id} area={area} />
        )) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dock} contentContainerStyle={styles.dockContent}>
        {wm.dockApps().map((info) => {
          const id = info.id;
          const open = wm.byApp(id);
          const builtin = isBuiltinApp(id);
          return (
            <Pressable key={id} onPress={() => wm.open(id)} onLongPress={() => wm.closeApp(id)} style={({ pressed }) => [styles.dockItem, pressed && { transform: [{ scale: 1.12 }] }]}>
              <View style={[styles.dockIcon, { backgroundColor: builtin ? DOCK_COLORS[id as BuiltinAppId] : '#ffffff' }, !builtin && styles.dockIconApp]}>
                <Text style={[styles.dockGlyph, id === 'terminal' && { fontFamily: mono }, !builtin && { fontSize: 20 }]}>{info.icon}</Text>
              </View>
              <Text style={styles.dockLabel} numberOfLines={1}>{info.title}</Text>
              <View style={[styles.dockDot, { opacity: open.length ? 1 : 0 }]} />
            </Pressable>
          );
        })}
      </ScrollView>
      {!booted ? <BootSplash onDone={() => setBooted(true)} /> : null}
    </View>
  );
}

const DOCK_COLORS: Record<BuiltinAppId, string> = {
  terminal: '#2c2c2e', finder: '#3d8bff', programs: '#34c759', memory: '#5856d6', apqb: '#ff9500', qbnn: '#af52de', activity: '#1c1c1e', settings: '#8e8e93', store: '#0a84ff', browser: '#32ade6',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e6ecf5' },
  menuBar: { height: MENU_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 14, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.75)', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.12)' },
  menuText: { fontFamily: sans, fontSize: 13, color: colors.text },
  menuLogo: { fontSize: 15, fontWeight: '700' },
  menuApp: { fontWeight: '700', flexShrink: 1 },
  menuStat: { fontFamily: mono, fontSize: 11, color: colors.dim },
  desktop: { flex: 1, overflow: 'hidden' },
  wallpaperBand: { position: 'absolute', left: 0, right: 0, height: '26%' },
  wallpaperOrb: { position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(120,160,255,0.18)', right: -120, top: -80 },
  wallpaperOrb2: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(90,220,200,0.16)', left: -100, bottom: -60 },
  window: { position: 'absolute', backgroundColor: colors.panel, borderRadius: 11, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.25)' },
  windowFocused: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
  windowBlurred: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  titleBar: { height: TITLE_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, backgroundColor: '#ececec', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.15)' },
  lights: { flexDirection: 'row', gap: 8, width: 60 },
  light: { width: 12, height: 12, borderRadius: 6 },
  windowTitle: { flex: 1, textAlign: 'center', fontFamily: sans, color: '#4d4d4d', fontSize: 13, fontWeight: '600' },
  pidTag: { width: 60, textAlign: 'right', fontFamily: mono, fontSize: 10, color: '#9a9a9a' },
  content: { flex: 1 },
  dock: { height: DOCK_H, flexGrow: 0, backgroundColor: 'rgba(255,255,255,0.65)', borderTopWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.12)' },
  dockContent: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 4, paddingTop: 6, paddingHorizontal: 8 },
  dockItem: { alignItems: 'center', width: 50 },
  dockIcon: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  dockIconApp: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.2)' },
  dockGlyph: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: sans },
  dockLabel: { fontFamily: sans, fontSize: 9, color: colors.text, marginTop: 2 },
  dockDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.text, marginTop: 1 },
  boot: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999 },
  bootLogo: { color: '#fff', fontSize: 56, fontFamily: sans, marginBottom: 6 },
  bootTitle: { color: '#fff', fontSize: 16, fontFamily: sans, fontWeight: '600', marginBottom: 28 },
  bootTrack: { width: 180, height: 5, borderRadius: 3, backgroundColor: '#333', overflow: 'hidden' },
  bootFill: { height: '100%', backgroundColor: '#fff' },
});
