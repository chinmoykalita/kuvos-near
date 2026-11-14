import * as SecureStore from 'expo-secure-store';

// Answers to "Is anything a bit harder?" (PRD ONB-09–11, ACC-02). They stay on this phone and are
// never sent to the API or shown in reports.
// ponytail: stored only; nothing reads them until the accessibility modes (ACC) are built.
export const needs = [
  { id: 'memory', label: 'Memory or dementia' },
  { id: 'low_vision', label: 'Low vision' },
  { id: 'hearing', label: 'Hard of hearing' },
  { id: 'hands', label: 'Shaky hands or weak grip' },
  { id: 'reading', label: 'Reading is hard' },
  { id: 'language', label: 'English is a second language' },
  { id: 'speaking', label: 'Speaking is hard' },
] as const;

export type Need = (typeof needs)[number]['id'];

export type Adaptations = { needs: Need[]; answeredAt: string };

const key = (patientId: string) => `kuvos.adaptations.${patientId}`;

export async function saveAdaptations(patientId: string, selected: Need[]) {
  try {
    const value: Adaptations = { needs: selected, answeredAt: new Date().toISOString() };
    await SecureStore.setItemAsync(key(patientId), JSON.stringify(value));
  } catch {
    // Best effort: losing these only means the question is asked again later.
  }
}
