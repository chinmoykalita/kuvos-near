import Constants from 'expo-constants';

const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
const developmentHost = (Constants.expoConfig?.hostUri || Constants.linkingUri)
  ?.replace(/^\w+:\/\//, '')
  .split(':')[0];

// ponytail: Expo's dev host keeps phone setup zero-config; set EXPO_PUBLIC_API_URL for deployed builds.
export const API_URL = configuredUrl || `http://${developmentHost || 'localhost'}:3001/api`;

export const wordmark: string = Constants.expoConfig?.extra?.wordmark ?? 'Kuvos';
// The logo beside the brand icon is always lowercase; sentences keep `wordmark`.
export const logoWordmark = wordmark.toLowerCase();
export const signInMetadata: Record<string, string> = Constants.expoConfig?.extra?.signInMetadata ?? {};
