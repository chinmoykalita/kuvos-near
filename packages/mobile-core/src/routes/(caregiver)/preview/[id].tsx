import { useLocalSearchParams } from 'expo-router';

import { PreviewScreen } from '../../../screens/preview-screen';

export default function PreviewRoute() {
  const { id, planId } = useLocalSearchParams<{ id: string; planId?: string }>();
  return <PreviewScreen extractionId={id} attachPlanId={planId} />;
}
