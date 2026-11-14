import NativeDateTimePicker from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Button } from './button';
import { Text, TextInput } from './text';
import { colors } from '../theme';

function asDate(time?: string) {
  const date = new Date();
  const [hour, minute] = (time || '').split(':').map(Number);
  date.setHours(Number.isFinite(hour) ? hour : date.getHours());
  date.setMinutes(Number.isFinite(minute) ? minute : 0, 0, 0);
  return date;
}

function asTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function displayTime(time?: string) {
  if (!time) return 'Choose time';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(asDate(time));
}

export function TimeField({
  value,
  onChange,
  onRemove,
  startOpen = false,
}: {
  value?: string;
  onChange: (value: string) => void;
  onRemove?: () => void;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState(() => asDate(value));

  function cancel() {
    setOpen(false);
    if (!value) onRemove?.();
  }

  function confirm() {
    onChange(asTime(draft));
    setOpen(false);
  }

  if (process.env.EXPO_OS === 'web') {
    return (
      <View className="flex-row items-center gap-3 rounded-xl border border-line bg-white p-3">
        <TextInput
          accessibilityLabel="Reminder time"
          className="min-h-11 flex-1 text-base text-ink"
          maxLength={5}
          onChangeText={onChange}
          placeholder="HH:MM"
          value={value}
        />
        {onRemove && (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onRemove}>
            <Text className="font-semibold text-slate">Remove</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <>
      <View className="min-h-14 flex-row items-center gap-3 rounded-xl border border-line bg-white px-3 py-2">
        <Text className="flex-1 text-sm font-semibold text-slate">Reminder time</Text>
        <Pressable
          accessibilityLabel={`Reminder time ${displayTime(value)}`}
          accessibilityRole="button"
          className="min-h-11 min-w-24 items-center justify-center rounded-xl bg-ice px-3"
          onPress={() => {
            setDraft(asDate(value));
            setOpen(true);
          }}
        >
          <Text className="font-bold text-deep-blue">{displayTime(value)}</Text>
        </Pressable>
        {onRemove && (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onRemove}>
            <Text className="text-sm font-semibold text-slate">Remove</Text>
          </Pressable>
        )}
      </View>

      {open && process.env.EXPO_OS === 'android' && (
        <NativeDateTimePicker
          accentColor={colors.cobalt}
          is24Hour={false}
          mode="time"
          onDismiss={cancel}
          onValueChange={(_, selected) => {
            onChange(asTime(selected));
            setOpen(false);
          }}
          presentation="dialog"
          value={draft}
        />
      )}

      <Modal
        animationType="slide"
        onRequestClose={cancel}
        transparent
        visible={open && process.env.EXPO_OS === 'ios'}
      >
        <View accessibilityViewIsModal className="flex-1 justify-end">
          <Pressable
            accessibilityLabel="Cancel time selection"
            className="absolute inset-0 bg-ink/35"
            onPress={cancel}
          />
          <View className="gap-4 rounded-t-3xl bg-white px-5 pb-8 pt-5">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-2xl font-extrabold text-deep-blue">Choose reminder time</Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={cancel}>
                <Text className="font-semibold text-slate">Cancel</Text>
              </Pressable>
            </View>
            <NativeDateTimePicker
              accentColor={colors.cobalt}
              display="spinner"
              locale="en_US"
              mode="time"
              onValueChange={(_, selected) => setDraft(selected)}
              style={{ height: 216, width: '100%' }}
              themeVariant="light"
              value={draft}
            />
            <Button title="Set time" onPress={confirm} />
          </View>
        </View>
      </Modal>
    </>
  );
}
