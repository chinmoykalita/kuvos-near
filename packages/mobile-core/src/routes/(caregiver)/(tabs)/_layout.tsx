import type { ReactNode } from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CareSessionProvider, useCareSession } from '../../../care-session';
import { TabIcon } from '../../../components/tab-icon';
import { colors, fonts } from '../../../theme';
import { assistantName } from '../../../chat';
import { healthTabEnabled } from '../../../wearables/api';

export default function DailyTabsLayout({ children, showPlanTab = true }: { children?: ReactNode; showPlanTab?: boolean }) {
  return (
    <CareSessionProvider>
      <DailyTabs showPlanTab={showPlanTab}>{children}</DailyTabs>
    </CareSessionProvider>
  );
}

function DailyTabs({ children, showPlanTab }: { children?: ReactNode; showPlanTab: boolean }) {
  const insets = useSafeAreaInsets();
  const { membership } = useCareSession();
  const isCaregiver = membership.role === 'CAREGIVER';
  const showHealth = healthTabEnabled(membership.role);

  return (
    <Tabs
      backBehavior={showHealth ? 'history' : 'firstRoute'}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.cloud },
        tabBarActiveTintColor: colors.deepBlue,
        tabBarHideOnKeyboard: true,
        tabBarInactiveTintColor: colors.slate,
        tabBarItemStyle: styles.item,
        tabBarLabelStyle: styles.label,
        tabBarStyle: [styles.bar, { height: 64 + insets.bottom, paddingBottom: insets.bottom }],
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="today" />
          ),
        }}
      />
      <Tabs.Screen name="health" options={{ title: 'Fitness', href: showHealth ? '/health' : null, tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} name="health" /> }} />
      <Tabs.Screen name="rhythm" options={{ title: 'Rhythm', href: showHealth ? null : '/rhythm', tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} name="rhythm" /> }} />
      <Tabs.Screen name="chat" options={{ title: assistantName, tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} name="chat" /> }} />
      {children}
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Plan',
          href: showPlanTab ? '/plan' : null,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="plan" />
          ),
        }}
      />
      <Tabs.Screen
        name="circle"
        options={{
          href: isCaregiver ? '/circle' : null,
          tabBarAccessibilityLabel: 'Care Circle',
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="circle" />
          ),
          title: 'Home',
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="more" />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.white,
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: {
    paddingTop: 4,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
});
