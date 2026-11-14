import { useAppExtensions } from "../app-extensions";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import {
  api,
  getPatientNotificationSchedule,
  type OccurrenceStatus,
  type SkipReason,
  type Today,
} from "../api";
import { useCareSession } from "../care-session";
import { CurrentTaskCard } from "../components/current-task-card";
import { RestrictionList } from "../components/restriction-list";
import { Button } from "../components/button";
import { Screen } from "../components/screen";
import { SeekerHeader } from "../components/seeker-header";
import { Text } from "../components/text";
import { syncPatientNotifications } from "../notifications";

const statusBadge: Record<
  OccurrenceStatus,
  {
    label: string;
    glyph: string;
    circle: string;
    glyphColor: string;
    labelColor: string;
  }
> = {
  scheduled: {
    label: "Not checked",
    glyph: "○",
    circle: "bg-cloud",
    glyphColor: "text-slate",
    labelColor: "text-slate",
  },
  done: {
    label: "Done",
    glyph: "✓",
    circle: "bg-ice",
    glyphColor: "text-fresh-green",
    labelColor: "text-fresh-green",
  },
  skipped: {
    label: "Skipped",
    glyph: "Ⅱ",
    circle: "bg-sun",
    glyphColor: "text-ink",
    labelColor: "text-ink",
  },
  missed: {
    label: "Missed",
    glyph: "!",
    circle: "bg-coral/10",
    glyphColor: "text-coral",
    labelColor: "text-coral",
  },
};

