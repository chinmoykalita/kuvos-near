import { saveActivity } from '../activity-log';
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import {
  logOccurrence,
  skipReasonOptions,
  type OccurrenceAction,
  type OccurrenceStatus,
  type SkipReason,
  type SkipReasonOption,
  type Today,
} from "../api";
import { Button } from "./button";
import { Sheet } from "./sheet";
import { Text } from "./text";
import { cancelOccurrenceNotifications } from "../notifications";
import { useAppExtensions } from "../app-extensions";

function haptic(kind: "tap" | "success" | "error" | "select") {
  const run =
    kind === "success"
      ? () =>
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : kind === "error"
        ? () =>
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        : kind === "select"
          ? () => Haptics.selectionAsync()
          : () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  void run().catch(() => undefined);
}

// Reason values are a fixed API enum; only wording and medicine-only options adapt per task.
function reasonsFor(category: string, options: SkipReasonOption[]) {
  if (/medication|pill|drug/i.test(category)) return options;
  return options
    .filter((option) => option.value !== "no_medicines")
    .map((option) =>
      option.value === "no_one_around"
        ? { ...option, label: "No one around to help" }
        : option,
    );
}

function windowCopy(
  occurrence: NonNullable<Today["occurrences"]>[number],
  timezone: string,
) {
  const state = occurrence.window?.state;
  if (occurrence.status === "missed" || state === "closed") {
    return "The marking window has closed.";
  }
  if (state === "upcoming" && occurrence.window?.opensAt) {
    const opens = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h12",
      timeZone: timezone,
    }).format(new Date(occurrence.window.opensAt));
    return `You can mark this from ${opens}.`;
  }
  if (occurrence.status === "done") return "Done";
  if (occurrence.status === "skipped") return "Skipped";
  return "Available on its scheduled day";
}

