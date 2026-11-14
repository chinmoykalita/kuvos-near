import { wordmark } from '../config';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { authClient } from '../auth-client';
import { Button } from '../components/button';
import { Screen } from '../components/screen';
import { Text } from '../components/text';

export function MagicLinkScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; returnTo?: string }>();
  const [error, setError] = useState('');
  const verifiedToken = useRef('');
  const token = typeof params.token === 'string' ? params.token : '';
  const invalidToken = !token || token.length > 256;

  useEffect(() => {
    const returnTo =
      typeof params.returnTo === 'string' && /^\/join\/[0-9a-f-]{36}$/i.test(params.returnTo)
        ? params.returnTo
        : '/';
    if (invalidToken || verifiedToken.current === token) return;
    verifiedToken.current = token;

    authClient.magicLink
      .verify({ query: { token } })
      .then((result) => {
        if (result.error) {
          setError(result.error.message || 'This sign-in link is invalid or expired.');
          return;
        }
        const invitationId = returnTo.match(/^\/join\/([0-9a-f-]{36})$/i)?.[1];
        if (invitationId) {
          router.replace(`/join/${invitationId}` as Href);
        } else {
          router.replace('/');
        }
      })
      .catch(() => setError(`${wordmark} could not verify this sign-in link.`));
  }, [invalidToken, params.returnTo, router, token]);

  const displayedError = invalidToken ? 'This sign-in link is invalid.' : error;

  return (
    <Screen withoutHeader>
      <View className="m-auto w-full gap-4 rounded-3xl border border-line bg-white p-5">
        {displayedError ? (
          <>
            <Text selectable accessibilityRole="alert" className="text-base leading-6 text-ink">
              {displayedError}
            </Text>
            <Button title="Back to sign in" onPress={() => router.replace('/sign-in')} />
          </>
        ) : (
          <>
            <ActivityIndicator />
            <Text selectable className="text-center text-base text-slate">
              Signing you in…
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}
