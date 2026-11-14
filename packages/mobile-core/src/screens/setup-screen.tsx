import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type TextInput as NativeTextInput,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInLeft,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { needs, saveAdaptations, type Need } from '../adaptations';
import { api, type CareRole, type Condition, type HealthProfile, type Meal } from '../api';
import { authClient } from '../auth-client';
import { Button } from '../components/button';
import { Text, TextInput } from '../components/text';
import { shiftTime, TimeDial } from '../components/time-dial';
import { Tomo, type TomoMood } from '../components/tomo';
import {
  ageValue,
  clearOnboardingDraft,
  conditions,
  convertWeight,
  defaultUnits,
  feetAndInches,
  healthFrom,
  heightCm,
  loadOnboardingDraft,
  meals,
  onboardingSteps,
  routineFrom,
  saveOnboardingDraft,
  stepsFor,
  weightKg,
  type HeightUnit,
  type OnboardingDraft,
  type OnboardingStep,
  type WeightUnit,
} from '../onboarding-draft';
import { colors } from '../theme';

// Relationship only adjusts on-screen wording; the API does not store it.
const relations = [
  { label: 'Mum', possessive: 'her' },
  { label: 'Dad', possessive: 'his' },
  { label: 'Partner', possessive: 'their' },
  { label: 'Child', possessive: 'their' },
  { label: 'Friend', possessive: 'their' },
  { label: 'Other', possessive: 'their' },
] as const;

const aboutSteps: OnboardingStep[] = [
  'name',
  'who',
  'patient',
  'relation',
  'permission',
  'gender',
  'age',
  'height',
  'weight',
  'conditions',
  'harder',
  'needs',
];
const genders: { id: NonNullable<HealthProfile['gender']>; label: string }[] = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'other', label: 'Other' },
];
const placeholderNames = ['Kuvos user'];
const mealLabels: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const relationFor = (label?: string) => relations.find((item) => item.label === label) ?? relations[5];
const around = (time: string, offsets: number[]) => offsets.map((offset) => shiftTime(time, offset));

function defaults(draft: OnboardingDraft) {
  const wake = draft.wake ?? '07:00';
  return {
    wake,
    sleep: draft.sleep ?? '22:30',
    breakfast: draft.meals?.breakfast ?? shiftTime(wake, 60),
    lunch: draft.meals?.lunch ?? '13:00',
    dinner: draft.meals?.dinner ?? '20:00',
    exercise: draft.exercise ?? '18:00',
  };
}

function tap() {
  void Haptics.selectionAsync().catch(() => undefined);
}

function Icon({ name, color = colors.deepBlue }: { name: 'me' | 'group' | Meal; color?: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {name === 'me' && (
        <>
          <Circle cx={12} cy={8} r={3.4} />
          <Path d="M5.5 19.5c.7-3.6 3.3-5.6 6.5-5.6s5.8 2 6.5 5.6" />
        </>
      )}
      {name === 'group' && (
        <>
          <Circle cx={9} cy={8} r={3.2} />
          <Path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
          <Circle cx={16.5} cy={9} r={2.6} />
          <Path d="M16 14.2c2.3.2 4 1.8 4.5 4.8" />
        </>
      )}
      {name === 'breakfast' && (
        <>
          <Path d="M4 18h16M7 18a5 5 0 0 1 10 0" />
          <Path d="M12 6v3M5.6 9.6l1.8 1.8M18.4 9.6l-1.8 1.8" />
        </>
      )}
      {name === 'lunch' && (
        <>
          <Circle cx={12} cy={12} r={4} />
          <Path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
        </>
      )}
      {name === 'dinner' && <Path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />}
    </Svg>
  );
}

function Check({ on, small }: { on: boolean; small?: boolean }) {
  return (
    <View
      className={`${small ? 'h-6 w-6' : 'h-7 w-7'} items-center justify-center rounded-full border-2 ${on ? 'border-deep-blue bg-deep-blue' : 'border-line bg-white'}`}
    >
      {on && (
        <Svg width={small ? 12 : 14} height={small ? 12 : 14} viewBox="0 0 24 24" fill="none" stroke={colors.white} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <Path d="m5 12.5 4.5 4.5L19 7.5" />
        </Svg>
      )}
    </View>
  );
}

