import { Redirect } from 'expo-router';

import { useCareSession } from '../../../care-session';
import { CaregiverGlanceScreen } from '../../../screens/caregiver-glance-screen';

export default function CircleRoute() {
  const { membership } = useCareSession();
  if (membership.role !== 'CAREGIVER') return <Redirect href="/today" />;
  return <CaregiverGlanceScreen />;
}
