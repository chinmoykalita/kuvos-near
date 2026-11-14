import * as SecureStore from 'expo-secure-store';

import type { Need } from './adaptations';
import type { CareRole, Condition, DailyRoutine, HealthProfile, Meal } from './api';

// Progress shown as step dashes: about you, their day, prescription, your people.
export const onboardingSteps = 4;

export const meals: Meal[] = ['breakfast', 'lunch', 'dinner'];

// Labels only; Kuvos stores these on the profile and never uses them to shape a plan.
export const conditions: { id: Condition; label: string }[] = [
  { id: 'blood_pressure', label: 'High blood pressure' },
  { id: 'diabetes', label: 'Diabetes' },
  { id: 'tb', label: 'TB (tuberculosis)' },
  { id: 'lung_infection', label: 'Lung infection' },
];

export type HeightUnit = 'cm' | 'ft';
export type WeightUnit = 'kg' | 'lb';

// Feet and pounds first only where they are the everyday units; either can be picked anywhere.
const imperial = /[-_](US|LR|MM)\b/.test(Intl.DateTimeFormat().resolvedOptions().locale);
export const defaultUnits: { height: HeightUnit; weight: WeightUnit } = imperial
  ? { height: 'ft', weight: 'lb' }
  : { height: 'cm', weight: 'kg' };

const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;

function typedNumber(typed: string | null | undefined, decimal = false) {
  if (!typed?.trim()) return;
  const value = Number(typed.trim().replace(',', '.'));
  if (!Number.isFinite(value) || (!decimal && !Number.isInteger(value))) return;
  return value;
}

const within = (value: number | undefined, min: number, max: number) =>
  value !== undefined && value >= min && value <= max ? value : undefined;
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

// Ranges match the API, which always receives centimetres and kilograms.
export function ageValue(draft: OnboardingDraft) {
  return within(typedNumber(draft.age), 0, 120);
}

export function heightCm(draft: OnboardingDraft) {
  if (draft.heightUnit !== 'ft') return within(typedNumber(draft.height), 30, 250);
  const feet = typedNumber(draft.heightFt);
  const inches = draft.heightIn?.trim() ? typedNumber(draft.heightIn, true) : 0;
  if (feet === undefined || inches === undefined || inches >= 12) return;
  return within(Math.round((feet * 12 + inches) * CM_PER_INCH), 30, 250);
}

export function weightKg(draft: OnboardingDraft) {
  const typed = typedNumber(draft.weight, true);
  if (typed === undefined) return;
  return within(oneDecimal(draft.weightUnit === 'lb' ? typed * KG_PER_LB : typed), 1, 400);
}

export function feetAndInches(cm: number) {
  const inches = Math.round(cm / CM_PER_INCH);
  return { heightFt: String(Math.floor(inches / 12)), heightIn: String(inches % 12) };
}

export function convertWeight(kg: number, unit: WeightUnit) {
  return String(unit === 'lb' ? oneDecimal(kg / KG_PER_LB) : kg);
}

export type OnboardingStep =
  | 'name'
  | 'who'
  | 'patient'
  | 'relation'
  | 'permission'
  | 'gender'
  | 'age'
  | 'height'
  | 'weight'
  | 'conditions'
  | 'harder'
  | 'needs'
  | 'day'
  | 'wake'
  | 'sleep'
  | 'meals'
  | Meal
  | 'exercise'
  | 'done';

// Answers collected by Tomo before sign-in; held on this device until the Care Circle is created.
export type OnboardingDraft = {
  step: OnboardingStep;
  name: string;
  role?: CareRole;
  patientName: string;
  relation?: string;
  permission: boolean;
  /** `null` means "prefer not to say". Numbers are kept as typed, in the unit picked. */
  gender?: HealthProfile['gender'] | null;
  age?: string | null;
  heightUnit?: HeightUnit;
  /** Centimetres, or feet and inches when `heightUnit` is `ft`. */
  height?: string | null;
  heightFt?: string;
  heightIn?: string;
  weightUnit?: WeightUnit;
  weight?: string | null;
  conditions?: Condition[];
  /** Typed when "Something else" is picked; `undefined` while it is off. */
  otherConditions?: string;
  /** "Is anything a bit harder?"; kept on this phone only. */
  harder?: boolean;
  needs?: Need[];
  wake?: string;
  sleep?: string;
  /** Meals the patient usually has; a meal they skip has no key. */
  meals?: Partial<Record<Meal, string>>;
  /** `null` means "not sure yet". */
  exercise?: string | null;
};

export function stepsFor(draft: Pick<OnboardingDraft, 'role' | 'harder' | 'meals'>): OnboardingStep[] {
  return [
    'name',
    'who',
    ...(draft.role === 'CAREGIVER' ? (['patient', 'relation', 'permission'] as const) : []),
    'gender',
    'age',
    'height',
    'weight',
    'conditions',
    'harder',
    ...(draft.harder ? (['needs'] as const) : []),
    'day',
    'wake',
    'sleep',
    'meals',
    ...meals.filter((meal) => draft.meals?.[meal]),
    'exercise',
    'done',
  ];
}

export function routineFrom(draft: OnboardingDraft): DailyRoutine | undefined {
  if (!draft.wake || !draft.sleep) return;
  return {
    wake: draft.wake,
    sleep: draft.sleep,
    meals: draft.meals ?? {},
    ...(draft.exercise ? { exercise: draft.exercise } : {}),
  };
}

export function healthFrom(draft: OnboardingDraft): HealthProfile | undefined {
  const age = ageValue(draft);
  const height = heightCm(draft);
  const weight = weightKg(draft);
  const otherConditions = draft.otherConditions?.trim();
  const profile: HealthProfile = {
    conditions: draft.conditions ?? [],
    ...(draft.gender ? { gender: draft.gender } : {}),
    ...(age !== undefined ? { age } : {}),
    ...(height !== undefined ? { heightCm: height } : {}),
    ...(weight !== undefined ? { weightKg: weight } : {}),
    ...(otherConditions ? { otherConditions } : {}),
  };
  return Object.keys(profile).length > 1 || profile.conditions.length ? profile : undefined;
}

const key = 'kuvos.onboarding';

export const emptyDraft: OnboardingDraft = { step: 'name', name: '', patientName: '', permission: false };

export async function loadOnboardingDraft(): Promise<OnboardingDraft> {
  try {
    const saved = await SecureStore.getItemAsync(key);
    return saved ? { ...emptyDraft, ...(JSON.parse(saved) as Partial<OnboardingDraft>) } : emptyDraft;
  } catch {
    return emptyDraft;
  }
}

export async function saveOnboardingDraft(draft: OnboardingDraft) {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(draft));
  } catch {
    // Resuming is a convenience; setup still works without it.
  }
}

export async function clearOnboardingDraft() {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing to clear.
  }
}
