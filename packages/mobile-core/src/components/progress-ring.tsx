import { View } from "react-native";

import { Text } from "./text";
import { colors } from "../theme";

const TICKS = 36;

export function ProgressRing({
  value,
  total,
  size = 56,
}: {
  value: number;
  total: number;
  size?: number;
}) {
  const stroke = 3;
  const progress = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;
  const complete = total > 0 && value >= total;
  const fill = complete ? colors.freshGreen : colors.aqua;
  const center = size / 2;
  const radius = (size - stroke) / 2;
  const tickLength = (2 * Math.PI * radius) / TICKS + 1;
  const filledTicks = Math.round(progress * TICKS);
  const label = `${value}/${total}`;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${value} of ${total} checked`}
      accessibilityValue={{ min: 0, max: Math.max(total, 0), now: value }}
      className="items-center justify-center"
      style={{ width: size, height: size }}
    >
      {Array.from({ length: TICKS }, (_, index) => {
        const angle = (360 / TICKS) * index;
        const radians = ((angle - 90) * Math.PI) / 180;
        return (
          <View
            key={index}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: center + radius * Math.cos(radians) - tickLength / 2,
              top: center + radius * Math.sin(radians) - stroke / 2,
              width: tickLength,
              height: stroke,
              borderRadius: stroke / 2,
              backgroundColor: index < filledTicks ? fill : colors.line,
              transform: [{ rotate: `${angle}deg` }],
            }}
          />
        );
      })}
      <Text
        className={`font-extrabold text-deep-blue ${
          label.length > 4 ? "text-2xs" : "text-xs"
        }`}
      >
        {label}
      </Text>
    </View>
  );
}