export function TodayScreen() {
  "use no memo"; // shortcut: compiler dereferences unloaded Today data; remove when the production loading check passes without this.
  const router = useRouter();
  const { membership } = useCareSession();
  const caregiver = membership.role === "CAREGIVER";
  const extensions = useAppExtensions();
  const TodayTask = extensions.TodayTask;
  const [today, setToday] = useState<Today>();
  const [error, setError] = useState("");
  const [hold, setHold] = useState<{
    id: string;
    status: "done" | "skipped";
  }>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(
    () => api<Today>(`/patients/${membership.patient.id}/today`),
    [membership.patient.id],
  );
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const refresh = () =>
        load()
          .then((next) => {
            if (active) {
              setToday(next);
              setError("");
            }
          })
          .catch((e) => {
            if (active)
              setError(
                e instanceof Error ? e.message : "Could not load Today.",
              );
          });
      void refresh();
      if (!caregiver)
        void getPatientNotificationSchedule(membership.patient.id)
          .then(syncPatientNotifications)
          .catch(() => undefined);
      const poll = setInterval(() => void refresh(), 30_000);
      return () => {
        active = false;
        clearInterval(poll);
      };
    }, [load, caregiver, membership.patient.id]),
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const items = today?.occurrences ?? [];
  const answered = items.filter(
    (i) => i.status === "done" || i.status === "skipped",
  ).length;
  const current =
    items.find((i) => i.id === hold?.id) ??
    items.find((i) => i.status === "scheduled" && i.window?.state !== "closed");
  const next = current
    ? items.find(
        (i) =>
          i.id !== current.id &&
          i.status === "scheduled" &&
          i.window?.state !== "closed" &&
          i.scheduledAt >= current.scheduledAt,
      )
    : undefined;
  function details(id: string) {
    router.push({
      pathname: "/task/[id]",
      params: {
        id,
        planId: items.find((i) => i.id === id)?.planId ?? "",
        date: today!.date,
      },
    });
  }
  function onLogged(id: string, status: OccurrenceStatus, reason?: SkipReason) {
    setToday(
      (previous) =>
        previous && {
          ...previous,
          occurrences: previous.occurrences?.map((i) =>
            i.id === id ? { ...i, status, reason } : i,
          ),
        },
    );
    if (timer.current) clearTimeout(timer.current);
    if (status === "done" || status === "skipped") {
      setHold({ id, status });
      timer.current = setTimeout(() => setHold(undefined), 1600);
    }
  }
  return (
    <Screen withoutHeader inTabs contentClassName="gap-4">
      <SeekerHeader
        label={today ? `${answered} of ${items.length} checked` : "Today"}
        onPress={() => router.push("/rhythm")}
      />
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
                  setToday(next);
                  setError("");
                })
                .catch((e) => setError(e.message))
            }
          />
        </>
      )}
      {!today && !error && (
        <ActivityIndicator accessibilityLabel="Loading Today" />
      )}
      {today && (
        <>
          {caregiver && (
            <>
              <Text className="font-serif text-3xl text-ink">
                {membership.patient.name}’s home
              </Text>
              <Text className="text-sm text-slate">
                {today.date} · {today.timezone}
              </Text>
              <View className="flex-row justify-between rounded-[32px] bg-deep-blue p-5">
                <View className="gap-2">
                  <Text className="text-2xs uppercase tracking-eyebrow text-white/70">
                    Today
                  </Text>
                  <Text className="font-serif text-3xl text-white">
                    {answered}{" "}
                    <Text className="text-base text-white/70">
                      of {items.length}
                    </Text>
                  </Text>
                </View>
                {extensions.todaySummary}
              </View>
            </>
          )}
          {!!today.restrictions?.length && (
            <RestrictionList restrictions={today.restrictions} />
          )}
          {!caregiver && current && (
            <View className="flex-1 justify-center gap-4">
              <CurrentTaskCard
                key={current.id}
                occurrence={current}
                timezone={today.timezone}
                celebrating={hold?.id === current.id ? hold.status : undefined}
                skipReasons={today.skipReasons}
                onDetails={() => details(current.id)}
                onLogged={(status, reason) =>
                  onLogged(current.id, status, reason)
                }
              />
              {next && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Next: ${next.actionText} at ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: today.timezone }).format(new Date(next.scheduledAt))}`}
                  className="flex-row items-center gap-4 rounded-3xl bg-line/50 px-5 py-4"
                  onPress={() => details(next.id)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Text className="text-2xs font-bold uppercase tracking-eyebrow text-slate">
                    Next
                  </Text>
                  <Text
                    numberOfLines={1}
                    className="min-w-0 flex-1 text-base font-semibold text-ink"
                  >
                    {next.actionText}
                  </Text>
                  <Text className="text-base text-slate">
                    {new Intl.DateTimeFormat("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: today.timezone,
                    }).format(new Date(next.scheduledAt))}
                  </Text>
                </Pressable>
              )}
              {TodayTask && <TodayTask occurrence={current} />}
            </View>
          )}
          {!caregiver && !current && (
            <View className="flex-1 justify-center">
              <View className="items-center gap-2 self-center rounded-[28px] bg-ice px-6 py-7">
                <Text className="text-center font-serif text-3xl text-ink">
                  {membership.patient.name?.trim()
                    ? `Hi, ${membership.patient.name.trim().split(/\s+/)[0]}`
                    : "Hi there"}
                </Text>
                <Text className="text-center text-base font-semibold text-deep-blue">
                  {!items.length
                    ? "A quiet day"
                    : answered === items.length
                      ? "Today’s check-ins are complete"
                      : "Today’s check-in windows have closed"}
                </Text>
                <Text className="text-center text-sm leading-5 text-slate">
                  {!items.length
                    ? "There are no timed tasks scheduled today."
                    : "Your recorded history is saved."}
                </Text>
                <Button
                  title="View plan"
                  variant="secondary"
                  size="compact"
                  className="mt-2"
                  onPress={() => router.push("/plan")}
                />
              </View>
            </View>
          )}
          {/* Patients see only the task in focus; the full day lives in Plan. */}
          {caregiver && !!items.length && (
            <View className="gap-2">
              <View className="rounded-3xl border border-line bg-white px-4">
                {items.map((i, index) => {
                  const badge = statusBadge[i.status];
                  return (
                    <Pressable
                      key={i.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${i.actionText}, ${badge.label}`}
                      className={`min-h-[72px] flex-row items-center gap-3 py-4 ${index < items.length - 1 ? "border-b border-line" : ""}`}
                      onPress={() => details(i.id)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                      <View
                        className={`h-9 w-9 items-center justify-center rounded-full ${badge.circle}`}
                      >
                        <Text
                          className={`text-base font-bold ${badge.glyphColor}`}
                        >
                          {badge.glyph}
                        </Text>
                      </View>
                      <View className="flex-1 gap-1">
                        <Text className="text-base font-semibold text-ink">
                          {i.actionText}
                        </Text>
                        <Text className={`text-sm text-slate`}>
                          {new Intl.DateTimeFormat("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            timeZone: today.timezone,
                          }).format(new Date(i.scheduledAt))}
                          {" · "}
                          <Text
                            className={`text-sm font-bold ${badge.labelColor}`}
                          >
                            {badge.label}
                          </Text>
                          {i.reason
                            ? ` · ${i.reason.replaceAll("_", " ")}`
                            : ""}
                        </Text>
                        {i.loggedBy && (
                          <Text className={`text-sm text-slate`}>
                            Recorded by {i.loggedBy}
                          </Text>
                        )}
                      </View>
                      <Text className="text-lg text-slate">›</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          {caregiver && (
            <View className="flex-row gap-3">
              <Button
                title="View recap"
                variant="secondary"
                className="flex-1"
                onPress={() => router.push("/recap")}
              />
              {extensions.todayActions}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
