/**
 * The QubitOS desktop: frosted menu bar, draggable glass windows and a floating dock
 * over a mesh-gradient wallpaper. Windows are kernel service processes managed by the OS WindowManager.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { launchTarget } from '../os/webinstall';
import { APPS, AppId, BuiltinAppId, OSWindow, WindowManager, isBuiltinApp } from '../os/wm';
import { BrowserApp } from './BrowserApp';
import { ScriptApp } from './ScriptApp';
import { StoreApp } from './StoreApp';
import { ActivityApp } from './ActivityApp';
import { APQBScreen } from './APQBScreen';
import { FinderApp } from './FinderApp';
import { useWebInstall } from './InstallCard';
import { useKernel } from './KernelContext';
import { MemoryScreen } from './MemoryScreen';
import { ProgramsScreen } from './ProgramsScreen';
import { QBNNApp } from './QBNNApp';
import { SettingsApp } from './SettingsApp';
import { TextEditApp } from './TextEditApp';
import { CalculatorApp } from './CalculatorApp';
import { TerminalScreen } from './TerminalScreen';
import { PressState, colors, glass, mono, radius, sans, shadow, web } from './theme';

const MENU_H = 30;
const DOCK_H = 78;
const TITLE_H = 34;

function useWindowManager(): WindowManager {
  const { kernel } = useKernel();
  const wm = useMemo(() => kernel.wm ?? new WindowManager(kernel), [kernel]);
  const [, setTick] = useState(0);
  useEffect(() => wm.subscribe(() => setTick((t) => t + 1)), [wm]);
  return wm;
}

function AppContent({ win, wm }: { win: OSWindow; wm: WindowManager }) {
  switch (win.app) {
    case 'textedit': return <TextEditApp path={win.arg} />;
    case 'calculator': return <CalculatorApp />;
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

/** macOS traffic light; shows its glyph on hover (web) or while focused. */
function Light({ color, glyph, onPress }: { color: string; glyph: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ hovered }: PressState) => [styles.light, { backgroundColor: color }, hovered && { transform: [{ scale: 1.15 }] }]}>
      {({ hovered }: PressState) => <Text style={[styles.lightGlyph, { opacity: hovered ? 1 : 0 }]}>{glyph}</Text>}
    </Pressable>
  );
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
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [appear]);
  if (win.minimized) return null;
  const frame = win.maximized ? { left: 0, top: 0, width: area.w, height: area.h } : { left: win.x, top: win.y, width: win.w, height: win.h };
  const info = wm.appInfo(win.app);
  const builtin = isBuiltinApp(win.app);
  return (
    <Animated.View
      style={[
        styles.window,
        frame,
        { zIndex: win.z, elevation: win.z, opacity: appear, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] },
        win.maximized && { borderRadius: 0 },
        focused ? styles.windowFocused : styles.windowBlurred,
      ]}
      onTouchStart={() => { if (!focused) wm.focus(win.id); }}
    >
      <View style={[styles.titleBar, !focused && styles.titleBarBlurred]} {...pan.panHandlers}>
        <View style={styles.lights}>
          <Light color={focused ? '#ff5f57' : '#d9dae3'} glyph="×" onPress={() => wm.close(win.id)} />
          <Light color={focused ? '#febc2e' : '#d9dae3'} glyph="–" onPress={() => wm.minimize(win.id)} />
          <Light color={focused ? '#28c840' : '#d9dae3'} glyph="+" onPress={() => wm.toggleMaximize(win.id)} />
        </View>
        <View style={styles.titleCenter}>
          {info ? (
            <View style={[styles.titleIcon, { backgroundColor: builtin ? DOCK_COLORS[win.app as BuiltinAppId] : '#fff' }, !focused && { opacity: 0.5 }]}>
              <Text style={[styles.titleIconGlyph, win.app === 'terminal' && { fontFamily: mono }, !builtin && { fontSize: 9 }]}>{info.icon}</Text>
            </View>
          ) : null}
          <Text style={[styles.windowTitle, !focused && { color: colors.faint }]} numberOfLines={1}>{win.title}</Text>
        </View>
        <Text style={styles.pidTag}>{`pid ${win.pid}`}</Text>
      </View>
      <View style={styles.content}>
        <AppContent win={win} wm={wm} />
      </View>
    </Animated.View>
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
  return <Text style={[styles.menuText, { fontVariant: ['tabular-nums'] }]}>{compact ? `${hh}:${mm}` : `${days[now.getDay()]} ${now.getDate()}  ${hh}:${mm}`}</Text>;
}

