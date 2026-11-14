import { useLocalSearchParams } from 'expo-router';

import { ReviewScreen } from '../../../screens/review-screen';

export default function ReviewRoute() {
  const { id, planId } = useLocalSearchParams<{ id: string; planId?: string }>();
  return <ReviewScreen extractionId={id} planId={planId} />;
}
