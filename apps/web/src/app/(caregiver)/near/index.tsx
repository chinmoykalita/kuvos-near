import { CareSessionProvider } from '@kuvos/mobile-core/care-session';

import { NearProofsScreen } from '../../../../web/near/proofs-screen';

// Proof screens sit outside the tab navigator, so they load the care session themselves.
export default function Route() {
  return (
    <CareSessionProvider>
      <NearProofsScreen />
    </CareSessionProvider>
  );
}
