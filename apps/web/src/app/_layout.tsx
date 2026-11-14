import '@/global.css';
import RootLayout from '@kuvos/mobile-core/routes/_layout';

import { AlertHost } from '../../web/alert-host';
import { AppFrame } from '../../web/frame';
import { NearExtensions } from '../../web/near/extensions';

export { ErrorBoundary } from 'expo-router';

export default function WebRootLayout() {
  return (
    <AppFrame>
      <NearExtensions>
        <RootLayout />
      </NearExtensions>
      <AlertHost />
    </AppFrame>
  );
}
