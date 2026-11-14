import { Stack } from "expo-router/stack";

import type { ReactNode } from "react";
import { colors, fonts } from "../../theme";

export default function CaregiverLayout({ children }: { children?: ReactNode }) {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.cloud },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.cloud },
        headerTintColor: colors.deepBlue,
        headerTitleStyle: {
          color: colors.deepBlue,
          fontFamily: fonts.semibold,
        },
      }}
    >
      {children}
      <Stack.Screen
        name="(tabs)"
        options={{ gestureEnabled: false, headerShown: false }}
      />
      <Stack.Screen name="physio/index" options={{ title: "Physiotherapy" }} />
      <Stack.Screen name="physio/[id]" options={{ title: "Exercise" }} />
      <Stack.Screen name="upload" options={{ headerShown: false }} />
      <Stack.Screen name="extraction/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="review/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="preview/[id]" options={{ title: "Plan preview" }} />
      <Stack.Screen name="plan/[id]" options={{ title: "Manage plan" }} />
      <Stack.Screen name="task/[id]" options={{ title: "Task details" }} />
      <Stack.Screen
        name="source/[id]"
        options={{ presentation: "modal", title: "Source evidence" }}
      />
    </Stack>
  );
}
