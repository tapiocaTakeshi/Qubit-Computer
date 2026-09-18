import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { InstalledApp, RegistryEntry } from '../os/pkg';
import { Body, Button, Card, Divider, Field, Mono, Row } from './components';
import { useKernel } from './KernelContext';
import { colors, radius, sans, spacing } from './theme';

/** App Store: install QubitOS packages and web apps from the internet. */
export function StoreApp({ onOpen }: { onOpen: (app: string) => void }) {
  const { kernel } = useKernel();
  const pkg = kernel.pkg;
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [webTitle, setWebTitle] = useState('');
  const [webUrl, setWebUrl] = useState('https://');
  const [, setTick] = useState(0);
  useEffect(() => kernel.subscribe(() => setTick((t) => t + 1)), [kernel]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setStatus(`${label}…`);
    try {
      await fn();
      setStatus(`${label}: done`);
    } catch (e) {
      setStatus(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!pkg.index.length) run('Loading registry', () => pkg.refreshIndex());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hits = pkg.search(query);
  const installed = pkg.list();

  const Entry = ({ p, app }: { p?: RegistryEntry; app?: InstalledApp }) => {
    const name = (p ?? app)!.name;
    const inst = pkg.get(name);
    const kind = (p ?? app)!.kind;
    return (
      <View style={styles.entry}>
        <View style={styles.iconWrap}><Text style={styles.icon}>{(p ?? app)!.icon ?? (kind === 'web' ? '🌐' : '▶')}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{(p ?? app)!.title} <Text style={styles.meta}>{(p ?? app)!.version} · {kind}</Text></Text>
          <Body color={colors.dim} style={{ fontSize: 12 }}>{(p ?? app)!.description ?? ''}</Body>
          {app?.kind === 'web' ? <Mono color={colors.dim} style={{ fontSize: 10 }}>{app.url}</Mono> : null}
        </View>
        <View style={{ gap: 4 }}>
          {inst ? (
            <>
              <Button title="Open" small onPress={() => onOpen(`app:${name}`)} />
              <Button title="Remove" small kind="ghost" onPress={() => run(`Removing ${name}`, async () => pkg.remove(name))} />
            </>
          ) : (
            <Button title={busy === `Installing ${name}` ? '…' : 'Get'} small disabled={!!busy} onPress={() => run(`Installing ${name}`, () => pkg.install(name))} />
          )}
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
      <Card title="Registry">
        <Row>
          <Field placeholder="search" value={query} onChangeText={setQuery} style={{ flex: 1 }} />
          <Button title="Refresh" small kind="ghost" disabled={!!busy} onPress={() => run('Refreshing registry', () => pkg.refreshIndex())} />
        </Row>
        <Mono color={colors.dim} style={{ fontSize: 10 }}>{pkg.indexSource ?? 'no registry loaded'}</Mono>
        {status ? <Body color={status.includes('error') || status.includes('HTTP') || status.includes('not') ? colors.danger : colors.dim} style={{ fontSize: 12, marginTop: 4 }}>{status}</Body> : null}
        <Divider />
        {hits.length ? hits.map((p) => <Entry key={p.name} p={p} />) : <Body color={colors.dim}>{pkg.index.length ? 'No matches.' : 'Registry not loaded — check sysctl net.enabled / net.registry.'}</Body>}
      </Card>
      <Card title="Install from URL">
        <Body color={colors.dim} style={{ fontSize: 12 }}>Any hosted package manifest (JSON). Script packages may only write under /apps/.</Body>
        <Row>
          <Field placeholder="https://…/package.json" value={url} onChangeText={setUrl} style={{ flex: 1 }} />
          <Button title="Install" small disabled={!!busy || !url.trim()} onPress={() => run(`Installing ${url}`, () => pkg.install(url.trim()))} />
        </Row>
      </Card>
      <Card title="Add a Web App">
        <Row>
          <Field placeholder="title" value={webTitle} onChangeText={setWebTitle} style={{ width: 120 }} />
          <Field placeholder="https://…" value={webUrl} onChangeText={setWebUrl} style={{ flex: 1 }} />
          <Button title="Add" small disabled={!webTitle.trim() || !/^https?:\/\/./.test(webUrl)} onPress={() => run(`Adding ${webTitle}`, async () => { pkg.addWebApp(webTitle.trim(), webUrl.trim()); setWebTitle(''); })} />
        </Row>
      </Card>
      <Card title={`Installed (${installed.length})`}>
        {installed.length ? installed.map((a) => <Entry key={a.name} app={a} />) : <Body color={colors.dim}>Nothing installed yet.</Body>}
      </Card>
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  iconWrap: { width: 44, height: 44, borderRadius: radius.sm + 3, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  icon: { fontSize: 22 },
  title: { fontFamily: sans, fontSize: 14, fontWeight: '600', color: colors.text, letterSpacing: -0.1 },
  meta: { fontFamily: sans, fontSize: 11, fontWeight: '400', color: colors.faint },
});