function MenuItem({ title, onPress, bold }: { title: string; onPress: () => void; bold?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ hovered, pressed }: PressState) => [styles.menuItem, (hovered || pressed) && styles.menuItemHover]}>
      <Text style={[styles.menuText, bold && styles.menuApp]} numberOfLines={1}>{title}</Text>
    </Pressable>
  );
}

/** Menu-bar shortcut, shown only while the browser is offering to install QubitOS. */
function InstallPill() {
  const { status, busy, install } = useWebInstall();
  if (!status.promptable) return null;
  return (
    <Pressable onPress={install} disabled={busy} style={({ hovered, pressed }: PressState) => [styles.installPill, (hovered || pressed) && { opacity: 0.85 }]}>
      <Text style={styles.installText}>{busy ? '…' : '⤓ Install'}</Text>
    </Pressable>
  );
}

function StatPill({ text, color, dot }: { text: string; color?: string; dot?: string }) {
  return (
    <View style={styles.statPill}>
      {dot ? <View style={[styles.statDot, { backgroundColor: dot }]} /> : null}
      <Text style={[styles.menuStat, color ? { color } : null]}>{text}</Text>
    </View>
  );
}

function BootSplash({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ])).start();
    const t = setInterval(() => setP((v) => Math.min(100, v + 7)), 60);
    const done = setTimeout(() => Animated.timing(fade, { toValue: 0, duration: 320, useNativeDriver: false }).start(onDone), 1100);
    return () => { clearInterval(t); clearTimeout(done); };
  }, [onDone, fade, pulse]);
  return (
    <Animated.View style={[styles.boot, { opacity: fade }]}>
      <View pointerEvents="none" style={[styles.bootOrb, { backgroundColor: 'rgba(91,91,240,0.45)', top: '10%', left: '15%' }]} />
      <View pointerEvents="none" style={[styles.bootOrb, { backgroundColor: 'rgba(168,85,247,0.35)', bottom: '5%', right: '10%' }]} />
      <Animated.View style={[styles.bootLogoWrap, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }]}>
        <Text style={styles.bootLogo}>|ψ⟩</Text>
      </Animated.View>
      <Text style={styles.bootTitle}>QubitOS</Text>
      <Text style={styles.bootSub}>APQB · adjustable pseudo quantum bits</Text>
      <View style={styles.bootTrack}>
        <View style={[styles.bootFill, { width: `${p}%` }]}>
          <View style={styles.bootFillTip} />
        </View>
      </View>
    </Animated.View>
  );
}

function DockIcon({ id, icon, title, open, onPress, onLongPress }: { id: string; icon: string; title: string; open: boolean; onPress: () => void; onLongPress: () => void }) {
  const builtin = isBuiltinApp(id);
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={styles.dockItem}>
      {({ hovered, pressed }: PressState) => (
        <>
          {hovered ? (
            <View style={styles.tooltip}>
              <Text style={styles.tooltipText}>{title}</Text>
            </View>
          ) : null}
          <View style={[styles.dockIcon, { backgroundColor: builtin ? DOCK_COLORS[id as BuiltinAppId] : '#ffffff' }, !builtin && styles.dockIconApp, shadow.md, (hovered || pressed) && { transform: [{ translateY: -6 }, { scale: 1.12 }] }]}>
            <View pointerEvents="none" style={styles.dockSheen} />
            <Text style={[styles.dockGlyph, id === 'terminal' && { fontFamily: mono }, !builtin && { fontSize: 22 }]}>{icon}</Text>
          </View>
          <View style={[styles.dockDot, { opacity: open ? 1 : 0 }]} />
        </>
      )}
    </Pressable>
  );
}

/**
 * Which app opens at boot: `?app=<id>` when the installed app was launched from one of the
 * manifest's shortcuts and the id is real, otherwise the Terminal.
 */
