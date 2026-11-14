import Svg, { Path, Rect, Circle } from "react-native-svg";
export function Garden({
  days,
  width = 110,
}: {
  days: number;
  width?: number;
}) {
  const height = Math.round((width * 120) / 110);
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 110 120"
      accessibilityLabel={
        days
          ? "A growing plant representing recorded check-ins"
          : "A plant ready to grow"
      }
    >
      <Path d="M55 92V35" stroke="#187345" strokeWidth="3" />
      <Path d="M55 68C34 68 25 53 25 48C43 48 55 56 55 68Z" fill="#2F935C" />
      {days > 0 && (
        <Path d="M55 55C77 55 83 39 83 35C66 35 55 43 55 55Z" fill="#3BA76D" />
      )}
      {days >= 7 && (
        <Path d="M55 40C39 40 34 27 34 22C49 22 55 29 55 40Z" fill="#2F935C" />
      )}
      {days >= 14 && <Circle cx="55" cy="28" r="8" fill="#FFC857" />}
      <Path d="M36 94H74L69 116H41Z" fill="#0C1C33" />
      <Rect x="32" y="88" width="46" height="9" rx="2" fill="#183B78" />
    </Svg>
  );
}
