import { useEffect, useRef, useState } from 'react';
import * as Updates from 'expo-updates';

const LAUNCH_UPDATE_TIMEOUT_MS = 8_000;
const SPLASH_BACKGROUND = '#F3F8FC';

function updatesAreEnabled() {
  return !__DEV__ && Updates.isEnabled;
}

function checkHasSettled(updates: ReturnType<typeof Updates.useUpdates>) {
  return (
    !updates.isChecking &&
    !updates.isDownloading &&
    !updates.isStartupProcedureRunning &&
    (updates.lastCheckForUpdateTimeSinceRestart != null ||
      updates.checkError != null ||
      updates.downloadError != null)
  );
}

async function reloadIntoUpdate() {
  await Updates.reloadAsync({
    reloadScreenOptions: {
      backgroundColor: SPLASH_BACKGROUND,
      fade: false,
      spinner: { enabled: false, color: SPLASH_BACKGROUND, size: 'small' },
    },
  });
}

export function useLaunchUpdateReady() {
  const updates = Updates.useUpdates();
  const [gaveUp, setGaveUp] = useState(false);
  const gaveUpRef = useRef(false);
  const reloading = useRef(false);

  useEffect(() => {
    if (!updatesAreEnabled()) return;

    // ponytail: a slow check must not hold the splash forever. The installed bundle opens, and a finished download applies on the next cold start.
    const timer = setTimeout(() => {
      gaveUpRef.current = true;
      setGaveUp(true);
    }, LAUNCH_UPDATE_TIMEOUT_MS);

    void (async () => {
      try {
        const check = await Updates.checkForUpdateAsync();
        if (gaveUpRef.current || reloading.current) return;
        if (!check.isAvailable && !check.isRollBackToEmbedded) return;
        const fetched = await Updates.fetchUpdateAsync();
        if (
          gaveUpRef.current ||
          reloading.current ||
          (!fetched.isNew && !fetched.isRollBackToEmbedded)
        ) {
          return;
        }
        reloading.current = true;
        clearTimeout(timer);
        await reloadIntoUpdate();
      } catch {
        // The installed build also checks on launch. That result arrives through useUpdates.
      }
    })();

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (
      !updatesAreEnabled() ||
      gaveUpRef.current ||
      reloading.current ||
      updates.restartCount > 0 ||
      !updates.isUpdatePending
    ) {
      return;
    }
    reloading.current = true;
    void reloadIntoUpdate();
  }, [updates.isUpdatePending, updates.restartCount]);

  if (!updatesAreEnabled() || gaveUp) return true;
  if (updates.isUpdatePending || updates.isRestarting) return false;
  return checkHasSettled(updates);
}