function bootApp(installed: (name: string) => unknown): AppId {
  const search = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location?.search : undefined;
  const id = launchTarget(search);
  if (!id) return 'terminal';
  if (isBuiltinApp(id)) return id;
  if (id.startsWith('app:') && installed(id.slice(4))) return id as AppId;
  if (installed(id)) return `app:${id}` as AppId;
  return 'terminal';
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
    if (booted && area.w > 0 && wm.windows.length === 0) wm.open(bootApp(kernel.pkg.get.bind(kernel.pkg)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, area.w > 0]);

  return (
    <View style={styles.root}>
      {/* Mesh wallpaper: a vertical gradient (CSS on the web, interpolated bands natively) plus blurred colour orbs. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wallpaper]}>
        {Platform.OS !== 'web' ? WALLPAPER_BANDS.map((c, i) => (
          <View key={i} style={[styles.wallpaperBand, { top: `${(100 * i) / WALLPAPER_BANDS.length}%`, backgroundColor: c }]} />
        )) : null}
        {ORBS.map((o, i) => (
          <View key={i} style={[styles.orb, o]} />
        ))}
      </View>

      <View style={[styles.menuBar, glass(0.62, 30)]}>
        <View style={styles.menuLogo}><Text style={styles.menuLogoText}>|ψ⟩</Text></View>
        <MenuItem title={activeTitle} bold onPress={() => { if (focused) wm.focus(focused.id); }} />
        {!narrow ? (
          <>
            <MenuItem title="File" onPress={() => wm.open('finder')} />
            <MenuItem title="Close" onPress={() => { if (focused) wm.close(focused.id); }} />
            <MenuItem title="New Terminal" onPress={() => wm.open('terminal', undefined, true)} />
            <MenuItem title="App Store" onPress={() => wm.open('store')} />
          </>
        ) : (
          <MenuItem title="Close" onPress={() => { if (focused) wm.close(focused.id); }} />
        )}
        <View style={{ flex: 1 }} />
        <InstallPill />
        {!narrow ? <StatPill text={`${mem.free}/${mem.total} q`} /> : null}
        <StatPill text={`η ${kernel.systemAPQB().T.toFixed(2)}`} color={colors.accent} />
        <StatPill text={kernel.net.enabled ? 'online' : 'offline'} dot={kernel.net.enabled ? colors.ok : colors.faint} />
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
        {area.w > 0 ? [...wm.windows].sort((a, b) => a.z - b.z).map((win) => (
          <WindowFrame key={win.id} win={win} wm={wm} focused={focused?.id === win.id} area={area} />
        )) : null}
      </View>

      <View style={styles.dockArea} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.dock, glass(0.55, 30), shadow.lg]} contentContainerStyle={styles.dockContent}>
          {wm.dockApps().map((info, i) => (
            <React.Fragment key={info.id}>
              {i === Object.keys(APPS).length ? <View style={styles.dockSep} /> : null}
              <DockIcon id={info.id} icon={info.icon} title={info.title} open={wm.byApp(info.id).length > 0} onPress={() => wm.open(info.id)} onLongPress={() => wm.closeApp(info.id)} />
            </React.Fragment>
          ))}
        </ScrollView>
      </View>
      {!booted ? <BootSplash onDone={() => setBooted(true)} /> : null}
    </View>
  );
}

const DOCK_COLORS: Record<BuiltinAppId, string> = {
  textedit: '#f59e0b', calculator: '#475569', terminal: '#1c1e33', finder: '#3b82f6', programs: '#22c55e', memory: '#6366f1', apqb: '#f97316', qbnn: '#a855f7', activity: '#0ea5e9', settings: '#64748b', store: '#2563eb', browser: '#14b8a6',
};

const WALLPAPER_STOPS: Array<[number, number, number]> = [[223, 227, 251], [232, 232, 252], [238, 240, 251], [235, 243, 251], [227, 238, 251]];
/** 24 bands interpolated between the stops, for platforms without CSS gradients. */
const WALLPAPER_BANDS = [...Array(24).keys()].map((i) => {
  const t = (i / 23) * (WALLPAPER_STOPS.length - 1);
  const a = WALLPAPER_STOPS[Math.floor(t)];
  const b = WALLPAPER_STOPS[Math.min(WALLPAPER_STOPS.length - 1, Math.floor(t) + 1)];
  const f = t - Math.floor(t);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
});
const WALLPAPER_GRADIENT = `linear-gradient(180deg, ${WALLPAPER_STOPS.map((c, i) => `rgb(${c.join(',')}) ${(100 * i) / (WALLPAPER_STOPS.length - 1)}%`).join(', ')})`;
const ORBS = [
  { width: 560, height: 560, borderRadius: 280, backgroundColor: 'rgba(120,120,255,0.42)', right: -160, top: -180 },
  { width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(168,85,247,0.30)', left: '30%', top: '35%' },
  { width: 480, height: 480, borderRadius: 240, backgroundColor: 'rgba(20,184,166,0.28)', left: -160, bottom: -140 },
  { width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(255,255,255,0.7)', right: '20%', bottom: '10%' },
] as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e7e9fb' },
  wallpaper: { ...web({ backgroundImage: WALLPAPER_GRADIENT }) },
  wallpaperBand: { position: 'absolute', left: 0, right: 0, height: '5%' },
  orb: { position: 'absolute', ...web({ filter: 'blur(70px)' }) },
  menuBar: { height: MENU_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 2, overflow: 'hidden', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(20,24,48,0.10)', zIndex: 10 },
  menuLogo: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.accent, marginRight: 6, ...shadow.glow },
  menuLogoText: { fontFamily: sans, fontSize: 13, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  menuItem: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, ...web({ cursor: 'default' }) },
  menuItemHover: { backgroundColor: 'rgba(20,24,48,0.08)' },
  menuText: { fontFamily: sans, fontSize: 13, color: colors.text, letterSpacing: -0.1 },
  menuApp: { fontWeight: '700', flexShrink: 1 },
  menuStat: { fontFamily: mono, fontSize: 10.5, color: colors.dim, fontVariant: ['tabular-nums'] },
  installPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.accent, marginHorizontal: 3, ...shadow.glow, ...web({ cursor: 'pointer' }) },
  installText: { fontFamily: sans, fontSize: 11.5, fontWeight: '700', color: colors.onAccent, letterSpacing: -0.1 },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: 'rgba(20,24,48,0.06)', marginHorizontal: 3 },
  statDot: { width: 6, height: 6, borderRadius: 3 },
  desktop: { flex: 1, overflow: 'hidden' },
  window: { position: 'absolute', backgroundColor: colors.panel, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', ...web({ outlineStyle: 'solid', outlineWidth: 1, outlineColor: 'rgba(20,24,48,0.18)' }) },
  windowFocused: { ...shadow.lg },
  windowBlurred: { ...shadow.md, opacity: 0.96 },
  titleBar: { height: TITLE_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, backgroundColor: '#f6f7fb', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, ...web({ cursor: 'grab', userSelect: 'none' }) },
  titleBarBlurred: { backgroundColor: '#fafafd' },
  lights: { flexDirection: 'row', gap: 8, width: 64 },
  light: { width: 12, height: 12, borderRadius: 6, alignItems: 'center', justifyContent: 'center', ...web({ transitionProperty: 'transform', transitionDuration: '120ms' }) },
  lightGlyph: { fontSize: 9, lineHeight: 11, fontWeight: '800', color: 'rgba(0,0,0,0.55)', fontFamily: sans },
  titleCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  titleIcon: { width: 16, height: 16, borderRadius: 4.5, alignItems: 'center', justifyContent: 'center' },
  titleIconGlyph: { color: '#fff', fontSize: 8, fontWeight: '700', fontFamily: sans },
  windowTitle: { fontFamily: sans, color: colors.text, fontSize: 13, fontWeight: '600', letterSpacing: -0.1, flexShrink: 1 },
  pidTag: { width: 64, textAlign: 'right', fontFamily: mono, fontSize: 10, color: colors.faint },
  content: { flex: 1 },
  dockArea: { height: DOCK_H, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8 },
  dock: { flexGrow: 0, maxWidth: '96%', borderRadius: radius.lg + 2, borderWidth: 1 },
  dockContent: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingVertical: 7, paddingHorizontal: 10 },
  dockSep: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: 'rgba(20,24,48,0.18)', marginHorizontal: 4, alignSelf: 'center' },
  dockItem: { alignItems: 'center', width: 52, ...web({ cursor: 'pointer' }) },
  dockIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...web({ transitionProperty: 'transform', transitionDuration: '160ms', transitionTimingFunction: 'cubic-bezier(.2,.8,.2,1)' }) },
  dockSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: '48%', backgroundColor: 'rgba(255,255,255,0.22)' },
  dockIconApp: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(20,24,48,0.2)' },
  dockGlyph: { color: '#fff', fontSize: 19, fontWeight: '700', fontFamily: sans },
  dockDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.text, marginTop: 4 },
  tooltip: { position: 'absolute', top: -34, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7, backgroundColor: 'rgba(21,23,43,0.92)', zIndex: 5, ...shadow.md },
  tooltipText: { fontFamily: sans, fontSize: 11.5, color: '#fff', fontWeight: '500' },
  boot: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999, overflow: 'hidden' },
  bootOrb: { position: 'absolute', width: 480, height: 480, borderRadius: 240, ...web({ filter: 'blur(90px)' }) },
  bootLogoWrap: { width: 96, height: 96, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', marginBottom: 18, boxShadow: '0 0 60px rgba(120,120,255,0.45)' },
  bootLogo: { color: '#fff', fontSize: 44, fontFamily: sans, fontWeight: '300', letterSpacing: -1 },
  bootTitle: { color: '#fff', fontSize: 20, fontFamily: sans, fontWeight: '700', letterSpacing: -0.4, marginBottom: 4 },
  bootSub: { color: colors.inkDim, fontSize: 11.5, fontFamily: sans, letterSpacing: 0.3, marginBottom: 32 },
  bootTrack: { width: 200, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  bootFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 3, overflow: 'hidden' },
  bootFillTip: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '40%', backgroundColor: colors.accent2, ...web({ maskImage: 'linear-gradient(to right, transparent, black)', WebkitMaskImage: 'linear-gradient(to right, transparent, black)' }) },
});
