import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import type { Candidate } from '../api';
import { findExercises, library, suggestedExercises, type Exercise } from '../physio/catalogue';
import { Button } from './button';
import { Sheet } from './sheet';
import { Text, TextInput } from './text';
import { PhysioPlayer } from './physio-player';

export function ReviewExercisePicker({ target, context, selectedIds, onSelect, onClose }: {
  target?: Candidate;
  context: string;
  selectedIds: string[];
  onSelect: (exercise: Exercise, dosage: string, attach: boolean) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<Exercise>();
  const [dosage, setDosage] = useState('');
  const suggestions = suggestedExercises(target?.instruction_text || context);
  const exercises = query || category ? findExercises(query, category) : [
    ...suggestions.exercises,
    ...library.exercises.filter(e => !suggestions.exercises.includes(e)),
  ];
  return <Sheet visible onClose={onClose} closeLabel="Close exercise selection">
    <Text accessibilityRole="header" className="text-2xl font-bold text-deep-blue">{selected ? selected.name : 'Choose an exercise'}</Text>
    {selected ? <>
      <PhysioPlayer key={selected.id} exercise={selected} />
      <Text className="text-base leading-6 text-ink">{selected.form.start}</Text>
      {selected.form.cues.map(cue => <Text key={cue} className="text-base leading-6 text-ink">• {cue}</Text>)}
      {selected.precautions.map(cue => <Text key={cue} className="text-sm leading-5 text-slate">{cue}</Text>)}
      {!!target && <>
        <Text className="text-sm leading-5 text-slate">Attach this demonstration to “{target.action_text}”. Its existing instructions and schedule stay in place.</Text>
        <Button title="Attach to this instruction" onPress={() => onSelect(selected, '', true)} />
      </>}
      <Text className="text-base font-semibold text-deep-blue">{target ? 'Or add a separate exercise' : 'Your exercise instructions'}</Text>
      <TextInput accessibilityLabel="Exercise dosage" multiline maxLength={500} value={dosage} onChangeText={setDosage}
        placeholder="Enter the repetitions, sets, holds or session duration you intend to use"
        className="min-h-24 rounded-2xl border border-line bg-cloud px-4 py-3 text-base text-ink" />
      <Text className="text-sm leading-5 text-slate">This will be recorded as an exercise added by you. Choose reminder times and days in the review.</Text>
      <Button title={selectedIds.includes(selected.id) ? 'Already added' : 'Add exercise to review'} disabled={!dosage.trim() || selectedIds.includes(selected.id)} onPress={() => onSelect(selected, dosage.trim(), false)} />
      <Button variant="secondary" title="Back to exercises" onPress={() => { setSelected(undefined); setDosage(''); }} />
    </> : <>
      {!!target && <Text className="text-base text-slate">{target.instruction_text}</Text>}
      <TextInput accessibilityLabel="Search exercises" value={query} onChangeText={setQuery} placeholder="Search by exercise or equipment" className="min-h-12 rounded-2xl border border-line px-4 text-base" />
      <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
        {[{ id: '', name: 'All' }, ...library.categories].map(c => <Button key={c.id} size="compact" variant={category === c.id ? 'primary' : 'secondary'} title={c.name} onPress={() => setCategory(c.id)} />)}
      </ScrollView>
      {!query && !category && !!suggestions.exercises.length && <Text className="text-sm text-slate">{suggestions.reason}</Text>}
      {!exercises.length && <Text>No matches. Try another name or category.</Text>}
      {exercises.map((exercise, index) => <View key={exercise.id} className="gap-2">
        {!query && !category && suggestions.exercises.length > 0 && index === suggestions.exercises.length && <Text accessibilityRole="header" className="text-lg font-bold text-deep-blue">Other exercises</Text>}
        <View className="gap-2 rounded-2xl border border-line p-4">
        <Text className="text-lg font-bold text-deep-blue">{exercise.name}</Text>
        <Text className="text-base text-slate">{exercise.summary}</Text>
        <Button variant="quiet" title="Preview and select" onPress={() => setSelected(exercise)} />
        </View>
      </View>)}
    </>}
    <Button variant="secondary" title="Close" onPress={onClose} />
  </Sheet>;
}
