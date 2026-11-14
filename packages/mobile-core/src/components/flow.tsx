import { logoWordmark } from '../config';
import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { BrandLogo } from './brand-logo';
import { Text } from './text';
import { colors } from '../theme';

// Shared shell for the setup → upload → reading flow: logo header, dark hero, white footer bar.
export function FlowScreen({
  step,
  steps,
  onBack,
  header,
  footer,
  children,
}: PropsWithChildren<{
  step?: number;
  steps?: number;
  onBack?: () => void;
  header?: ReactNode;
  footer?: ReactNode;
}>) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-cloud" style={{ paddingTop: insets.top }}>
      <ScrollView
        contentContainerClassName="flex-grow gap-4 px-5 pb-6 pt-3"
        keyboardShouldPersistTaps="handled"
      >
        {header ?? (
        <View className="min-h-11 flex-row items-center justify-between">
          <Pressable
            accessibilityRole={onBack ? 'button' : undefined}
            accessibilityLabel={onBack ? 'Back' : undefined}
            className="flex-row items-center gap-2"
            disabled={!onBack}
            hitSlop={8}
            onPress={onBack}
          >
            {onBack && <Text className="text-2xl text-deep-blue">‹</Text>}
            <BrandLogo size={24} />
            <Text className="text-brand text-deep-blue">{logoWordmark}</Text>
          </Pressable>
          <View accessibilityLabel={`Step ${step} of ${steps}`} className="flex-row gap-1.5">
            {Array.from({ length: steps ?? 0 }, (_, index) => (
              <View
                key={index}
                className={`h-1 w-5 rounded-full ${index < (step ?? 0) ? 'bg-deep-blue' : 'bg-line'}`}
              />
            ))}
          </View>
        </View>
        )}
        {children}
      </ScrollView>
      {footer && (
        <View
          className="gap-2 border-t border-line bg-white px-5 pt-4"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          {footer}
        </View>
      )}
    </View>
  );
}

function HeartBadge() {
  return (
    <View className="-ml-3 h-8 w-8 items-center justify-center rounded-xl border-2 border-deep-blue bg-cobalt">
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={colors.white} strokeWidth={2.2} strokeLinejoin="round">
        <Path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
      </Svg>
    </View>
  );
}

export function FlowHero({
  initial,
  meta,
  eyebrow,
  title,
  accent,
  suffix = '',
  subtitle,
}: {
  /** Person initial with a heart badge; omit to show the kuvos ring instead. */
  initial?: string;
  meta?: string;
  eyebrow: string;
  title: string;
  accent: string;
  suffix?: string;
  subtitle: string;
}) {
  return (
    <View className="gap-3 rounded-3xl bg-deep-blue p-5">
      <View className="flex-row items-center gap-3">
        <View className="flex-row items-center">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-white">
            {initial ? (
              <Text className="font-serif text-2xl text-deep-blue">{initial}</Text>
            ) : (
              <BrandLogo size={30} />
            )}
          </View>
          {initial !== undefined && <HeartBadge />}
        </View>
        {!!meta && <Text className="text-sm text-white/70">{meta}</Text>}
      </View>
      <Text className="pt-1 text-2xs font-semibold uppercase tracking-eyebrow text-mist">
        {eyebrow}
      </Text>
      <Text accessibilityRole="header" className="font-serif text-3xl text-white">
        {title}
        <Text className="font-serif-italic text-mist">{accent}</Text>
        {suffix}
      </Text>
      <Text className="text-sm text-white/70">{subtitle}</Text>
    </View>
  );
}

export function CheckList({ title, lines }: { title?: string; lines: ReactNode[] }) {
  return (
    <View className="gap-2 rounded-3xl border border-line bg-white p-4">
      {!!title && <Text className="text-sm font-bold text-ink">{title}</Text>}
      {lines.map((line, index) => (
        <View key={index} className="flex-row gap-2">
          <Text className="text-sm font-bold text-fresh-green">✓</Text>
          <Text className="flex-1 text-sm text-slate">{line}</Text>
        </View>
      ))}
    </View>
  );
}
