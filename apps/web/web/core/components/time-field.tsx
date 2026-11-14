import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Button } from '@kuvos/mobile-core/components/button';
import { Text } from '@kuvos/mobile-core/components/text';
import { colors, fonts } from '@kuvos/mobile-core/theme';
import { useWideLayout } from '../../layout';

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
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(asDate(time));
}

// Same row and bottom sheet as iOS; the sheet holds the browser's own time input, which
// opens the platform time wheel on phones and a keyboard-friendly field on desktop.
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
  const wide = useWideLayout();
  const [open, setOpen] = useState(startOpen);
  const [draft, setDraft] = useState(() => asTime(asDate(value)));

  function cancel() {
    setOpen(false);
    if (!value) onRemove?.();
  }

  function confirm() {
    if (/^\d{2}:\d{2}$/.test(draft)) onChange(draft);
    setOpen(false);
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
            setDraft(asTime(asDate(value)));
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

      <Modal animationType={wide ? 'fade' : 'slide'} onRequestClose={cancel} transparent visible={open}>
        <View accessibilityViewIsModal className={`flex-1 ${wide ? 'items-center justify-center p-8' : 'justify-end'}`}>
          <Pressable accessibilityLabel="Cancel time selection" className="absolute inset-0 bg-ink/35" onPress={cancel} />
          <View
            className={wide ? 'w-full gap-4 rounded-3xl bg-white p-7' : 'gap-4 rounded-t-3xl bg-white px-5 pb-8 pt-5'}
            style={wide ? { maxWidth: 420, boxShadow: '0 24px 64px rgba(12, 28, 51, 0.22)' } : undefined}
          >
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-2xl font-extrabold text-deep-blue">Choose reminder time</Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={cancel}>
                <Text className="font-semibold text-slate">Cancel</Text>
              </Pressable>
            </View>
            <input
              aria-label="Reminder time"
              autoFocus
              type="time"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirm();
              }}
              style={{
                appearance: 'none',
                background: colors.cloud,
                border: `1px solid ${colors.line}`,
                borderRadius: 16,
                color: colors.deepBlue,
                fontFamily: fonts.semibold,
                fontSize: 28,
                height: 72,
                padding: '0 16px',
                textAlign: 'center',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
            <Button title="Set time" onPress={confirm} />
          </View>
        </View>
      </Modal>
    </>
  );
}
