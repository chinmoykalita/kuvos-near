import { ReviewExercisePicker } from '../components/review-exercise-picker';
import { library, type Exercise } from '../physio/catalogue';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { api, type Candidate, type Extraction, type Me } from '../api';
import { Button } from '../components/button';
import { FlowHero, FlowScreen } from '../components/flow';
import { ReviewDetailsSheet } from '../components/review-details-sheet';
import { Text, TextInput } from '../components/text';
import { TimeField } from '../components/time-field';
import {
  applyDayCount,
  candidateIssue,
  candidatesFrom,
  emptyReminderSlots,
  fieldValue,
  isUnscheduled,
  needsDayCount,
  needsIntervalCompletion,
  routineTimes,
} from '../review';

function displayTime(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  })
    .format(new Date(Date.UTC(2000, 0, 1, hour, minute)))
    .toUpperCase();
}

function displayDate(date: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function summary(candidate: Candidate) {
  const { schedule } = candidate;
  if (isUnscheduled(candidate)) {
    return schedule.kind === 'as_needed' ? 'Only when needed' : 'Always shown';
  }
  const parts: string[] = [];
  const date = [schedule.date, schedule.start_date].find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value || ''));
  if (schedule.kind === 'once' && date) parts.push(displayDate(date));
  parts.push(schedule.times.length ? schedule.times.map(displayTime).join(', ') : 'time needed');
  const meal = candidate.fields.find((field) => /meal|food/.test(field.name));
  if (meal) parts.push(fieldValue(meal));
  if (schedule.kind !== 'once') {
    const days = Number(schedule.duration_days || 0);
    parts.push(days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : 'days needed');
  }
  return parts.join(' · ');
}

function included(candidate: Candidate) {
  return candidate.review_status !== 'unsupported' && candidate.decision !== 'rejected';
}

function needLabel(candidate: Candidate) {
  if (needsIntervalCompletion(candidate.schedule)) return 'Can’t schedule';
  if (!candidate.schedule.times.length) return candidate.schedule.kind === 'once' ? 'Add time' : 'Pick a time';
  if (needsDayCount(candidate) && !(Number(candidate.schedule.duration_days) > 0) && !candidate.schedule.end_date) {
    return 'Add days';
  }
  return 'Check';
}

function DetailsButton({ label, onPress }: { label?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`Details for ${label || 'this item'}`}
      accessibilityRole="button"
      className="h-11 w-11 items-center justify-center"
      onPress={onPress}
    >
      <Text className="h-6 w-6 rounded-full border border-cobalt text-center font-bold text-cobalt">i</Text>
    </Pressable>
  );
}

function statusLabel(candidate: Candidate) {
  if (candidate.review_status === 'unsupported') return 'Not clear in the document · left out';
  if (!included(candidate)) return 'Left out of the plan';
  return candidateIssue(candidate) === undefined ? 'Looks right' : needLabel(candidate);
}

