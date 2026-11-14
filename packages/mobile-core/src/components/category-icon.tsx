import Svg, { Circle, Path, Rect } from "react-native-svg";
import { colors } from "../theme";
export function CategoryIcon({
  category,
  size = 32,
}: {
  category: string;
  size?: number;
}) {
  const medication = /medication|pill|drug/i.test(category);
  const exercise = /exercise|physical|stretch|therapy/i.test(category);
  const appointment = /appointment|visit|checkup/i.test(category);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityLabel={category.replaceAll("_", " ")}
      fill="none"
      stroke={colors.deepBlue}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {medication ? (
        <>
          <Path
            d="M7 19a5 5 0 0 1-7-7l5-5a5 5 0 0 1 7 7Z"
            transform="translate(6 -2)"
          />
          <Path d="m8 9 7 7" />
        </>
      ) : exercise ? (
        <>
          <Circle cx="13" cy="4" r="2" />
          <Path d="m8 21 3-7-3-4 4-3 4 5 4 1M5 12l3-2M11 14l5 2 1 5" />
        </>
      ) : appointment ? (
        <>
          <Rect x="3" y="5" width="18" height="16" rx="3" />
          <Path d="M7 3v4m10-4v4M3 11h18m-12 4h6" />
        </>
      ) : (
        <Path d="M12 21 4 13a5 5 0 0 1 8-7 5 5 0 0 1 8 7Z" />
      )}
    </Svg>
  );
}
