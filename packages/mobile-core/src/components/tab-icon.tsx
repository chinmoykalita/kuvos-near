import { Image } from 'expo-image';
import { View, type ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const tomo = require('../../assets/images/tomo-orb-idle.png');

type TabName = 'today' | 'plan' | 'circle' | 'more' | 'rhythm' | 'chat' | 'health';

export function TabIcon({
  name,
  color,
  focused,
}: {
  name: TabName;
  color: ColorValue;
  focused: boolean;
}) {
  const stroke = focused ? 2.5 : 2;
  return (
    <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
      {name === 'today' ? <TodayMark color={color} focused={focused} stroke={stroke} /> : null}
      {name === 'plan' ? <PlanMark color={color} focused={focused} stroke={stroke} /> : null}
      {name === 'circle' ? <CircleMark color={color} focused={focused} /> : null}
      {name === 'rhythm' ? <View style={{ width: 20, height: 22, flexDirection: 'row', gap: 3, alignItems: 'flex-end' }}>{[8, 16, 22].map(h => <View key={h} style={{ width: 4, height: h, backgroundColor: color, borderRadius: 2 }} />)}</View> : null}
      {name === 'health' ? <HealthMark color={color} stroke={stroke} /> : null}
      {name === 'more' ? <MoreMark color={color} focused={focused} /> : null}
      {name === 'chat' ? <Image source={tomo} contentFit="contain" accessible={false} style={{ width: 28, height: 28, opacity: focused ? 1 : 0.7 }} /> : null}
    </View>
  );
}

function TodayMark({
  color,
  focused,
  stroke,
}: {
  color: ColorValue;
  focused: boolean;
  stroke: number;
}) {
  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      {[0, 45, 90, 135].map((deg) => (
        <View
          key={deg}
          style={{
            position: 'absolute',
            height: 20,
            width: 2,
            alignItems: 'center',
            justifyContent: 'space-between',
            transform: [{ rotate: `${deg}deg` }],
          }}
        >
          <View style={{ backgroundColor: color, borderRadius: 1, height: 4, width: 2 }} />
          <View style={{ backgroundColor: color, borderRadius: 1, height: 4, width: 2 }} />
        </View>
      ))}
      <View
        style={{
          backgroundColor: focused ? color : 'transparent',
          borderColor: color,
          borderRadius: 6,
          borderWidth: stroke,
          height: 8,
          width: 8,
        }}
      />
    </View>
  );
}

function PlanMark({
  color,
  focused,
  stroke,
}: {
  color: ColorValue;
  focused: boolean;
  stroke: number;
}) {
  return (
    <View
      style={{
        backgroundColor: focused ? color : 'transparent',
        borderColor: color,
        borderRadius: 5,
        borderWidth: stroke,
        height: 18,
        overflow: 'hidden',
        width: 16,
      }}
    >
      <View
        style={{
          backgroundColor: focused ? 'rgba(255,255,255,0.92)' : color,
          height: 4,
          opacity: focused ? 1 : 0.9,
        }}
      />
      <View style={{ flex: 1, justifyContent: 'space-evenly', paddingHorizontal: 3 }}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View
              style={{
                backgroundColor: focused ? 'rgba(255,255,255,0.92)' : color,
                borderRadius: 1,
                height: 2,
                width: 3,
              }}
            />
            <View
              style={{
                backgroundColor: focused ? 'rgba(255,255,255,0.92)' : color,
                borderRadius: 1,
                height: 2,
                width: 3,
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function CircleMark({ color, focused }: { color: ColorValue; focused: boolean }) {
  const fill = focused ? color : 'transparent';
  return (
    <View style={{ height: 20, width: 22 }}>
      <View
        style={{
          backgroundColor: fill,
          borderColor: color,
          borderRadius: 5,
          borderWidth: 2,
          height: 10,
          left: 1,
          position: 'absolute',
          top: 0,
          width: 10,
        }}
      />
      <View
        style={{
          backgroundColor: fill,
          borderColor: color,
          borderRadius: 5,
          borderWidth: 2,
          height: 10,
          position: 'absolute',
          right: 1,
          top: 0,
          width: 10,
        }}
      />
      <View
        style={{
          backgroundColor: fill,
          borderColor: color,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          borderWidth: 2,
          bottom: 0,
          height: 9,
          left: 0,
          position: 'absolute',
          width: 13,
        }}
      />
      <View
        style={{
          backgroundColor: fill,
          borderColor: color,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          borderWidth: 2,
          bottom: 0,
          height: 9,
          position: 'absolute',
          right: 0,
          width: 13,
        }}
      />
    </View>
  );
}

function HealthMark({ color, stroke }: { color: ColorValue; stroke: number }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color as string} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20.4 12.9 12 21l-8.4-8.1A5.3 5.3 0 0 1 12 6.4a5.3 5.3 0 0 1 8.4 6.5Z" />
      <Path d="M3.6 12.5H9l1.5-2.5 2.5 4.5 1.5-2H20" />
    </Svg>
  );
}

function MoreMark({ color, focused }: { color: ColorValue; focused: boolean }) {
  const size = focused ? 5 : 4;
  return (
    <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map((dot) => (
        <View
          key={dot}
          style={{
            backgroundColor: color,
            borderRadius: 3,
            height: size,
            width: size,
          }}
        />
      ))}
    </View>
  );
}
