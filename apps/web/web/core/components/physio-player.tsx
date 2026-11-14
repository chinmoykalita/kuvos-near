import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFocusEffect } from 'expo-router';

import type { Exercise } from '@kuvos/mobile-core/physio/catalogue';
import { playerHtml } from '@kuvos/mobile-core/physio/player-html';
import { colors } from '@kuvos/mobile-core/theme';
import { Text } from '@kuvos/mobile-core/components/text';

// The native player runs this HTML in a WebView; on web it runs in a sandboxed iframe
// without same-origin access, so playback commands travel by postMessage.
const bridge =
  "<script>addEventListener('message',function(e){if(typeof e.data==='string'&&window.physioControl)window.physioControl(e.data)});</script>";

export function PhysioPlayer({ exercise }: { exercise: Exercise }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const focused = useRef(false);
  const { height } = useWindowDimensions();
  const [slow, setSlow] = useState(false);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => playerHtml(exercise) + bridge, [exercise]);
  const control = useCallback((action: string) => {
    frame.current?.contentWindow?.postMessage(action, '*');
  }, []);
  const syncPlayback = useCallback(() => {
    control(focused.current && document.visibilityState === 'visible' ? 'play' : 'pause');
  }, [control]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    syncPlayback();
    return () => { focused.current = false; control('pause'); };
  }, [control, syncPlayback]));
  useEffect(() => {
    document.addEventListener('visibilitychange', syncPlayback);
    return () => document.removeEventListener('visibilitychange', syncPlayback);
  }, [syncPlayback]);

  return (
    <View className="overflow-hidden rounded-3xl border border-line bg-white">
      <View style={{ height: Math.min(240, height * 0.28) }}>
        <iframe
          ref={frame}
          title={`${exercise.name} animation`}
          sandbox="allow-scripts"
          srcDoc={html}
          onLoad={() => { setReady(true); control(slow ? 'slow' : 'normal'); syncPlayback(); }}
          style={{ border: 0, width: '100%', height: '100%', background: '#F3F8FC', display: 'block' }}
        />
      </View>
      <View className="items-end px-3 pb-1">
        <Pressable
          accessibilityRole="button"
          disabled={!ready}
          accessibilityState={{ disabled: !ready }}
          accessibilityLabel={slow ? 'Slow motion. Switch to normal speed' : 'Normal speed. Switch to slow motion'}
          className="min-h-12 min-w-12 items-center justify-center"
          style={({ pressed }) => ({ opacity: !ready ? 0.4 : pressed ? 0.65 : 1 })}
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
