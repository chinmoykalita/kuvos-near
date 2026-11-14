import { View } from 'react-native';

import { Text } from './text';

const tones = {
  neutral: { container: 'bg-slate/10', label: 'text-slate' },
  review: { container: 'bg-sun/25', label: 'text-ink' },
  success: { container: 'bg-fresh-green/15', label: 'text-deep-blue' },
  danger: { container: 'bg-coral/15', label: 'text-ink' },
} as const;

export function StatusChip({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: keyof typeof tones;
}) {
  return (
    <View className={`self-start rounded-full px-3 py-1.5 ${tones[tone].container}`}>
      <Text selectable className={`text-xs font-bold ${tones[tone].label}`}>
        {label}
      </Text>
    </View>
  );
}
