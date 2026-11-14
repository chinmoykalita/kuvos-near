import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  View,
  type TextInput as RNTextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { BrandLogo } from '../components/brand-logo';
import { Glow } from '../components/glow';
import { Tomo } from '../components/tomo';
import { authClient } from '../auth-client';
import { loadOnboardingDraft } from '../onboarding-draft';
import {
  CountryPickerModal,
  CountryPickerTrigger,
  DEFAULT_COUNTRY,
  type Country,
} from '../components/country-picker';
import { Text, TextInput } from '../components/text';
import { colors } from '../theme';
import { signInMetadata, wordmark } from '../config';
import { useAppExtensions } from '../app-extensions';
import { Button } from '../components/button';

const googleIcon = require('../../assets/images/google-icon.svg');

// ─── helpers ──────────────────────────────────────────────────────────────────

function stripFormatting(value: string) {
  return value.replace(/[\s()\-]/g, '');
}

const socialButton = 'h-14 flex-row items-center justify-center gap-2.5 rounded-2xl';

function GoogleSignInButton({
  busy,
  loading,
  onPress,
}: {
  busy: boolean;
  loading: boolean;
  onPress: () => void;
}) {
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

function AppleSignInButton({
  available,
  busy,
  loading,
  onPress,
}: {
  available: boolean;
  busy: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  if (!available) return null;
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
          <Svg width={16} height={19} viewBox="0 0 814 1000" accessibilityElementsHidden>
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

function MailIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={colors.cobalt} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3} y={5} width={18} height={14} rx={2.5} />
      <Path d="m4 7 8 6 8-6" />
    </Svg>
  );
}

// ─── OTP boxes ────────────────────────────────────────────────────────────────

const OTP_LENGTH = 6;

function OtpInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<RNTextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  const digits = value.padEnd(OTP_LENGTH, ' ').split('');

  return (
    <Pressable onPress={() => inputRef.current?.focus()}>
      {/* Hidden real input */}
      <TextInput
        ref={inputRef}
        accessibilityLabel="Six-digit verification code"
        autoComplete="sms-otp"
        caretHidden
        editable={!disabled}
        keyboardType="number-pad"
        maxLength={OTP_LENGTH}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
        textContentType="oneTimeCode"
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, ''))}
      />

      {/* Visual digit boxes */}
      <View className="flex-row justify-between gap-2">
        {digits.map((d, i) => {
          const filled = i < value.length;
          const active = i === value.length && !disabled;
          return (
            <View
              key={i}
              className={[
                'h-16 flex-1 items-center justify-center rounded-2xl border-2',
                active
                  ? 'border-cobalt bg-white'
                  : filled
                    ? 'border-cobalt/40 bg-cloud'
                    : 'border-line bg-cloud',
              ].join(' ')}
            >
              {filled ? (
                <Text className="text-2xl font-bold text-ink">{d}</Text>
              ) : active ? (
                <View className="h-6 w-px rounded-full bg-cobalt" />
              ) : null}
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

// ─── Resend timer ─────────────────────────────────────────────────────────────

function ResendTimer({ onResend, disabled }: { onResend: () => void; disabled: boolean }) {
  const [seconds, setSeconds] = useState(30);
  const canResend = seconds === 0 && !disabled;

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [seconds]);

  return (
    <View className="flex-row items-center justify-center gap-1">
      <Text className="text-sm text-slate">{"Didn't get a code?"}</Text>
      {canResend ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSeconds(30);
            onResend();
          }}
        >
          <Text className="text-sm font-bold text-cobalt">Resend</Text>
        </Pressable>
      ) : (
        <Text className="text-sm font-semibold text-slate">Resend in {seconds}s</Text>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

// ponytail: mobile OTP is muted in the UI until an SMS sender replaces console OTP; the API route stays.
const phoneSignIn = false;

export function SignInScreen() {
  const router = useRouter();
  const { alternativeSignIn } = useAppExtensions();
  const [alternativeBusy, setAlternativeBusy] = useState(false);
  const params = useLocalSearchParams<{ invitationId?: string }>();
  const insets = useSafeAreaInsets();
  const invitationId =
    typeof params.invitationId === 'string' && /^[0-9a-f-]{36}$/i.test(params.invitationId)
      ? params.invitationId
      : undefined;
  const returnTo = invitationId ? `/join/${invitationId}` : '/';

  // Invitations go straight to email: the invite is tied to one address.
  const entryPhase = invitationId ? 'email' : phoneSignIn ? 'phone' : 'choose';
  const [phase, setPhase] = useState<'choose' | 'phone' | 'otp' | 'email' | 'email-sent'>(entryPhase);
  const [onboardingName, setOnboardingName] = useState('');
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [localNumber, setLocalNumber] = useState('');
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (invitationId) return;
    void loadOnboardingDraft().then((draft) => {
      if (draft.step === 'done') setOnboardingName(draft.name.trim().split(/\s+/)[0] ?? '');
    });
  }, [invitationId]);

  useEffect(() => {
    if (process.env.EXPO_OS === 'ios') {
      void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
    }
  }, []);

  const signInBusy = busy || googleBusy || appleBusy || alternativeBusy;

  function finishSignIn() {
    if (invitationId) {
      router.replace(`/join/${invitationId}` as Href);
    } else {
      router.replace('/');
    }
  }

  async function signInWithGoogle() {
    setGoogleBusy(true);
    setError('');
    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: returnTo,
      });
      if (result.error) {
        setError(result.error.message || 'Google sign-in failed.');
        return;
      }
      const session = await authClient.getSession();
      if (session.data) finishSignIn();
    } catch {
      setError(`${wordmark} could not sign in with Google.`);
    } finally {
      setGoogleBusy(false);
    }
  }

  async function signInWithApple() {
    if (signInBusy) return;
    setAppleBusy(true);
    setError('');
    try {
      const nonce = Crypto.randomUUID();
      const credential = await AppleAuthentication.signInAsync({
        nonce: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce),
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        setError('Apple did not return a sign-in token.');
        return;
      }
      const result = await authClient.signIn.social({
        provider: 'apple',
        callbackURL: returnTo,
        idToken: {
          token: credential.identityToken,
          nonce,
          user: {
            email: credential.email ?? undefined,
            name: {
              firstName: credential.fullName?.givenName ?? undefined,
              lastName: credential.fullName?.familyName ?? undefined,
            },
          },
        },
      });
      if (result.error) {
        setError(result.error.message || 'Apple sign-in failed.');
        return;
      }
      finishSignIn();
    } catch (cause) {
      if ((cause as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        setError(`${wordmark} could not sign in with Apple.`);
      }
    } finally {
      setAppleBusy(false);
    }
  }

  async function sendCode() {
    Keyboard.dismiss();
    const digits = stripFormatting(localNumber);
    if (!/^\d{5,14}$/.test(digits)) {
      setError('Enter a valid mobile number.');
      return;
    }
    const phoneNumber = `${country.dial}${digits}`;
    setBusy(true);
    setError('');
    try {
      const result = await authClient.phoneNumber.sendOtp({ phoneNumber });
      if (result.error) {
        setError(result.error.message || 'The code could not be sent.');
        return;
      }
      setSentTo(phoneNumber);
      setOtp('');
      setPhase('otp');
    } catch {
      setError(`${wordmark} could not reach the authentication service.`);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(code = otp) {
    if (code.length < OTP_LENGTH) {
      setError('Enter the six-digit code.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await authClient.phoneNumber.verify({
        phoneNumber: sentTo,
        code,
      });
      if (result.error) {
        setError(result.error.message || 'That code could not be verified.');
        return;
      }
      finishSignIn();
    } catch {
      setError(`${wordmark} could not reach the authentication service.`);
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    setPhase('phone');
    setOtp('');
    setError('');
  }

  async function resend() {
    setBusy(true);
    setError('');
    try {
      await authClient.phoneNumber.sendOtp({ phoneNumber: sentTo });
    } catch {
      setError(`${wordmark} could not reach the authentication service.`);
    } finally {
      setBusy(false);
    }
  }

  async function sendEmailLink() {
    Keyboard.dismiss();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await authClient.signIn.magicLink({
        email: normalizedEmail,
        name: 'Kuvos user',
        callbackURL: returnTo,
        metadata: { returnTo, ...signInMetadata },
      });
      if (result.error) {
        setError(result.error.message || 'The sign-in link could not be sent.');
        return;
      }
      setSentEmail(normalizedEmail);
      setPhase('email-sent');
    } catch {
      setError(`${wordmark} could not reach the authentication service.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-cloud"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <CountryPickerModal
        key={String(pickerVisible)}
        selected={country}
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(c) => {
          setCountry(c);
          setError('');
        }}
      />

      <Glow />
      <ScrollView
        contentContainerClassName="flex-grow justify-between gap-10 px-6 pb-6 pt-24"
        keyboardShouldPersistTaps="handled"
      >
        {onboardingName ? (
          <View className="items-center gap-3 py-2">
            <Tomo size={96} mood="happy" />
            <Text accessibilityRole="header" className="text-center font-serif text-3xl text-deep-blue">
              Almost there, <Text className="font-serif-italic text-cobalt">{onboardingName}</Text>
            </Text>
            <Text className="text-center text-base text-slate">
              Sign in to save your setup. It only takes a moment.
            </Text>
          </View>
        ) : (
          <View className="items-center gap-3 py-6">
            <BrandLogo variant="lockup" size={140} />
            <Text className="text-center font-serif text-xl text-deep-blue">
              Care, <Text className="font-serif-italic text-cobalt">followed through</Text>.
            </Text>
          </View>
        )}

        {/* Card content */}
        <View className="gap-6">
          {!invitationId && phase === entryPhase && alternativeSignIn && (
            <Button title={alternativeSignIn.label} disabled={signInBusy} loading={alternativeBusy}
              onPress={() => {
                setAlternativeBusy(true);
                setError('');
                void alternativeSignIn.connect().then(finishSignIn)
                  .catch((error: unknown) => setError(error instanceof Error ? error.message : 'Could not sign in.'))
                  .finally(() => setAlternativeBusy(false));
              }} />
          )}
          {phase === 'choose' ? (
            <View className="gap-3">
              {!!error && (
                <View className="flex-row items-start gap-3 rounded-2xl bg-coral/10 p-4">
                  <Text className="text-base">⚠️</Text>
                  <Text selectable accessibilityRole="alert" className="flex-1 text-sm leading-5 text-ink">
                    {error}
                  </Text>
                </View>
              )}
              <AppleSignInButton available={appleAvailable} busy={signInBusy} loading={appleBusy} onPress={signInWithApple} />
              <GoogleSignInButton busy={signInBusy} loading={googleBusy} onPress={signInWithGoogle} />
              <Pressable
                accessibilityRole="button"
                className="min-h-12 flex-row items-center justify-center gap-2.5 self-center px-4"
                disabled={signInBusy}
                style={({ pressed }) => ({ opacity: signInBusy || pressed ? 0.6 : 1 })}
                onPress={() => {
                  setError('');
                  setPhase('email');
                }}
              >
                <MailIcon />
                <Text className="text-base font-semibold text-cobalt">Use email</Text>
              </Pressable>
            </View>
          ) : phase === 'phone' ? (
            <>
              <View className="gap-4">
                <Text className="px-1 text-sm text-slate">Sign in or create an account</Text>
                {/* Phone input */}
                <View className="-mt-1 h-14 flex-row items-center overflow-hidden rounded-2xl border border-line bg-white px-2">
                  <CountryPickerTrigger country={country} onPress={() => setPickerVisible(true)} />
                  <View className="mx-2 h-8 w-px bg-line" />
                  <View className="min-h-0 min-w-0 flex-1 justify-center">
                    <TextInput
                      accessibilityLabel="Mobile number"
                      autoComplete="tel"
                      className="w-full text-ink"
                      keyboardType="phone-pad"
                      placeholder="Mobile number"
                      placeholderTextColor={colors.slate}
                      returnKeyType="done"
                      textContentType="telephoneNumber"
                      value={localNumber}
                      style={{
                        fontSize: 17,
                        height: 40,
                        includeFontPadding: false,
                        lineHeight: 22,
                        paddingHorizontal: 0,
                        paddingVertical: 0,
                        textAlign: 'left',
                        textAlignVertical: 'center',
                      }}
                      onChangeText={(v) => {
                        setLocalNumber(v);
                        setError('');
                      }}
                      onSubmitEditing={sendCode}
                    />
                  </View>
                </View>

                {!!error && (
                  <View className="flex-row items-start gap-3 rounded-2xl bg-coral/10 p-4">
                    <Text className="text-base">⚠️</Text>
                    <Text
                      selectable
                      accessibilityRole="alert"
                      className="flex-1 text-sm leading-5 text-ink"
                    >
                      {error}
                    </Text>
                  </View>
                )}

                <Pressable
                  accessibilityRole="button"
                  className="h-14 items-center justify-center rounded-2xl bg-deep-blue"
                  disabled={signInBusy}
                  style={({ pressed }) => ({
                    opacity: signInBusy || pressed ? 0.7 : 1,
                  })}
                  onPress={sendCode}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text className="text-base font-semibold text-white">Continue  →</Text>
                  )}
                </Pressable>

                <View className="flex-row items-center gap-3">
                  <View className="h-px flex-1 bg-line" />
                  <Text className="text-sm text-slate">or</Text>
                  <View className="h-px flex-1 bg-line" />
                </View>

                <View className="gap-3">
                  <AppleSignInButton available={appleAvailable} busy={signInBusy} loading={appleBusy} onPress={signInWithApple} />
                  <GoogleSignInButton busy={signInBusy} loading={googleBusy} onPress={signInWithGoogle} />
                </View>

                <Pressable
                  accessibilityRole="button"
                  className="flex-row items-center justify-center gap-2.5 self-center px-4 py-2"
                  disabled={signInBusy}
                  style={({ pressed }) => ({
                    opacity: signInBusy || pressed ? 0.6 : 1,
                  })}
                  onPress={() => {
                    setError('');
                    setPhase('email');
                  }}
                >
                  <MailIcon />
                  <Text className="text-base font-medium text-deep-blue">Continue with email</Text>
                </Pressable>
              </View>
            </>
          ) : phase === 'otp' ? (
            <>
              <Pressable
                accessibilityRole="button"
                className="self-start"
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                onPress={goBack}
              >
                <Text className="text-sm font-semibold text-cobalt">← Change number</Text>
              </Pressable>

              <Text className="text-base leading-6 text-slate">
                We sent a 6-digit code to <Text className="font-semibold text-ink">{sentTo}</Text>
              </Text>

              <View className="gap-5">
                <OtpInput
                  disabled={busy}
                  value={otp}
                  onChange={(code) => {
                    setOtp(code);
                    if (code.length === OTP_LENGTH) void verifyCode(code);
                  }}
                />

                {!!error && (
                  <View className="flex-row items-start gap-3 rounded-2xl bg-coral/10 p-4">
                    <Text className="text-base">⚠️</Text>
                    <Text
                      selectable
                      accessibilityRole="alert"
                      className="flex-1 text-sm leading-5 text-ink"
                    >
                      {error}
                    </Text>
                  </View>
                )}

                {otp.length < OTP_LENGTH && (
                  <Pressable
                    accessibilityRole="button"
                    className="h-14 items-center justify-center rounded-2xl bg-deep-blue"
                    disabled={busy || otp.length < OTP_LENGTH}
                    style={({ pressed }) => ({
                      opacity: busy || otp.length < OTP_LENGTH || pressed ? 0.55 : 1,
                    })}
                    onPress={() => void verifyCode()}
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <Text className="text-base font-bold text-white">Verify code</Text>
                    )}
                  </Pressable>
                )}

                {busy && otp.length === OTP_LENGTH && (
                  <View className="items-center gap-2 py-2">
                    <ActivityIndicator color={colors.cobalt} />
                    <Text className="text-sm text-slate">Verifying…</Text>
                  </View>
                )}

                <ResendTimer disabled={busy} onResend={resend} />
              </View>
            </>
          ) : phase === 'email' ? (
            <>
              {invitationId ? (
                <Text className="text-base leading-6 text-slate">
                  Sign in with the email address that received the invitation.
                </Text>
              ) : phoneSignIn ? (
                <Pressable
                  accessibilityRole="button"
                  className="self-start"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  onPress={() => {
                    setError('');
                    setPhase('phone');
                  }}
                >
                  <Text className="text-sm font-semibold text-cobalt">← Use mobile number</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  className="self-start"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  onPress={() => {
                    setError('');
                    setPhase('choose');
                  }}
                >
                  <Text className="text-sm font-semibold text-cobalt">← Other ways to sign in</Text>
                </Pressable>
              )}

              <View className="gap-4">
                <TextInput
                  accessibilityLabel="Email address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  autoFocus
                  className="h-14 rounded-2xl border border-line bg-white px-4 text-base text-ink"
                  keyboardType="email-address"
                  onChangeText={(value) => {
                    setEmail(value);
                    setError('');
                  }}
                  onSubmitEditing={sendEmailLink}
                  placeholder="name@example.com"
                  placeholderTextColor={colors.slate}
                  returnKeyType="send"
                  textContentType="emailAddress"
                  value={email}
                />

                {!!error && (
                  <View className="flex-row items-start gap-3 rounded-2xl bg-coral/10 p-4">
                    <Text className="text-base">⚠️</Text>
                    <Text
                      selectable
                      accessibilityRole="alert"
                      className="flex-1 text-sm leading-5 text-ink"
                    >
                      {error}
                    </Text>
                  </View>
                )}

                <Pressable
                  accessibilityRole="button"
                  className="h-14 items-center justify-center rounded-2xl bg-deep-blue"
                  disabled={signInBusy}
                  style={({ pressed }) => ({
                    opacity: signInBusy || pressed ? 0.7 : 1,
                  })}
                  onPress={sendEmailLink}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text className="text-base font-bold text-white">Email me a sign-in link</Text>
                  )}
                </Pressable>

                <View className="flex-row items-center gap-3">
                  <View className="h-px flex-1 bg-line" />
                  <Text className="text-sm text-slate">or</Text>
                  <View className="h-px flex-1 bg-line" />
                </View>

                <View className="gap-3">
                  <AppleSignInButton available={appleAvailable} busy={signInBusy} loading={appleBusy} onPress={signInWithApple} />
                  <GoogleSignInButton busy={signInBusy} loading={googleBusy} onPress={signInWithGoogle} />
                </View>
              </View>
            </>
          ) : (
            <View className="gap-5 rounded-3xl border border-line bg-white p-5">
              <Text className="text-2xl font-extrabold text-deep-blue">Check your email</Text>
              <Text className="text-base leading-6 text-slate">
                We sent a one-time sign-in link to{' '}
                <Text className="font-semibold text-ink">{sentEmail}</Text>.
              </Text>
              <Pressable
                accessibilityRole="button"
                className="self-start"
                onPress={() => {
                  setError('');
                  setPhase('email');
                }}
              >
                <Text className="text-sm font-bold text-cobalt">Use a different email</Text>
              </Pressable>
            </View>
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
    </KeyboardAvoidingView>
  );
}
