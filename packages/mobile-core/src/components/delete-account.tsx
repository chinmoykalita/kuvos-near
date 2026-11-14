import { wordmark } from '../config';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';

import { authClient } from '../auth-client';
import { deleteMyAccount, type CareRole } from '../api';
import { Button } from './button';
import { Text } from './text';
import {
  clearPatientNotifications,
  unregisterCareCirclePushDevice,
} from '../notifications';

export function accountDeletionMessage(membership?: {
  role: CareRole;
  patientName: string;
}) {
  if (membership?.role === 'PATIENT') {
    return `Anyone else in your Care Circle is emailed first. Then your ${wordmark} account and the care routine stored for you are permanently deleted.`;
  }
  if (membership?.role === 'CAREGIVER') {
    return `Anyone else in your Care Circle is emailed first. Then your ${wordmark} account is permanently deleted. ${membership.patientName}'s care routine stays in place.`;
  }
  return `Anyone else in your Care Circle is emailed first. Then your ${wordmark} account is permanently deleted.`;
}

export function DeleteAccountButton({
  membership,
}: {
  membership?: { role: CareRole; patientName: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const message = accountDeletionMessage(membership);

  function confirm() {
    Alert.alert('Delete your account?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete account',
        style: 'destructive',
        onPress: () => void remove(),
      },
    ]);
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await clearPatientNotifications().catch(() => undefined);
      await unregisterCareCirclePushDevice().catch(() => undefined);
      await deleteMyAccount();
      await authClient.signOut().catch(() => undefined);
      router.replace('/sign-in');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not delete your account.',
      );
      setBusy(false);
    }
  }

  return (
    <View className="gap-3">
      {!!error && (
        <Text selectable accessibilityRole="alert" className="text-sm text-coral">
          {error}
        </Text>
      )}
      <Button
        disabled={busy}
        loading={busy}
        title="Delete account"
        variant="danger"
        onPress={confirm}
      />
    </View>
  );
}