export function ReviewScreen({ extractionId, planId }: { extractionId: string; planId?: string }) {
  const router = useRouter();
  const [extraction, setExtraction] = useState<Extraction>();
  const [me, setMe] = useState<Me>();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [open, setOpen] = useState<string>();
  const [details, setDetails] = useState<string>();
  const [showLeftOut, setShowLeftOut] = useState(false);
  const [slots, setSlots] = useState<Record<string, number>>({});
  const [newSlotFor, setNewSlotFor] = useState<string>();
  const [daysSetByReviewer, setDaysSetByReviewer] = useState<Set<string>>(new Set());
  const [autofilled, setAutofilled] = useState<Set<string>>(new Set());
  const [fromRoutine, setFromRoutine] = useState<Set<string>>(new Set());
  const [exerciseTarget, setExerciseTarget] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    const loadMe = api<Me>('/me').catch(() => undefined);
    loadMe.then((next) => active && next && setMe(next));
    Promise.all([api<Extraction>(`/extractions/${extractionId}`), loadMe])
      .then(([next, account]) => {
        if (!active) return;
        const routine = account?.memberships[0]?.patient.dailyRoutine;
        const suggested = new Set<string>();
        const loaded = candidatesFrom(next).map((candidate) => {
          const times = included(candidate) ? routineTimes(candidate, routine) : [];
          if (!times.length) return candidate;
          suggested.add(candidate.candidate_id);
          return { ...candidate, schedule: { ...candidate.schedule, times } };
        });
        setFromRoutine(suggested);
        setExtraction(next);
        setCandidates(loaded);
        setSlots(
          Object.fromEntries(
            loaded.map((candidate) => [
              candidate.candidate_id,
              isUnscheduled(candidate) || needsIntervalCompletion(candidate.schedule)
                ? 0
                : emptyReminderSlots(candidate.schedule),
            ]),
          ),
        );
        const firstNeed = loaded.find(
          (candidate) => included(candidate) && candidateIssue(candidate) !== undefined,
        );
        setOpen(firstNeed?.candidate_id);
      })
      .catch((caught) => active && setNotice(caught instanceof Error ? caught.message : 'Could not load the review.'));
    return () => {
      active = false;
    };
  }, [extractionId]);

  const membership = me?.memberships[0];
  const routine = membership?.patient.dailyRoutine;
  const firstName =
    membership?.role === 'CAREGIVER' ? membership.patient.name.trim().split(/\s+/)[0] : '';
  const pageCount = extraction?.result?.document?.pages?.length ?? 0;
  const firstDocumentCandidate = candidates.find(candidate => !candidate.candidate_id.startsWith('library:'));
  const includedItems = candidates.filter(included);
  const needs = includedItems.filter((candidate) => candidateIssue(candidate) !== undefined);
  const looksRight = includedItems.length - needs.length;
  const usedTimes = [...new Set(candidates.flatMap((candidate) => candidate.schedule.times))].sort();
  // Keep the original index: applyDayCount works on positions in the full candidate list.
  const rows = candidates.map((candidate, index) => ({ candidate, index }));
  const activeRows = rows.filter(({ candidate }) => included(candidate));
  const leftOutRows = rows.filter(({ candidate }) => !included(candidate));
  const detailsCandidate = candidates.find((candidate) => candidate.candidate_id === details);

  function patch(id: string, update: (candidate: Candidate) => Candidate) {
    setCandidates((current) => current.map((candidate) => (candidate.candidate_id === id ? update(candidate) : candidate)));
  }

  function setTimes(id: string, times: string[]) {
    setFromRoutine((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    patch(id, (candidate) => ({ ...candidate, schedule: { ...candidate.schedule, times: [...times].sort() } }));
  }

  function setDays(index: number, days: number) {
    const id = candidates[index].candidate_id;
    const reviewerSet = new Set(daysSetByReviewer).add(id);
    const result = applyDayCount(candidates, index, days, reviewerSet);
    setDaysSetByReviewer(reviewerSet);
    setCandidates(result.candidates);
    setAutofilled((current) => {
      const next = new Set([...current, ...result.autofilled]);
      next.delete(id);
      return next;
    });
  }

  function closeAndAdvance(id: string) {
    const index = candidates.findIndex((candidate) => candidate.candidate_id === id);
    const nextNeed = candidates.find(
      (candidate, position) =>
        position > index && included(candidate) && candidateIssue(candidate) !== undefined,
    );
    setOpen(nextNeed?.candidate_id);
  }

  function leaveOut(id: string) {
    if (id.startsWith('library:')) {
      setCandidates(current => current.filter(candidate => candidate.candidate_id !== id));
      setOpen(undefined);
      return;
    }
    patch(id, (current) => ({ ...current, decision: 'rejected' }));
    closeAndAdvance(id);
  }

  function restore(id: string) {
    patch(id, (current) => ({ ...current, decision: undefined }));
  }

  async function startPlan() {
    if (needs.length || !checked || !includedItems.length) return;
    setBusy(true);
    setNotice('');
    const decided = candidates.map((candidate) => ({
      ...candidate,
      decision: included(candidate) ? ('accepted' as const) : ('rejected' as const),
    }));
    try {
      await api(`/extractions/${extractionId}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates: decided }),
      });
      router.push({ pathname: '/preview/[id]', params: { id: extractionId, ...(planId ? { planId } : {}) } });
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Could not save this review.');
    } finally {
      setBusy(false);
    }
  }

  function selectExercise(exercise: Exercise, dosage: string, attach: boolean) {
    if (attach && exerciseTarget) {
      patch(exerciseTarget, candidate => ({ ...candidate, physio: { exercise_id: exercise.id, origin: 'document_match' } }));
    } else {
      const id = `library:${exercise.id}`;
      setCandidates(current => [...current, {
        candidate_id: id, category: 'exercise', instruction_text: [exercise.name, exercise.form.start, ...exercise.form.cues, `Your instructions: ${dosage}`].join('\n'),
        action_text: `${exercise.name} — ${dosage}`, evidence_span_ids: [], fields: [{ name: 'exercise_dosage', raw_value: dosage }],
        physio: { exercise_id: exercise.id, origin: 'reviewer_added', dosage }, review_status: 'reviewer_added',
        schedule: { kind: 'times_per_day', times: routine?.exercise ? [routine.exercise] : [], duration_days: 0 },
      }]);
      if (routine?.exercise) setFromRoutine(current => new Set(current).add(id));
      setSlots(current => ({ ...current, [id]: routine?.exercise ? 0 : 1 }));
      setOpen(id);
    }
    setChecked(false);
    setExerciseTarget(undefined);
  }

  function openSource(candidateId: string) {
    router.push({ pathname: '/source/[id]', params: { id: extractionId, candidateId } });
  }

  const header = (
    <View className="min-h-11 flex-row items-center justify-between">
      <Pressable
        accessibilityLabel="Back"
        accessibilityRole="button"
        className="h-10 w-10 items-center justify-center rounded-full border border-line bg-white"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      >
        <Text className="text-2xl leading-7 text-deep-blue">‹</Text>
      </Pressable>
      {firstDocumentCandidate && (
        <Pressable accessibilityRole="link" className="min-h-11 justify-center" onPress={() => openSource(firstDocumentCandidate.candidate_id)}>
          <Text className="text-sm font-semibold text-cobalt">View prescription</Text>
        </Pressable>
      )}
    </View>
  );

  if (!extraction) {
    return (
      <FlowScreen header={header}>
        <FlowHero
          eyebrow="Check each line"
          title={extraction ? 'Nothing to ' : 'Loading the '}
          accent={extraction ? 'add' : 'plan'}
          subtitle={
            notice ||
            (extraction
              ? 'No actionable instructions were found in this document.'
              : 'Getting the instructions ready to check.')
          }
        />
      </FlowScreen>
    );
  }

  return (
    <FlowScreen
      header={header}
      footer={
        <>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            className="min-h-11 flex-row items-center gap-3"
            onPress={() => setChecked((value) => !value)}
          >
            <View
              className={`h-6 w-6 items-center justify-center rounded-md border-2 ${checked ? 'border-deep-blue bg-deep-blue' : 'border-line bg-white'}`}
            >
              {checked && <Text className="text-xs font-bold text-white">✓</Text>}
            </View>
            <Text className="flex-1 text-base text-ink">I’ve checked the document instructions and any exercises I added</Text>
          </Pressable>
          <Button
            disabled={!!needs.length || !checked || !includedItems.length}
            loading={busy}
            title={needs.length ? `Start plan · ${needs.length} left` : 'Start plan'}
            onPress={startPlan}
          />
        </>
      }
    >
      <FlowHero
        meta={`${candidates.length} found${pageCount ? ` · ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}` : ''}`}
        eyebrow="Check each line"
        title={firstName ? `Check ${firstName}’s ` : 'Check your '}
        accent="plan"
        subtitle={
          needs.length
            ? `${looksRight} ${looksRight === 1 ? 'looks' : 'look'} right. ${needs.length} ${needs.length === 1 ? 'needs' : 'need'} a quick look.`
            : 'Everything looks complete. Tick the box to continue.'
        }
      />

      <View className="gap-3 rounded-3xl border border-line bg-white p-5">
        <Text className="text-xl font-bold text-deep-blue">Exercises for this plan</Text>
        <Text className="text-base leading-6 text-slate">Choose demonstrations for the exercise instructions, or add exercises from the library.</Text>
        <Button title="Add an exercise" variant="secondary" onPress={() => setExerciseTarget('new')} />
      </View>
      {exerciseTarget !== undefined && <ReviewExercisePicker
        target={candidates.find(candidate => candidate.candidate_id === exerciseTarget)}
        context={candidates.filter(candidate => !candidate.candidate_id.startsWith('library:') && candidate.category !== 'restriction' && /exercise|physio/i.test(`${candidate.category} ${candidate.instruction_text}`)).map(candidate => candidate.instruction_text).join(' ')}
        selectedIds={candidates.filter(candidate => candidate.candidate_id.startsWith('library:')).map(candidate => candidate.physio?.exercise_id || '')}
        onSelect={selectExercise} onClose={() => setExerciseTarget(undefined)}
      />}

      <View className={activeRows.length ? 'overflow-hidden rounded-3xl border border-line bg-white' : 'hidden'}>
        {activeRows.map(({ candidate, index }, position) => {
          const id = candidate.candidate_id;
          const issue = candidateIssue(candidate);
          const isOpen = open === id;
          const emptySlots = slots[id] ?? 0;
          const days = Number(candidate.schedule.duration_days || 0);
          const canEditSchedule = !isUnscheduled(candidate) && !needsIntervalCompletion(candidate.schedule);
          return (
            <View
              key={id}
              className={`${position ? 'border-t border-line' : ''} ${isOpen && issue ? 'bg-sun' : ''}`}
            >
              <View className="min-h-[68px] flex-row items-center pr-1">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={issue ? { expanded: isOpen } : undefined}
                  accessibilityLabel={`${candidate.action_text}. ${statusLabel(candidate)}`}
                  accessibilityHint={issue ? undefined : 'Opens details'}
                  className="flex-1 flex-row items-center gap-3 py-3 pl-4"
                  onPress={() => (issue ? setOpen(isOpen ? undefined : id) : setDetails(id))}
                >
                  <View className="flex-1 gap-1">
                    <Text className="text-base font-bold text-ink">{candidate.action_text}</Text>
                    {candidate.physio?.origin === 'reviewer_added' && <Text className="text-sm text-cobalt">Added by reviewer</Text>}
                    {fromRoutine.has(id) && (
                      <Text className="text-sm text-cobalt">
                        Time from {firstName ? `${firstName}’s` : 'your'} usual day · change if needed
                      </Text>
                    )}
                    <Text className="text-sm text-slate">{summary(candidate)}</Text>
                  </View>
                  {issue ? (
                    <View
                      className={`flex-row items-center gap-1 rounded-full px-3 py-1.5 ${isOpen ? 'border border-line bg-white' : 'bg-sun'}`}
                    >
                      <Text className="text-xs font-bold text-ink">{needLabel(candidate)}</Text>
                      <Text className="text-xs text-ink">{isOpen ? '⌃' : '⌄'}</Text>
                    </View>
                  ) : (
                    <View className="h-7 w-7 items-center justify-center rounded-full bg-ice">
                      <Text className="text-sm font-bold text-fresh-green">✓</Text>
                    </View>
                  )}
                </Pressable>
                <DetailsButton label={candidate.action_text} onPress={() => setDetails(id)} />
              </View>

              {candidate.category !== 'restriction' && /exercise|physio/i.test(`${candidate.category} ${candidate.instruction_text}`) && <View className="gap-2 px-4 pb-3">
                {!candidate.candidate_id.startsWith('library:') && <Button size="compact" variant="quiet"
                  title={candidate.physio ? `Demonstration: ${library.exercises.find(e => e.id === candidate.physio?.exercise_id)?.name || 'Selected'}` : 'Choose exercise demonstration'}
                  onPress={() => setExerciseTarget(id)} />}
                {candidate.physio && !candidate.candidate_id.startsWith('library:') && <Button size="compact" variant="secondary" title="Remove demonstration" onPress={() => patch(id, current => ({ ...current, physio: null }))} />}
              </View>}
              {isOpen && (
                <View className="gap-3 px-4 pb-4">
                  {canEditSchedule && (
                    <View className="gap-2">
                      {candidate.schedule.times.map((time, timeIndex) => (
                        <TimeField
                          key={`${timeIndex}-${time}`}
                          value={time}
                          onChange={(nextTime) => {
                            const times = [...candidate.schedule.times];
                            times[timeIndex] = nextTime;
                            setTimes(id, times);
                          }}
                          onRemove={() => setTimes(id, candidate.schedule.times.filter((_, position) => position !== timeIndex))}
                        />
                      ))}
                      {emptySlots > 0 && usedTimes.some((time) => !candidate.schedule.times.includes(time)) && (
                        <View className="flex-row flex-wrap items-center gap-2">
                          <Text className="text-sm text-slate">Times you’ve used:</Text>
                          {usedTimes
                            .filter((time) => !candidate.schedule.times.includes(time))
                            .slice(0, 4)
                            .map((time) => (
                              <Pressable
                                key={time}
                                accessibilityRole="button"
                                className="min-h-10 justify-center rounded-full border border-line bg-white px-4"
                                onPress={() => {
                                  setTimes(id, [...candidate.schedule.times, time]);
                                  setSlots((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) - 1) }));
                                }}
                              >
                                <Text className="text-sm font-bold text-deep-blue">{displayTime(time)}</Text>
                              </Pressable>
                            ))}
                        </View>
                      )}
                      {Array.from({ length: emptySlots }, (_, slot) => (
                        <TimeField
                          key={`empty-${slot}`}
                          startOpen={newSlotFor === id && slot === emptySlots - 1}
                          onChange={(time) => {
                            setTimes(id, [...candidate.schedule.times, time]);
                            setSlots((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) - 1) }));
                            setNewSlotFor(undefined);
                          }}
                          onRemove={() => {
                            setSlots((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) - 1) }));
                            setNewSlotFor(undefined);
                          }}
                        />
                      ))}
                      <Pressable
                        accessibilityRole="button"
                        className="min-h-10 self-start justify-center"
                        onPress={() => {
                          setSlots((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
                          setNewSlotFor(id);
                        }}
                      >
                        <Text className="text-sm font-bold text-cobalt">+ Add another time</Text>
                      </Pressable>
                    </View>
                  )}

                  {needsDayCount(candidate) && canEditSchedule && (
                    <View className="gap-1">
                      <View className="flex-row items-center gap-3">
                        <Text className="flex-1 text-base font-bold text-ink">For how many days?</Text>
                        <TextInput
                          accessibilityLabel={`Number of days for ${candidate.action_text}`}
                          className="min-h-11 w-20 rounded-xl border border-line bg-white px-3 text-center text-base font-bold text-ink"
                          keyboardType="number-pad"
                          maxLength={3}
                          placeholder="—"
                          value={days > 0 ? String(days) : ''}
                          onChangeText={(text) => {
                            const digits = text.replace(/\D/g, '').slice(0, 3);
                            setDays(index, digits ? Number(digits) : 0);
                          }}
                        />
                        <Text className="text-base text-slate">days</Text>
                      </View>
                      <Text className="text-sm text-slate">
                        {autofilled.has(id)
                          ? 'Same as the item above. Change it if this one is different.'
                          : candidate.extracted_duration_days
                            ? `The document says ${candidate.extracted_duration_days} days.`
                            : 'The document doesn’t say. Later items will use the same number.'}
                      </Text>
                    </View>
                  )}

                  {needsIntervalCompletion(candidate.schedule) && (
                    <Text className="text-sm text-ink">
                      This repeats every few hours and can’t be scheduled here yet. Leave it out for now.
                    </Text>
                  )}

                  {!!issue && <Text className="text-sm font-semibold text-ink">{issue}</Text>}

                  <View className="flex-row items-center gap-2 pt-1">
                    <Pressable
                      accessibilityRole="button"
                      className="min-h-10 justify-center px-2"
                      onPress={() => leaveOut(id)}
                    >
                      <Text className="text-sm font-bold text-slate">Leave out</Text>
                    </Pressable>
                    <View className="flex-1" />
                    <Pressable
                      accessibilityRole="button"
                      className="min-h-10 justify-center rounded-full bg-deep-blue px-5"
                      disabled={!!issue}
                      style={{ opacity: issue ? 0.4 : 1 }}
                      onPress={() => closeAndAdvance(id)}
                    >
                      <Text className="text-sm font-bold text-white">OK</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {!!leftOutRows.length && (
        <View className="gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showLeftOut }}
            className="min-h-11 flex-row items-center justify-between px-1"
            onPress={() => setShowLeftOut((value) => !value)}
          >
            <Text className="text-sm font-bold text-slate">Left out ({leftOutRows.length})</Text>
            <Text className="text-sm text-slate">{showLeftOut ? '⌃' : '⌄'}</Text>
          </Pressable>
          {showLeftOut && (
            <View className="overflow-hidden rounded-3xl border border-line bg-white">
              {leftOutRows.map(({ candidate }, position) => (
                <View
                  key={candidate.candidate_id}
                  className={`min-h-[60px] flex-row items-center gap-1 py-2 pl-4 pr-1 ${position ? 'border-t border-line' : ''}`}
                >
                  <View className="flex-1 gap-1">
                    <Text className="text-base font-bold text-slate line-through">{candidate.action_text}</Text>
                    <Text className="text-sm text-slate">{statusLabel(candidate)}</Text>
                  </View>
                  {candidate.review_status !== 'unsupported' && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add back ${candidate.action_text}`}
                      className="min-h-11 justify-center px-2"
                      onPress={() => restore(candidate.candidate_id)}
                    >
                      <Text className="text-sm font-bold text-cobalt">Undo</Text>
                    </Pressable>
                  )}
                  <DetailsButton
                    label={candidate.action_text}
                    onPress={() => setDetails(candidate.candidate_id)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <ReviewDetailsSheet
        key={detailsCandidate?.candidate_id}
        candidate={detailsCandidate}
        extractionId={extractionId}
        status={detailsCandidate ? statusLabel(detailsCandidate) : ''}
        schedule={detailsCandidate ? summary(detailsCandidate) : ''}
        isIncluded={!!detailsCandidate && included(detailsCandidate)}
        canChangeSchedule={
          !!detailsCandidate &&
          !isUnscheduled(detailsCandidate) &&
          !needsIntervalCompletion(detailsCandidate.schedule)
        }
        onClose={() => setDetails(undefined)}
        onChange={(update) => detailsCandidate && patch(detailsCandidate.candidate_id, update)}
        onChangeSchedule={() => {
          setOpen(details);
          setDetails(undefined);
        }}
        onLeaveOut={() => {
          if (details) leaveOut(details);
          setDetails(undefined);
        }}
        onRestore={
          detailsCandidate?.review_status !== 'unsupported' && details ? () => restore(details) : undefined
        }
        onOpenSource={() => {
          setDetails(undefined);
          if (details) openSource(details);
        }}
      />

      {!!notice && (
        <Text selectable accessibilityRole="alert" className="rounded-2xl bg-coral/15 p-4 text-base text-ink">
          {notice}
        </Text>
      )}
    </FlowScreen>
  );
}
