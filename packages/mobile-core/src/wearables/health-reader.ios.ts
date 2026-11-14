import {
  AuthorizationRequestStatus,
  CategoryValueSleepAnalysis,
  getRequestStatusForAuthorization,
  isHealthDataAvailable,
  isProtectedDataAvailableAsync,
  queryCategorySamples,
  queryStatisticsCollectionForQuantity,
  queryStatisticsCollectionForQuantitySeparateBySource,
  requestAuthorization,
  type QuantityTypeIdentifier,
  type StatisticsOptions,
} from '@kingstinct/react-native-healthkit';

import {
  dayKey,
  sleepByDay,
  sourceKind,
  type SyncReading,
  type WearableMetric,
} from './metrics';

const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis' as const;
const QUANTITIES: {
  metric: WearableMetric;
  identifier: QuantityTypeIdentifier;
  unit: string;
  statistic: StatisticsOptions;
  // Converts HealthKit's unit to the one the API stores.
  scale?: number;
}[] = [
  {
    metric: 'resting_heart_rate',
    identifier: 'HKQuantityTypeIdentifierRestingHeartRate',
    unit: 'count/min',
    statistic: 'discreteAverage',
  },
  {
    metric: 'hrv_sdnn',
    identifier: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
    unit: 'ms',
    statistic: 'discreteAverage',
  },
  {
    metric: 'steps',
    identifier: 'HKQuantityTypeIdentifierStepCount',
    unit: 'count',
    statistic: 'cumulativeSum',
  },
  {
    metric: 'calories_consumed',
    identifier: 'HKQuantityTypeIdentifierDietaryEnergyConsumed',
    unit: 'kcal',
    statistic: 'cumulativeSum',
  },
  {
    metric: 'walking_speed',
    identifier: 'HKQuantityTypeIdentifierWalkingSpeed',
    unit: 'm/s',
    statistic: 'discreteAverage',
    scale: 3.6,
  },
  {
    metric: 'walking_step_length',
    identifier: 'HKQuantityTypeIdentifierWalkingStepLength',
    unit: 'cm',
    statistic: 'discreteAverage',
  },
  // HealthKit percentages are fractions: 0.289 is 28.9%.
  {
    metric: 'walking_asymmetry',
    identifier: 'HKQuantityTypeIdentifierWalkingAsymmetryPercentage',
    unit: '%',
    statistic: 'discreteAverage',
    scale: 100,
  },
  {
    metric: 'walking_double_support',
    identifier: 'HKQuantityTypeIdentifierWalkingDoubleSupportPercentage',
    unit: '%',
    statistic: 'discreteAverage',
    scale: 100,
  },
];
const ASLEEP = new Set<number>([
  CategoryValueSleepAnalysis.asleepUnspecified,
  CategoryValueSleepAnalysis.asleepCore,
  CategoryValueSleepAnalysis.asleepDeep,
  CategoryValueSleepAnalysis.asleepREM,
]);
const SLEEP_LOOKBACK_MS = 12 * 3_600_000;

export const healthAvailable = () => isHealthDataAvailable();

const READ_TYPES = [...QUANTITIES.map(({ identifier }) => identifier), SLEEP];

// iOS shows this sheet once per type and never reports whether reading was denied.
export async function requestHealthAccess() {
  await requestAuthorization({ toRead: READ_TYPES });
}

// A type added in an app update was never requested, and iOS refuses to read it
// (HealthKit error 5) until it is. Already-answered types show no sheet.
async function ensureAccess() {
  const status = await getRequestStatusForAuthorization({ toRead: READ_TYPES });
  if (status === AuthorizationRequestStatus.shouldRequest) {
    await requestHealthAccess();
  }
}

const statisticValue = (
  statistic: StatisticsOptions,
  row: { sumQuantity?: { quantity: number }; averageQuantity?: { quantity: number } },
) =>
  (statistic === 'cumulativeSum' ? row.sumQuantity : row.averageQuantity)?.quantity;

