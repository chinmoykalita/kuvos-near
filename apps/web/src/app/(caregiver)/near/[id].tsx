import { CareSessionProvider } from '@kuvos/mobile-core/care-session';

import { NearProofScreen } from '../../../../web/near/proof-screen';

export default function Route() {
  return (
    <CareSessionProvider>
      <NearProofScreen />
    </CareSessionProvider>
  );
}
