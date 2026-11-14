import { View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors } from '../theme';

// Soft aqua glow behind a hero (logo or Tomo).
export function Glow({ height = 560 }: { height?: number }) {
  return (
    <View pointerEvents="none" className="absolute inset-x-0 top-0" style={{ height }}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="38%" r="60%">
            <Stop offset="0" stopColor={colors.aqua} stopOpacity={0.14} />
            <Stop offset="0.55" stopColor={colors.aqua} stopOpacity={0.05} />
            <Stop offset="1" stopColor={colors.aqua} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#glow)" />
      </Svg>
    </View>
  );
}
