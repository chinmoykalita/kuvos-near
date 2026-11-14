import { Pressable, View } from "react-native";
import type {
  OccurrenceStatus,
  SkipReason,
  SkipReasonOption,
  Today,
} from "../api";
import { CategoryIcon } from "./category-icon";
import { OccurrenceActions } from "./occurrence-actions";
import { Text } from "./text";
type Occurrence = NonNullable<Today["occurrences"]>[number];
export function CurrentTaskCard({
  occurrence,
  timezone,
  celebrating,
  skipReasons,
  onLogged,
  onDetails,
}: {
  occurrence: Occurrence;
  timezone: string;
  celebrating?: "done" | "skipped";
  skipReasons?: SkipReasonOption[];
  onLogged: (status: OccurrenceStatus, reason?: SkipReason) => void;
  onDetails: () => void;
}) {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(occurrence.scheduledAt));
  const qualifier = occurrence.fields
    ?.filter((f) => /meal|food|water|route|condition/.test(f.name))
    .map((f) => f.normalized_value || f.raw_value)
    .join(" · ");
  if (celebrating)
    return (
      <View
        accessibilityLiveRegion="polite"
        className="min-h-[320px] items-center justify-center gap-4 rounded-[32px] bg-deep-blue p-5"
      >
        <View className="h-20 w-20 items-center justify-center rounded-full bg-fresh-green">
          <Text className="text-3xl text-white">✓</Text>
        </View>
        <Text className="font-serif text-3xl text-white">Recorded</Text>
        <Text className="text-center font-hand text-2xl text-lime">
          {celebrating === "skipped"
            ? "Your reason matters too."
            : "One check-in at a time."}
        </Text>
        <Text className="text-center text-sm leading-5 text-white/70">
          {celebrating === "skipped"
            ? "Skip saved with your reason."
            : "Done saved."}{" "}
          Receipt signing is tracked separately.
        </Text>
      </View>
    );
  return (
    <View className="gap-4 rounded-[32px] border border-line bg-white p-5">
      <View className="flex-row items-center gap-3">
        <CategoryIcon category={occurrence.category} size={24} />
        <Text className="text-lg font-semibold text-cobalt">{time}</Text>
      </View>
      <Text selectable className="font-serif text-3xl text-ink">
        {occurrence.actionText}
      </Text>
      {!!qualifier && (
        <Text selectable className="text-base text-slate">
          {qualifier}
        </Text>
      )}
      <View className="gap-1 pt-4">
        <OccurrenceActions
          hero
          occurrence={occurrence}
          skipReasons={skipReasons}
          timezone={timezone}
          onLogged={onLogged}
        />
        <Pressable
          accessibilityRole="button"
          className="min-h-11 items-center justify-center"
          onPress={onDetails}
        >
          <Text className="text-base font-semibold text-cobalt">
            Details and source
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
