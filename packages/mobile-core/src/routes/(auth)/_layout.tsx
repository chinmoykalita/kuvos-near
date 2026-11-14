import { Stack } from 'expo-router/stack';

// Signed-out visitors start with Tomo; deep links can still open sign-in directly.
export const unstable_settings = { initialRouteName: 'welcome' };

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="get-started" />
      <Stack.Screen name="sign-in" />
    </Stack>
  );
}
