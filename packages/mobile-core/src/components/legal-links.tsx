import { wordmark } from '../config';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Text } from './text';

const links = [
  { label: 'Privacy', url: 'https://kuvosai.com/privacy' },
  { label: 'Terms', url: 'https://kuvosai.com/terms' },
  {
    label: 'Support',
    url: `mailto:hello@kuvosai.com?subject=${wordmark}%20support`,
  },
] as const;

export function LegalLinks() {
  const [error, setError] = useState('');

  async function open(url: string) {
    setError('');
    try {
      await Linking.openURL(url);
    } catch {
      setError('Could not open this link. Contact hello@kuvosai.com.');
    }
  }

  return (
    <View className="items-center gap-2">
      <View className="flex-row flex-wrap justify-center gap-5">
        {links.map((link) => (
          <Pressable
            accessibilityRole="link"
            className="min-h-11 justify-center"
            key={link.label}
            onPress={() => void open(link.url)}
          >
            <Text className="text-sm font-semibold text-cobalt">{link.label}</Text>
          </Pressable>
        ))}
      </View>
      {!!error && (
        <Text selectable accessibilityRole="alert" className="text-center text-xs text-coral">
          {error}
        </Text>
      )}
    </View>
  );
}
