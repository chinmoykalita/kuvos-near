import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { api, type Today } from "../api";
import { useCareSession } from "../care-session";
import { RestrictionList } from "../components/restriction-list";
import { Screen } from "../components/screen";
import { Text } from "../components/text";

function displayTime(date: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(date));
}

export function CaregiverGlanceScreen() {
  const router = useRouter();
  const { membership } = useCareSession();
  const patientId = membership.patient.id;
  const patientName = membership.patient.name;
  const [today, setToday] = useState<Today>();
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError("");
      api<Today>(`/patients/${patientId}/today`)
        .then((next) => active && setToday(next))
        .catch(
          (caught) =>
            active &&
            setError(
              caught instanceof Error
                ? caught.message
                : "Could not load the caregiver view.",
            ),
        );
      return () => {
        active = false;
      };
    }, [patientId]),
  );

  if (!today)
    return (
      <Screen withoutHeader inTabs>
        {error ? (
          <Text
            selectable
            accessibilityRole="alert"
            className="m-auto rounded-2xl bg-white p-5 text-center text-slate"
          >
            {error}
          </Text>
        ) : (
          <ActivityIndicator className="m-auto" />
        )}
      </Screen>
    );

  const occurrences = today.occurrences || [];
  const counts = {
    done: occurrences.filter((item) => item.status === "done").length,
    skipped: occurrences.filter((item) => item.status === "skipped").length,
    missed: occurrences.filter((item) => item.status === "missed").length,
    due: occurrences.filter((item) => item.status === "scheduled").length,
  };

  return (
    <Screen withoutHeader inTabs>
      <View className="gap-2">
        <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
          Care Circle · {today.date}
        </Text>
        <Text className="text-3xl font-serif  text-deep-blue">
          {patientName} at a glance
        </Text>
        <Text className="text-base leading-6 text-slate">
          A quiet view of what is done, skipped, or still due.
        </Text>
      </View>
      {!!error && (
        <Text
          selectable
          accessibilityRole="alert"
          className="rounded-2xl bg-coral/15 p-4 text-ink"
        >
          {error}
        </Text>
      )}
      <View className="flex-row gap-2">
        {(
          [
            ["done", counts.done, "Done"],
            ["skipped", counts.skipped, "Skipped"],
            ["missed", counts.missed, "Missed"],
            ["due", counts.due, "Not checked"],
          ] as const
        ).map(([key, count, copy]) => (
          <View
            className="min-w-0 flex-1 gap-1 rounded-2xl bg-white p-3"
            key={key}
          >
            <Text className="text-2xl font-serif text-deep-blue">
              {count}
            </Text>
            <Text className="text-xs font-bold text-slate">{copy}</Text>
          </View>
        ))}
      </View>

      {!!today.restrictions?.length && (
        <RestrictionList restrictions={today.restrictions} />
      )}

      <View className="gap-3">
        <Text className="text-lg font-extrabold text-deep-blue">
          Today’s tasks
        </Text>
        {occurrences.map((item) => (
          <View
            className="gap-3 rounded-2xl border border-line bg-white p-4"
            key={item.id}
          >
            <View className="flex-row items-start gap-3">
              <Text className="w-14 text-sm font-extrabold text-cobalt">
                {displayTime(item.scheduledAt, today.timezone)}
              </Text>
              <View className="min-w-0 flex-1">
                <Text selectable className="font-bold text-ink">
                  {item.actionText}
                </Text>
                <Text className="text-xs font-semibold capitalize text-slate">
                  {item.status === "scheduled"
                    ? "Not checked yet"
                    : item.status === "missed"
                      ? "Missed"
                      : item.status}
                </Text>
                {!!item.reason && (
                  <Text className="text-xs text-slate">
                    Reason: {item.reason.replaceAll("_", " ")}
                    {item.loggedBy ? ` · ${item.loggedBy}` : ""}
                  </Text>
                )}
                {!!item.loggedBy && (
                  <Text className="text-xs text-slate">
                    Logged by {item.loggedBy}
                  </Text>
                )}
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/task/[id]",
                    params: {
                      id: item.id,
                      planId: item.planId || "",
                      date: today.date,
                    },
                  })
                }
              >
                <Text className="text-lg text-slate">›</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}
