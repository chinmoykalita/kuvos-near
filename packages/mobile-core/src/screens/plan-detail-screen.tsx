import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { api, type Me, type PlansResponse, type PlanSummary, type Today } from '../api';
import { Button } from '../components/button';
import { Screen } from '../components/screen';
import { Text, TextInput } from '../components/text';

export function PlanDetailScreen({ planId }: { planId: string }) {
  const router = useRouter();
  const [patientId, setPatientId] = useState('');
  const [plan, setPlan] = useState<PlanSummary>();
  const [today, setToday] = useState<Today>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const me = await api<Me>('/me');
    const nextPatientId = me.memberships[0]?.patient.id;
    if (!nextPatientId) throw new Error('Patient not found.');
    const [plans, day] = await Promise.all([
      api<PlansResponse>(`/patients/${nextPatientId}/plans`),
      api<Today>(`/plans/${planId}/today`).catch(() => undefined),
    ]);
    const found = plans.plans.find((item) => item.id === planId);
    if (!found) throw new Error('Plan not found.');
    setPatientId(nextPatientId);
    setPlan(found);
    setName(found.name);
    if (day) setToday(day);
  }, [planId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError('');
      load().catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not load this plan.');
        }
      });
      return () => {
        active = false;
      };
    }, [load]),
  );

  async function rename() {
    if (!name.trim() || name.trim() === plan?.name) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api<PlanSummary>(`/plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      setPlan((current) => (current ? { ...current, ...updated } : updated));
      setNotice('Plan renamed.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not rename the plan.');
    } finally {
      setBusy(false);
    }
  }

  async function closePlan() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/plans/${planId}/close`, { method: 'POST' });
      setNotice('Plan closed. It no longer appears in Today.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not close the plan.');
    } finally {
      setBusy(false);
    }
  }

  if (!plan) {
    return (
      <Screen>
        {error ? (
          <Text selectable accessibilityRole="alert" className="m-auto rounded-2xl bg-white p-5 text-center text-slate">
            {error}
          </Text>
        ) : (
          <ActivityIndicator className="m-auto" />
        )}
      </Screen>
    );
  }

  const isActive = plan.status === 'active';
  const occurrences = today?.occurrences || [];
  const checked = occurrences.filter(
    (item) => item.status === 'done' || item.status === 'skipped',
  ).length;

  return (
    <Screen contentClassName="gap-4">
      <View className="gap-2">
        <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
          {isActive ? 'Active plan' : 'Closed plan'}
        </Text>
        <Text className="text-2xl font-serif  text-deep-blue">
          {plan.name}
        </Text>
        {plan.suggestedName && plan.suggestedName !== plan.name && (
          <Text className="text-sm text-slate">
            Suggested from the document: {plan.suggestedName}
          </Text>
        )}
        {isActive && (
          <Text className="text-base font-semibold text-slate">
            {occurrences.length
              ? `${checked} of ${occurrences.length} checked today`
              : 'No timed tasks today'}
          </Text>
        )}
      </View>

      {isActive && (
        <View className="gap-3 rounded-3xl border border-line bg-white p-5">
          <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
            Rename
          </Text>
          <TextInput
            accessibilityLabel="Plan name"
            className="rounded-2xl border border-line bg-cloud px-4 py-3 text-base font-semibold text-ink"
            maxLength={40}
            onChangeText={setName}
            value={name}
          />
          <Button
            disabled={name.trim().length < 2 || name.trim() === plan.name}
            loading={busy}
            title="Save name"
            variant="secondary"
            onPress={rename}
          />
        </View>
      )}

      {isActive && !!occurrences.length && (
        <View className="gap-3 rounded-3xl border border-line bg-white p-5">
          <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
            Today in this plan
          </Text>
          {occurrences.map((item) => (
            <Text key={item.id} className="text-base font-semibold text-ink">
              {item.actionText}
            </Text>
          ))}
        </View>
      )}

      {isActive && (
        <View className="gap-3">
          <Button
            title="Add document to this plan"
            onPress={() =>
              router.push({
                pathname: '/upload',
                params: { patientId, planId },
              })
            }
          />
          <Button
            loading={busy}
            title="Close plan"
            variant="quiet"
            onPress={closePlan}
          />
        </View>
      )}

      {!!notice && <Text className="rounded-2xl bg-ice p-4 text-ink">{notice}</Text>}
      {!!error && (
        <Text selectable accessibilityRole="alert" className="rounded-2xl bg-coral/15 p-4 text-ink">
          {error}
        </Text>
      )}
    </Screen>
  );
}
