import { createAuthClient } from 'better-auth/react';
// shortcut: Better Auth 1.7.3's client barrel bundles SIWE; use public per-plugin imports when available.
import { magicLinkClient } from '../../../../node_modules/better-auth/dist/plugins/magic-link/client.mjs';
import { phoneNumberClient } from '../../../../node_modules/better-auth/dist/plugins/phone-number/client.mjs';

import { API_URL } from '@kuvos/mobile-core/config';

// Web sessions use the API's own httpOnly cookies (keep the API same-site with the web app),
// so nothing about the session is readable from JavaScript.
export const authClient = createAuthClient({
  baseURL: `${API_URL}/auth`,
  fetchOptions: { credentials: 'include' },
  plugins: [phoneNumberClient(), magicLinkClient()],
});
