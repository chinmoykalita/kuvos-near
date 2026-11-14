import { useAppExtensions } from "../app-extensions";
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { api } from "../api";
import { useCareSession } from "../care-session";
import { Button } from "../components/button";
import { Garden } from "../components/garden";
import { Screen } from "../components/screen";
import { Text } from "../components/text";
import type { RhythmDay } from "../chat";
import { healthTabEnabled } from "../wearables/api";
type Rhythm = {
  timezone: string;
  label: string;
  recordedDays: number;
  days: RhythmDay[];
};

const STAGES = [
  { label: "Sprout", days: 7 },
  { label: "Bloom", days: 14 },
];

export const recordedOf = (day: RhythmDay) => day.done + day.skipped;

// Consecutive days with a check-in, ending today. Today still in progress and days
// with nothing scheduled leave the rhythm unchanged rather than pausing it.
function rhythmLength(days: RhythmDay[]) {
  let length = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (recordedOf(day) > 0) length += 1;
    else if (day.total > 0 && index < days.length - 1) break;
  }
  return length;
}

function todayMessage(today: RhythmDay, paused: boolean) {
  const recorded = recordedOf(today);
  const open = today.total - recorded - today.missed;
  if (!today.total) {
    return paused
      ? "Your rhythm paused. Continue with the next step."
      : "Nothing timed today.";
  }
  if (open > 0) return `${recorded} of ${today.total} checked today`;
  if (recorded === today.total) {
    return today.skipped
      ? "Recorded with care · Rhythm continues"
      : "Today’s plan is complete";
  }
  return recorded
    ? `${recorded} of ${today.total} checked today`
    : "Your rhythm paused. Continue with the next step.";
}

