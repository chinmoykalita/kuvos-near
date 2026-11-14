import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { Pressable, View } from 'react-native';

import { api, type OccurrenceAction, type SkipReason } from '@kuvos/mobile-core/api';
import { AppExtensionsProvider, type AppExtensions, type Occurrence } from '@kuvos/mobile-core/app-extensions';
import { Text } from '@kuvos/mobile-core/components/text';

import { nearApi, type NearConfig, type NearWallet } from './near-api';
import { signCommitment } from './wallet';

type NearState = {
  config?: NearConfig;
  wallet?: NearWallet;
  refresh: () => void;
};

const NearContext = createContext<NearState>({ refresh: () => undefined });
export const useNear = () => useContext(NearContext);

function NearCard() {
  const router = useRouter();
  const { wallet, config } = useNear();
  return (
    <Pressable
      accessibilityRole="button"
      className="gap-1 rounded-3xl border border-line bg-white p-5"
      onPress={() => router.push('/near')}
    >
      <Text className="text-2xs uppercase tracking-eyebrow text-cobalt">NEAR · {config?.network ?? 'testnet'}</Text>
      <Text className="text-base font-bold text-deep-blue">Proofs on NEAR</Text>
      <Text className="text-sm leading-5 text-slate">
        {wallet?.accountId
          ? `Signing as ${wallet.accountId}. See what the private AI drafted, what you confirmed and every check-in, each anchored on NEAR.`
          : 'Link a NEAR account to sign what you confirm. Every plan, check-in and Tomo decision is already committed privately.'}
      </Text>
    </Pressable>
  );
}

function TodayProof() {
  const router = useRouter();
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push('/near')}>
      <Text className="text-xs font-semibold text-white/80 underline">Private AI · human-confirmed · anchored on NEAR</Text>
    </Pressable>
  );
}

export function NearExtensions({ children }: PropsWithChildren) {
  const [config, setConfig] = useState<NearConfig>();
  const [wallet, setWallet] = useState<NearWallet>();
  const refresh = useCallback(() => {
    void nearApi.config().then(setConfig).catch(() => undefined);
    // Signed-out visitors get 401 here; that is expected.
    void nearApi.wallet().then(setWallet).catch(() => setWallet(undefined));
  }, []);
  useEffect(refresh, [refresh]);

  const value: AppExtensions = {
    moreContent: <NearCard />,
    todaySummary: <TodayProof />,
    // Offer the person a signature on the plan version they just confirmed (skippable).
    afterPlanConfirm: async (planId: string) => (config?.enabled ? `/near/sign-plan/${planId}` : undefined),
    logActivity: async (occurrence: Occurrence, action: OccurrenceAction, reason?: SkipReason) => {
      const logged = await api<{ near: { eventId: string } | null }>(`/occurrences/${occurrence.id}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      });
      const eventId = logged.near?.eventId;
      // Care recording never waits for a wallet. Signing is an optional second step.
      const linked = await nearApi.wallet().catch(() => undefined);
      if (!eventId || !linked?.accountId) return undefined;
      return async () => {
        try {
          const bundle = await nearApi.event(eventId);
          if (bundle.signature) return undefined;
          await signCommitment(linked.network, bundle);
          return undefined;
        } catch {
          return 'Saved. Your NEAR signature was not added; you can sign it later from Proofs on NEAR.';
        }
      };
    },
  };
  return (
    <NearContext.Provider value={{ config, wallet, refresh }}>
      <AppExtensionsProvider value={value}>
        <View style={{ flex: 1 }}>{children}</View>
      </AppExtensionsProvider>
    </NearContext.Provider>
  );
}
