import { logoWordmark, wordmark } from '../config';
import { useAppExtensions } from "../app-extensions";
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { BrandLogo } from '../components/brand-logo';
import { Button } from '../components/button';
import { DeleteAccountButton } from '../components/delete-account';
import { Screen } from '../components/screen';
import { StatusChip } from '../components/status-chip';
import { Text } from '../components/text';
import { authClient } from '../auth-client';
import type { Membership } from '../api';
import { resumeRoute } from '../review';

export function CaregiverHomeScreen({
  membership,
  userName,
}: {
  membership: Membership;
  userName: string;
}) {
  const router = useRouter();
  const extensions = useAppExtensions();
  const { patient } = membership;
  const isPatient = membership.role === 'PATIENT';
  const hasActivePlan = !!patient.hasActivePlan;
  const resumable = patient.resumableExtraction;
  const readyToReview = resumable?.status === 'review_ready';
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountError, setAccountError] = useState('');
  const heading = resumable
    ? readyToReview ? 'Your document is ready to review' : 'Preparing your review'
    : isPatient ? 'Add your care document' : `Add ${patient.name}’s care document`;
  const description = resumable
    ? readyToReview
      ? 'Check each suggested instruction against the original before it joins a plan.'
      : 'We are reading the document and linking each suggestion to its source.'
    : 'Upload the instructions from a healthcare professional. You will review every suggested step.';

  async function signOut() {
    setAccountError('');
    try {
      await authClient.signOut();
      router.replace('/sign-in');
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : 'Could not sign out.');
    }
  }

  return (
    <Screen withoutHeader contentClassName="gap-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-3">
          <BrandLogo size={40} />
          <Text className="text-brand font-extrabold tracking-tight text-deep-blue">{logoWordmark}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account options"
          accessibilityState={{ expanded: accountOpen }}
          className="min-h-11 min-w-20 items-center justify-center rounded-full border border-line bg-white px-4"
          onPress={() => setAccountOpen((open) => !open)}
        >
          <Text className="text-sm font-semibold text-deep-blue">Account</Text>
        </Pressable>
      </View>

      {extensions.accountAction}
      {accountOpen && (
        <View className="gap-3 rounded-3xl border border-line bg-white p-4">
          {!!accountError && (
            <Text selectable accessibilityRole="alert" className="text-sm text-coral">
              {accountError}
            </Text>
          )}
          <Button title="Sign out" variant="quiet" onPress={() => void signOut()} />
          <DeleteAccountButton membership={{ role: membership.role, patientName: patient.name }} />
        </View>
      )}

      <View className="flex-1 justify-center gap-7 py-8">
        <View className="gap-3">
          <Text className="text-sm font-semibold text-slate">Welcome, {userName}</Text>
          <Text className="text-3xl font-serif text-deep-blue">
            {heading}
          </Text>
          <Text className="text-base leading-6 text-slate">
            {description}
          </Text>
        </View>

        <View className="gap-5 rounded-3xl border border-line bg-white p-5">
          {resumable && (
            <View className="gap-2">
              <StatusChip
                label={readyToReview ? 'Ready to review' : resumable.status === 'queued' ? 'Upload received' : 'Preparing'}
                tone="review"
              />
              <Text selectable numberOfLines={1} className="text-sm text-slate">
                {resumable.fileName}
              </Text>
            </View>
          )}
          <Button
            title={resumable ? readyToReview ? 'Continue review' : 'View progress' : 'Add a care document'}
            onPress={() =>
              resumable
                ? router.push(resumeRoute(resumable))
                : router.push({ pathname: '/upload', params: { patientId: patient.id } })
            }
          />
          <Text className="text-sm leading-5 text-slate">
            Every instruction stays linked to its source. Nothing becomes active until you confirm it.
          </Text>
        </View>

        {hasActivePlan && resumable && (
          <Button title="View Today" variant="secondary" onPress={() => router.push('/today')} />
        )}

        {membership.canInviteRole && (
          <Pressable
            accessibilityRole="button"
            className="min-h-11 items-center justify-center"
            onPress={() =>
              router.push({
                pathname: '/invite',
                params: { patientId: patient.id, role: membership.canInviteRole },
              })
            }
          >
            <Text className="text-sm font-semibold text-cobalt">
              {membership.canInviteRole === 'PATIENT' ? 'Invite the patient' : 'Invite someone to help'}
            </Text>
          </Pressable>
        )}
      </View>

      <Text className="text-center text-xs leading-5 text-slate">
        {wordmark} does not create treatment plans or provide medical advice.
      </Text>
    </Screen>
  );
}
