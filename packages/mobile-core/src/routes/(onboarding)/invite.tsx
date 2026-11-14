import { useLocalSearchParams } from 'expo-router';

import type { CareRole } from '../../api';
import { InviteScreen } from '../../screens/invite-screen';

export default function InviteRoute() {
  const { patientId, role } = useLocalSearchParams<{ patientId: string; role: CareRole }>();
  return <InviteScreen patientId={patientId} role={role} />;
}
