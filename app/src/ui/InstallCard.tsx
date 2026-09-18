/**
 * "Install QubitOS" — the desktop's front end for the browser's own install flow.
 *
 * On the web the exported build is a progressive web app, so a browser that supports installation
 * hands us a `beforeinstallprompt` event which this card replays on demand. Browsers that install by
 * hand (Safari, iOS) get the steps instead. On native there is nothing to install: the card says so.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { InstallOutcome, InstallStatus } from '../os/webinstall';
import { Body, Button, Card, Row } from './components';
import { useKernel } from './KernelContext';
import { colors, mono, radius, sans, shadow, spacing } from './theme';

export interface WebInstall {
  status: InstallStatus;
  busy: boolean;
  /** Empty until the user tries to install. */
  message: string;
  install: () => void;
}

/** Live install status for the running kernel, plus the action that opens the browser's dialog. */
export function useWebInstall(): WebInstall {
  const { kernel } = useKernel();
  const installer = kernel.webInstall;
  const [status, setStatus] = useState<InstallStatus>(() => installer.status());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setStatus(installer.status());
    return installer.subscribe(() => setStatus(installer.status()));
  }, [installer]);

  const install = useCallback(() => {
    setBusy(true);
    setMessage('Waiting for the browser…');
    installer
      .install()
      .then((outcome: InstallOutcome) => setMessage(OUTCOME_TEXT[outcome]))
      .catch((e: Error) => setMessage(e.message))
      .finally(() => {
        setBusy(false);
        setStatus(installer.status());
      });
  }, [installer]);

  return { status, busy, message, install };
}

const OUTCOME_TEXT: Record<InstallOutcome, string> = {
  accepted: 'Installing — QubitOS will appear with your other apps.',
  dismissed: 'Install cancelled.',
  installed: 'QubitOS is already installed on this device.',
  unavailable: 'This browser did not offer an install prompt.',
};

/** The |ψ⟩ app tile, matching the dock and the boot screen. */
function AppTile() {
  return (
    <View style={[styles.tile, shadow.md]}>
      <Text style={styles.tileGlyph}>|ψ⟩</Text>
    </View>
  );
}

/** Install card for the App Store and System Settings. */
export function InstallCard({ compact }: { compact?: boolean }) {
  const { status, busy, message, install } = useWebInstall();
  const { installed, promptable, supported, offlineReady, manual } = status;
  const desktop = status.platform === 'electron';
  const state = !supported
    ? 'This is the native app — it is already installed.'
    : desktop
      ? 'This is the QubitOS desktop app.'
      : installed
        ? 'Installed on this device.'
        : 'Not installed.';

  return (
    <Card title="Install QubitOS" accent={installed ? colors.ok : colors.accent}>
      <View style={styles.head}>
        <AppTile />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>QubitOS <Text style={styles.meta}>1.0.0 · {desktop ? 'desktop app' : 'web app'}</Text></Text>
          <Body color={colors.dim} style={{ fontSize: 12 }}>
            {compact
              ? 'Run QubitOS in its own window, offline, with your filesystem kept on this device.'
              : 'Install this page as an app: it launches in its own window without browser chrome, keeps the QubitFS you have on this device, and starts even when you are offline.'}
          </Body>
        </View>
        <View style={{ gap: 4 }}>
          {installed ? (
            <Text style={[styles.badge, { color: colors.ok }]}>✓ Installed</Text>
          ) : (
            <Button title={busy ? '…' : 'Install'} small disabled={!promptable || busy} onPress={install} />
          )}
        </View>
      </View>
      <Body color={installed ? colors.ok : colors.dim} style={{ fontSize: 12, marginTop: spacing.sm }}>{state}</Body>
      {!installed && manual ? <Body color={colors.dim} style={{ fontSize: 12 }}>{manual}</Body> : null}
      {message ? <Body color={colors.text} style={{ fontSize: 12, marginTop: 2 }}>{message}</Body> : null}
      {supported ? (
        <Row style={{ marginTop: spacing.sm }}>
          <Text style={styles.foot}>{offlineReady ? 'offline ready · service worker active' : 'caching for offline use…'}</Text>
        </Row>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: { width: 54, height: 54, borderRadius: radius.sm + 4, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  tileGlyph: { color: '#fff', fontFamily: sans, fontSize: 21, fontWeight: '300', letterSpacing: -0.5 },
  name: { fontFamily: sans, fontSize: 14, fontWeight: '600', color: colors.text, letterSpacing: -0.1 },
  meta: { fontFamily: sans, fontSize: 11, fontWeight: '400', color: colors.faint },
  badge: { fontFamily: sans, fontSize: 12, fontWeight: '600' },
  foot: { fontFamily: mono, fontSize: 10, color: colors.faint },
});
