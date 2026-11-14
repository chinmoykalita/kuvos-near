import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Candidate } from '../api';
import { ActionExplanation } from './action-explanation';
import { Sheet } from './sheet';
import { Text, TextInput } from './text';
import { fieldValue } from '../review';

function fieldLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function SectionLabel({ children }: { children: string }) {
  return <Text className="text-xs font-bold uppercase tracking-wider text-slate">{children}</Text>;
}

export function ReviewDetailsSheet({
  candidate,
  extractionId,
  status,
  schedule,
  isIncluded,
  canChangeSchedule,
  onClose,
  onChange,
  onChangeSchedule,
  onLeaveOut,
  onRestore,
  onOpenSource,
}: {
  candidate?: Candidate;
  extractionId: string;
  status: string;
  schedule: string;
  isIncluded: boolean;
  canChangeSchedule: boolean;
  onClose: () => void;
  onChange: (update: (candidate: Candidate) => Candidate) => void;
  onChangeSchedule: () => void;
  onLeaveOut: () => void;
  onRestore?: () => void;
  onOpenSource: () => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Sheet visible={!!candidate} onClose={onClose} closeLabel="Close details">
      {candidate && (
        <>
          <View className="flex-row items-start gap-3">
            <View className="flex-1 gap-1">
              <Text accessibilityRole="header" className="text-xl font-extrabold text-deep-blue">
                {candidate.action_text || candidate.instruction_text}
              </Text>
              <Text className="text-sm font-semibold text-slate">{status}</Text>
            </View>
            <Pressable accessibilityRole="button" className="min-h-11 justify-center px-2" onPress={onClose}>
              <Text className="font-bold text-cobalt">Close</Text>
            </Pressable>
          </View>

          <View className="gap-2">
            <SectionLabel>{candidate.physio?.origin === 'reviewer_added' ? 'Exercise added by reviewer' : 'From the prescription'}</SectionLabel>
            <Text selectable className="font-serif-italic text-base leading-6 text-ink">
              “{candidate.instruction_text}”
            </Text>
            {candidate.physio?.origin !== 'reviewer_added' && <Pressable accessibilityRole="link" className="min-h-11 self-start justify-center" onPress={onOpenSource}>
              <Text className="text-sm font-bold text-cobalt">View in document</Text>
            </Pressable>}
          </View>

          {isIncluded && (
            <View className="gap-2">
              <SectionLabel>Schedule</SectionLabel>
              <View className="flex-row items-center gap-3">
                <Text className="flex-1 text-base text-ink">{schedule}</Text>
                {canChangeSchedule && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Change times or days"
                    className="min-h-10 justify-center rounded-full border border-line bg-white px-4"
                    onPress={onChangeSchedule}
                  >
                    <Text className="text-sm font-bold text-deep-blue">Change</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {!!candidate.fields.length && (
            <View className="gap-2">
              <SectionLabel>Details</SectionLabel>
              <View className="gap-2 rounded-2xl bg-cloud p-3">
                {candidate.fields.map((field) => (
                  <View key={field.name} className="flex-row justify-between gap-4">
                    <Text className="flex-1 text-sm text-slate">{fieldLabel(field.name)}</Text>
                    <Text selectable className="max-w-[58%] text-right text-sm font-bold text-ink">
                      {fieldValue(field)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {!!candidate.disagreement_notes?.length && (
            <View className="gap-1 rounded-2xl bg-sun/50 p-3">
              <Text className="text-sm font-bold text-ink">Why this needs a closer look</Text>
              {candidate.disagreement_notes.map((note) => (
                <Text selectable key={note} className="text-sm text-ink">
                  • {note}
                </Text>
              ))}
            </View>
          )}

          {isIncluded && candidate.physio?.origin !== 'reviewer_added' && (
            <ActionExplanation
              explanation={candidate.explanation}
              extractionId={extractionId}
              candidateId={candidate.candidate_id}
              showEmpty
              onLeave={onClose}
              onChangeText={(text) =>
                onChange((current) => ({
                  ...current,
                  explanation: { ...current.explanation, text, sources: current.explanation?.sources || [] },
                }))
              }
            />
          )}

          {isIncluded && candidate.physio?.origin !== 'reviewer_added' && (
            <View className="gap-3">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: editing }}
                className="min-h-11 flex-row items-center justify-between"
                onPress={() => setEditing((value) => !value)}
              >
                <Text className="text-sm font-bold text-deep-blue">Edit wording</Text>
                <Text className="text-sm text-deep-blue">{editing ? '⌃' : '⌄'}</Text>
              </Pressable>
              {editing && (
                <>
                  <View className="gap-1">
                    <Text className="text-sm font-bold text-ink">Shown on Today as</Text>
                    <TextInput
                      accessibilityLabel="Task shown to the patient"
                      className="min-h-11 rounded-xl border border-line bg-white px-3 py-2 text-base text-ink"
                      multiline
                      value={candidate.action_text || ''}
                      onChangeText={(action_text) => onChange((current) => ({ ...current, action_text }))}
                    />
                  </View>
                  <View className="gap-1">
                    <Text className="text-sm font-bold text-ink">Full instruction</Text>
                    <TextInput
                      accessibilityLabel="Full instruction"
                      className="min-h-20 rounded-xl border border-line bg-white px-3 py-2 text-base text-ink"
                      multiline
                      textAlignVertical="top"
                      value={candidate.instruction_text}
                      onChangeText={(instruction_text) => onChange((current) => ({ ...current, instruction_text }))}
                    />
                    <Text className="text-xs text-slate">The original document text stays unchanged.</Text>
                  </View>
                </>
              )}
            </View>
          )}

          {isIncluded && candidate.physio?.origin === 'reviewer_added' && <View className="gap-2">
            <SectionLabel>Your exercise instructions</SectionLabel>
            <TextInput accessibilityLabel="Exercise dosage" multiline maxLength={500} value={candidate.physio.dosage || ''}
              className="min-h-20 rounded-xl border border-line px-3 py-2 text-base"
              onChangeText={dosage => onChange(current => ({ ...current, physio: { ...current.physio!, dosage }, action_text: `${current.action_text?.split(' — ')[0]} — ${dosage}`, instruction_text: `${current.instruction_text.split('\nYour instructions:')[0]}\nYour instructions: ${dosage}`, fields: [{ name: 'exercise_dosage', raw_value: dosage }] }))} />
          </View>}

          <View className="flex-row items-center gap-2 border-t border-line pt-4">
            {isIncluded ? (
              <Pressable accessibilityRole="button" className="min-h-11 justify-center px-2" onPress={onLeaveOut}>
                <Text className="text-sm font-bold text-slate">Leave out</Text>
              </Pressable>
            ) : (
              onRestore && (
                <Pressable accessibilityRole="button" className="min-h-11 justify-center px-2" onPress={onRestore}>
                  <Text className="text-sm font-bold text-cobalt">Add back</Text>
                </Pressable>
              )
            )}
            <View className="flex-1" />
            <Pressable
              accessibilityRole="button"
              className="min-h-11 justify-center rounded-full bg-deep-blue px-6"
              onPress={onClose}
            >
              <Text className="text-sm font-bold text-white">Done</Text>
            </Pressable>
          </View>
        </>
      )}
    </Sheet>
  );
}
