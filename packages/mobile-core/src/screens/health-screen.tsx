import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { useCareSession } from '../care-session';
import { Button } from '../components/button';
import {
  ChevronIcon,
  InfoIcon,
  MetricIcon,
  SourceIcon,
} from '../components/health-icon';
import { Screen } from '../components/screen';
import { Sheet } from '../components/sheet';
import { Text, TextInput } from '../components/text';
import { Tomo } from '../components/tomo';
import { colors } from '../theme';
import {
  APPLE_HEALTH,
  connectAppleHealth,
  disconnectAppleHealth,
  getWearables,
  setCalorieTarget,
  syncAppleHealth,
  type WearableSummary,
} from '../wearables/api';
import {
  healthAvailable,
  readHealth,
  requestHealthAccess,
} from '../wearables/health-reader';
import {
  calorieMessage,
  dailySeries,
  formatDay,
  formatTile,
  formatValue,
  hasReadings,
  healthGroups,
  metricDetails,
  periodCaption,
  snapshot,
  sourceLabels,
  type DailyPoint,
  type HealthGroup,
  type HealthPeriod,
  type WearableMetric,
} from '../wearables/metrics';

// One extra day so a 30-day average that ends yesterday is complete.
const BACKFILL_DAYS = 31;
const RESYNC_DAYS = 8;
const AUTO_SYNC_GAP_MS = 60_000;

const TILES: { metric: WearableMetric; label: string }[] = [
  { metric: 'resting_heart_rate', label: 'Resting HR' },
  { metric: 'sleep_duration', label: 'Sleep' },
  { metric: 'steps', label: 'Steps' },
  { metric: 'hrv_sdnn', label: 'HRV' },
];
const PERIODS: { value: HealthPeriod; label: string; hero: string }[] = [
  { value: 'today', label: 'Today', hero: 'day' },
  { value: 'week', label: '7 days', hero: 'week' },
  { value: 'month', label: '30 days', hero: 'month' },
];
const GROUP_ICON: Record<HealthGroup, WearableMetric> = {
  vitals: 'resting_heart_rate',
  sleep: 'sleep_duration',
  mobility: 'steps',
  food: 'calories_consumed',
};
const layout = LinearTransition.duration(220);

const message = (caught: unknown, fallback: string) =>
  caught instanceof Error ? caught.message : fallback;

// Today's view still charts a week, so every detail has some history.
const chartDays = (period: HealthPeriod) => (period === 'month' ? 30 : 7);

const shown = (metric: WearableMetric, value: number | null) =>
  value === null ? '–' : formatValue(metric, value);

function useCompact() {
  const { width, fontScale } = useWindowDimensions();
  return width < 350 || fontScale > 1.25;
}

function WeekHero({
  period,
  onInfo,
}: {
  period: HealthPeriod;
  onInfo: () => void;
}) {
  const hero = PERIODS.find(({ value }) => value === period)!.hero;
  return (
    // The hero is the page title, kept to one compact row.
    <View className="-mx-5 -mt-2 flex-row items-center gap-3 overflow-hidden px-5 py-2">
      <View pointerEvents="none" className="absolute inset-0">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="healthHero" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors.mist} stopOpacity={0.38} />
              <Stop offset="1" stopColor={colors.mist} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#healthHero)" />
        </Svg>
      </View>
      <Tomo size={44} />
      <Animated.View key={hero} entering={FadeIn.duration(200)} className="min-w-0 flex-1">
        <Text
          accessibilityRole="header"
          accessibilityLabel={`Fitness, your ${hero}`}
          numberOfLines={1}
          className="font-serif text-3xl text-ink"
        >
          Your <Text className="font-serif-italic text-cobalt">{hero}</Text>
        </Text>
      </Animated.View>
      <Pressable
        accessibilityLabel="About these numbers"
        accessibilityRole="button"
        className="h-11 w-11 items-center justify-center"
        onPress={onInfo}
      >
        <InfoIcon />
      </Pressable>
    </View>
  );
}

