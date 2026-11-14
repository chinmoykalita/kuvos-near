import { View } from 'react-native';

import { Text, TextInput } from './text';

export function DurationField({
  value,
  extractedDays,
  onChange,
}: {
  value?: number;
  extractedDays?: number;
  onChange: (days: number) => void;
}) {
  const days = value && value > 0 ? value : 0;
  const edited = !!extractedDays && days > 0 && days !== extractedDays;

  return (
    <View className="gap-2">
      <Text className="text-sm font-bold text-deep-blue">Days for this instruction</Text>
      <TextInput
        accessibilityLabel="Number of days for this instruction"
        className="min-h-14 rounded-2xl border border-line bg-white px-4 text-base font-bold text-ink"
        keyboardType="number-pad"
        maxLength={3}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '').slice(0, 3);
          onChange(digits ? Number(digits) : 0);
        }}
        placeholder="Days"
        value={days ? String(days) : ''}
      />
      <Text className="text-xs leading-5 text-slate">
        {edited
          ? `Document said ${extractedDays} ${extractedDays === 1 ? 'day' : 'days'}. This instruction will use ${days}.`
          : extractedDays
            ? 'From the document. You can change it for this instruction only.'
            : 'This instruction only. Other items can use a different length.'}
      </Text>
    </View>
  );
}
