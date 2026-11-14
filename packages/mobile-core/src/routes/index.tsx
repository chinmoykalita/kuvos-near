import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { api, type Me } from '../api';
import { Screen } from '../components/screen';
import { Text } from '../components/text';
import { clearOnboardingDraft } from '../onboarding-draft';
import { CaregiverHomeScreen } from '../screens/caregiver-home-screen';

export default function HomeScreen() {
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError('');
      api<Me>('/me')
        .then((next) => {
          // An existing Care Circle wins over answers left on this device.
          if (next.memberships.length) void clearOnboardingDraft();
          if (active) setMe(next);
        })
        .catch((caught) =>
          active && setError(caught instanceof Error ? caught.message : 'Could not load your profile.'),
        );
      return () => {
        active = false;
      };
    }, []),
  );

  if (error) {
    return (
      <Screen withoutHeader>
        <Text selectable accessibilityRole="alert" className="rounded-2xl bg-coral/15 p-4 text-ink">
          {error}
        </Text>
      </Screen>
    );
  }
  if (!me) {
    return (
      <Screen withoutHeader>
        <ActivityIndicator className="m-auto" />
      </Screen>
    );
  }
  if (me.pendingInvitations.length) return <Redirect href="/invitation" />;
  if (!me.memberships.length) return <Redirect href="/setup" />;
  const membership = me.memberships[0];
  if (membership.patient.hasActivePlan && !membership.patient.resumableExtraction) {
    return <Redirect href="/today" />;
  }
  return <CaregiverHomeScreen membership={membership} userName={me.user.name} />;
}