function Option({
  title,
  detail,
  icon,
  selected,
  multi,
  onPress,
}: {
  title: string;
  detail?: string;
  icon?: ReactNode;
  selected: boolean;
  multi?: boolean;
  onPress: () => void;
}) {
  // Title-only answers sit in longer lists; keep them slim so more fit without scrolling.
  const compact = !icon && !detail;
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'button'}
      accessibilityState={multi ? { checked: selected } : { selected }}
      className={`${compact ? 'min-h-14 gap-3 rounded-2xl py-2' : 'min-h-[76px] gap-4 rounded-3xl py-3'} flex-row items-center border-2 px-4 ${selected ? 'border-deep-blue bg-white' : 'border-transparent bg-white'}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}
      onPress={onPress}
    >
      {icon && <View className="h-12 w-12 items-center justify-center rounded-2xl bg-cloud">{icon}</View>}
      <View className="flex-1 gap-0.5">
        <Text className={compact ? 'text-base font-semibold text-ink' : 'text-lg font-bold text-ink'}>{title}</Text>
        {!!detail && <Text className="text-sm leading-5 text-slate">{detail}</Text>}
      </View>
      <Check on={selected} small={compact} />
    </Pressable>
  );
}

function SkipLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      className="min-h-12 items-center justify-center"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      onPress={onPress}
    >
      <Text className="text-base font-semibold text-deep-blue">{title}</Text>
    </Pressable>
  );
}

function UnitToggle<Unit extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: Unit; label: string }[];
  value: Unit;
  onChange: (unit: Unit) => void;
}) {
  return (
    <View accessibilityLabel={label} accessibilityRole="radiogroup" className="flex-row self-center rounded-full bg-white p-1">
      {options.map((option) => {
        const on = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            className={`min-h-11 min-w-24 items-center justify-center rounded-full px-4 ${on ? 'bg-deep-blue' : ''}`}
            onPress={() => {
              if (on) return;
              tap();
              onChange(option.id);
            }}
          >
            <Text className={`text-sm font-semibold ${on ? 'text-white' : 'text-deep-blue'}`}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

function Segment({ fill }: { fill: number }) {
  const width = useSharedValue(fill);
  useEffect(() => {
    width.value = withTiming(fill, { duration: 380 });
  }, [fill, width]);
  const style = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  return (
    <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
      <Animated.View className="h-full rounded-full bg-deep-blue" style={style} />
    </View>
  );
}

export function SetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inchesInput = useRef<NativeTextInput>(null);
  const scroller = useRef<ScrollView>(null);
  // While a text box at the bottom of the list is focused, keep it in view as the keyboard
  // shrinks the screen or the box grows a line.
  const followInput = useRef(false);
  const keepInputInView = () => {
    if (followInput.current) scroller.current?.scrollToEnd({ animated: true });
  };
  const { data: session } = authClient.useSession();
  const signedIn = !!session;
  const sessionName = session?.user.name?.trim() ?? '';
  const accountName = placeholderNames.includes(sessionName) ? '' : sessionName;

  const [draft, setDraft] = useState<OnboardingDraft>();
  const [forward, setForward] = useState(true);
  const [notYet, setNotYet] = useState(false);
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle');
  const [error, setError] = useState('');

  const restore = useEffectEvent((saved: OnboardingDraft) => {
    const next = saved.name || !accountName ? saved : { ...saved, name: accountName };
    setDraft(next);
    // Back from sign-in with every answer given: carry straight on.
    if (signedIn && next.step === 'done') void createCareCircle(next);
  });

  useEffect(() => {
    let active = true;
    void loadOnboardingDraft().then((saved) => active && restore(saved));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const order = draft ? stepsFor(draft) : [];
  // `done` means every answer is in. Signed out, that hands over to sign-in; coming back from
  // there lands on the last question so answers can still be changed.
  const step: OnboardingStep =
    draft?.step === 'done' && !signedIn ? order[order.length - 2] : (draft?.step ?? 'name');
  const index = Math.max(0, order.indexOf(step));

  function save(patch: Partial<OnboardingDraft>) {
    if (!draft || status === 'busy') return;
    const next = { ...draft, ...patch };
    setDraft(next);
    void saveOnboardingDraft(next);
    return next;
  }

  function go(step: OnboardingStep, patch: Partial<OnboardingDraft> = {}, isForward = true) {
    setForward(isForward);
    setNotYet(false);
    setStatus('idle');
    save({ ...patch, step });
  }

  /** Answer the current question and move on. */
  function next(patch: Partial<OnboardingDraft> = {}) {
    if (!draft || status === 'busy') return;
    const steps = stepsFor({ ...draft, ...patch });
    const target = steps[steps.indexOf(step) + 1] ?? 'done';
    if (target !== 'done') {
      go(target, patch);
      return;
    }
    const answers: OnboardingDraft = { ...draft, ...patch, step: 'done' };
    setDraft(answers);
    if (signedIn) {
      void createCareCircle(answers);
      return;
    }
    // Sign-in reads the saved answers for its greeting, so save before opening it.
    void saveOnboardingDraft(answers).then(() => router.push('/sign-in'));
  }

  /** Tap feedback, then advance once the selection has had a moment to show. */
  function choose(patch: Partial<OnboardingDraft>) {
    tap();
    save(patch);
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => next(patch), 220);
  }

  function back() {
    if (!draft || status === 'busy') return false;
    clearTimeout(advanceTimer.current);
    if (index > 0) {
      go(order[index - 1], {}, false);
      return true;
    }
    if (!signedIn && router.canGoBack()) {
      router.back();
      return true;
    }
    return false;
  }

  useEffect(() => {
    // The hardware back button exists only on Android; web logs an error for BackHandler.
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    return () => subscription.remove();
  });

  async function createCareCircle(answers: OnboardingDraft) {
    setStatus('busy');
    setError('');
    try {
      const caregiver = answers.role === 'CAREGIVER';
      const created = await api<{ patientId: string }>('/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: answers.role ?? 'PATIENT',
          userName: answers.name.trim(),
          patientName: caregiver ? answers.patientName.trim() : answers.name.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          dailyRoutine: routineFrom(answers),
          healthProfile: healthFrom(answers),
        }),
      });
      if (answers.harder) await saveAdaptations(created.patientId, answers.needs ?? []);
      await clearOnboardingDraft();
      router.replace({ pathname: '/upload', params: { patientId: created.patientId } });
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof Error ? caught.message : 'Your Care Circle could not be created.');
    }
  }

  if (!draft) return <View className="flex-1 bg-cloud" />;

  const caregiver = draft.role === 'CAREGIVER';
  const you = firstName(draft.name);
  const them = firstName(draft.patientName) || 'them';
  const relation = relationFor(draft.relation);
  const whose = caregiver ? `${them}’s` : 'your';
  const Whose = caregiver ? `${them}’s` : 'Your';
  const does = caregiver ? `does ${them}` : 'do you';
  const values = defaults(draft);
  const chosenMeals = draft.meals ?? { breakfast: values.breakfast, lunch: values.lunch, dinner: values.dinner };

  const aboutCount = order.filter((step) => aboutSteps.includes(step)).length;
  const dayCount = order.length - 1 - aboutCount;
  const segments = [
    Math.min(1, (index + 0.5) / aboutCount),
    Math.max(0, Math.min(1, (index - aboutCount + 0.5) / dayCount)),
    0,
    0,
  ];
  const stepNumber = index < aboutCount ? 1 : 2;
  const canGoBack = index > 0 || (!signedIn && router.canGoBack());

  let mood: TomoMood = 'idle';
  let eyebrow = index < aboutCount ? (caregiver && index > 1 ? `About ${them}` : 'About you') : `${Whose} day`;
  let title = '';
  let subtitle = '';
  let body: ReactNode = null;
  let footer: ReactNode = null;

  const timeQuestion = (field: 'wake' | 'sleep' | 'exercise' | Meal, presets: string[]) => {
    const value = values[field];
    const set = (time: string) =>
      field === 'wake' || field === 'sleep' || field === 'exercise'
        ? { [field]: time }
        : { meals: { ...chosenMeals, [field]: time } };
    body = <TimeDial label={title} value={value} presets={presets} onChange={(time) => save(set(time))} />;
    footer = <Button title="Continue" size="hero" onPress={() => next(set(value))} />;
  };

  type NumberField = { key: 'age' | 'height' | 'heightFt' | 'heightIn' | 'weight'; unit: string; digits: number; decimal?: boolean };
  /** One or two big number boxes, an optional unit switch, and a skip link. */
  const numberQuestion = ({
    fields,
    value,
    error,
    units,
    keep,
    skip,
  }: {
    fields: NumberField[];
    value: number | undefined;
    error: string;
    units?: ReactNode;
    keep: Partial<OnboardingDraft>;
    skip: Partial<OnboardingDraft>;
  }) => {
    const valid = value !== undefined;
    const typed = fields.some((field) => !!draft[field.key]?.trim());
    body = (
      <View className="gap-4">
        {units}
        <View className="flex-row items-center justify-center gap-5 rounded-[32px] bg-white px-5 py-6">
          {fields.map((field, position) => (
            <View key={field.key} className="flex-row items-center gap-2">
              <TextInput
                ref={position === 1 ? inchesInput : undefined}
                accessibilityLabel={`${title} In ${field.unit}.`}
                autoFocus={position === 0}
                className={`${fields.length > 1 ? 'min-w-16' : 'min-w-28'} text-center text-3xl font-bold text-deep-blue`}
                keyboardType={field.decimal ? 'decimal-pad' : 'number-pad'}
                maxLength={field.digits + (field.decimal ? 2 : 0)}
                placeholder="–"
                placeholderTextColor={colors.mist}
                returnKeyType="next"
                style={{ fontVariant: ['tabular-nums'] }}
                value={draft[field.key] ?? ''}
                onChangeText={(text) => {
                  const clean = text.replace(field.decimal ? /[^\d.,]/g : /\D/g, '');
                  save({ [field.key]: clean });
                  if (position === 0 && fields.length > 1 && clean.length >= field.digits) inchesInput.current?.focus();
                }}
                onSubmitEditing={() => {
                  if (position === 0 && fields.length > 1) inchesInput.current?.focus();
                  else if (valid) next(keep);
                }}
              />
              <Text className="text-lg font-semibold text-slate">{field.unit}</Text>
            </View>
          ))}
        </View>
        {typed && !valid && (
          <Text accessibilityRole="alert" className="text-center text-sm text-coral">
            {error}
          </Text>
        )}
      </View>
    );
    footer = (
      <View className="gap-1">
        <Button title="Continue" size="hero" disabled={!valid} onPress={() => next(keep)} />
        <SkipLink title="Prefer not to say" onPress={() => next(skip)} />
      </View>
    );
  };

  switch (step) {
    case 'name': {
      mood = 'hello';
      title = 'What should I call you?';
      subtitle = 'Just the name you like to be called.';
      const ready = !!draft.name.trim();
      body = (
        <TextInput
          accessibilityLabel="Your name"
          autoCapitalize="words"
          autoComplete="name"
          autoFocus
          className="min-h-16 rounded-3xl bg-white px-5 text-2xl text-ink"
          maxLength={80}
          placeholder="Your name"
          placeholderTextColor={colors.mist}
          returnKeyType="next"
          value={draft.name}
          onChangeText={(name) => save({ name })}
          onSubmitEditing={() => ready && next()}
        />
      );
      footer = <Button title="Continue" size="hero" disabled={!ready} onPress={() => next({ name: draft.name.trim() })} />;
      break;
    }
    case 'who':
      title = 'Who is this plan for?';
      subtitle = `Nice to meet you, ${you}. This helps me ask the right questions.`;
      body = (
        <View className="gap-3">
          <Option
            icon={<Icon name="me" />}
            title="Me"
            detail="I’m the patient. Family can join later."
            selected={draft.role === 'PATIENT'}
            onPress={() => choose({ role: 'PATIENT' as CareRole, permission: false })}
          />
          <Option
            icon={<Icon name="group" />}
            title="Someone I care for"
            detail="A parent, partner, child or friend, near or far."
            selected={caregiver}
            onPress={() => choose({ role: 'CAREGIVER' as CareRole, permission: caregiver && draft.permission })}
          />
        </View>
      );
      break;
    case 'patient': {
      title = 'What’s their name?';
      subtitle = 'The name they like to be called.';
      const ready = !!draft.patientName.trim();
      body = (
        <TextInput
          accessibilityLabel="Their name"
          autoCapitalize="words"
          autoFocus
          className="min-h-16 rounded-3xl bg-white px-5 text-2xl text-ink"
          maxLength={80}
          placeholder="Their name"
          placeholderTextColor={colors.mist}
          returnKeyType="next"
          value={draft.patientName}
          onChangeText={(patientName) => save({ patientName })}
          onSubmitEditing={() => ready && next()}
        />
      );
      footer = (
        <Button title="Continue" size="hero" disabled={!ready} onPress={() => next({ patientName: draft.patientName.trim() })} />
      );
      break;
    }
    case 'relation':
      title = `${them} is your…`;
      subtitle = 'So I can talk about them the right way.';
      body = (
        <View className="flex-row flex-wrap justify-between gap-y-3">
          {relations.map((item) => {
            const selected = item.label === draft.relation;
            return (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className={`min-h-16 w-[48.5%] items-center justify-center rounded-3xl border-2 ${selected ? 'border-deep-blue bg-deep-blue' : 'border-transparent bg-white'}`}
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
                onPress={() => choose({ relation: item.label })}
              >
                <Text className={`text-lg font-bold ${selected ? 'text-white' : 'text-ink'}`}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      );
      break;
    case 'permission':
      title = `Does ${them} know you’re helping?`;
      subtitle = `You’ll see and manage ${relation.possessive} care plan, so ${them} should be happy with that.`;
      body = (
        <View className="gap-3">
          <Option
            title={`Yes, ${them} knows`}
            selected={draft.permission}
            onPress={() => choose({ permission: true })}
          />
          <Option
            title="Not yet"
            selected={notYet}
            onPress={() => {
              tap();
              setNotYet(true);
              save({ permission: false });
            }}
          />
          {notYet && (
            <Animated.View entering={FadeIn.duration(220)} className="rounded-3xl bg-sun p-4">
              <Text className="text-base leading-6 text-ink">
                Please check with {them} first. Your answers stay on this phone, so you can pick up
                right here.
              </Text>
            </Animated.View>
          )}
        </View>
      );
      break;
    case 'gender':
      title = `What’s ${whose} gender?`;
      subtitle = `Optional. It’s kept with ${whose} profile and never changes the plan.`;
      body = (
        <View className="gap-2">
          {genders.map((gender) => (
            <Option
              key={gender.id}
              title={gender.label}
              selected={draft.gender === gender.id}
              onPress={() => choose({ gender: gender.id })}
            />
          ))}
        </View>
      );
      footer = <SkipLink title="Prefer not to say" onPress={() => next({ gender: null })} />;
      break;
    case 'age':
      title = caregiver ? `How old is ${them}?` : 'How old are you?';
      subtitle = 'Optional.';
      numberQuestion({
        fields: [{ key: 'age', unit: 'years', digits: 3 }],
        value: ageValue(draft),
        error: 'Enter an age from 0 to 120.',
        keep: {},
        skip: { age: null },
      });
      break;
    case 'height':
      title = caregiver ? `How tall is ${them}?` : 'How tall are you?';
      subtitle = 'Optional. Roughly is fine.';
      {
        const heightUnit = draft.heightUnit ?? defaultUnits.height;
        const cm = heightCm({ ...draft, heightUnit });
        numberQuestion({
          fields:
            heightUnit === 'ft'
              ? [
                  { key: 'heightFt', unit: 'ft', digits: 1 },
                  { key: 'heightIn', unit: 'in', digits: 2 },
                ]
              : [{ key: 'height', unit: 'cm', digits: 3 }],
          value: cm,
          error: heightUnit === 'ft' ? 'Enter a height from 1 ft to 8 ft 2 in.' : 'Enter a height from 30 to 250 cm.',
          units: (
            <UnitToggle<HeightUnit>
              label="Height unit"
              options={[
                { id: 'cm', label: 'cm' },
                { id: 'ft', label: 'ft & in' },
              ]}
              value={heightUnit}
              // Carry a number already typed over to the other unit.
              onChange={(unit) =>
                save({ heightUnit: unit, ...(cm === undefined ? {} : unit === 'ft' ? feetAndInches(cm) : { height: String(cm) }) })
              }
            />
          ),
          keep: { heightUnit },
          skip: { height: null, heightFt: undefined, heightIn: undefined },
        });
      }
      break;
    case 'weight':
      title = `And ${whose} weight?`;
      subtitle = `Optional. ${caregiver ? 'Their' : 'Your'} last weigh-in is fine.`;
      {
        const weightUnit = draft.weightUnit ?? defaultUnits.weight;
        const kg = weightKg({ ...draft, weightUnit });
        numberQuestion({
          fields: [{ key: 'weight', unit: weightUnit, digits: 3, decimal: true }],
          value: kg,
          error: weightUnit === 'lb' ? 'Enter a weight from 3 to 880 lb.' : 'Enter a weight from 1 to 400 kg.',
          units: (
            <UnitToggle<WeightUnit>
              label="Weight unit"
              options={[
                { id: 'kg', label: 'kg' },
                { id: 'lb', label: 'lb' },
              ]}
              value={weightUnit}
              onChange={(unit) => save({ weightUnit: unit, ...(kg === undefined ? {} : { weight: convertWeight(kg, unit) }) })}
            />
          ),
          keep: { weightUnit },
          skip: { weight: null },
        });
      }
      break;
    case 'conditions': {
      const picked = draft.conditions ?? [];
      const other = draft.otherConditions !== undefined;
      title = `${caregiver ? `Does ${them}` : 'Do you'} have any long-term or chronic medical conditions?`;
      subtitle = 'Pick all that apply.';
      body = (
        <View className="gap-2">
          {conditions.map((condition) => {
            const on = picked.includes(condition.id);
            return (
              <Option
                key={condition.id}
                multi
                title={condition.label}
                selected={on}
                onPress={() => {
                  tap();
                  save({
                    conditions: on ? picked.filter((id) => id !== condition.id) : [...picked, condition.id as Condition],
                  });
                }}
              />
            );
          })}
          <Option
            multi
            title="Something else"
            selected={other}
            onPress={() => {
              tap();
              save({ otherConditions: other ? undefined : '' });
            }}
          />
          {other && (
            <Animated.View entering={FadeIn.duration(220)}>
              <TextInput
                accessibilityLabel="Other conditions"
                autoFocus
                className="min-h-16 rounded-3xl bg-white px-5 py-4 text-lg text-ink"
                maxLength={200}
                multiline
                placeholder="Type them here, like thyroid or asthma"
                placeholderTextColor={colors.mist}
                value={draft.otherConditions}
                onBlur={() => {
                  followInput.current = false;
                }}
                onChangeText={(otherConditions) => save({ otherConditions })}
                onFocus={() => {
                  followInput.current = true;
                  keepInputInView();
                }}
              />
            </Animated.View>
          )}
        </View>
      );
      footer = (
        <Button
          title={picked.length || draft.otherConditions?.trim() ? 'Continue' : 'None of these'}
          size="hero"
          onPress={() =>
            next({ conditions: picked, otherConditions: draft.otherConditions?.trim() || undefined })
          }
        />
      );
      break;
    }
    case 'harder':
      title = `Is anything a bit harder for ${caregiver ? them : 'you'}?`;
      subtitle = 'Like memory, eyesight or hearing. Your answer stays on this phone and never goes into reports.';
      body = (
        <View className="gap-3">
          <Option
            title="Yes, a few things"
            selected={draft.harder === true}
            onPress={() => choose({ harder: true })}
          />
          <Option
            title="No, all good"
            selected={draft.harder === false}
            onPress={() => choose({ harder: false, needs: [] })}
          />
        </View>
      );
      break;
    case 'needs': {
      const picked = draft.needs ?? [];
      title = 'Thanks for telling me';
      subtitle = 'Pick any that fit. It stays on this phone, so only you will see it.';
      body = (
        <View className="gap-2">
          {needs.map((need) => {
            const on = picked.includes(need.id);
            return (
              <Option
                key={need.id}
                multi
                title={need.label}
                selected={on}
                onPress={() => {
                  tap();
                  save({ needs: on ? picked.filter((id) => id !== need.id) : [...picked, need.id as Need] });
                }}
              />
            );
          })}
        </View>
      );
      footer = (
        <Button
          title={picked.length ? 'Continue' : 'Skip for now'}
          size="hero"
          onPress={() => next({ needs: picked })}
        />
      );
      break;
    }
    case 'day':
      mood = 'happy';
      title = `Now, a little about ${whose} day`;
      subtitle =
        'I’ll use it to suggest reminder times around meals and sleep. You’ll check every one before anything starts.';
      footer = <Button title="Let’s go" size="hero" onPress={() => next({ wake: values.wake })} />;
      break;
    case 'wake':
      title = `When ${does} usually wake up?`;
      subtitle = 'Roughly is fine. You can change it later.';
      timeQuestion('wake', ['06:00', '06:30', '07:00', '07:30', '08:00', '09:00']);
      break;
    case 'sleep':
      title = `And when ${does} usually go to bed?`;
      subtitle = 'I won’t suggest reminders after this.';
      timeQuestion('sleep', ['21:00', '21:30', '22:00', '22:30', '23:00', '23:30']);
      break;
    case 'meals':
      title = `Which meals ${does} usually have?`;
      subtitle = `Leave out any meal ${caregiver ? `${them} usually skips` : 'you usually skip'}.`;
      body = (
        <View className="gap-3">
          {meals.map((meal) => {
            const on = !!chosenMeals[meal];
            return (
              <Option
                key={meal}
                multi
                icon={<Icon name={meal} />}
                title={mealLabels[meal]}
                selected={on}
                onPress={() => {
                  tap();
                  const nextMeals = { ...chosenMeals };
                  if (on) delete nextMeals[meal];
                  else nextMeals[meal] = values[meal];
                  save({ meals: nextMeals });
                }}
              />
            );
          })}
        </View>
      );
      footer = (
        <Button
          title={Object.keys(chosenMeals).length ? 'Continue' : 'No regular meals'}
          size="hero"
          onPress={() => next({ meals: chosenMeals })}
        />
      );
      break;
    case 'breakfast':
    case 'lunch':
    case 'dinner':
      title = `When ${does} usually have ${step}?`;
      subtitle = 'Reminders for “with food” or “after food” can line up with it.';
      timeQuestion(step, around(values[step], [-60, -30, 0, 30, 60]).filter((time, position, all) => all.indexOf(time) === position));
      break;
    case 'exercise':
      title = `When’s a good time for ${caregiver ? `${them}’s` : 'your'} exercises?`;
      subtitle = 'Handy if the plan includes physio or walks.';
      timeQuestion('exercise', ['07:30', '10:00', '16:00', '18:00', '19:30']);
      footer = (
        <View className="gap-1">
          {footer}
          <SkipLink title="Not sure yet" onPress={() => next({ exercise: null })} />
        </View>
      );
      break;
    case 'done':
      // Signed in with every answer given: the Care Circle is being created.
      mood = status === 'error' ? 'idle' : 'thinking';
      eyebrow = 'All set';
      title = status === 'error' ? 'That didn’t work' : `Setting up ${whose} plan…`;
      subtitle = status === 'error' ? error : 'Just a moment.';
      if (status === 'error') {
        footer = <Button title="Try again" size="hero" onPress={() => void createCareCircle(draft)} />;
      }
      break;
  }

  const entering = (forward ? FadeInRight : FadeInLeft).duration(280);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-cloud"
      style={{ paddingTop: insets.top }}
    >
      <View className="min-h-14 flex-row items-center gap-4 px-5">
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          className={`h-11 w-11 items-center justify-center rounded-full ${canGoBack ? 'bg-white' : ''}`}
          disabled={!canGoBack}
          hitSlop={8}
          onPress={back}
        >
          {canGoBack && <Text className="text-2xl text-deep-blue">‹</Text>}
        </Pressable>
        <View
          accessible
          accessibilityLabel={`Step ${stepNumber} of ${onboardingSteps}`}
          className="flex-1 flex-row gap-1.5"
        >
          {segments.map((fill, position) => (
            <Segment key={position} fill={fill} />
          ))}
        </View>
      </View>

      <ScrollView
        ref={scroller}
        className="flex-1"
        contentContainerClassName="flex-grow px-5 pb-6 pt-4"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={keepInputInView}
        onLayout={keepInputInView}
      >
        <Animated.View key={step} entering={entering} className="flex-1 gap-7">
          <View className={step === 'day' ? 'flex-1 items-center justify-center gap-5' : 'gap-3'}>
            <Tomo size={step === 'day' ? 140 : 64} mood={mood} />
            <View className={`gap-2 ${step === 'day' ? 'items-center' : ''}`}>
              <Text className="text-2xs font-semibold uppercase tracking-eyebrow text-cobalt">{eyebrow}</Text>
              <Text
                accessibilityRole="header"
                className={`font-serif text-deep-blue ${step === 'day' ? 'text-center text-3xl' : 'text-2xl'}`}
              >
                {title}
              </Text>
              {!!subtitle && (
                <Text className={`text-base leading-6 text-slate ${step === 'day' ? 'max-w-[320px] text-center' : ''}`}>
                  {subtitle}
                </Text>
              )}
            </View>
          </View>
          {body}
        </Animated.View>
      </ScrollView>

      {/* The keyboard covers the home indicator, so the safe-area gap is only needed without it. */}
      {footer && (
        <View className="px-5 pt-2" style={{ paddingBottom: keyboardOpen ? 8 : insets.bottom + 12 }}>
          {footer}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
