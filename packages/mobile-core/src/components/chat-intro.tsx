import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";

import { assistantName } from "../chat";
import { colors } from "../theme";
import { Button } from "./button";
import { Text } from "./text";
import { Tomo, type TomoMood } from "./tomo";

const hiddenKey = "kuvos.chat-intro.hidden";
// Closing without "Don't show this again" shows the intro once more on the next app launch.
let shownThisLaunch = false;

const slides = (name: string): { mood: TomoMood; title: string; body: string }[] => [
  {
    mood: "hello",
    title: name ? `Hello ${name}` : "Hello",
    body: `I’m ${assistantName}. Ask me about your plans, what’s on today and what has been recorded. I answer from confirmed care records and show where each detail came from.`,
  },
  {
    mood: "idle",
    title: "Type or talk",
    body: "Tap the mic to speak instead of typing. Your words appear in the message box so you can check them before you send.",
  },
  {
    mood: "happy",
    title: "Here when you need me",
    body: "Start with “Remember that…” to save a private note. I can’t give medical advice or change your care. For urgent help, use Get help.",
  },
];

export function ChatIntro({ name }: { name: string }) {
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width - 48, 400);
  const pages = slides(name);
  const scroller = useRef<ScrollView>(null);
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState(0);
  const [hide, setHide] = useState(false);

  useEffect(() => {
    if (shownThisLaunch) return;
    let cancelled = false;
    void SecureStore.getItemAsync(hiddenKey)
      .catch(() => null)
      .then((hidden) => {
        if (cancelled || hidden === "true") return;
        shownThisLaunch = true;
        setVisible(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function close() {
    setVisible(false);
    // Best effort: if this fails, the intro simply appears again later.
    if (hide) void SecureStore.setItemAsync(hiddenKey, "true").catch(() => undefined);
  }

  function goTo(next: number) {
    setPage(next);
    scroller.current?.scrollTo({ x: next * pageWidth, animated: true });
  }

  const last = page === pages.length - 1;

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={close}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View accessibilityViewIsModal className="flex-1 items-center justify-center bg-ink/40">
        <View className="rounded-[28px] bg-white py-8" style={{ width: pageWidth }}>
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) =>
              setPage(Math.round(event.nativeEvent.contentOffset.x / pageWidth))
            }
          >
            {pages.map((slide) => (
              <View key={slide.title} className="items-center gap-4 px-6" style={{ width: pageWidth }}>
                <Tomo size={112} mood={slide.mood} />
                <Text accessibilityRole="header" className="text-center font-serif text-2xl text-deep-blue">
                  {slide.title}
                </Text>
                <Text className="text-center text-base leading-6 text-ink">{slide.body}</Text>
              </View>
            ))}
          </ScrollView>
          <View className="gap-4 px-6 pt-6">
            {last && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: hide }}
                onPress={() => setHide((value) => !value)}
                className="min-h-12 flex-row items-center justify-center gap-3"
              >
                <View
                  className={`h-6 w-6 items-center justify-center rounded-md border-2 ${hide ? "border-cobalt bg-cobalt" : "border-slate bg-white"}`}
                >
                  {hide && <Text className="text-sm font-semibold text-white">✓</Text>}
                </View>
                <Text className="text-base text-ink">Don’t show this again</Text>
              </Pressable>
            )}
            <Button title={last ? "Start chatting" : "Next"} onPress={() => (last ? close() : goTo(page + 1))} />
            <View
              accessibilityLabel={`Page ${page + 1} of ${pages.length}`}
              className="flex-row justify-center gap-2"
            >
              {pages.map((slide, index) => (
                <View
                  key={slide.title}
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: index === page ? colors.cobalt : colors.line }}
                />
              ))}
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${assistantName} introduction`}
            hitSlop={8}
            onPress={close}
            className="absolute -right-3 -top-3 h-11 w-11 items-center justify-center rounded-full bg-white shadow"
          >
            <Text className="text-xl text-deep-blue">✕</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
