import type { PropsWithChildren } from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWideLayout } from '../../layout';

// Phones get the same bottom sheet as the app. Wide screens get a centred dialog, which is
// what a sheet should be on a desktop browser.
export function Sheet({
  visible,
  onClose,
  closeLabel = 'Close',
  children,
}: PropsWithChildren<{ visible: boolean; onClose: () => void; closeLabel?: string }>) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const wide = useWideLayout();
  return (
    <Modal animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose} transparent visible={visible}>
      <View accessibilityViewIsModal className={`flex-1 ${wide ? 'items-center justify-center p-8' : 'justify-end'}`}>
        <Pressable accessibilityLabel={closeLabel} accessibilityRole="button" className="absolute inset-0 bg-ink/40" onPress={onClose} />
        <View
          className={wide ? 'w-full rounded-[28px] bg-white' : 'w-full rounded-t-[28px] bg-white'}
          style={{
            maxHeight: height * 0.85,
            maxWidth: wide ? 560 : undefined,
            boxShadow: wide ? '0 24px 64px rgba(12, 28, 51, 0.22)' : undefined,
          }}
        >
          {!wide && (
            <View className="items-center pb-1 pt-3">
              <View className="h-1 w-10 rounded-full bg-line" />
            </View>
          )}
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              gap: 16,
              paddingHorizontal: wide ? 28 : 20,
              paddingTop: wide ? 28 : 12,
              paddingBottom: wide ? 28 : insets.bottom + 24,
            }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
