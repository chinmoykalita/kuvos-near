import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router/stack';
import { useRouter } from 'expo-router';
import { Screen } from '../components/screen';
import { Text } from '../components/text';
import { Button } from '../components/button';
import { PhysioPlayer } from '../components/physio-player';
import { library } from '../physio/catalogue';

export function PhysioExerciseScreen({ id }: { id: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const exercise = library.exercises.find(item => item.id === id);
  if (!exercise) return <Screen><Text accessibilityRole="alert">This exercise is not in the library.</Text><Button title="Browse exercises" onPress={() => router.replace('/physio')} /></Screen>;
  return (
    <View className="flex-1 bg-cloud">
      <Stack.Screen options={{ title: exercise.name }} />
      <View className="mx-auto w-full max-w-2xl px-5 pb-3 pt-2">
        <PhysioPlayer key={exercise.id} exercise={exercise} />
      </View>
      <ScrollView className="flex-1" contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}>
      <View className="mx-auto w-full max-w-2xl gap-4 px-5">
      <Text className="text-lg leading-7 text-slate">{exercise.summary}</Text>
      <View className="gap-3 rounded-3xl border border-line bg-white p-5">
        <Text accessibilityRole="header" className="text-xl font-bold text-deep-blue">Before you begin</Text>
        <Text selectable className="text-lg leading-7 text-ink">{exercise.form.start}</Text>
        {exercise.equipment.length > 0 && <Text className="text-base leading-6 text-slate">Equipment: {exercise.equipment.join(', ')}</Text>}
      </View>
      <View className="gap-4 rounded-3xl border border-line bg-white p-5">
        <Text accessibilityRole="header" className="text-xl font-bold text-deep-blue">Step by step</Text>
        {exercise.form.cues.map((cue, index) => (
          <View key={index} className="flex-row gap-3">
            <Text className="text-lg font-bold text-cobalt">{index + 1}.</Text>
            <Text selectable className="flex-1 text-lg leading-7 text-ink">{cue}</Text>
          </View>
        ))}
        <View className="gap-2 rounded-2xl bg-ice p-4">
          <Text className="font-bold text-deep-blue">Breathing</Text>
          <Text selectable className="text-base leading-6 text-ink">{exercise.form.breathe}</Text>
        </View>
      </View>
      {exercise.supports.length > 0 && <View className="gap-4 rounded-3xl border border-line bg-white p-5">
        <Text accessibilityRole="header" className="text-xl font-bold text-deep-blue">Positioning and supports</Text>
        {exercise.supports.map(support => <View key={support.n} className="gap-1">
          <Text className="text-base font-bold text-deep-blue">{support.n}. {support.label}</Text>
          <Text selectable className="text-base leading-6 text-slate">{support.why}</Text>
        </View>)}
      </View>}
      <View className="gap-3 rounded-3xl border border-line bg-white p-5">
        <Text accessibilityRole="header" className="text-xl font-bold text-deep-blue">What to watch for</Text>
        {exercise.form.faults.map((fault, index) => <Text selectable key={index} className="text-base leading-6 text-ink">• {fault}</Text>)}
        {exercise.precautions.map((precaution, index) => <Text selectable key={index} className="text-base font-semibold leading-6 text-deep-blue">{precaution}</Text>)}
      </View>
      </View>
      </ScrollView>
    </View>
  );
}
