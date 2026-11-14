import { Redirect, useLocalSearchParams } from 'expo-router';

import { authClient } from '../../auth-client';

export default function JoinRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: session } = authClient.useSession();

  if (!/^[0-9a-f-]{36}$/i.test(id)) return <Redirect href="/" />;

  return session ? (
    <Redirect href={{ pathname: '/invitation', params: { invitationId: id } }} />
  ) : (
    <Redirect href={{ pathname: '/sign-in', params: { invitationId: id } }} />
  );
}
