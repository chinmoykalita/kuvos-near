import { useWindowDimensions } from 'react-native';

// At this width and above the app uses the desktop shell: a left sidebar instead of the
// bottom tab bar, centred dialogs instead of bottom sheets.
export const WIDE_MIN_WIDTH = 900;
// Readable column widths for the desktop shell.
export const CONTENT_MAX_WIDTH = 760;
export const FOCUSED_MAX_WIDTH = 560;
export const SIDEBAR_WIDTH = 256;

export function useWideLayout() {
  return useWindowDimensions().width >= WIDE_MIN_WIDTH;
}
