import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { BrandLogo } from '@kuvos/mobile-core/components/brand-logo';
import { Glow } from '@kuvos/mobile-core/components/glow';
import { Tomo } from '@kuvos/mobile-core/components/tomo';
import { Text } from '@kuvos/mobile-core/components/text';
import { loadOnboardingDraft } from '@kuvos/mobile-core/onboarding-draft';
import { colors } from '@kuvos/mobile-core/theme';
import { wordmark } from '@kuvos/mobile-core/config';
import { authClient } from '../auth-client';

const googleIcon = require('../../../../../packages/mobile-core/assets/images/google-icon.svg');

const socialButton = 'h-14 flex-row items-center justify-center gap-2.5 rounded-2xl';

type Provider = 'apple' | 'google';

// Better Auth appends ?error=<code> to errorCallbackURL when the provider round trip fails.
function providerError(code?: string) {
  if (!code) return '';
  if (code === 'access_denied') return 'Sign-in was cancelled.';
  if (code === 'account_not_linked' || code === 'email_not_verified') {
    return 'That account could not be used. Sign in with an account that has a verified email address.';
  }
  return `${wordmark} could not finish signing you in. Please try again.`;
}

function AppleSignInButton({ busy, loading, onPress }: { busy: boolean; loading: boolean; onPress: () => void }) {
  // Apple's black button style: white logo and label on black.
  return (
    <Pressable
      accessibilityLabel="Continue with Apple"
      accessibilityRole="button"
      className={`${socialButton} bg-black`}
      disabled={busy}
      style={({ pressed }) => ({ opacity: busy || pressed ? 0.7 : 1 })}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <>
          <Svg width={16} height={19} viewBox="0 0 814 1000">
            <Path
              fill="#FFFFFF"
              d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
            />
          </Svg>
          <Text className="text-base font-semibold text-white">Continue with Apple</Text>
        </>
      )}
    </Pressable>
  );
}

function GoogleSignInButton({ busy, loading, onPress }: { busy: boolean; loading: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Continue with Google"
      accessibilityRole="button"
      className={`${socialButton} bg-cobalt/10`}
      disabled={busy}
      style={({ pressed }) => ({ opacity: busy || pressed ? 0.7 : 1 })}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color={colors.cobalt} />
      ) : (
        <>
          <Image accessibilityIgnoresInvertColors source={googleIcon} style={{ width: 20, height: 20 }} />
          <Text className="text-base font-semibold text-cobalt">Continue with Google</Text>
        </>
      )}
    </Pressable>
  );
}

function AgreementLine() {
  const open = (url: string) => void Linking.openURL(url).catch(() => undefined);
  return (
    <Text className="text-center text-xs leading-5 text-slate">
      By continuing you agree to the{' '}
      <Text accessibilityRole="link" className="text-xs font-bold text-deep-blue underline" onPress={() => open('https://kuvosai.com/terms')}>
        Terms
      </Text>{' '}
      and{' '}
      <Text accessibilityRole="link" className="text-xs font-bold text-deep-blue underline" onPress={() => open('https://kuvosai.com/privacy')}>
        Privacy
      </Text>
      .
    </Text>
  );
}

