import { useLocalSearchParams } from 'expo-router';

import { PlanDetailScreen } from '../../../screens/plan-detail-screen';

export default function PlanDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlanDetailScreen planId={id} />;
}
