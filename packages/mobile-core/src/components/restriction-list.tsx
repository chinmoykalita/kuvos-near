import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { Restriction } from "../api";
import { Text } from "./text";

export function RestrictionList({
  restrictions,
}: {
  restrictions: Restriction[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const extra = Math.max(restrictions.length - 1, 0);
  const visible =
    expanded || extra === 0 ? restrictions : restrictions.slice(0, 1);

  function openSource(restriction: Restriction) {
    router.push({
      pathname: "/source/[id]",
      params: {
        id: restriction.extractionId,
        candidateId: restriction.candidateId,
      },
    });
  }

  return (
    <View className="gap-1 rounded-2xl bg-sun/20 px-4 py-3">
      <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-ink">
        Keep in mind
      </Text>
      {visible.map((restriction) => (
        <Pressable
          key={restriction.id}
          accessibilityRole="button"
          accessibilityLabel={`${restriction.actionText}. View source.`}
          className="flex-row items-center gap-2 py-1"
          onPress={() => openSource(restriction)}
        >
          <Text
            selectable
            className="min-w-0 flex-1 text-base font-bold text-ink"
          >
            {restriction.actionText}
          </Text>
          <Text className="text-slate">›</Text>
        </Pressable>
      ))}
      {extra > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={8}
          onPress={() => setExpanded((open) => !open)}
        >
          <Text className="text-base font-semibold text-slate">
            {expanded ? "Hide" : `Show ${extra} more`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
