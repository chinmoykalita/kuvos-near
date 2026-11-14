import { logoWordmark } from '../config';
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { BrandLogo } from "./brand-logo";
import { Text } from "./text";
export function SeekerHeader({
  label = "Today",
  onPress,
}: {
  label?: string;
  onPress?: () => void;
}) {
  const router = useRouter();
  return (
    <View className="flex-row items-center justify-between gap-3 pb-2">
      <View className="flex-row items-center gap-2">
        <BrandLogo size={28} />
        <Text className="text-brand text-deep-blue">{logoWordmark}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress ?? (() => router.push("/today"))}
        className="min-h-10 justify-center rounded-full bg-deep-blue px-[18px]"
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Text className="text-sm font-bold text-white">{label}</Text>
      </Pressable>
    </View>
  );
}
