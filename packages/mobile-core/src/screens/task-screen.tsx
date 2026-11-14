import { PhysioPlayer } from '../components/physio-player';
import { library } from '../physio/catalogue';
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import {
  api,
  type Me,
  type OccurrenceStatus,
  type SkipReason,
  type Today,
} from "../api";
import { OccurrenceActions } from "../components/occurrence-actions";
import { ActionExplanation } from "../components/action-explanation";
import { Screen } from "../components/screen";
import { Text } from "../components/text";

export function TaskScreen({
  planId,
  occurrenceId,
  date,
}: {
  planId?: string;
  occurrenceId: string;
  date?: string;
}) {
  const router = useRouter();
  const [occurrence, setOccurrence] =
    useState<NonNullable<Today["occurrences"]>[number]>();
  const [timezone, setTimezone] = useState("UTC");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [readOnly, setReadOnly] = useState<boolean>();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const query = date ? `?date=${encodeURIComponent(date)}` : "";

      async function load() {
        const me = await api<Me>("/me");
        const patientId = me.memberships[0]?.patient.id;
        if (!patientId) throw new Error("Patient not found.");
        const today = await api<Today>(
          planId
            ? `/plans/${planId}/today${query}`
            : `/patients/${patientId}/today${query}`,
        );
        const item = today.occurrences?.find(
          (occurrence) => occurrence.id === occurrenceId,
        );
        const ownerPlanId = item?.planId || planId;
        if (!active) return;
        setTimezone(today.timezone);
        setOccurrence(item);
        setReadOnly(
          me.memberships.some(
            (membership) =>
              membership.role === "CAREGIVER" &&
              membership.patient.plans?.some((plan) => plan.id === ownerPlanId),
          ),
        );
        setLoaded(true);
      }

      load().catch((caught) => {
        if (!active) return;
        setError(
          caught instanceof Error ? caught.message : "Could not load this task.",
        );
      });
      return () => {
        active = false;
      };
    }, [date, occurrenceId, planId]),
  );

  if (!occurrence) {
    return (
      <Screen>
        {error || loaded ? (
          <Text
            selectable
            accessibilityRole="alert"
            className="m-auto rounded-2xl bg-white p-5 text-center text-slate"
          >
            {error || "This task was not found for the selected day."}
          </Text>
        ) : (
          <ActivityIndicator className="m-auto" />
        )}
      </Screen>
    );
  }

  const fields = occurrence.fields || [];
  const exercise = occurrence.physio?.library_version === library.version
    ? library.exercises.find(item => item.id === occurrence.physio?.exercise_id) : undefined;
  const reviewerAdded = occurrence.physio?.origin === 'reviewer_added';
  const schedule = occurrence.schedule;
  return (
    <Screen>
      <View className="gap-2">
        <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
          {occurrence.category.replaceAll("_", " ")}
        </Text>
        <Text
          selectable
          className="text-3xl font-serif text-deep-blue"
        >
          {occurrence.actionText}
        </Text>
        <Text className="text-base font-bold text-slate">
          Scheduled for{" "}
          {new Intl.DateTimeFormat("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: timezone,
          }).format(new Date(occurrence.scheduledAt))}
        </Text>
      </View>

      {reviewerAdded && <Text className="text-sm font-semibold text-slate">Exercise added by a Care Circle reviewer</Text>}
      {exercise && <PhysioPlayer key={exercise.id} exercise={exercise} />}
      {occurrence.physio && !exercise && <Text className="text-sm text-slate">The saved exercise instructions are below. The matching animation is unavailable in this app version.</Text>}
      <View className="gap-3 rounded-3xl border border-line bg-white p-5">
        <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
          Full instruction
        </Text>
        <Text selectable className="text-base leading-6 text-ink">
          {occurrence.instructionText}
        </Text>
        {!!fields.length &&
          fields.map((field) => (
            <View
              className="flex-row justify-between gap-4 border-t border-line pt-3"
              key={field.name}
            >
              <Text className="font-bold capitalize text-slate">
                {field.name.replaceAll("_", " ")}
              </Text>
              <Text selectable className="flex-1 text-right font-bold text-ink">
                {field.normalized_value || field.raw_value}
                {field.unit ? ` ${field.unit}` : ""}
              </Text>
            </View>
          ))}
        {!!schedule?.times?.length && (
          <Text className="text-base font-semibold text-slate">
            Reminder times: {schedule.times.join(", ")}
          </Text>
        )}
      </View>

      <ActionExplanation explanation={occurrence.explanation} extractionId={occurrence.extractionId} candidateId={occurrence.candidateId} />

      {readOnly === true ? (
        <Text className="text-sm font-semibold leading-5 text-slate">
          {occurrence.status === "done"
            ? "Done"
            : occurrence.status === "skipped"
              ? "Skipped"
              : occurrence.status === "missed"
                ? "Missed. The marking window has closed."
                : "The patient marks this complete from Today."}
        </Text>
      ) : readOnly === false ? (
        <OccurrenceActions
          occurrence={occurrence}
          timezone={timezone}
          onLogged={(status: OccurrenceStatus, reason: SkipReason | undefined) =>
            setOccurrence(
              (current) =>
                current && {
                  ...current,
                  status,
                  reason: status === "skipped" ? reason : undefined,
                },
            )
          }
        />
      ) : null}

      {!reviewerAdded && occurrence.extractionId && occurrence.candidateId && (
        <Pressable
          accessibilityRole="button"
          className="rounded-2xl bg-sun/20 p-4"
          onPress={() =>
            router.push({
              pathname: "/source/[id]",
              params: {
                id: occurrence.extractionId!,
                candidateId: occurrence.candidateId!,
              },
            })
          }
        >
          <Text className="text-center font-extrabold text-ink">
            View source evidence
          </Text>
          <Text className="mt-1 text-center text-sm text-slate">
            Original page text and highlight
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}
