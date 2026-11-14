import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../theme';
import type { WearableMetric, WearableSource } from '../wearables/metrics';

const shapes: Record<WearableMetric, React.ReactNode> = {
  resting_heart_rate: <Path d="M3 12h4l2-5 4 10 2-5h6" />,
  hrv_sdnn: <Path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 8 0" />,
  sleep_duration: <Path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" />,
  steps: (
    <>
      <Circle cx="13" cy="4" r="2" />
      <Path d="m8 21 3-7-3-4 4-3 4 5 4 1M5 12l3-2M11 14l5 2 1 5" />
    </>
  ),
  calories_consumed: (
    <Path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Zm0 0v7" />
  ),
  walking_speed: <Path d="M4 17a8 8 0 1 1 16 0M12 17l4-5M8 20h8" />,
  walking_step_length: (
    <Path d="M3 15h18v5H3ZM7 15v2M11 15v2M15 15v2M5 9h14M8 6 5 9l3 3M16 6l3 3-3 3" />
  ),
  walking_asymmetry: <Path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />,
  walking_double_support: (
    <Path d="M8 3c1.7 0 3 2.5 3 5.5S9.7 14 8 14s-3-2.5-3-5.5S6.3 3 8 3ZM16 9c1.7 0 3 2.5 3 5.5S17.7 20 16 20s-3-2.5-3-5.5S14.3 9 16 9Z" />
  ),
};

export function MetricIcon({ metric, size = 20 }: { metric: WearableMetric; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.cobalt} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {shapes[metric]}
    </Svg>
  );
}

export function SourceIcon({ source, size = 12 }: { source: WearableSource; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.slate} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      {source === 'watch' ? (
        <>
          <Rect x="6" y="6" width="12" height="12" rx="3" />
          <Path d="M9 6V2h6v4M9 18v4h6v-4" />
        </>
      ) : source === 'ring' ? (
        <Circle cx="12" cy="12" r="8" />
      ) : source === 'phone' ? (
        <>
          <Rect x="6" y="2" width="12" height="20" rx="3" />
          <Path d="M11 18h2" />
        </>
      ) : (
        <Path d="M20.4 12.9 12 21l-8.4-8.1A5.3 5.3 0 0 1 12 6.4a5.3 5.3 0 0 1 8.4 6.5Z" />
      )}
    </Svg>
  );
}

export function InfoIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.slate} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 11v5M12 8h.01" />
    </Svg>
  );
}

export function ChevronIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colors.slate} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m6 9 6 6 6-6" />
    </Svg>
  );
}
