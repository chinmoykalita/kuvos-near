import { signInMetadata } from '../config';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api, type CareRole } from '../api';
import { Button } from '../components/button';
import { Screen } from '../components/screen';
import { Text, TextInput } from '../components/text';

export function InviteScreen({ patientId, role }: { patientId: string; role: CareRole }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function invite() {
    const normalizedEmail = email.trim().toLowerCase();
    setBusy(true);
    setError('');
    try {
      await api(`/patients/${patientId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: normalizedEmail, role, ...signInMetadata }),
      });
      setEmail(normalizedEmail);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The invitation could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View className="gap-3">
        <Text selectable className="text-3xl font-serif text-deep-blue">
          Invite {role === 'PATIENT' ? 'the patient' : 'a caregiver'}
        </Text>
        <Text selectable className="text-base leading-6 text-slate">
          They can use Google or an email link, but the verified email must match this
          invitation.
        </Text>
      </View>
      {sent ? (
        <View className="gap-4 rounded-3xl bg-ice p-5">
          <Text selectable className="text-2xl font-extrabold text-deep-blue">
            Invitation ready
          </Text>
          <Text selectable className="leading-6 text-slate">
            We sent an invitation to {email}. No care details were included in the email.
          </Text>
          <Button title="Done" onPress={() => router.replace('/')} />
        </View>
      ) : (
        <View className="gap-4 rounded-3xl border border-line bg-white p-5">
          <TextInput
            accessibilityLabel="Email address to invite"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-14 rounded-2xl border border-line bg-cloud px-4 text-lg text-ink"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="name@example.com"
            textContentType="emailAddress"
            value={email}
          />
          {!!error && (
            <Text
              selectable
              accessibilityRole="alert"
              className="rounded-2xl bg-coral/15 p-4 text-ink"
            >
              {error}
            </Text>
          )}
          <Button loading={busy} title="Create invitation" onPress={invite} />
        </View>
      )}
    </Screen>
  );
}