function PeriodSwitch({
  value,
  onChange,
}: {
  value: HealthPeriod;
  onChange: (next: HealthPeriod) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const segment = width ? (width - 8) / PERIODS.length : 0;
  const index = PERIODS.findIndex((period) => period.value === value);
  const offset = useSharedValue(0);
  useEffect(() => {
    offset.value = reduceMotion
      ? index * segment
      : withTiming(index * segment, { duration: 220 });
  }, [index, offset, reduceMotion, segment]);
  const pill = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));
  return (
    <View
      accessibilityRole="tablist"
      className="w-full max-w-[300px] flex-row self-center rounded-full bg-line/60 p-1"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {!!segment && (
        <Animated.View
          pointerEvents="none"
          className="absolute bottom-1 left-1 top-1 rounded-full bg-white"
          style={[
            {
              width: segment,
              shadowColor: colors.ink,
              shadowOpacity: 0.08,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 1,
            },
            pill,
          ]}
        />
      )}
      {PERIODS.map((period) => {
        const selected = period.value === value;
        return (
          <Pressable
            key={period.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            className="min-h-9 flex-1 items-center justify-center rounded-full"
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={() => {
              if (selected) return;
              void Haptics.selectionAsync();
              onChange(period.value);
            }}
          >
            <Text
              numberOfLines={1}
              className={`text-xs ${
                selected ? 'font-bold text-ink' : 'font-semibold text-slate'
              }`}
            >
              {period.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Tiles({
  summary,
  period,
  onOpen,
}: {
  summary: WearableSummary;
  period: HealthPeriod;
  onOpen: (metric: WearableMetric) => void;
}) {
  // Four across only when the numbers fit; larger text and small phones get 2 × 2.
  const twoColumns = useCompact();
  return (
    <Animated.View
      key={period}
      entering={FadeIn.duration(200)}
      className="flex-row flex-wrap gap-2"
    >
      {TILES.map(({ metric, label }) => {
        const snap = snapshot(summary.readings, metric, period, summary.today);
        const tile = formatTile(metric, snap.value);
        const caption = periodCaption(snap, summary.today);
        return (
          <Pressable
            key={metric}
            accessibilityRole="button"
            accessibilityHint="Opens daily readings"
            accessibilityLabel={
              snap.value === null
                ? `${label}: no reading`
                : `${label}: ${tile.value} ${tile.unit}, ${
                    period === 'today' ? caption : `daily average, ${caption}`
                  }`
            }
            className="min-w-0 grow rounded-2xl bg-white px-2 py-3 active:opacity-70"
            style={{ flexBasis: twoColumns ? '47%' : 0 }}
            onPress={() => onOpen(metric)}
          >
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              minimumFontScale={0.7}
              className="text-center font-serif text-2xl text-ink"
            >
              {tile.value}
              {!!tile.unit && (
                <Text className="text-xs text-slate"> {tile.unit}</Text>
              )}
            </Text>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              minimumFontScale={0.8}
              className="mt-1 text-center text-xs font-semibold text-ink"
            >
              {label}
            </Text>
            <Text
              numberOfLines={1}
              className="text-center text-2xs text-slate"
            >
              {caption}
            </Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

function ProgressBar({ share }: { share: number }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = reduceMotion ? share : withTiming(share, { duration: 500 });
  }, [progress, reduceMotion, share]);
  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  return (
    <View className="h-2 overflow-hidden rounded-full bg-cloud">
      <Animated.View className="h-full rounded-full bg-cobalt" style={fill} />
    </View>
  );
}

function CalorieCard({
  summary,
  onEdit,
}: {
  summary: WearableSummary;
  onEdit: () => void;
}) {
  const eaten =
    summary.readings.find(
      ({ day, metric }) => day === summary.today && metric === 'calories_consumed',
    )?.value ?? 0;
  const target = summary.calorieTarget;
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(120)}
      layout={layout}
      className="gap-3 rounded-3xl bg-white p-5"
    >
      <Text className="text-2xs font-bold uppercase tracking-eyebrow text-slate">
        Calories eaten today
      </Text>
      <Text
        accessibilityLabel={`${Math.round(eaten)} calories eaten today${
          target ? ` of a ${target} calorie target` : ''
        }`}
        className="font-serif text-3xl text-ink"
      >
        {Math.round(eaten).toLocaleString('en-US')}
        {target ? ` / ${target.toLocaleString('en-US')}` : ''}
        <Text className="text-lg font-bold text-ink"> kcal</Text>
      </Text>
      {!!target && <ProgressBar share={Math.min(eaten / target, 1)} />}
      <Text className="text-sm text-slate">{calorieMessage(eaten, target)}</Text>
      <Button
        size="compact"
        title={target ? 'Edit target' : 'Set a calorie target'}
        variant="quiet"
        onPress={onEdit}
      />
      {!eaten && (
        <Text className="text-xs leading-4 text-slate">
          Calories eaten come from Apple Health. Log food in Health or an app
          that writes to it.
        </Text>
      )}
    </Animated.View>
  );
}

// One neutral colour at every value: bar height is the only signal.
function Bars({
  points,
  width,
  height,
  target,
}: {
  points: DailyPoint[];
  width: number;
  height: number;
  target?: number | null;
}) {
  const gap = width / (points.length > 10 ? 120 : 28);
  const barWidth = (width - gap * (points.length - 1)) / points.length;
  const peak = Math.max(
    ...points.map(({ value }) => value ?? 0),
    target ?? 0,
    1,
  );
  const scale = (value: number) => Math.max(3, (value / peak) * (height - 4));
  return (
    <Svg width={width} height={height}>
      {points.map(({ day, value, partial }, index) => {
        const x = index * (barWidth + gap);
        if (value === null) {
          return (
            <Circle
              key={day}
              cx={x + barWidth / 2}
              cy={height - 2}
              r={Math.min(2, barWidth / 2)}
              fill={colors.line}
            />
          );
        }
        const barHeight = scale(value);
        return (
          <Rect
            key={day}
            x={x}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={Math.min(barWidth / 2, 5)}
            fill={colors.cobalt}
            opacity={partial ? 0.35 : 1}
          />
        );
      })}
      {!!target && (
        <Line
          x1={0}
          x2={width}
          y1={height - scale(target)}
          y2={height - scale(target)}
          stroke={colors.slate}
          strokeDasharray="4 4"
          strokeOpacity={0.6}
        />
      )}
    </Svg>
  );
}

function DayChart({
  points,
  today,
  target,
}: {
  points: DailyPoint[];
  today: string;
  target?: number | null;
}) {
  const [width, setWidth] = useState(0);
  const short = (day: string) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${day}T12:00:00Z`));
  const labels =
    points.length <= 7
      ? points.map(({ day }) =>
          day === today
            ? 'Today'
            : new Intl.DateTimeFormat('en-GB', {
                weekday: 'narrow',
                timeZone: 'UTC',
              }).format(new Date(`${day}T12:00:00Z`)),
        )
      : [short(points[0].day), short(points[14].day), 'Today'];
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      className="gap-2 rounded-2xl bg-cloud px-4 pb-3 pt-4"
    >
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {!!width && (
          <Bars points={points} width={width} height={132} target={target} />
        )}
      </View>
      {/* Weekly labels share the bars' gap so each sits under its own bar. */}
      <View
        className={`flex-row ${points.length <= 7 ? '' : 'justify-between'}`}
        style={points.length <= 7 ? { gap: width / 28 } : undefined}
      >
        {labels.map((label, index) => (
          <Text
            key={`${label}${index}`}
            numberOfLines={1}
            className={`text-2xs text-slate ${
              points.length <= 7 ? 'flex-1 text-center' : ''
            }`}
          >
            {label}
          </Text>
        ))}
      </View>
      {!!target && (
        <Text className="text-2xs text-slate">
          Dashed line: your target of {target.toLocaleString('en-US')} kcal
        </Text>
      )}
    </View>
  );
}

function MetricRow({
  metric,
  summary,
  period,
  first,
  onOpen,
}: {
  metric: WearableMetric;
  summary: WearableSummary;
  period: HealthPeriod;
  first: boolean;
  onOpen: () => void;
}) {
  const compact = useCompact();
  const snap = snapshot(summary.readings, metric, period, summary.today);
  const caption = periodCaption(snap, summary.today);
  const label = metricDetails[metric].label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens daily readings"
      accessibilityLabel={`${label}, ${shown(metric, snap.value)}, ${
        period === 'today' ? caption : `daily average, ${caption}`
      }`}
      className={`min-h-16 flex-row items-center gap-3 py-3 active:opacity-70 ${
        first ? '' : 'border-t border-line'
      }`}
      onPress={onOpen}
    >
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-base font-semibold text-ink">
          {label}
        </Text>
        <View className="flex-row items-center gap-1">
          {!!snap.source && <SourceIcon source={snap.source} />}
          <Text numberOfLines={1} className="text-xs text-slate">
            {snap.source ? `${sourceLabels[snap.source]} · ` : ''}
            {caption}
          </Text>
        </View>
      </View>
      {!compact && (
        <Bars
          points={dailySeries(
            summary.readings,
            metric,
            chartDays(period),
            summary.today,
          )}
          width={56}
          height={22}
        />
      )}
      <Text className="min-w-[64px] text-right text-base text-ink">
        {shown(metric, snap.value)}
      </Text>
    </Pressable>
  );
}

function GroupCard({
  group,
  label,
  metrics,
  summary,
  period,
  open,
  onToggle,
  onOpen,
}: {
  group: HealthGroup;
  label: string;
  metrics: WearableMetric[];
  summary: WearableSummary;
  period: HealthPeriod;
  open: boolean;
  onToggle: () => void;
  onOpen: (metric: WearableMetric) => void;
}) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(open ? 180 : 0);
  useEffect(() => {
    turn.value = reduceMotion
      ? open
        ? 180
        : 0
      : withTiming(open ? 180 : 0, { duration: 220 });
  }, [open, reduceMotion, turn]);
  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value}deg` }],
  }));
  const preview = metrics
    .map((metric) => ({
      metric,
      value: snapshot(summary.readings, metric, period, summary.today).value,
    }))
    .filter(({ value }) => value !== null)
    .slice(0, 2)
    .map(({ metric, value }) => formatValue(metric, value!))
    .join('  ·  ');
  const empty = period === 'today' ? 'No reading today' : 'No readings in this period';
  return (
    <Animated.View layout={layout} className="overflow-hidden rounded-3xl bg-white">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}, ${preview || empty}`}
        className="min-h-16 flex-row items-center gap-3 px-4 py-3 active:opacity-70"
        onPress={() => {
          void Haptics.selectionAsync();
          onToggle();
        }}
      >
        <View className="h-10 w-10 items-center justify-center rounded-full bg-cloud">
          <MetricIcon metric={GROUP_ICON[group]} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-base font-bold text-ink">{label}</Text>
          <Text numberOfLines={1} className="text-xs text-slate">
            {preview || empty}
          </Text>
        </View>
        <Animated.View style={chevron}>
          <ChevronIcon />
        </Animated.View>
      </Pressable>
      {open && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(120)}
          className="border-t border-line px-4"
        >
          {metrics.map((metric, index) => (
            <MetricRow
              key={metric}
              metric={metric}
              summary={summary}
              period={period}
              first={index === 0}
              onOpen={() => onOpen(metric)}
            />
          ))}
        </Animated.View>
      )}
    </Animated.View>
  );
}

function MetricSheet({
  metric,
  summary,
  period,
  onClose,
}: {
  metric?: WearableMetric;
  summary?: WearableSummary;
  period: HealthPeriod;
  onClose: () => void;
}) {
  // Keep the last metric while the sheet slides away.
  const [last, setLast] = useState(metric);
  if (metric && metric !== last) setLast(metric);
  const current = metric ?? last;
  if (!summary || !current) return <Sheet visible={false} onClose={onClose} />;

  const days = chartDays(period);
  const points = dailySeries(summary.readings, current, days, summary.today);
  const snap = snapshot(summary.readings, current, period, summary.today);
  const complete = points.filter(
    (point): point is DailyPoint & { value: number } =>
      point.value !== null && !point.partial,
  );
  const values = complete.map(({ value }) => value);
  const history = [...points]
    .reverse()
    .flatMap((point) =>
      point.value === null
        ? []
        : [
            {
              ...point,
              value: point.value,
              source: summary.readings.find(
                ({ day, metric: m }) => day === point.day && m === current,
              )?.source,
            },
          ],
    );
  const stats = [
    { label: 'Lowest', value: values.length ? Math.min(...values) : null },
    { label: 'Highest', value: values.length ? Math.max(...values) : null },
  ];
  return (
    <Sheet visible={!!metric} onClose={onClose}>
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-cloud">
          <MetricIcon metric={current} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-serif text-2xl text-ink">
            {metricDetails[current].label}
          </Text>
          <Text className="text-sm text-slate">Last {days} days</Text>
        </View>
      </View>
      <View>
        <Text className="font-serif text-3xl text-ink">
          {shown(current, snap.value)}
        </Text>
        <Text className="text-sm text-slate">
          {period === 'today'
            ? periodCaption(snap, summary.today)
            : `Daily average · ${periodCaption(snap, summary.today)}`}
        </Text>
      </View>
      <DayChart
        points={points}
        today={summary.today}
        target={current === 'calories_consumed' ? summary.calorieTarget : null}
      />
      <View className="flex-row gap-2">
        {[
          ...stats.map(({ label, value }) => ({
            label,
            value: shown(current, value),
          })),
          { label: 'Days with data', value: `${complete.length} of ${days}` },
        ].map(({ label, value }) => (
          <View key={label} className="min-w-0 flex-1 rounded-2xl border border-line px-3 py-2.5">
            <Text className="text-2xs text-slate">{label}</Text>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              minimumFontScale={0.75}
              className="text-base font-semibold text-ink"
            >
              {value}
            </Text>
          </View>
        ))}
      </View>
      {history.length ? (
        <View>
          <Text className="pb-1 text-2xs font-bold uppercase tracking-eyebrow text-slate">
            Daily readings
          </Text>
          {history.map((point, index) => (
            <View
              key={point.day}
              accessible
              accessibilityLabel={`${formatDay(point.day, summary.today)}, ${formatValue(
                current,
                point.value,
              )}${point.partial ? ', so far' : ''}${
                point.source ? `, from ${sourceLabels[point.source]}` : ''
              }`}
              className={`min-h-12 flex-row items-center gap-3 py-2 ${
                index ? 'border-t border-line' : ''
              }`}
            >
              <View className="min-w-0 flex-1">
                <Text className="text-base text-ink">
                  {formatDay(point.day, summary.today)}
                </Text>
                {!!point.source && (
                  <View className="flex-row items-center gap-1">
                    <SourceIcon source={point.source} />
                    <Text className="text-xs text-slate">
                      {sourceLabels[point.source]}
                      {point.partial ? ' · so far' : ''}
                    </Text>
                  </View>
                )}
              </View>
              <Text className="text-base text-ink">
                {formatValue(current, point.value)}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text className="text-sm text-slate">
          No readings in the last {days} days.
        </Text>
      )}
      <Text className="text-2xs leading-4 text-slate">
        Shown as your devices recorded it. Not medical advice.
      </Text>
    </Sheet>
  );
}

function LoadingState() {
  return (
    <View accessibilityLabel="Loading health data" className="gap-3">
      <View className="flex-row gap-2">
        {TILES.map(({ metric }) => (
          <View key={metric} className="h-24 flex-1 rounded-2xl bg-white/70" />
        ))}
      </View>
      <View className="h-36 rounded-3xl bg-white/70" />
      {[0, 1, 2].map((row) => (
        <View key={row} className="h-16 rounded-3xl bg-white/70" />
      ))}
    </View>
  );
}

function ConnectCard({
  available,
  outdated,
  onConnect,
}: {
  available: boolean;
  outdated: boolean;
  onConnect: () => void;
}) {
  return (
    <View className="items-center gap-4 rounded-3xl bg-white p-6">
      <Tomo size={88} mood="hello" />
      <Text className="text-center font-serif text-2xl text-ink">
        Bring your week <Text className="font-serif-italic text-cobalt">together</Text>
      </Text>
      {available ? (
        <>
          <Text className="text-center text-base leading-6 text-slate">
            {outdated
              ? 'Kuvos can now show your walking measurements too. Review what’s shared to keep syncing.'
              : 'See your heart rate, sleep, steps, walking and calories eaten from Apple Health, your Watch or your ring in one place.'}
          </Text>
          <Button
            className="self-stretch"
            title={outdated ? 'Review and continue' : 'Connect Apple Health'}
            onPress={onConnect}
          />
        </>
      ) : (
        <Text className="text-center text-base leading-6 text-slate">
          Apple Health isn’t available on this device.
        </Text>
      )}
    </View>
  );
}

function ConsentSheet({
  visible,
  busy,
  onClose,
  onAccept,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onAccept: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text className="font-serif text-2xl text-ink">Connect Apple Health</Text>
      <Text className="text-base leading-6 text-slate">
        Kuvos reads daily totals for resting heart rate, HRV, sleep, steps,
        calories eaten and walking (speed, step length, asymmetry and double
        support time), and stores them on Kuvos servers so they’re here for you.
      </Text>
      <View className="gap-2">
        {[
          'Only you can see them. Your Care Circle and Tomo cannot.',
          'They never change your plan or tasks.',
          'They’re never used for advertising.',
          'Disconnect at any time to delete them from Kuvos.',
        ].map((line) => (
          <Text key={line} className="text-sm leading-5 text-ink">
            ·  {line}
          </Text>
        ))}
      </View>
      <Text className="text-sm leading-5 text-slate">
        Next, iOS asks which data to share. You can change this any time in
        Settings › Health.
      </Text>
      <Button loading={busy} title="Agree and continue" onPress={onAccept} />
      <Button title="Not now" variant="quiet" onPress={onClose} />
    </Sheet>
  );
}

function TargetForm({
  target,
  onClose,
  onSave,
}: {
  target: number | null;
  onClose: () => void;
  onSave: (next: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(target ? String(target) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parsed = Number(draft);
  const valid = /^\d{1,5}$/.test(draft) && parsed >= 1;

  async function save(next: number | null) {
    setBusy(true);
    setError('');
    try {
      await onSave(next);
      onClose();
    } catch (caught) {
      setError(message(caught, 'Could not save your target.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Text className="font-serif text-2xl text-ink">Daily calorie target</Text>
      <Text className="text-sm leading-5 text-slate">
        Choose your own number. Kuvos doesn’t suggest one. If a healthcare
        professional gave you a target, use theirs.
      </Text>
      <View className="flex-row items-center rounded-2xl border border-line px-4">
        <TextInput
          accessibilityLabel="Daily calorie target in kcal"
          autoFocus
          className="min-h-14 min-w-0 flex-1 text-2xl text-ink"
          keyboardType="number-pad"
          maxLength={5}
          onChangeText={setDraft}
          placeholder="Enter a number"
          placeholderTextColor={colors.slate}
          returnKeyType="done"
          value={draft}
        />
        <Text className="text-base text-slate">kcal</Text>
      </View>
      {!!error && (
        <Text selectable accessibilityRole="alert" className="text-sm text-coral">
          {error}
        </Text>
      )}
      <Button
        disabled={!valid || busy}
        loading={busy}
        title="Save target"
        onPress={() => void save(parsed)}
      />
      {!!target && (
        <Button
          disabled={busy}
          title="Remove target"
          variant="quiet"
          onPress={() => void save(null)}
        />
      )}
    </>
  );
}

function InfoSheet({
  visible,
  onClose,
  onDisconnect,
}: {
  visible: boolean;
  onClose: () => void;
  onDisconnect?: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text className="font-serif text-2xl text-ink">About these numbers</Text>
      <Text className="text-sm leading-5 text-slate">
        Today shows your steps and calories so far, and the latest heart rate,
        HRV, sleep and walking readings from the past week.
      </Text>
      <Text className="text-sm leading-5 text-slate">
        7 and 30 days show the daily average of days with a reading. Step and
        calorie averages end yesterday, because today isn’t over yet.
      </Text>
      <Text className="text-sm leading-5 text-slate">
        Sleep uses one device for each night, so a Watch and a ring aren’t added
        together. HRV is Apple Health’s SDNN value, and devices can measure it
        differently.
      </Text>
      <Text className="text-sm leading-5 text-slate">
        Mobility comes from walks your iPhone or Watch measured, so days without
        steady walking have none.
      </Text>
      <Text className="text-sm leading-5 text-slate">
        Numbers appear as your devices recorded them. Kuvos doesn’t interpret
        them, and they aren’t medical advice. Only you can see them.
      </Text>
      {onDisconnect && (
        <>
          <Button
            title="Open Apple Health"
            variant="secondary"
            onPress={() => void Linking.openURL('x-apple-health://')}
          />
          <Button
            title="Disconnect and delete data"
            variant="danger"
            onPress={onDisconnect}
          />
        </>
      )}
    </Sheet>
  );
}

export function HealthScreen() {
  const { membership } = useCareSession();
  const patientId = membership.patient.id;
  const timezone = membership.patient.timezone;
  const available = healthAvailable();
  const [summary, setSummary] = useState<WearableSummary>();
  const [loadError, setLoadError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<HealthPeriod>('today');
  const [openGroups, setOpenGroups] = useState<HealthGroup[]>([]);
  const [detail, setDetail] = useState<WearableMetric>();
  const [sheet, setSheet] = useState<'consent' | 'target' | 'info'>();
  const [connecting, setConnecting] = useState(false);
  const running = useRef(false);

  const connection = summary?.connections.find(
    ({ provider, consentCurrent }) => provider === APPLE_HEALTH && consentCurrent,
  );

  const sync = useCallback(
    async (firstSync: boolean) => {
      if (running.current) return;
      running.current = true;
      setSyncing(true);
      setSyncError('');
      try {
        const batch = await readHealth(
          firstSync ? BACKFILL_DAYS : RESYNC_DAYS,
          timezone,
        );
        setSummary(await syncAppleHealth(patientId, batch));
      } catch (caught) {
        setSyncError(message(caught, 'Could not sync Apple Health.'));
      } finally {
        running.current = false;
        setSyncing(false);
      }
    },
    [patientId, timezone],
  );

  const load = useCallback(async () => {
    try {
      const next = await getWearables(patientId);
      setSummary(next);
      setLoadError('');
      const current = next.connections.find(
        ({ provider, consentCurrent }) =>
          provider === APPLE_HEALTH && consentCurrent,
      );
      const age = current?.lastSyncedAt
        ? Date.now() - Date.parse(current.lastSyncedAt)
        : Infinity;
      if (current && available && age > AUTO_SYNC_GAP_MS) {
        await sync(!current.lastSyncedAt);
      }
    } catch (caught) {
      setLoadError(message(caught, 'Could not load your health data.'));
    }
  }, [available, patientId, sync]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await (connection ? sync(!connection.lastSyncedAt) : load());
    setRefreshing(false);
  }

  async function connect() {
    if (!summary) return;
    setConnecting(true);
    setSyncError('');
    try {
      await requestHealthAccess();
      setSummary(await connectAppleHealth(patientId, summary.consentVersion));
      setSheet(undefined);
      await sync(true);
    } catch (caught) {
      setSheet(undefined);
      setSyncError(message(caught, 'Could not connect Apple Health.'));
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    Alert.alert(
      'Disconnect Apple Health?',
      'This deletes your synced readings and calorie target from Kuvos. Your data in Apple Health stays on your iPhone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            setSheet(undefined);
            disconnectAppleHealth(patientId)
              .then(setSummary)
              .catch((caught: unknown) =>
                setSyncError(message(caught, 'Could not disconnect.')),
              );
          },
        },
      ],
    );
  }

  const toggleGroup = (group: HealthGroup) =>
    setOpenGroups((current) =>
      current.includes(group)
        ? current.filter((item) => item !== group)
        : [...current, group],
    );

  // Metrics a person has never recorded stay out of the way entirely.
  const groups = summary
    ? healthGroups
        .map((group) => ({
          ...group,
          metrics: group.metrics.filter((metric) =>
            hasReadings(summary.readings, metric),
          ),
        }))
        .filter(({ metrics }) => metrics.length)
    : [];

  return (
    <Screen
      withoutHeader
      inTabs
      contentClassName="gap-4"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.cobalt}
          onRefresh={() => void refresh()}
        />
      }
    >
      <WeekHero period={period} onInfo={() => setSheet('info')} />

      {!!loadError && !summary && (
        <>
          <Text selectable accessibilityRole="alert" className="text-coral">
            {loadError}
          </Text>
          <Button title="Retry" variant="secondary" onPress={() => void load()} />
        </>
      )}
      {!summary && !loadError && <LoadingState />}

      {!!summary && !connection && (
        <ConnectCard
          available={available}
          outdated={summary.connections.some(
            ({ provider, consentCurrent }) =>
              provider === APPLE_HEALTH && !consentCurrent,
          )}
          onConnect={() => setSheet('consent')}
        />
      )}

      {!!syncError && (
        <View className="gap-2 rounded-2xl bg-sun p-4">
          <Text selectable accessibilityRole="alert" className="text-sm text-ink">
            {syncError}
          </Text>
          {!!connection && (
            <Button
              size="compact"
              title="Try again"
              variant="secondary"
              onPress={() => void sync(!connection.lastSyncedAt)}
            />
          )}
        </View>
      )}

      {!!summary && !!connection && (
        <>
          <PeriodSwitch value={period} onChange={setPeriod} />
          <Tiles summary={summary} period={period} onOpen={setDetail} />
          {period === 'today' && (
            <CalorieCard summary={summary} onEdit={() => setSheet('target')} />
          )}
          {groups.length ? (
            <View className="gap-3">
              {groups.map(({ group, label, metrics }) => (
                <GroupCard
                  key={group}
                  group={group}
                  label={label}
                  metrics={metrics}
                  summary={summary}
                  period={period}
                  open={openGroups.includes(group)}
                  onToggle={() => toggleGroup(group)}
                  onOpen={setDetail}
                />
              ))}
            </View>
          ) : syncing ? null : (
            <View className="gap-2 rounded-3xl bg-white p-5">
              <Text className="text-base font-bold text-ink">No readings yet</Text>
              <Text className="text-sm leading-5 text-slate">
                If you’ve got data in Apple Health, check that Kuvos can read it
                in Settings › Health › Data Access & Devices.
              </Text>
              <Button
                size="compact"
                title="Open Apple Health"
                variant="quiet"
                onPress={() => void Linking.openURL('x-apple-health://')}
              />
            </View>
          )}
          <Animated.View layout={layout}>
            <Text className="px-1 pt-2 text-center text-2xs leading-4 text-slate">
              Shown as your devices recorded it. Not medical advice. Only you can
              see this.
            </Text>
          </Animated.View>
        </>
      )}

      <MetricSheet
        metric={detail}
        summary={summary}
        period={period}
        onClose={() => setDetail(undefined)}
      />
      <ConsentSheet
        visible={sheet === 'consent'}
        busy={connecting}
        onClose={() => setSheet(undefined)}
        onAccept={() => void connect()}
      />
      <Sheet visible={sheet === 'target'} onClose={() => setSheet(undefined)}>
        <TargetForm
          target={summary?.calorieTarget ?? null}
          onClose={() => setSheet(undefined)}
          onSave={async (next) =>
            setSummary(await setCalorieTarget(patientId, next))
          }
        />
      </Sheet>
      <InfoSheet
        visible={sheet === 'info'}
        onClose={() => setSheet(undefined)}
        onDisconnect={connection ? disconnect : undefined}
      />
    </Screen>
  );
}
