import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { api, type Me } from '@kuvos/mobile-core/api';
import CaregiverLayout from '@kuvos/mobile-core/routes/(caregiver)/_layout';
import { colors } from '@kuvos/mobile-core/theme';

import { CONTENT_MAX_WIDTH, useWideLayout } from '../../../web/layout';
import { Sidebar } from '../../../web/sidebar';

// Web shell for the signed-in care area. Phones keep the native layout (bottom tab bar).
// Wide screens get a persistent left sidebar once the patient has an active plan, and every
// screen, including task details, upload and review, sits in a centred readable column.
export default function WebCaregiverLayout() {
  const wide = useWideLayout();
  const pathname = usePathname();
  const [me, setMe] = useState<Me>();
  const hasPlan = !!me?.memberships[0]?.patient.hasActivePlan;

  // The first confirmed plan unlocks the sidebar, so look again on navigation until one exists.
  useEffect(() => {
    if (!wide || hasPlan) return;
    let active = true;
    api<Me>('/me').then((next) => active && setMe(next)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [wide, hasPlan, pathname]);

  const sidebar = wide && hasPlan && me;
  // The tree shape never changes with width, so resizing does not remount the navigator.
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.cloud }}>
      {sidebar ? <Sidebar me={me} /> : null}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <View style={{ flex: 1, width: '100%', maxWidth: wide ? CONTENT_MAX_WIDTH : undefined }}>
          <CaregiverLayout />
        </View>
      </View>
    </View>
  );
}
