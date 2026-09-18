import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Body, Button } from './components';
import { useKernel } from './KernelContext';
import { colors, mono, sans } from './theme';

/** Browser: a WebView (native) or iframe (web) with an address bar and "Add to Dock". */
export function BrowserApp({ url: initial, onTitle }: { url?: string; onTitle?: (t: string) => void }) {
  const { kernel } = useKernel();
  const [address, setAddress] = useState(initial ?? 'https://github.com/tapiocaTakeshi/Qubit');
  const [url, setUrl] = useState(initial ?? 'https://github.com/tapiocaTakeshi/Qubit');
  const [title, setTitle] = useState('');
  const [nonce, setNonce] = useState(0);
  const online = kernel.net.enabled;

  const go = (target = address) => {
    let u = target.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    setAddress(u);
    setUrl(u);
    setNonce((n) => n + 1);
    kernel.log(`browser: navigate ${u}`);
  };

  const addToDock = () => {
    const t = title || url.replace(/^https?:\/\//, '').split('/')[0];
    kernel.pkg.addWebApp(t, url);
  };

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Button title="↻" small kind="ghost" onPress={() => go()} />
        <TextInput style={styles.address} value={address} onChangeText={setAddress} onSubmitEditing={() => go()} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" placeholder="https://" placeholderTextColor={colors.dim} />
        <Button title="Go" small onPress={() => go()} />
        <Button title="Add to Dock" small kind="ghost" onPress={addToDock} />
      </View>
      {!online ? (
        <View style={styles.offline}><Body color={colors.dim}>Network is disabled (sysctl net.enabled false).</Body></View>
      ) : (
        <WebFrame key={nonce} url={url} onTitle={(t) => { setTitle(t); onTitle?.(t); }} />
      )}
      <View style={styles.status}>
        <Text style={styles.statusText} numberOfLines={1}>{title ? `${title} — ${url}` : url}</Text>
        {Platform.OS === 'web' ? <Text style={styles.statusText}>some sites refuse to load inside a frame</Text> : null}
      </View>
    </View>
  );
}

function WebFrame({ url, onTitle }: { url: string; onTitle: (t: string) => void }) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return React.createElement('iframe' as any, { src: url, style: { flex: 1, border: 'none', width: '100%', height: '100%', backgroundColor: '#fff' }, sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups', title: url });
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebView } = require('react-native-webview');
  return <WebView source={{ uri: url }} style={{ flex: 1 }} onLoadEnd={(e: { nativeEvent: { title?: string } }) => onTitle(e.nativeEvent.title ?? '')} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.panel },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, backgroundColor: colors.panel2, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  address: { flex: 1, backgroundColor: colors.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.25)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontFamily: mono, fontSize: 12, color: colors.text },
  offline: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  status: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 3, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.panel2 },
  statusText: { fontFamily: sans, fontSize: 10, color: colors.dim, flexShrink: 1 },
});
