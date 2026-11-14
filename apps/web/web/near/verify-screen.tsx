import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button } from '@kuvos/mobile-core/components/button';
import { Text, TextInput } from '@kuvos/mobile-core/components/text';

import { nearApi, type Check, type NearConfig } from './near-api';
import { CheckList } from './proof-screen';

// Public page: anyone holding a downloaded proof can re-run every check. The API only relays
// NEAR RPC reads; the same checks run offline with `pnpm verify bundle.json`.
export function VerifyScreen() {
  const [text, setText] = useState('');
  const [checks, setChecks] = useState<Check[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<NearConfig>();
  useEffect(() => void nearApi.config().then(setConfig).catch(() => undefined), []);

  function pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => void input.files?.[0]?.text().then(setText);
    input.click();
  }

  async function verify() {
    setError('');
    setChecks(undefined);
    let bundle: unknown;
    try {
      bundle = JSON.parse(text);
    } catch {
      setError('That is not a JSON proof file.');
      return;
    }
    setBusy(true);
    try {
      setChecks((await nearApi.verify(bundle)).checks);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  const failed = checks?.some((check) => check.ok === false);
  return (
    <ScrollView className="flex-1 bg-cloud" contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
      <Stack.Screen options={{ title: 'Verify a Kuvos proof', headerShown: true }} />
      <View className="w-full max-w-2xl gap-4">
        <Text accessibilityRole="header" className="font-serif text-3xl text-deep-blue">
          Verify a Kuvos proof
        </Text>
        <Text className="text-base leading-6 text-slate">
          A proof shows that a care plan version, a check-in or a Tomo decision existed in this exact form, who signed it
          and that its hash is anchored on NEAR {config?.network ?? 'testnet'}
          {config?.contractId ? ` in ${config.contractId}` : ''}. It also checks the NEAR AI TEE signatures behind any AI
          draft or reply. It cannot show that care actually happened, or that the AI was right.
        </Text>
        <TextInput
          multiline
          accessibilityLabel="Proof JSON"
          className="min-h-48 rounded-2xl border border-line bg-white p-4 font-mono text-xs text-ink"
          placeholder="Paste the downloaded proof JSON here"
          value={text}
          onChangeText={setText}
        />
        <View className="flex-row gap-3">
          <Button title="Verify" className="flex-1" loading={busy} disabled={!text.trim()} onPress={() => void verify()} />
          <Button title="Open file" variant="secondary" className="flex-1" onPress={pickFile} />
        </View>
        {!!error && (
          <Text accessibilityRole="alert" className="text-sm text-coral">
            {error}
          </Text>
        )}
        {checks && (
          <View className="gap-3 rounded-3xl border border-line bg-white p-5">
            <Text className={`text-lg font-bold ${failed ? 'text-coral' : 'text-deep-blue'}`}>
              {failed ? 'This proof does not verify.' : 'Every available check passed.'}
            </Text>
            <CheckList checks={checks} />
          </View>
        )}
      </View>
    </ScrollView>
  );
}
