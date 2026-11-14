import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, View } from 'react-native';

import { useCareSession } from '@kuvos/mobile-core/care-session';
import { Button } from '@kuvos/mobile-core/components/button';
import { Screen } from '@kuvos/mobile-core/components/screen';
import { Text } from '@kuvos/mobile-core/components/text';
import { colors } from '@kuvos/mobile-core/theme';

import { useNear } from './extensions';
import { kindLabel, nearApi, type EventSummary } from './near-api';
import { linkNearAccount, unlinkNearAccount } from './wallet';

const stateStyle: Record<EventSummary['state'], { label: string; className: string }> = {
  recorded: { label: 'Committed', className: 'bg-ice text-deep-blue' },
  signed: { label: 'Signed', className: 'bg-sun text-ink' },
  anchored: { label: 'On NEAR', className: 'bg-cobalt text-white' },
};

export function StateChip({ state, signed }: { state: EventSummary['state']; signed?: boolean }) {
  const style = stateStyle[state];
  return (
    <View className="flex-row gap-1.5">
      <Text className={`overflow-hidden rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-eyebrow ${style.className}`}>
        {style.label}
      </Text>
      {signed && state === 'anchored' && (
        <Text className="overflow-hidden rounded-full bg-sun px-2.5 py-1 text-2xs font-bold uppercase tracking-eyebrow text-ink">Signed</Text>
      )}
    </View>
  );
}

export function NearProofsScreen() {
  const router = useRouter();
  const { membership } = useCareSession();
  const { config, wallet, refresh } = useNear();
  const [events, setEvents] = useState<EventSummary[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | EventSummary['kind']>('all');

  const load = useCallback(() => {
    setError('');
    refresh();
    return nearApi
      .events(membership.patient.id)
      .then((result) => setEvents(result.events))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load proofs.'));
  }, [membership.patient.id, refresh]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Batches are anchored about every 30 s, so refresh while something is still waiting.
  const pending = !!config?.contractId && !!events?.some((event) => event.state !== 'anchored');
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      nearApi
        .events(membership.patient.id)
        .then((result) => setEvents(result.events))
        .catch(() => undefined);
    }, 10_000);
    return () => clearInterval(timer);
  }, [pending, membership.patient.id]);

  async function link() {
    setBusy(true);
    setError('');
    try {
      await linkNearAccount(config?.network ?? 'testnet');
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not link the NEAR account.');
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await unlinkNearAccount(config?.network ?? 'testnet');
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const shown = events?.filter((event) => filter === 'all' || event.kind === filter);

  return (
    <Screen refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}>
      <Stack.Screen options={{ title: 'Proofs on NEAR' }} />
      <View className="gap-2 rounded-3xl bg-deep-blue p-6">
        <Text className="text-2xs uppercase tracking-eyebrow text-white">How Kuvos proves care</Text>
        <Text className="font-serif text-2xl text-white">Private AI drafts. People confirm. NEAR remembers.</Text>
        <Text className="text-sm leading-5 text-white">
          Documents are read by NEAR AI Cloud models inside TEEs, and every reply is signed by the enclave. Nothing
          becomes a task until a person confirms it. Each confirmed plan, check-in and Tomo decision becomes a salted
          hash, and batches of hashes are anchored on NEAR. No health data goes on-chain.
        </Text>
        {config?.contractUrl && (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(config.contractUrl!)}>
            <Text className="text-sm font-semibold text-white underline">Contract {config.contractId}</Text>
          </Pressable>
        )}
      </View>

      <View className="gap-3 rounded-3xl border border-line bg-white p-5">
        <Text className="text-base font-bold text-deep-blue">Your NEAR signature</Text>
        {wallet?.accountId ? (
          <>
            <Text className="text-sm leading-5 text-slate">
              Linked to <Text className="font-bold text-ink">{wallet.accountId}</Text>. After you confirm a plan or record a
              check-in, your wallet asks you to sign that exact commitment (a NEP-413 message: no transaction, no fee).
            </Text>
            <Button title="Unlink account" variant="secondary" loading={busy} onPress={() => void unlink()} />
          </>
        ) : (
          <>
            <Text className="text-sm leading-5 text-slate">
              Optional. Link a NEAR {config?.network ?? 'testnet'} account to sign what you confirm and record. Care
              works the same without it.
            </Text>
            <Button title="Link NEAR account" loading={busy} onPress={() => void link()} />
          </>
        )}
      </View>

      <View className="flex-row flex-wrap gap-2">
        {(['all', 'plan_version', 'activity', 'gate_decision'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === value }}
            className={`rounded-full px-4 py-2 ${filter === value ? 'bg-deep-blue' : 'bg-white'}`}
            onPress={() => setFilter(value)}
          >
            <Text className={`text-sm font-semibold ${filter === value ? 'text-white' : 'text-deep-blue'}`}>
              {value === 'all' ? 'All' : kindLabel[value]}
            </Text>
          </Pressable>
        ))}
      </View>

      {!!error && (
        <Text accessibilityRole="alert" className="text-sm text-coral">
          {error}
        </Text>
      )}
      {!events && !error && <ActivityIndicator color={colors.cobalt} />}
      {shown?.length === 0 && (
        <Text className="text-sm text-slate">Nothing here yet. Confirm a plan or record a check-in.</Text>
      )}
      {shown?.map((event) => (
        <Pressable
          key={event.id}
          accessibilityRole="button"
          className="gap-2 rounded-3xl border border-line bg-white p-5"
          onPress={() => router.push({ pathname: '/near/[id]', params: { id: event.id } })}
        >
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-2xs uppercase tracking-eyebrow text-cobalt">{kindLabel[event.kind]}</Text>
            <StateChip state={event.state} signed={event.signed} />
          </View>
          <Text className="text-base font-semibold text-ink">{event.summary}</Text>
          <Text className="font-mono text-xs text-slate">
            {event.digest.slice(0, 20)}… · {new Date(event.createdAt).toLocaleString()}
          </Text>
        </Pressable>
      ))}
    </Screen>
  );
}
