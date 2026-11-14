import { useLocalSearchParams } from 'expo-router';

import { UploadScreen } from '../../screens/upload-screen';

export default function UploadRoute() {
  const { patientId, planId } = useLocalSearchParams<{
    patientId: string;
    planId?: string;
  }>();
  return <UploadScreen patientId={patientId} planId={planId} />;
}
