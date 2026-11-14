import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { api, type PlansResponse, type PlanSummary } from '../api';
import { useCareSession } from '../care-session';
import { Button } from '../components/button';
import { Screen } from '../components/screen';
import { Text } from '../components/text';
import { PlanCalendarScreen } from './plan-calendar-screen';

function adherenceLabel(plan: PlanSummary) {
  const adherence = plan.adherence;
  if (!adherence || plan.status !== 'active') return 'Closed';
  if (!adherence.total) return 'No timed tasks today';
  const checked = adherence.done + adherence.skipped;
  return `${checked} of ${adherence.total} checked today`;
}

export function PlanScreen() {
  const { membership } = useCareSession();
  if (membership.role === 'PATIENT') {
    return <PlanCalendarScreen patientId={membership.patient.id} />;
  }
  return <CaregiverPlansScreen />;
}

function CaregiverPlansScreen() {
  const router = useRouter();
  const { membership } = useCareSession();
  const patientId = membership.patient.id;
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError('');
      api<PlansResponse>(`/patients/${patientId}/plans`)
        .then((next) => {
          if (!active) return;
          setPlans(next.plans);
          setLoaded(true);
        })
        .catch((caught) => {
          if (!active) return;
          setError(
            caught instanceof Error ? caught.message : 'Could not load plans.',
          );
          setLoaded(true);
        });
      return () => {
        active = false;
      };
    }, [patientId]),
  );

  const activePlans = plans.filter((plan) => plan.status === 'active');
  const closedPlans = plans.filter((plan) => plan.status === 'closed');

  if (!loaded) {
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
  }

  return (
    <Screen withoutHeader inTabs contentClassName="gap-4">
      <View className="gap-2">
        <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
          Care plans
        </Text>
        <Text className="text-3xl font-serif  text-deep-blue">
          {membership.patient.name}’s plans
        </Text>
        <Text className="text-base leading-6 text-slate">
          Keep Cardiac, Physio, and Dental as separate folders. Today still merges them for the
          patient.
        </Text>
      </View>

      <Button
        title="Add a new plan document"
        onPress={() =>
          router.push({ pathname: '/upload', params: { patientId } })
        }
      />

      {!!error && (
        <Text selectable accessibilityRole="alert" className="rounded-2xl bg-coral/15 p-4 text-ink">
          {error}
        </Text>
      )}

      <View className="gap-3">
        {activePlans.map((plan) => (
          <Pressable
            key={plan.id}
            accessibilityRole="button"
            className="gap-2 rounded-3xl border border-line bg-white p-5"
            onPress={() =>
              router.push({ pathname: '/plan/[id]', params: { id: plan.id } })
            }
          >
            <Text className="text-2xl font-extrabold text-deep-blue">{plan.name}</Text>
            <Text className="text-sm font-semibold text-slate">
              {adherenceLabel(plan)}
            </Text>
            <View className="flex-row gap-3 pt-2">
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: '/upload',
                    params: { patientId, planId: plan.id },
                  })
                }
              >
                <Text className="font-semibold text-cobalt">Add document</Text>
              </Pressable>
              <Text className="font-semibold text-slate">Open</Text>
            </View>
          </Pressable>
        ))}
        {!activePlans.length && (
          <View className="rounded-3xl border border-line bg-white p-5">
            <Text className="text-base leading-6 text-slate">
              No active plans yet. Upload a care document to create the first folder.
            </Text>
          </View>
        )}
      </View>

      {!!closedPlans.length && (
        <View className="gap-3">
          <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-slate">
            Closed
          </Text>
          {closedPlans.map((plan) => (
            <View key={plan.id} className="rounded-3xl border border-line bg-cloud p-5">
              <Text className="text-lg font-extrabold text-deep-blue">{plan.name}</Text>
              <Text className="text-sm font-semibold text-slate">Closed</Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
