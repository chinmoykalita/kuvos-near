import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, TurboModuleRegistry, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFocusEffect } from 'expo-router';
import type { WebView as WebViewInstance } from 'react-native-webview';

import type { Exercise } from '../physio/catalogue';
import { playerHtml } from '../physio/player-html';
import { colors } from '../theme';
import { Button } from './button';
import { Text } from './text';

// Older OTA recipients lack WebView; importing it eagerly calls getEnforcing and crashes.
const WebView: typeof WebViewInstance | null = TurboModuleRegistry.get('RNCWebViewModule')
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Load only after the native compatibility check.
  ? require('react-native-webview').WebView
  : null;

export function PhysioPlayer({ exercise }: { exercise: Exercise }) {
  const view = useRef<WebViewInstance>(null);
  const focused = useRef(false);
  const { height } = useWindowDimensions();
  const [slow, setSlow] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source = useMemo(() => ({ html: playerHtml(exercise) }), [exercise]);
  const control = useCallback((action: string) => {
    view.current?.injectJavaScript(`window.physioControl && window.physioControl(${JSON.stringify(action)}); true;`);
  }, []);
  const syncPlayback = useCallback(() => {
    control(focused.current && AppState.currentState === 'active' ? 'play' : 'pause');
  }, [control]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    syncPlayback();
    return () => { focused.current = false; control('pause'); };
  }, [control, syncPlayback]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', syncPlayback);
    return () => listener.remove();
  }, [syncPlayback]);

  if (!WebView) return (
    <View className="gap-2 rounded-3xl border border-line bg-white p-5">
      <Text className="text-base font-semibold text-deep-blue">Update the app to watch animations</Text>
      <Text className="text-base leading-6 text-slate">Install the latest app version from your app store or TestFlight. You can still read the exercise instructions below.</Text>
    </View>
  );

  return (
    <View className="overflow-hidden rounded-3xl border border-line bg-white">
      {failed ? (
        <View className="gap-3 p-4">
          <Text accessibilityRole="alert">The animation could not load. The instructions are below.</Text>
          <Button title="Try again" variant="secondary" onPress={() => {
            setFailed(false); setReady(false); setSlow(false); setAttempt(value => value + 1);
          }} />
        </View>
      ) : (
        <View style={{ height: Math.min(240, height * 0.28) }}>
          <WebView
            key={attempt}
            ref={view}
            source={source}
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
            javaScriptEnabled
            domStorageEnabled={false}
            allowFileAccess={false}
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled={false}
            scrollEnabled={false}
            onLoadEnd={() => { setReady(true); control(slow ? 'slow' : 'normal'); syncPlayback(); }}
            onError={() => { setFailed(true); setReady(false); control('pause'); }}
            onContentProcessDidTerminate={() => { setFailed(true); setReady(false); }}
            onRenderProcessGone={() => { setFailed(true); setReady(false); }}
            style={{ backgroundColor: '#F3F8FC' }}
          />
        </View>
      )}
      <View className="items-end px-3 pb-1">
        <Pressable
          accessibilityRole="button"
          disabled={!ready || failed}
          accessibilityState={{ disabled: !ready || failed }}
          accessibilityLabel={slow ? 'Slow motion. Switch to normal speed' : 'Normal speed. Switch to slow motion'}
          className="min-h-12 min-w-12 items-center justify-center"
          style={({ pressed }) => ({ opacity: !ready || failed ? 0.4 : pressed ? 0.65 : 1 })}
          onPress={() => { control(slow ? 'normal' : 'slow'); setSlow(!slow); }}
        >
          <View className="flex-row items-center gap-1.5 rounded-full bg-ice px-3 py-1.5">
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.deepBlue} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
              <Path d="M4 19a9 9 0 1 1 16 0M4 19h16" />
              <Path d={slow ? 'M12 14 8 10' : 'M12 14 16 8'} />
            </Svg>
            <Text className="text-sm font-semibold text-deep-blue">{slow ? '½×' : '1×'}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}