export function weekday(day: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "narrow",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

export function dayTone(day: RhythmDay) {
  const recorded = recordedOf(day);
  if (!day.total) {
    return { cell: "border border-line bg-white", text: "text-slate", label: "Nothing scheduled" };
  }
  if (recorded === day.total) {
    return { cell: "border border-fresh-green bg-fresh-green", text: "text-white", label: "All recorded" };
  }
  if (recorded > 0) {
    return { cell: "border border-fresh-green/35 bg-fresh-green/35", text: "text-deep-blue", label: "Partly recorded" };
  }
  return { cell: "border border-line bg-line", text: "text-slate", label: "Not recorded" };
}

const LEGEND = [
  { cell: "bg-fresh-green", label: "All recorded" },
  { cell: "bg-fresh-green/35", label: "Partly" },
  { cell: "bg-line", label: "Not recorded" },
  { cell: "border border-line bg-white", label: "Nothing due" },
];

export function RhythmScreen({ recap = false }: { recap?: boolean }) {
  const { membership } = useCareSession();
  const extensions = useAppExtensions();
  const router = useRouter();
  // Opened from More or Today when Health holds this tab's place in the bar.
  const showBack = !recap && healthTabEnabled(membership.role);
  const [rhythm, setRhythm] = useState<Rhythm>();
  const [error, setError] = useState("");
  const load = useCallback(
    () => api<Rhythm>(`/patients/${membership.patient.id}/rhythm`),
    [membership.patient.id],
  );
  useFocusEffect(
    useCallback(() => {
      let active = true;
      load()
        .then((next) => {
          if (active) {
            setRhythm(next);
            setError("");
          }
        })
        .catch((e) => {
          if (active)
            setError(
              e instanceof Error ? e.message : "Could not load your rhythm.",
            );
        });
      return () => {
        active = false;
      };
    }, [load]),
  );

  const days = rhythm?.days ?? [];
  const today = days[days.length - 1];
  const week = days.slice(-7);
  const done = week.reduce((n, d) => n + d.done, 0);
  const skipped = week.reduce((n, d) => n + d.skipped, 0);
  const notRecorded = week.reduce((n, d) => n + d.missed, 0);
  const length = rhythmLength(days);
  const paused = length === 0 && (rhythm?.recordedDays ?? 0) > 0;
  const nextStage = STAGES.find((stage) => (rhythm?.recordedDays ?? 0) < stage.days);
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) =>
    days.slice(index * 7, index * 7 + 7),
  );

  return (
    <Screen withoutHeader inTabs={!recap} contentClassName="gap-4">
      {showBack && (
        <Pressable
          accessibilityRole="button"
          className="min-h-11 justify-center self-start"
          hitSlop={8}
          onPress={() => router.back()}
        >
          <Text className="text-sm font-bold text-cobalt">‹ Back</Text>
        </Pressable>
      )}
      <Text className="font-serif text-3xl text-ink">
        {recap ? `${membership.patient.name}’s garden is ` : "Your "}
        <Text className="font-serif-italic text-cobalt">
          {recap ? "growing" : "rhythm"}
        </Text>
      </Text>
      {!rhythm && !error && (
        <ActivityIndicator accessibilityLabel="Loading rhythm" />
      )}
      {!!error && (
        <>
          <Text selectable accessibilityRole="alert" className="text-coral">
            {error}
          </Text>
          <Button
            title="Retry"
            variant="secondary"
            onPress={() =>
              void load()
                .then((next) => {
                  setRhythm(next);
                  setError("");
                })
                .catch((e) => setError(e.message))
            }
          />
        </>
      )}
      {rhythm && today && (
        <View className="flex-1 justify-center gap-4">
          <View className="gap-3 rounded-3xl bg-white p-4">
            <View className="flex-row items-center gap-4">
              <View className="h-[76px] w-[76px] items-center justify-center rounded-full bg-ice">
                <Garden days={rhythm.recordedDays} width={54} />
              </View>
              <View className="min-w-0 flex-1 items-start gap-1">
                <View className="rounded-full bg-ice px-2.5 py-0.5">
                  <Text className="text-2xs font-bold uppercase tracking-eyebrow text-fresh-green">
                    {rhythm.label}
                  </Text>
                </View>
                <Text className="font-serif text-2xl text-ink">
                  {length ? `${length}-day rhythm` : "Ready to grow"}
                </Text>
                {length >= 7 ? (
                  <Text className="text-xs font-semibold text-fresh-green">
                    A steady week
                  </Text>
                ) : null}
              </View>
            </View>
            <Text className="text-sm font-bold text-deep-blue">
              {todayMessage(today, paused)}
            </Text>
            <Text className="text-xs leading-4 text-slate">
              {rhythm.recordedDays}{" "}
              {rhythm.recordedDays === 1 ? "day" : "days"} with a check-in in the
              last 28. Skips with a reason count.
              {nextStage ? ` ${nextStage.label} at ${nextStage.days}.` : ""}
            </Text>
          </View>

          <View className="gap-2">
            <Text className="px-1 text-2xs font-bold uppercase tracking-eyebrow text-slate">
              Last 7 days
            </Text>
            <View className="flex-row gap-2">
              {[
                { value: done, label: "Done", tone: "text-fresh-green" },
                { value: skipped, label: "Skipped", tone: "text-deep-blue" },
                { value: notRecorded, label: "Not recorded", tone: "text-deep-blue" },
              ].map((stat) => (
                <View
                  key={stat.label}
                  accessible
                  accessibilityLabel={`${stat.value} ${stat.label}`}
                  className="min-w-0 flex-1 flex-row items-baseline gap-1 rounded-xl bg-white px-2.5 py-2"
                >
                  <Text className={`font-serif text-lg ${stat.tone}`}>
                    {stat.value}
                  </Text>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    className="min-w-0 flex-shrink text-xs text-slate"
                  >
                    {stat.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View className="gap-2">
            <Text className="px-1 text-2xs font-bold uppercase tracking-eyebrow text-slate">
              Last 4 weeks
            </Text>
            <View className="gap-1.5 rounded-3xl bg-white p-3">
              <View className="flex-row gap-1.5 pb-0.5">
                {(weeks[0] ?? []).map((day) => (
                  <Text
                    key={day.day}
                    className="flex-1 text-center text-2xs font-bold uppercase text-slate"
                  >
                    {weekday(day.day)}
                  </Text>
                ))}
              </View>
              {weeks.map((row, index) => (
                <View key={index} className="flex-row gap-1.5">
                  {row.map((day) => {
                    const tone = dayTone(day);
                    const isToday = day.day === today.day;
                    return (
                      <View
                        key={day.day}
                        accessible
                        accessibilityLabel={`${isToday ? "Today, " : ""}${day.day}: ${tone.label}${
                          day.total ? `, ${recordedOf(day)} of ${day.total} recorded` : ""
                        }`}
                        className={`h-11 flex-1 items-center justify-center rounded-lg ${tone.cell} ${
                          isToday ? "border-2 border-aqua" : ""
                        }`}
                      >
                        <Text
                          className={`text-xs ${isToday ? "font-bold" : ""} ${tone.text}`}
                        >
                          {Number(day.day.slice(-2))}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ))}
              <View className="flex-row flex-wrap gap-x-3 gap-y-1.5 pt-1.5">
                {LEGEND.map((item) => (
                  <View key={item.label} className="flex-row items-center gap-1">
                    <View className={`h-2.5 w-2.5 rounded-sm ${item.cell}`} />
                    <Text className="text-2xs text-slate">{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {extensions.rhythmContent}
          {extensions.rhythmAction ? (
            <View className="gap-3">{extensions.rhythmAction}</View>
          ) : null}
          <Text className="px-1 text-center text-2xs leading-4 text-slate">
            Check-ins describe recorded activity, not verified treatment.
          </Text>
        </View>
      )}
    </Screen>
  );
}
