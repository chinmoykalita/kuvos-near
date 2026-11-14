import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { api, getAuthCookie, sourcePageUrl, type Candidate, type Extraction } from '../api';
import { Screen } from '../components/screen';
import { ActionExplanation } from '../components/action-explanation';
import { Text } from '../components/text';

export function SourceScreen({
  extractionId,
  candidateId,
  explanationSources = false,
}: {
  extractionId: string;
  candidateId: string;
  explanationSources?: boolean;
}) {
  const [extraction, setExtraction] = useState<Extraction>();
  const [page, setPage] = useState(1);
  const [aspectRatio, setAspectRatio] = useState(0.72);
  const [cookie, setCookie] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<Extraction>(`/extractions/${extractionId}`)
      .then((next) => {
        setExtraction(next);
        const candidate = next.result?.evaluation?.candidates?.find(
          (item) => item.candidate_id === candidateId,
        );
        const ids = explanationSources
          ? candidate?.explanation?.sources.flatMap((source) => source.evidence_span_ids)
          : candidate?.evidence_span_ids;
        const span = next.result?.document?.source_spans?.find((item) =>
          ids?.includes(item.span_id),
        );
        if (span) setPage(span.page);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Could not load the source.'),
      );
  }, [candidateId, extractionId, explanationSources]);

  useEffect(() => {
    getAuthCookie().then(setCookie).catch(() => setError('Could not load the secure session.'));
  }, []);

  const candidate: Candidate | undefined = extraction?.result?.evaluation?.candidates?.find(
    (item) => item.candidate_id === candidateId,
  );
  const spans = useMemo(
    () =>
      (extraction?.result?.document?.source_spans || []).filter((span) =>
        (explanationSources
          ? candidate?.explanation?.sources.flatMap((source) => source.evidence_span_ids)
          : candidate?.evidence_span_ids)?.includes(span.span_id),
      ),
    [candidate, extraction, explanationSources],
  );
  const pages = [...new Set(spans.map((span) => span.page))];
  const visibleSpans = spans.filter((span) => span.page === page);

  return (
    <Screen>
      {candidate && (
        <View className="gap-2">
          <Text className="text-2xs font-extrabold uppercase tracking-eyebrow text-aqua">
            Original instruction
          </Text>
          <Text selectable className="text-2xl font-extrabold text-deep-blue">
            {candidate.instruction_text}
          </Text>
        </View>
      )}

      {pages.length > 1 && (
        <View className="flex-row flex-wrap gap-2">
          {pages.map((pageNumber) => (
            <Pressable
              accessibilityRole="button"
              className={`rounded-full px-4 py-2 ${pageNumber === page ? 'bg-cobalt' : 'bg-white'}`}
              key={pageNumber}
              onPress={() => setPage(pageNumber)}
            >
              <Text className={`font-bold ${pageNumber === page ? 'text-white' : 'text-deep-blue'}`}>
                Page {pageNumber}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {!explanationSources && extraction?.status.toLowerCase() === 'confirmed' && (
        <ActionExplanation
          explanation={extraction.review?.candidates?.find((item) => item.candidate_id === candidateId)?.explanation}
          extractionId={extractionId}
          candidateId={candidateId}
        />
      )}

      {extraction && (
        <View className="overflow-hidden rounded-2xl border border-line bg-white" style={{ aspectRatio }}>
          <Image
            accessibilityLabel={`Source document page ${page}`}
            contentFit="fill"
            onLoad={({ source }) => {
              if (source.width && source.height) setAspectRatio(source.width / source.height);
            }}
            source={{
              uri: sourcePageUrl(extractionId, page),
              headers: cookie ? { Cookie: cookie } : undefined,
            }}
            style={{ position: 'absolute', inset: 0 }}
          />
          {visibleSpans.map((span) => (
            <View
              className="absolute border-2 border-sun bg-sun/30"
              key={span.span_id}
              pointerEvents="none"
              style={{
                left: `${span.bounding_box.x * 100}%`,
                top: `${span.bounding_box.y * 100}%`,
                width: `${span.bounding_box.width * 100}%`,
                height: `${span.bounding_box.height * 100}%`,
              }}
            />
          ))}
        </View>
      )}

      {!!visibleSpans.length && (
        <View className="gap-3 rounded-3xl bg-sun/15 p-5">
          <Text className="text-sm font-extrabold text-ink">Exact source text · page {page}</Text>
          {visibleSpans.map((span) => (
            <Text selectable className="text-base leading-6 text-ink" key={span.span_id}>
              {span.text || 'Source text unavailable'}
            </Text>
          ))}
        </View>
      )}

      {(error || (extraction && !spans.length)) && (
        <Text selectable accessibilityRole="alert" className="rounded-2xl bg-coral/15 p-4 text-ink">
          {error || 'No source evidence is available for this instruction.'}
        </Text>
      )}
    </Screen>
  );
}
