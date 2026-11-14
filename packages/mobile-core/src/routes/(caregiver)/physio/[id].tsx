import { useLocalSearchParams } from 'expo-router';
import { PhysioExerciseScreen } from '../../../screens/physio-exercise-screen';

export default function ExerciseRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PhysioExerciseScreen id={id} />;
}
