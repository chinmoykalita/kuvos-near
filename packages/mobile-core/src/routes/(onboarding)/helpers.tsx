import { useLocalSearchParams } from 'expo-router';

import type { CareRole } from '../../api';
import { HelpersScreen } from '../../screens/helpers-screen';

export default function HelpersRoute() {
  const { patientId, role } = useLocalSearchParams<{ patientId: string; role: CareRole }>();
  return <HelpersScreen patientId={patientId} role={role} />;
}