export function OccurrenceActions({
  compact = false,
  hero = false,
  occurrence,
  timezone,
  skipReasons = skipReasonOptions,
  onLogged,
}: {
  compact?: boolean;
  hero?: boolean;
  occurrence: NonNullable<Today["occurrences"]>[number];
  timezone: string;
  skipReasons?: SkipReasonOption[];
  onLogged: (status: OccurrenceStatus, reason?: SkipReason) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const [error, setError] = useState("");
  const extensions = useAppExtensions();

  async function submit(action: OccurrenceAction, reason?: SkipReason) {
    setBusy(true);
    setError("");
    try {
      const notice = await saveActivity(async () => {
        if (extensions.logActivity) return extensions.logActivity(occurrence, action, reason);
        await logOccurrence(occurrence.id, action, reason);
        return undefined;
      }, () => {
        if (action !== "undone") {
          void cancelOccurrenceNotifications(occurrence.id).catch(() => undefined);
        }
        haptic(action === "done" ? "success" : "select");
        setShowReasons(false);
        onLogged(action === "undone" ? "scheduled" : action, reason);
      });
      if (notice) {
        setError(notice);
        Alert.alert('Activity saved', notice);
      }
    } catch (caught) {
      haptic("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save this update.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (occurrence.canLog === false || occurrence.status === "missed") {
    if (occurrence.status === "done" || occurrence.status === "skipped") {
      return (
        <View className="gap-2">
          {compact ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Mark ${occurrence.actionText} as not done`}
              className="min-h-11 items-center justify-center rounded-full bg-ice px-4"
              disabled={busy || occurrence.window?.state !== "open"}
              onPress={() => void submit("undone")}
              style={({ pressed }) => ({
                opacity: busy ? 0.45 : pressed ? 0.72 : 1,
              })}
            >
              <Text className="text-base font-bold text-deep-blue">
                {busy ? "Undoing…" : "Undo"}
              </Text>
            </Pressable>
          ) : (
            <>
              <Text
                className={`text-base font-extrabold ${occurrence.status === "done" ? "text-fresh-green" : "text-ink"}`}
              >
                {occurrence.status === "done" ? "Done" : "Skipped"}
              </Text>
              {occurrence.window?.state === "open" ? (
                <Button
                  disabled={busy}
                  loading={busy}
                  title="Mark as not done"
                  variant="secondary"
                  onPress={() => void submit("undone")}
                />
              ) : null}
            </>
          )}
          {!!error && (
            <Text
              selectable
              accessibilityRole="alert"
              className="text-base text-coral"
            >
              {error}
            </Text>
          )}
        </View>
      );
    }
    return (
      <Text
        className={`text-base font-bold ${occurrence.status === "missed" ? "text-coral" : "text-slate"}`}
      >
        {windowCopy(occurrence, timezone)}
      </Text>
    );
  }

  if (occurrence.status !== "scheduled") {
    return (
      <View className="gap-2">
        {compact ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Mark ${occurrence.actionText} as not done`}
            className="min-h-11 items-center justify-center rounded-full bg-ice px-4"
            disabled={busy}
            onPress={() => void submit("undone")}
            style={({ pressed }) => ({
              opacity: busy ? 0.45 : pressed ? 0.72 : 1,
            })}
          >
            <Text className="text-base font-bold text-deep-blue">
              {busy ? "Undoing…" : "Undo"}
            </Text>
          </Pressable>
        ) : (
          <>
            <Text
              className={`text-base font-extrabold ${occurrence.status === "done" ? "text-fresh-green" : "text-ink"}`}
            >
              {occurrence.status === "done" ? "Done" : "Skipped"}
            </Text>
            <Button
              disabled={busy}
              loading={busy}
              title="Mark as not done"
              variant="secondary"
              onPress={() => void submit("undone")}
            />
          </>
        )}
        {!!error && (
          <Text
            selectable
            accessibilityRole="alert"
            className="text-base text-coral"
          >
            {error}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View className="gap-3">
      {hero ? (
        <View className="gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Mark ${occurrence.actionText} done`}
            className="min-h-[76px] flex-row items-center justify-center gap-3 rounded-[28px] bg-deep-blue px-6"
            disabled={busy}
            onPress={() => {
              haptic("tap");
              void submit("done");
            }}
            style={({ pressed }) => ({
              opacity: busy ? 0.45 : pressed ? 0.72 : 1,
            })}
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-white/20">
              <Text className="text-lg font-bold leading-6 text-white">✓</Text>
            </View>
            <Text className="text-2xl font-bold text-white">
              {busy ? "Saving…" : "Done"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            className="min-h-12 items-center justify-center"
            disabled={busy}
            onPress={() => {
              haptic("tap");
              setShowReasons(true);
            }}
          >
            <Text className="text-base font-bold text-slate">Skip</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-row items-center gap-3">
          <Button
            className="flex-1"
            disabled={busy}
            loading={busy}
            title="Mark done"
            onPress={() => {
              haptic("tap");
              void submit("done");
            }}
          />
          <Button
            disabled={busy}
            title="Skip"
            variant="secondary"
            onPress={() => {
              haptic("tap");
              setShowReasons(true);
            }}
          />
        </View>
      )}
      <Sheet
        visible={showReasons}
        closeLabel="Cancel skip"
        onClose={() => setShowReasons(false)}
      >
        <View className="gap-2">
          <Text
            accessibilityRole="header"
            className="font-serif text-2xl text-ink"
          >
            Why are you skipping?
          </Text>
          <Text className="text-base leading-5 text-slate">
            {extensions.skipExplanation ?? "Your reason matters. This is recorded with care, not as a failure."}
          </Text>
        </View>
        <View className="gap-3">
          {reasonsFor(occurrence.category, skipReasons).map((item) => (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              className="min-h-14 flex-row items-center justify-between gap-3 rounded-2xl border border-line bg-cloud px-4"
              disabled={busy}
              onPress={() => void submit("skipped", item.value)}
              style={({ pressed }) => ({
                opacity: busy ? 0.45 : pressed ? 0.72 : 1,
              })}
            >
              <Text className="flex-1 text-base font-semibold text-ink">
                {item.label}
              </Text>
              <Text className="text-lg text-slate">›</Text>
            </Pressable>
          ))}
        </View>
        {!!error && (
          <Text accessibilityRole="alert" className="text-base text-coral">
            {error}
          </Text>
        )}
        <Button
          title="Cancel"
          variant="secondary"
          disabled={busy}
          onPress={() => setShowReasons(false)}
        />
      </Sheet>
      {!!error && (
        <Text
          selectable
          accessibilityRole="alert"
          className="text-base text-coral"
        >
          {error}
        </Text>
      )}
    </View>
  );
}
