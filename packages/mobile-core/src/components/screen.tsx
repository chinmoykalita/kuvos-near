import type { PropsWithChildren, ReactElement } from 'react';
import { ScrollView, View, type RefreshControlProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function Screen({
  children,
  withoutHeader = false,
  inTabs = false,
  contentClassName,
  refreshControl,
}: PropsWithChildren<{
  withoutHeader?: boolean;
  inTabs?: boolean;
  contentClassName?: string;
  refreshControl?: ReactElement<RefreshControlProps>;
}>) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-cloud"
      contentInsetAdjustmentBehavior={withoutHeader ? 'never' : 'automatic'}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: withoutHeader ? insets.top + 12 : 24,
        paddingBottom: inTabs ? 28 : insets.bottom + 28,
      }}
    >
      <View className={`mx-auto w-full max-w-2xl flex-1 px-5 ${contentClassName ?? 'gap-4'}`}>
        {children}
      </View>
    </ScrollView>
  );
}
