import { useLocalSearchParams } from 'expo-router';

import { InvitationScreen } from '../../screens/invitation-screen';

export default function InvitationRoute() {
  const { invitationId } = useLocalSearchParams<{ invitationId?: string }>();
  return <InvitationScreen invitationId={invitationId} />;
}
