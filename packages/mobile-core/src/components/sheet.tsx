import type { PropsWithChildren } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// React Native–laid-out bottom sheet. The @expo/ui Compose sheet measures RN children
// at their intrinsic width on Android, which pushed long copy past the screen edges.
export function Sheet({
  visible,
  onClose,
  closeLabel = "Close",
  children,
}: PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  closeLabel?: string;
}>) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal
      animationType="slide"
      navigationBarTranslucent
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View accessibilityViewIsModal className="flex-1 justify-end">
        <Pressable
          accessibilityLabel={closeLabel}
          accessibilityRole="button"
          className="absolute inset-0 bg-ink/40"
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          pointerEvents="box-none"
        >
          <View
            className="w-full rounded-t-[28px] bg-white"
            style={{ maxHeight: height * 0.85 }}
          >
            <View className="items-center pb-1 pt-3">
              <View className="h-1 w-10 rounded-full bg-line" />
            </View>
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                gap: 16,
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: insets.bottom + 24,
              }}
            >
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
