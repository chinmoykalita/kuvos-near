import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@kuvos/mobile-core/components/button';
import { Screen } from '@kuvos/mobile-core/components/screen';
import { Text } from '@kuvos/mobile-core/components/text';
import { colors } from '@kuvos/mobile-core/theme';

import { useNear } from './extensions';
import { nearApi, type ProofBundle } from './near-api';
import { linkNearAccount, signCommitment } from './wallet';

// Shown once, right after a plan is confirmed: the moment a person's endorsement means most.
// Care is already active; signing is optional and can also be done later from Proofs.
export function SignPlanScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const router = useRouter();
  const { config, wallet, refresh } = useNear();
  const [bundle, setBundle] = useState<ProofBundle>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const network = config?.network ?? 'testnet';

  useEffect(() => {
    let active = true;
    nearApi
      .subject('plan', planId)
      .then((next) => active && setBundle(next))
      .catch(() => active && router.replace('/today'));
    return () => {
      active = false;
    };
  }, [planId, router]);

  async function sign() {
    if (!bundle) return;
    setBusy(true);
    setError('');
    try {
      // Each wallet approval opens a window and needs its own tap: link first, then sign.
      if (!wallet?.accountId) {
        await linkNearAccount(network);
        refresh();
        return;
      }
      setBundle(await signCommitment(network, bundle));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Signing did not finish. You can sign later from Proofs.');
    } finally {
      setBusy(false);
    }
  }

  const body = bundle ? (JSON.parse(bundle.event.payload) as { body?: { plan?: { name?: string }; planVersion?: number; items?: unknown[] } }).body : undefined;
  const signed = !!bundle?.signature;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Plan confirmed', headerBackVisible: false }} />
      {!bundle ? (
        <ActivityIndicator color={colors.cobalt} />
      ) : (
        <>
          <View className="gap-2">
            <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">Your plan is active</Text>
            <Text className="font-serif text-2xl text-deep-blue">
              {signed ? 'Signed. Thank you.' : 'Sign this plan with NEAR?'}
            </Text>
            <Text className="text-base leading-6 text-slate">
              {signed
                ? `${bundle.signature!.accountId} endorsed this exact plan version. Anyone with the proof can check it.`
                : 'Your NEAR account can endorse this exact plan version: "I reviewed and confirmed it against its source document." It is a free message, not a transaction. Care works the same if you skip it.'}
            </Text>
          </View>

          <View className="gap-2 rounded-3xl border border-line bg-white p-5">
            <Text className="text-base font-bold text-deep-blue">
              {body?.plan?.name ?? 'Care plan'} · version {body?.planVersion ?? 1}
            </Text>
            <Text className="text-sm text-slate">{body?.items?.length ?? 0} confirmed instructions</Text>
            <Text className="font-mono text-xs text-slate">SHA-256 {bundle.event.digest}</Text>
          </View>

          {!!error && (
            <Text accessibilityRole="alert" className="text-sm text-coral">
              {error}
            </Text>
          )}

          {signed ? (
            <>
              <Button title="Continue to Today" onPress={() => router.replace('/today')} />
              <Button
                title="View proof"
                variant="secondary"
                onPress={() => router.replace({ pathname: '/near/[id]', params: { id: bundle.event.id } })}
              />
            </>
          ) : (
            <>
              <Button
                title={wallet?.accountId ? `Sign as ${wallet.accountId}` : 'Link NEAR account'}
                loading={busy}
                onPress={() => void sign()}
              />
              <Button title="Not now" variant="secondary" disabled={busy} onPress={() => router.replace('/today')} />
            </>
          )}
        </>
      )}
    </Screen>
  );
}
