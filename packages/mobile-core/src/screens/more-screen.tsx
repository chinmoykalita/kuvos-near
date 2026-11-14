import { wordmark } from '../config';
import { useAppExtensions } from "../app-extensions";
import { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { authClient } from '../auth-client';
import {
  getPatientNotificationSchedule,
  updateMarkingWindow,
  type MarkingWindow,
} from '../api';
import { useCareSession } from '../care-session';
import { Button } from '../components/button';
import {
  accountDeletionMessage,
  DeleteAccountButton,
} from '../components/delete-account';
import { Screen } from '../components/screen';
import { Text } from '../components/text';
import { LegalLinks } from '../components/legal-links';
import {
  clearPatientNotifications,
  patientNotificationPermission,
  requestPatientNotificationPermission,
  setCareCircleNotifications,
  syncPatientNotifications,
  unregisterCareCirclePushDevice,
  type NotificationPermission,
} from '../notifications';
import { healthTabEnabled } from '../wearables/api';

const beforeOptions = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 90, label: '90 min' },
  { minutes: 120, label: '2 hours' },
];
const afterOptions = [
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
  { minutes: 240, label: '4 hours' },
];

function Chip({
  selected,
  label,
  onPress,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-11 min-w-0 flex-1 items-center justify-center rounded-full px-2 ${
        selected ? 'bg-cobalt' : 'bg-cloud'
      }`}
      onPress={onPress}
    >
      <Text className={`text-xs font-bold ${selected ? 'text-white' : 'text-deep-blue'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MoreScreen() {
  const router = useRouter();
  const extensions = useAppExtensions();
  const { me, membership } = useCareSession();
  const isPatient = membership.role === 'PATIENT';
  const inviteRole = membership.canInviteRole;
  const savedWindow = membership.patient.markingWindow;
  const [committed, setCommitted] = useState<MarkingWindow>({
    openBeforeMinutes: savedWindow?.openBeforeMinutes ?? 90,
    closeAfterMinutes: savedWindow?.closeAfterMinutes ?? 180,
  });
  const [windowDraft, setWindowDraft] = useState<MarkingWindow>(committed);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>();
  const [careCircleAlertsEnabled, setCareCircleAlertsEnabled] = useState(
    membership.missedAlertsEnabled ?? false,
  );
  const dirty =
    windowDraft.openBeforeMinutes !== committed.openBeforeMinutes ||
    windowDraft.closeAfterMinutes !== committed.closeAfterMinutes;

  useFocusEffect(useCallback(() => {
    let active = true;
    patientNotificationPermission()
      .then((next) => active && setNotificationPermission(next))
      .catch(() => active && setNotificationPermission('denied'));
    return () => {
      active = false;
    };
  }, []));

  async function signOut() {
    if (isPatient) {
      await clearPatientNotifications().catch(() => undefined);
    } else {
      await unregisterCareCirclePushDevice().catch(() => undefined);
    }
    await authClient.signOut();
    router.replace('/sign-in');
  }

  async function enableNotifications() {
    setNotificationBusy(true);
    setNotificationError('');
    try {
      const permission = await requestPatientNotificationPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        const schedule = await getPatientNotificationSchedule(
          membership.patient.id,
        );
        await syncPatientNotifications(schedule, false);
      }
    } catch (caught) {
      setNotificationError(
        caught instanceof Error
          ? caught.message
          : 'Could not prepare offline reminders.',
      );
    } finally {
      setNotificationBusy(false);
    }
  }

  async function updateCareCircleAlerts(enabled: boolean) {
    setNotificationBusy(true);
    setNotificationError('');
    try {
      const permission = await setCareCircleNotifications(
        membership.patient.id,
        enabled,
      );
      setNotificationPermission(permission);
      if (!enabled || permission === 'granted') {
        setCareCircleAlertsEnabled(enabled);
      }
    } catch (caught) {
      setNotificationError(
        caught instanceof Error
          ? caught.message
          : 'Could not update Care Circle alerts.',
      );
    } finally {
      setNotificationBusy(false);
    }
  }

  async function saveWindow() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const next = await updateMarkingWindow(membership.patient.id, windowDraft);
      setWindowDraft(next);
      setCommitted(next);
      setSaved(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save the marking window.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen withoutHeader inTabs contentClassName="gap-4">
      <View className="gap-2">
        <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
          {wordmark}
        </Text>
        <Text className="text-3xl font-serif  text-deep-blue">More</Text>
        <Text className="text-base leading-6 text-slate">
          {isPatient ? 'Your care account' : `Helping ${membership.patient.name}`}
        </Text>
      </View>

      <View className="gap-1 rounded-3xl border border-line bg-white p-5">
        <Text selectable className="text-2xl font-extrabold text-deep-blue">
          {me.user.name}
        </Text>
        <Text className="text-sm font-semibold text-slate">
          {isPatient ? 'Patient' : 'Caregiver'}
          {me.user.phoneNumber ? ` · ${me.user.phoneNumber}` : ''}
        </Text>
      </View>

      <Button title="View and manage plans" variant="secondary" onPress={() => router.push('/plan')} />
      <Pressable accessibilityRole="button" onPress={() => router.push('/physio')} className="gap-2 rounded-3xl border border-line bg-white p-5">
        <Text className="text-xs font-bold uppercase tracking-eyebrow text-cobalt">Movement library</Text>
        <Text className="text-xl font-bold text-deep-blue">Explore physiotherapy</Text>
        <Text className="text-base leading-6 text-slate">Browse exercise demonstrations and step-by-step instructions.</Text>
        <Text className="font-bold text-cobalt">Open library →</Text>
      </Pressable>
      {healthTabEnabled(membership.role) && (
        <Pressable accessibilityRole="button" onPress={() => router.push('/rhythm')} className="gap-2 rounded-3xl border border-line bg-white p-5">
          <Text className="text-xs font-bold uppercase tracking-eyebrow text-cobalt">Daily rhythm</Text>
          <Text className="text-xl font-bold text-deep-blue">Your rhythm</Text>
          <Text className="text-base leading-6 text-slate">See your check-ins, garden and last four weeks.</Text>
          <Text className="font-bold text-cobalt">Open rhythm →</Text>
        </Pressable>
      )}
      {extensions.moreContent}

      {inviteRole ? (
        <Pressable
          accessibilityRole="button"
          className="rounded-3xl border border-line bg-white p-5"
          onPress={() =>
            router.push({
              pathname: '/invite',
              params: { patientId: membership.patient.id, role: inviteRole },
            })
          }
        >
          <Text className="text-base font-bold text-deep-blue">
            {inviteRole === 'PATIENT' ? 'Invite the patient' : 'Invite a caregiver'}
          </Text>
          <Text className="mt-1 text-sm leading-5 text-slate">
            Add someone to this Care Circle with their email address.
          </Text>
        </Pressable>
      ) : null}

      {isPatient && (
        <View className="gap-3 rounded-3xl border border-line bg-white p-5">
          <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
            Notifications
          </Text>
          <Text className="text-lg font-extrabold text-deep-blue">
            Offline care reminders
          </Text>
          <Text className="text-sm leading-5 text-slate">
            Once your plan syncs, reminders are scheduled on this phone and do
            not need internet.
          </Text>
          {notificationPermission === 'granted' ? (
            <Text className="text-sm font-semibold text-fresh-green">
              Notifications are allowed on this phone. {wordmark} refreshes them
              whenever Today syncs.
            </Text>
          ) : (
            <Button
              disabled={notificationBusy}
              loading={notificationBusy}
              title={
                notificationPermission === 'denied'
                  ? 'Open device settings'
                  : 'Enable reminders'
              }
              onPress={() =>
                notificationPermission === 'denied'
                  ? void Linking.openSettings()
                  : void enableNotifications()
              }
            />
          )}
          {!!notificationError && (
            <Text selectable accessibilityRole="alert" className="text-sm text-coral">
              {notificationError}
            </Text>
          )}
        </View>
      )}

      {!isPatient && (
        <View className="gap-3 rounded-3xl border border-line bg-white p-5">
          <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
            Care Circle notifications
          </Text>
          <Text className="text-lg font-extrabold text-deep-blue">
            Missed-task check-ins
          </Text>
          <Text className="text-sm leading-5 text-slate">
            Get one status-only alert when a task is left unchecked after its
            marking window. Explicit skips do not alert you. Alerts wait until
            7 AM during quiet hours in the patient’s local time.
          </Text>
          {careCircleAlertsEnabled ? (
            <>
              <Text className="text-sm font-semibold text-fresh-green">
                Check-in alerts are enabled
              </Text>
              {notificationPermission === 'denied' && (
                <Button
                  title="Open device settings"
                  variant="secondary"
                  onPress={() => void Linking.openSettings()}
                />
              )}
              <Button
                disabled={notificationBusy}
                loading={notificationBusy}
                title="Turn off alerts"
                variant="secondary"
                onPress={() => void updateCareCircleAlerts(false)}
              />
            </>
          ) : (
            <Button
              disabled={notificationBusy}
              loading={notificationBusy}
              title={
                notificationPermission === 'denied'
                  ? 'Open device settings'
                  : 'Enable check-in alerts'
              }
              onPress={() =>
                notificationPermission === 'denied'
                  ? void Linking.openSettings()
                  : void updateCareCircleAlerts(true)
              }
            />
          )}
          {!!notificationError && (
            <Text selectable accessibilityRole="alert" className="text-sm text-coral">
              {notificationError}
            </Text>
          )}
        </View>
      )}

      {!isPatient && (
        <View className="gap-4 rounded-3xl border border-line bg-white p-5">
          <View className="gap-1">
            <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
              Marking window
            </Text>
            <Text className="text-lg font-extrabold text-deep-blue">When they can tap</Text>
            <Text className="text-sm leading-5 text-slate">
              {membership.patient.name} can mark a task from this long before the scheduled
              time until this long after. When the window closes, it is missed.
            </Text>
          </View>
          <View className="gap-2">
            <Text className="text-sm font-bold text-ink">Before scheduled time</Text>
            <View className="flex-row gap-2">
              {beforeOptions.map((option) => (
                <Chip
                  key={option.minutes}
                  label={option.label}
                  selected={windowDraft.openBeforeMinutes === option.minutes}
                  onPress={() => {
                    setSaved(false);
                    setWindowDraft((current) => ({
                      ...current,
                      openBeforeMinutes: option.minutes,
                    }));
                  }}
                />
              ))}
            </View>
          </View>
          <View className="gap-2">
            <Text className="text-sm font-bold text-ink">After scheduled time</Text>
            <View className="flex-row gap-2">
              {afterOptions.map((option) => (
                <Chip
                  key={option.minutes}
                  label={option.label}
                  selected={windowDraft.closeAfterMinutes === option.minutes}
                  onPress={() => {
                    setSaved(false);
                    setWindowDraft((current) => ({
                      ...current,
                      closeAfterMinutes: option.minutes,
                    }));
                  }}
                />
              ))}
            </View>
          </View>
          {!!error && (
            <Text selectable accessibilityRole="alert" className="text-sm text-coral">
              {error}
            </Text>
          )}
          {saved && !dirty ? (
            <Text className="text-sm font-semibold text-fresh-green">Saved</Text>
          ) : null}
          <Button
            disabled={busy || !dirty}
            loading={busy}
            title="Save marking window"
            onPress={() => void saveWindow()}
          />
        </View>
      )}

      <View className="gap-2 rounded-3xl border border-line bg-white p-5">
        <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
          Legal & support
        </Text>
        <LegalLinks />
      </View>

      <View className="mt-auto gap-3 pt-6">
        <Text className="text-center text-sm leading-5 text-slate">
          {wordmark} does not create treatment plans or provide medical advice.
        </Text>
        <Button title="Sign out" variant="quiet" onPress={signOut} />
        <View className="gap-3 rounded-3xl border border-line bg-white p-5">
          <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
            Account
          </Text>
          <Text className="text-sm leading-5 text-slate">
            {accountDeletionMessage({
              role: membership.role,
              patientName: membership.patient.name,
            })}
          </Text>
          <DeleteAccountButton
            membership={{
              role: membership.role,
              patientName: membership.patient.name,
            }}
          />
        </View>
      </View>
    </Screen>
  );
}
