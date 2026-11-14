import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, View, type AlertButton } from 'react-native';

import { Text } from '@kuvos/mobile-core/components/text';

// react-native-web ships Alert.alert as a no-op, which would silently drop every
// confirmation in the shared screens. This renders them as an in-app dialog instead.
type Request = { title: string; message?: string; buttons: AlertButton[]; cancelable: boolean };

const queue: Request[] = [];
let notify: (() => void) | undefined;

Alert.alert = (title, message, buttons, options) => {
  queue.push({
    title,
    message,
    buttons: buttons?.length ? buttons : [{ text: 'OK' }],
    cancelable: options?.cancelable ?? false,
  });
  notify?.();
};

export function AlertHost() {
  const [request, setRequest] = useState<Request | undefined>(queue[0]);
  useEffect(() => {
    notify = () => setRequest(queue[0]);
    notify();
    return () => {
      notify = undefined;
    };
  }, []);

  function close(button?: AlertButton) {
    queue.shift();
    setRequest(queue[0]);
    button?.onPress?.();
  }

  if (!request) return null;
  const cancel = request.buttons.find((button) => button.style === 'cancel');
  const stacked = request.buttons.length > 2;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => close(cancel)}>
      <View className="flex-1 items-center justify-center px-8">
        <Pressable
          accessibilityLabel="Dismiss"
          className="absolute inset-0 bg-ink/40"
          onPress={() => (request.cancelable || cancel ? close(cancel) : undefined)}
        />
        <View accessibilityRole="alert" accessibilityViewIsModal className="w-full max-w-[340px] gap-4 rounded-3xl bg-white p-6">
          <View className="gap-2">
            <Text accessibilityRole="header" className="text-lg font-bold text-deep-blue">
              {request.title}
            </Text>
            {!!request.message && <Text className="text-base leading-6 text-slate">{request.message}</Text>}
          </View>
          <View className={stacked ? 'gap-2' : 'flex-row-reverse gap-2'}>
            {[...request.buttons].reverse().map((button, index) => {
              const primary = button.style !== 'cancel';
              const destructive = button.style === 'destructive';
              return (
                <Pressable
                  key={`${button.text}-${index}`}
                  accessibilityRole="button"
                  className={`min-h-12 ${stacked ? '' : 'flex-1'} items-center justify-center rounded-2xl px-4 ${
                    destructive ? 'bg-coral' : primary ? 'bg-deep-blue' : 'bg-cloud'
                  }`}
                  style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
                  onPress={() => close(button)}
                >
                  <Text className={`text-base font-semibold ${primary ? 'text-white' : 'text-deep-blue'}`}>
                    {button.text ?? 'OK'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}
