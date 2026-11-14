import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { api, type Candidate, type CareRole, type Extraction, type PlanSummary } from '../api';
import { useAppExtensions } from '../app-extensions';
import { Button } from '../components/button';
import { DurationField } from '../components/duration-field';
import { ActionExplanation } from '../components/action-explanation';
import { Screen } from '../components/screen';
import { Text, TextInput } from '../components/text';
import { candidatesFrom, needsDayCount, reviewReady, scheduleSummary } from '../review';

export function PreviewScreen({
  extractionId,
  attachPlanId,
}: {
  extractionId: string;
  attachPlanId?: string;
}) {
  const router = useRouter();
  const extensions = useAppExtensions();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [suggestedName, setSuggestedName] = useState('Care plan');
  const [name, setName] = useState('Care plan');
  const [activePlans, setActivePlans] = useState<PlanSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState(attachPlanId || '');
  // Set when this is the patient's first plan: onboarding ends with "Who helps you?".
  const [helperInvite, setHelperInvite] = useState<{ patientId: string; role: CareRole }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Extraction>(`/extractions/${extractionId}`)
      .then(async (extraction) => {
        setCandidates(candidatesFrom(extraction));
        const suggested = extraction.suggestedPlanName || 'Care plan';
        setSuggestedName(suggested);
        setName(suggested);
        const me = await api<{
          memberships: {
            canInviteRole?: CareRole;
            patient: { id: string; plans?: PlanSummary[] };
          }[];
        }>('/me');
        const membership = me.memberships[0];
        if (!membership) return;
        const active = (membership.patient.plans || []).filter(
          (plan) => plan.status === 'active',
        );
        setActivePlans(active);
        if (attachPlanId) setSelectedPlanId(attachPlanId);
        if (!active.length && membership.canInviteRole) {
          setHelperInvite({ patientId: membership.patient.id, role: membership.canInviteRole });
        }
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Could not load the plan preview.'),
      );
  }, [attachPlanId, extractionId]);

  const included = candidates.filter((candidate) => candidate.decision === 'accepted');
  const excluded = candidates.filter((candidate) => candidate.decision === 'rejected');
  const attaching = !!selectedPlanId;
  const selectedPlan = activePlans.find((plan) => plan.id === selectedPlanId);

  function patchDurationDays(candidateId: string, days: number) {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.candidate_id === candidateId
          ? {
              ...candidate,
              schedule: {
                ...candidate.schedule,
                duration_days: days,
                end_date: days > 0 ? undefined : candidate.schedule.end_date,
              },
            }
          : candidate,
      ),
    );
  }

  async function confirm() {
    if (!reviewReady(candidates)) return;
    if (!attaching && name.trim().length < 2) {
      setError('Give this plan a short name before activating.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/extractions/${extractionId}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates }),
      });
      const confirmed = await api<{ planId: string }>(`/extractions/${extractionId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          attaching
            ? { planId: selectedPlanId }
            : { name: name.trim() },
        ),
      });
      if (helperInvite && !attaching) router.replace({ pathname: '/helpers', params: helperInvite });
      else {
        const next = await extensions.afterPlanConfirm?.(confirmed.planId).catch(() => undefined);
        router.replace((next ?? '/today') as Href);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The plan could not be activated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View className="gap-2">
        <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
          Final check
        </Text>
        <Text className="text-2xl font-serif  text-deep-blue">
          This is what will become active
        </Text>
        <Text className="text-base leading-6 text-slate">
          {attaching
            ? `These instructions will be added to ${selectedPlan?.name || 'the selected plan'}.`
            : 'Name this plan folder, then activate. Each instruction can run for a different number of days.'}
        </Text>
      </View>

      {attaching ? (
        <View className="gap-2 rounded-3xl border border-line bg-ice p-5">
          <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
            Adding to
          </Text>
          <Text className="text-2xl font-extrabold text-deep-blue">
            {selectedPlan?.name || 'Selected plan'}
          </Text>
          {!attachPlanId && (
            <Pressable onPress={() => setSelectedPlanId('')}>
              <Text className="text-sm font-semibold text-cobalt">Create a new plan instead</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View className="gap-3 rounded-3xl border border-line bg-white p-5">
          <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
            Plan name
          </Text>
          <TextInput
            accessibilityLabel="Plan name"
            className="rounded-2xl border border-line bg-cloud px-4 py-3 text-base font-semibold text-ink"
            maxLength={40}
            onChangeText={setName}
            placeholder={suggestedName}
            value={name}
          />
          <Text className="text-sm leading-5 text-slate">
            Suggested from the document: {suggestedName}. You can edit this label.
          </Text>
          {!!activePlans.length && (
            <View className="gap-2 pt-2">
              <Text className="text-sm font-semibold text-slate">Or add to an existing plan</Text>
              {activePlans.map((plan) => (
                <Pressable
                  key={plan.id}
                  accessibilityRole="button"
                  className="rounded-2xl border border-line bg-cloud px-4 py-3"
                  onPress={() => setSelectedPlanId(plan.id)}
                >
                  <Text className="font-extrabold text-deep-blue">{plan.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      <View className="flex-row gap-3">
        <View className="flex-1 gap-1 rounded-2xl bg-ice p-4">
          <Text className="text-3xl font-serif text-deep-blue">{included.length}</Text>
          <Text className="text-sm font-semibold text-slate">Included</Text>
        </View>
        <View className="flex-1 gap-1 rounded-2xl bg-white p-4">
          <Text className="text-3xl font-serif text-deep-blue">{excluded.length}</Text>
          <Text className="text-sm font-semibold text-slate">Not included</Text>
        </View>
      </View>

      <View className="gap-3">
        {included.map((candidate, index) => (
          <View className="gap-3 rounded-3xl border border-line bg-white p-5" key={candidate.candidate_id}>
            <View className="flex-row items-center gap-3">
              <View className="h-9 w-9 items-center justify-center rounded-full bg-fresh-green/20">
                <Text className="font-extrabold text-deep-blue">{index + 1}</Text>
              </View>
              <Text className="flex-1 text-lg font-extrabold leading-6 text-ink">
                {candidate.action_text}
              </Text>
            </View>
            <Text className="pl-12 text-sm font-semibold text-slate">
              {scheduleSummary(candidate.schedule, candidate.category)}
            </Text>
            {candidate.physio && <Text className="pl-12 text-sm font-semibold text-cobalt">{candidate.physio.origin === 'reviewer_added' ? 'Exercise added by reviewer' : 'Exercise demonstration attached'}</Text>}
            <ActionExplanation explanation={candidate.explanation} extractionId={extractionId} candidateId={candidate.candidate_id} />
            {needsDayCount(candidate) && (
              <View className="pl-12">
                <DurationField
                  extractedDays={candidate.extracted_duration_days}
                  onChange={(days) => patchDurationDays(candidate.candidate_id, days)}
                  value={candidate.schedule.duration_days}
                />
              </View>
            )}
          </View>
        ))}
      </View>

      {!!error && (
        <Text selectable accessibilityRole="alert" className="rounded-2xl bg-coral/15 p-4 text-ink">
          {error}
        </Text>
      )}

      <View className="mt-auto gap-3 pt-4">
        <Button
          disabled={!reviewReady(candidates) || (!attaching && name.trim().length < 2)}
          loading={busy}
          title={attaching ? 'Add to plan' : 'Activate plan'}
          onPress={confirm}
        />
        <Text className="text-center text-sm leading-5 text-slate">
          Nothing is activated until you tap this button.
        </Text>
      </View>
    </Screen>
  );
}
