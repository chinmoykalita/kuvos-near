import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { useSegments } from 'expo-router';

import { colors } from '@kuvos/mobile-core/theme';
import { FOCUSED_MAX_WIDTH, useWideLayout } from './layout';

// Signed-in care screens get the sidebar shell from the (caregiver) layout. Everything else
// (welcome, sign-in, onboarding, invitations) is a focused flow: on wide screens it sits in a
// centred column on the page background instead of stretching edge to edge.
export function AppFrame({ children }: PropsWithChildren) {
  const wide = useWideLayout();
  const segments = useSegments() as string[];
  const focused = wide && segments[0] !== '(caregiver)';
  return (
    <View style={{ flex: 1, backgroundColor: colors.cloud, alignItems: 'center' }}>
      <View style={{ flex: 1, width: '100%', maxWidth: focused ? FOCUSED_MAX_WIDTH : undefined }}>{children}</View>
    </View>
  );
}