// kuvos-near sign-in: a synthetic demo account, plus Google and Apple when the deployment
// configures them (full-page OAuth redirects through the API).
export function SignInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ invitationId?: string; error?: string }>();
  const insets = useSafeAreaInsets();
  const invitationId =
    typeof params.invitationId === 'string' && /^[0-9a-f-]{36}$/i.test(params.invitationId)
      ? params.invitationId
      : undefined;
  const returnTo = invitationId ? `/join/${invitationId}` : '/';
  const [onboardingName, setOnboardingName] = useState('');
  const [pending, setPending] = useState<Provider | 'demo' | 'near' | null>(null);
  const [nearAccount, setNearAccount] = useState('');
  const [error, setError] = useState(() => providerError(typeof params.error === 'string' ? params.error : undefined));

  useEffect(() => {
    if (invitationId) return;
    void loadOnboardingDraft().then((draft) => {
      if (draft.step === 'done') setOnboardingName(draft.name.trim().split(/\s+/)[0] ?? '');
    });
  }, [invitationId]);

  // Synthetic demo account for judges and team testing (console OTP mode only; never real data).
  async function demoSignIn() {
    if (pending) return;
    setPending('demo');
    setError('');
    try {
      const phoneNumber = process.env.EXPO_PUBLIC_DEMO_PHONE || '+919000000001';
      const sent = await authClient.phoneNumber.sendOtp({ phoneNumber });
      if (sent.error) throw new Error(sent.error.message);
      const verified = await authClient.phoneNumber.verify({
        phoneNumber,
        code: process.env.EXPO_PUBLIC_DEMO_CODE || '900001',
      });
      if (verified.error) throw new Error(verified.error.message);
      window.location.assign(returnTo);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'The demo account is not available.');
      setPending(null);
    }
  }

  async function nearSignIn() {
    if (pending) return;
    setPending('near');
    setError('');
    try {
      const { signInWithNear, WalletConnected } = await import('../../near/wallet');
      try {
        await signInWithNear();
      } catch (caught) {
        // Connecting used up this tap; the next tap opens the wallet's signing window.
        if (caught instanceof WalletConnected) {
          setNearAccount(caught.accountId);
          setPending(null);
          return;
        }
        throw caught;
      }
      window.location.assign(returnTo);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'NEAR sign-in did not finish.');
      setPending(null);
    }
  }

  async function signIn(provider: Provider) {
    if (pending) return;
    setPending(provider);
    setError('');
    const origin = window.location.origin;
    const errorReturn = new URL('/sign-in', origin);
    if (invitationId) errorReturn.searchParams.set('invitationId', invitationId);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: new URL(returnTo, origin).href,
        errorCallbackURL: errorReturn.href,
      });
      if (result.error) {
        setError(result.error.message || `${provider === 'apple' ? 'Apple' : 'Google'} sign-in failed.`);
        setPending(null);
      }
      // On success the client navigates away to the provider; keep the spinner until it does.
    } catch {
      setError(`${wordmark} could not sign in with ${provider === 'apple' ? 'Apple' : 'Google'}.`);
      setPending(null);
    }
  }

  return (
    <View className="flex-1 bg-cloud" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Glow />
      <ScrollView contentContainerClassName="flex-grow justify-between gap-10 px-6 pb-6 pt-24">
        {onboardingName ? (
          <View className="items-center gap-3 py-2">
            <Tomo size={96} mood="happy" />
            <Text accessibilityRole="header" className="text-center font-serif text-3xl text-deep-blue">
              Almost there, <Text className="font-serif-italic text-cobalt">{onboardingName}</Text>
            </Text>
            <Text className="text-center text-base text-slate">Sign in to save your setup. It only takes a moment.</Text>
          </View>
        ) : (
          <View className="items-center gap-3 py-6">
            <BrandLogo variant="lockup" size={140} />
            <Text className="text-center font-serif text-xl text-deep-blue">
              Care, <Text className="font-serif-italic text-cobalt">followed through</Text>.
            </Text>
          </View>
        )}

        <View className="gap-3">
          {invitationId && (
            <Text className="pb-1 text-base leading-6 text-slate">
              Sign in with the account that uses the email address that received the invitation.
            </Text>
          )}
          {!!error && (
            <View className="flex-row items-start gap-3 rounded-2xl bg-coral/10 p-4">
              <Text className="text-base">⚠️</Text>
              <Text selectable accessibilityRole="alert" className="flex-1 text-sm leading-5 text-ink">
                {error}
              </Text>
            </View>
          )}
          {!invitationId && process.env.EXPO_PUBLIC_NEAR_SIGN_IN !== 'false' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue with NEAR"
              className={`${socialButton} bg-black`}
              disabled={!!pending}
              style={({ pressed }) => ({ opacity: pending || pressed ? 0.7 : 1 })}
              onPress={() => void nearSignIn()}
            >
              {pending === 'near' ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text className="text-base font-semibold text-white">
                  {nearAccount ? `Sign in as ${nearAccount}` : 'Continue with NEAR'}
                </Text>
              )}
            </Pressable>
          )}
          {!invitationId && process.env.EXPO_PUBLIC_DEMO_SIGN_IN !== 'false' && (
            <Pressable
              accessibilityRole="button"
              className={`${socialButton} bg-deep-blue`}
              disabled={!!pending}
              style={({ pressed }) => ({ opacity: pending || pressed ? 0.7 : 1 })}
              onPress={() => void demoSignIn()}
            >
              {pending === 'demo' ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text className="text-base font-semibold text-white">Try the synthetic demo</Text>
              )}
            </Pressable>
          )}
          {process.env.EXPO_PUBLIC_SOCIAL_SIGN_IN === 'true' && (
            <>
              <AppleSignInButton busy={!!pending} loading={pending === 'apple'} onPress={() => void signIn('apple')} />
              <GoogleSignInButton busy={!!pending} loading={pending === 'google'} onPress={() => void signIn('google')} />
            </>
          )}
        </View>

        <AgreementLine />
      </ScrollView>
      {!invitationId && router.canGoBack() && (
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          className="absolute left-5 h-11 w-11 items-center justify-center rounded-full bg-white"
          hitSlop={8}
          style={{ top: insets.top + 8 }}
          onPress={() => router.back()}
        >
          <Text className="text-2xl text-deep-blue">‹</Text>
        </Pressable>
      )}
    </View>
  );
}
