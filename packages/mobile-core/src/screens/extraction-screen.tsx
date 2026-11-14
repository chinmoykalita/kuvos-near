import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { api, type Extraction } from '../api';
import { Button } from '../components/button';
import { FlowHero, FlowScreen } from '../components/flow';
import { Text } from '../components/text';
import { onboardingSteps } from '../onboarding-draft';

export function ExtractionScreen({
  extractionId,
  planId,
  patientId,
  pages,
}: {
  extractionId: string;
  planId?: string;
  patientId?: string;
  pages?: string;
}) {
  const router = useRouter();
  const [extraction, setExtraction] = useState<Extraction>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const next = await api<Extraction>(`/extractions/${extractionId}`);
        if (cancelled) return;
        setExtraction(next);
        setError('');
        if (next.status === 'review_ready') {
          router.replace({
            pathname: '/review/[id]',
            params: {
              id: extractionId,
              ...(planId ? { planId } : {}),
            },
          });
          return;
        }
        if (next.status === 'confirmed') {
          router.replace('/');
          return;
        }
        if (next.status !== 'failed') {
          timer = setTimeout(poll, 2000);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not check progress.');
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [extractionId, planId, retry, router]);

  const failed = extraction?.status === 'failed';
  const processing = extraction?.status === 'processing';
  const pageCount = Number(pages) || 0;
  const received = pageCount
    ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'} · received`
    : 'Document · received';

  const stepsList = [
    {
      title: 'Uploaded',
      detail: pageCount
        ? `${pageCount === 1 ? 'Page 1' : `${pageCount} pages`} saved with the plan`
        : 'Saved with the plan',
      state: 'done' as const,
    },
    {
      title: 'Finding the tasks',
      detail: processing ? undefined : 'Waiting its turn',
      state: 'active' as const,
    },
    { title: 'You check them', detail: 'One list, one tick', state: 'next' as const },
  ];

  return (
    <FlowScreen
      step={3}
      steps={onboardingSteps}
      footer={
        <>
          {failed && (
            <Button
              title="Try another document"
              onPress={() =>
                patientId
                  ? router.replace({
                      pathname: '/upload',
                      params: { patientId, ...(planId ? { planId } : {}) },
                    })
                  : router.replace('/')
              }
            />
          )}
          <Button title="Back to home" variant="secondary" onPress={() => router.replace('/')} />
          {!failed && (
            <Text className="text-center text-sm text-slate">It keeps reading while you’re away.</Text>
          )}
        </>
      }
    >
      <FlowHero
        meta={received}
        eyebrow={failed ? 'Needs attention' : 'Reading'}
        title={failed ? 'We couldn’t read this ' : 'Reading the '}
        accent={failed ? 'document' : 'prescription'}
        subtitle={failed ? 'Nothing was added to the plan.' : 'Usually under a minute.'}
      />

      {failed ? (
        <View className="gap-2 rounded-3xl border border-line bg-white p-4">
          <Text className="text-base font-bold text-ink">Try a clearer photo or PDF</Text>
          <Text selectable className="text-sm text-slate">
            {extraction?.error || 'Make sure the whole page is visible, flat and in focus.'}
          </Text>
        </View>
      ) : (
        <View className="rounded-3xl border border-line bg-white px-4">
          {stepsList.map((item, index) => (
            <View
              key={item.title}
              className={`flex-row items-start gap-3 py-4 ${index ? 'border-t border-line' : ''}`}
            >
              <View
                className={`mt-0.5 h-7 w-7 items-center justify-center rounded-full ${
                  item.state === 'done' ? 'bg-fresh-green/15' : item.state === 'active' ? 'bg-ice' : 'bg-cloud'
                }`}
              >
                {item.state === 'done' ? (
                  <Text className="text-sm font-bold text-fresh-green">✓</Text>
                ) : item.state === 'active' ? (
                  <View className="h-2.5 w-2.5 rounded-full bg-cobalt" />
                ) : null}
              </View>
              <View className="flex-1 gap-1">
                <Text className={`text-base font-bold ${item.state === 'next' ? 'text-slate' : 'text-ink'}`}>
                  {item.title}
                </Text>
                {!!item.detail && <Text className="text-sm text-slate">{item.detail}</Text>}
                {item.state === 'active' && <ReadingBar />}
              </View>
            </View>
          ))}
        </View>
      )}

      {!failed && !!error && (
        <View className="gap-3 rounded-2xl bg-coral/10 p-4">
          <Text selectable accessibilityRole="alert" className="text-base text-ink">
            We could not check the latest status. {error}
          </Text>
          <Button title="Check again" variant="secondary" onPress={() => setRetry((value) => value + 1)} />
        </View>
      )}
    </FlowScreen>
  );
}

// The API exposes stages, not a percentage, so this bar is indeterminate on purpose.
function ReadingBar() {
  const [width, setWidth] = useState(0);
  const [offset] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(offset, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [offset]);

  return (
    <View
      accessibilityLabel="Reading in progress"
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View
        className="h-full w-2/5 rounded-full bg-cobalt"
        style={{
          transform: [
            {
              translateX: offset.interpolate({
                inputRange: [0, 1],
                outputRange: [-width * 0.4, width],
              }),
            },
          ],
        }}
      />
    </View>
  );
}
