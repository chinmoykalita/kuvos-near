import { wordmark } from '../config';
import { Image } from 'expo-image';
import { View } from 'react-native';

const lockup = require('../../assets/images/kuvos-logo.png');
const mark = require('../../assets/images/kuvos-mark.png');

export function BrandLogo({
  variant = 'mark',
  size = 36,
}: {
  variant?: 'mark' | 'lockup';
  size?: number;
}) {
  if (variant === 'lockup') {
    return (
      <View className="items-center">
        <Image
          accessibilityLabel={wordmark}
          contentFit="cover"
          contentPosition="top"
          source={lockup}
          style={{ width: size, height: size * 0.7 }}
        />
      </View>
    );
  }

  return (
    <Image
      accessibilityLabel={wordmark}
      contentFit="contain"
      source={mark}
      style={{ width: size, height: size }}
    />
  );
}