async function readQuantity(
  { metric, identifier, unit, statistic, scale = 1 }: (typeof QUANTITIES)[number],
  startDate: Date,
  endDate: Date,
  timezone: string,
) {
  const options = { unit, filter: { date: { startDate, endDate } } };
  const interval = { day: 1 };
  // The merged query de-duplicates Watch and iPhone; the per-source one only names the device.
  const [merged, bySource] = await Promise.all([
    queryStatisticsCollectionForQuantity(
      identifier,
      [statistic],
      startDate,
      interval,
      options,
    ),
    queryStatisticsCollectionForQuantitySeparateBySource(
      identifier,
      [statistic],
      startDate,
      interval,
      options,
    ),
  ]);
  const middleOfDay = (row: { startDate?: Date; endDate?: Date }) =>
    row.startDate && row.endDate
      ? dayKey(
          new Date((row.startDate.getTime() + row.endDate.getTime()) / 2),
          timezone,
        )
      : undefined;
  const sources = new Map<string, { name: string; value: number }>();
  for (const row of bySource) {
    const day = middleOfDay(row);
    const value = statisticValue(statistic, row);
    if (!day || value === undefined) continue;
    if (value > (sources.get(day)?.value ?? -1)) {
      sources.set(day, { name: row.source.name, value });
    }
  }
  return merged.flatMap((row): SyncReading[] => {
    const day = middleOfDay(row);
    const value = statisticValue(statistic, row);
    if (!day || value === undefined) return [];
    return [
      {
        day,
        metric,
        value: Math.round(value * scale * 10) / 10,
        source: sourceKind(sources.get(day)?.name ?? ''),
      },
    ];
  });
}

async function readSleep(startDate: Date, endDate: Date, timezone: string) {
  const samples = await queryCategorySamples(SLEEP, {
    limit: 0,
    ascending: true,
    filter: {
      date: {
        startDate: new Date(startDate.getTime() - SLEEP_LOOKBACK_MS),
        endDate,
      },
    },
  });
  const nights = sleepByDay(
    samples
      .filter((sample) => ASLEEP.has(sample.value))
      .map((sample) => ({
        start: sample.startDate,
        end: sample.endDate,
        source: sample.sourceRevision?.source.name ?? '',
      })),
    timezone,
  );
  return [...nights].map(
    ([day, { minutes, source }]): SyncReading => ({
      day,
      metric: 'sleep_duration',
      value: Math.round(minutes),
      source: sourceKind(source),
    }),
  );
}

export async function readHealth(days: number, timezone: string) {
  if (!(await isProtectedDataAvailableAsync())) {
    throw new Error('Unlock your iPhone to read Apple Health.');
  }
  try {
    return await readAll(days, timezone);
  } catch (caught) {
    // Native HealthKit errors are NSError dumps; keep the screen readable.
    if (caught instanceof Error && caught.message.includes('com.apple.healthkit')) {
      throw new Error(
        'Apple Health couldn’t be read. Try again, or check Settings › Health › Data Access & Devices › Kuvos.',
      );
    }
    throw caught;
  }
}

async function readAll(days: number, timezone: string) {
  await ensureAccess();
  const endDate = new Date();
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - (days - 1));
  const from = dayKey(startDate, timezone);
  const to = dayKey(endDate, timezone);
  const groups = await Promise.all([
    ...QUANTITIES.map((quantity) =>
      readQuantity(quantity, startDate, endDate, timezone),
    ),
    readSleep(startDate, endDate, timezone),
  ]);
  const readings = groups
    .flat()
    // An even gait is a real 0% asymmetry; every other metric is empty at 0.
    .filter(
      ({ day, metric, value }) =>
        day >= from &&
        day <= to &&
        (value > 0 || (metric === 'walking_asymmetry' && value === 0)),
    );
  return { from, to, readings };
}
