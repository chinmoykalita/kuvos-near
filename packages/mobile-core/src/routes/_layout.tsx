import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import * as SystemUI from 'expo-system-ui';
import { router, SplashScreen } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';

import { authClient } from '../auth-client';
import { useAppFonts } from '../fonts';
import { useLaunchUpdateReady } from '../launch-update';
import {
  clearPatientNotifications,
  configureNotificationPresentation,
  requestPatientNotificationPermission,
} from '../notifications';
import { colors } from '../theme';
import { clearDictationRecordings } from '../dictation-cache';

SplashScreen.preventAutoHideAsync();
void SystemUI.setBackgroundColorAsync(colors.cloud);
configureNotificationPresentation();

function openPatientReminder(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data ?? {};
  if (data.kuvosCareCircleAlert === true) {
    router.push('/circle');
    return;
  }
  if (
    data.kuvosPatientReminder !== true ||
    typeof data.occurrenceId !== 'string' ||
    typeof data.planId !== 'string' ||
    typeof data.date !== 'string'
  ) {
    return;
  }
  router.push({
    pathname: '/task/[id]',
    params: {
      id: data.occurrenceId,
      planId: data.planId,
      date: data.date,
    },
  });
}

export default function RootLayout() {
  useEffect(() => {
    try { clearDictationRecordings(); }
    catch { console.warn('Temporary dictation cache cleanup could not complete.'); }
  }, []);
  const [fontsLoaded, fontError] = useAppFonts();
  const { data: session, isPending } = authClient.useSession();
  const updateReady = useLaunchUpdateReady();
  // Better Auth marks a signed-out session as pending again on every refetch (for example when
  // the Apple or Google sheet backgrounds the app). Only the first check may hold the splash,
  // or the navigator unmounts and the visitor is dropped back on the welcome screen.
  const [sessionChecked, setSessionChecked] = useState(false);
  if (!isPending && !sessionChecked) setSessionChecked(true);
  const ready = (fontsLoaded || !!fontError) && sessionChecked && updateReady;

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
    }
  }, [ready]);

  useEffect(() => {
    if (!ready || !session || Platform.OS === 'web') return;
    void requestPatientNotificationPermission().catch(() => undefined);
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      openPatientReminder(last);
      Notifications.clearLastNotificationResponse();
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(
      openPatientReminder,
    );
    return () => subscription.remove();
  }, [ready, session]);

  useEffect(() => {
    if (ready && !session) {
      void clearPatientNotifications().catch(() => undefined);
    }
  }, [ready, session]);

  if (!ready) {
    return null;
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.cloud } }}>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
          <Stack.Screen name="(caregiver)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="join/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="magic-link" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
