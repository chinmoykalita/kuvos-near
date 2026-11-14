import { wordmark } from '../../config';
import { Stack } from 'expo-router/stack';

import { colors } from '../../theme';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.cloud },
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.cloud },
        headerTintColor: colors.deepBlue,
      }}
    >
      <Stack.Screen name="setup" options={{ title: `Set up ${wordmark}`, headerShown: false }} />
      <Stack.Screen name="invitation" options={{ title: 'Invitation' }} />
      <Stack.Screen name="invite" options={{ title: 'Care Circle' }} />
      <Stack.Screen name="helpers" options={{ headerShown: false, gestureEnabled: false }} />
    </Stack>
  );
}
