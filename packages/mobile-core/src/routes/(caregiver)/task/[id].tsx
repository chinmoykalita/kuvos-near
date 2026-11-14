import { useLocalSearchParams } from "expo-router";

import { TaskScreen } from "../../../screens/task-screen";

export default function TaskRoute() {
  const { id, planId, date } = useLocalSearchParams<{
    id: string;
    planId: string;
    date?: string;
  }>();
  return <TaskScreen occurrenceId={id} planId={planId} date={date} />;
}
