import { useLocalSearchParams } from 'expo-router';

import { ExtractionScreen } from '../../../screens/extraction-screen';

export default function ExtractionRoute() {
  const { id, planId, patientId, pages } = useLocalSearchParams<{
    id: string;
    planId?: string;
    patientId?: string;
    pages?: string;
  }>();
  return <ExtractionScreen extractionId={id} planId={planId} patientId={patientId} pages={pages} />;
}
