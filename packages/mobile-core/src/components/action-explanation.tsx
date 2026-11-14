import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";

import type { Explanation } from "../api";
import { Sheet } from "./sheet";
import { Text, TextInput } from "./text";

export function ActionExplanation({
  explanation,
  extractionId,
  candidateId,
  onChangeText,
  onLeave,
  showEmpty = false,
}: {
  explanation?: Explanation | null;
  extractionId?: string;
  candidateId?: string;
  onChangeText?: (text: string) => void;
  // Lets a host modal close first; an open RN Modal would cover the pushed route.
  onLeave?: () => void;
  showEmpty?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  if (!explanation?.text && !showEmpty && !onChangeText) return null;

  async function openReference(url: string) {
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" ||
        !["medlineplus.gov", "www.medlineplus.gov", "www.nhs.uk"].includes(
          parsed.host,
        )
      ) {
        throw new Error("Unsupported reference");
      }
      await Linking.openURL(url);
    } catch {
      setError("Could not open this reference. Please try again.");
    }
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm font-bold text-deep-blue">
          About this action
        </Text>
        <Pressable
          accessibilityLabel="Show explanation sources"
          accessibilityRole="button"
          className="h-11 w-11 items-center justify-center"
          onPress={() => {
            setError("");
            setOpen(true);
          }}
        >
          <Text className="h-6 w-6 rounded-full border border-cobalt text-center font-bold text-cobalt">
            i
          </Text>
        </Pressable>
      </View>
      {onChangeText ? (
        <TextInput
          accessibilityLabel="Explanation"
          className="min-h-28 rounded-2xl border border-line bg-cloud px-4 py-3 text-base leading-6 text-ink"
          maxLength={1200}
          multiline
          onChangeText={onChangeText}
          placeholder="Explain what this item is and what it does"
          textAlignVertical="top"
          value={explanation?.text || ""}
        />
      ) : (
        <Text selectable className="text-base leading-6 text-ink">
          {explanation?.text || "No explanation is available yet."}
        </Text>
      )}
      <Sheet visible={open} onClose={() => setOpen(false)}>
        <View className="flex-row items-center justify-between gap-4">
          <Text
            accessibilityRole="header"
            className="text-2xl font-extrabold text-deep-blue"
          >
            Sources
          </Text>
          <Pressable
            accessibilityRole="button"
            className="min-h-11 justify-center px-2"
            onPress={() => setOpen(false)}
          >
            <Text className="font-bold text-cobalt">Close</Text>
          </Pressable>
        </View>
        {explanation?.reviewer_edited && (
          <View className="gap-2">
            <Text selectable className="text-sm leading-5 text-slate">
              The reviewer edited this explanation. These sources support the
              original draft; edits have not been independently checked.
            </Text>
            {!!explanation.original_text && (
              <Text selectable className="text-sm leading-5 text-ink">
                Original draft: {explanation.original_text}
              </Text>
            )}
          </View>
        )}
        {explanation?.sources.map((source, index) => (
          <View
            key={`${source.url}-${index}`}
            className="gap-2 border-t border-line pt-4"
          >
            <Text selectable className="font-bold text-deep-blue">
              {source.title}
            </Text>
            <Text selectable className="text-sm leading-5 text-ink">
              {source.quote}
            </Text>
            {source.url ? (
              <Pressable
                accessibilityRole="link"
                className="min-h-11 justify-center"
                onPress={() => openReference(source.url)}
              >
                <Text className="font-semibold text-cobalt">
                  Read reference
                </Text>
              </Pressable>
            ) : (
              extractionId &&
              candidateId && (
                <Pressable
                  accessibilityRole="button"
                  className="min-h-11 justify-center"
                  onPress={() => {
                    setOpen(false);
                    onLeave?.();
                    router.push({
                      pathname: "/source/[id]",
                      params: {
                        id: extractionId,
                        candidateId,
                        explanation: "1",
                      },
                    });
                  }}
                >
                  <Text className="font-semibold text-cobalt">
                    View document highlight
                  </Text>
                </Pressable>
              )
            )}
          </View>
        ))}
        {!explanation?.sources.length && (
          <Text className="text-sm text-slate">
            No supporting sources were recorded.
          </Text>
        )}
        {!!error && (
          <Text accessibilityRole="alert" className="text-sm text-coral">
            {error}
          </Text>
        )}
      </Sheet>
    </View>
  );
}
