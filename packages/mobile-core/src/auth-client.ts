import Constants from 'expo-constants';
import { expoClient } from '@better-auth/expo/client';
import * as SecureStore from 'expo-secure-store';
import { createAuthClient } from 'better-auth/react';
// shortcut: Better Auth 1.7.3's client barrel bundles SIWE; use public per-plugin imports when available.
import { jwtClient } from '../../../node_modules/better-auth/dist/plugins/jwt/client.mjs';
import { magicLinkClient } from '../../../node_modules/better-auth/dist/plugins/magic-link/client.mjs';
import { phoneNumberClient } from '../../../node_modules/better-auth/dist/plugins/phone-number/client.mjs';

import { API_URL } from './config';

export const authClient = createAuthClient({
  baseURL: `${API_URL}/auth`,
  plugins: [
    expoClient({
      scheme: Constants.expoConfig?.scheme as string,
      storagePrefix: Constants.expoConfig?.extra?.authStoragePrefix,
      storage: SecureStore,
    }),
    jwtClient(),
    phoneNumberClient(),
    magicLinkClient(),
  ],
});
