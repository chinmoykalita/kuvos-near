import { useLocalSearchParams } from 'expo-router';

import { SourceScreen } from '../../../screens/source-screen';

export default function SourceRoute() {
  const { candidateId, id, explanation } = useLocalSearchParams<{ id: string; candidateId: string; explanation?: string }>();
  return <SourceScreen candidateId={candidateId} extractionId={id} explanationSources={explanation === '1'} />;
}
