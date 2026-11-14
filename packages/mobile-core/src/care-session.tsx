import { useAppExtensions } from './app-extensions';
import { Redirect, useFocusEffect } from 'expo-router';
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';
import { ActivityIndicator } from 'react-native';

import { api, type Me, type Membership } from './api';
import { Screen } from './components/screen';
import { Text } from './components/text';
import { syncCareCirclePushDevice } from './notifications';

type CareSessionValue = {
  me: Me;
  membership: Membership;
};

const CareSessionContext = createContext<CareSessionValue | undefined>(undefined);

export function useCareSession() {
  const value = useContext(CareSessionContext);
  if (!value) {
    throw new Error('useCareSession must be used within CareSessionProvider.');
  }
  return value;
}

export function CareSessionProvider({ children, allowInactive = false }: PropsWithChildren<{ allowInactive?: boolean }>) {
  const { CareProvider = Fragment } = useAppExtensions();
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError('');
      api<Me>('/me')
        .then((next) => active && setMe(next))
        .catch(
          (caught) =>
            active &&
            setError(caught instanceof Error ? caught.message : 'Could not load your profile.'),
        );
      return () => {
        active = false;
      };
    }, []),
  );

  useEffect(() => {
    const membership = me?.memberships[0];
    if (
      membership?.role === 'CAREGIVER' &&
      membership.missedAlertsEnabled
    ) {
      void syncCareCirclePushDevice(membership.patient.id).catch(
        () => undefined,
      );
    }
  }, [me]);

  if (!me) {
    return (
      <Screen withoutHeader>
        {error ? (
          <Text selectable accessibilityRole="alert" className="rounded-2xl bg-coral/15 p-4 text-ink">
            {error}
          </Text>
        ) : (
          <ActivityIndicator className="m-auto" />
        )}
      </Screen>
    );
  }

  if (me.pendingInvitations.length) return <Redirect href="/invitation" />;
  if (!me.memberships.length) return <Redirect href="/setup" />;
  const membership = me.memberships[0];
  if (!allowInactive && !membership.patient.hasActivePlan) return <Redirect href="/" />;

  return (
    <CareSessionContext.Provider
      value={{ me, membership }}
    >
      <CareProvider>{children}</CareProvider>
    </CareSessionContext.Provider>
  );
}
