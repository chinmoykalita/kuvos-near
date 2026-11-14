import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  Text as RNText,
  View,
  type TextInput as RNTextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from './text';

export type Country = {
  name: string;
  dial: string;
  flag: string;
  code: string;
};

// Curated list — common first, alphabetical after
const COUNTRIES: Country[] = [
  { name: 'India', dial: '+91', flag: '🇮🇳', code: 'IN' },
  { name: 'United States', dial: '+1', flag: '🇺🇸', code: 'US' },
  { name: 'United Kingdom', dial: '+44', flag: '🇬🇧', code: 'GB' },
  { name: 'Canada', dial: '+1', flag: '🇨🇦', code: 'CA' },
  { name: 'Australia', dial: '+61', flag: '🇦🇺', code: 'AU' },
  { name: 'Singapore', dial: '+65', flag: '🇸🇬', code: 'SG' },
  { name: 'UAE', dial: '+971', flag: '🇦🇪', code: 'AE' },
  { name: 'Germany', dial: '+49', flag: '🇩🇪', code: 'DE' },
  { name: 'France', dial: '+33', flag: '🇫🇷', code: 'FR' },
  { name: 'Japan', dial: '+81', flag: '🇯🇵', code: 'JP' },
  { name: 'China', dial: '+86', flag: '🇨🇳', code: 'CN' },
  { name: 'Brazil', dial: '+55', flag: '🇧🇷', code: 'BR' },
  { name: 'Mexico', dial: '+52', flag: '🇲🇽', code: 'MX' },
  { name: 'Nigeria', dial: '+234', flag: '🇳🇬', code: 'NG' },
  { name: 'South Africa', dial: '+27', flag: '🇿🇦', code: 'ZA' },
  { name: 'Bangladesh', dial: '+880', flag: '🇧🇩', code: 'BD' },
  { name: 'Pakistan', dial: '+92', flag: '🇵🇰', code: 'PK' },
  { name: 'Sri Lanka', dial: '+94', flag: '🇱🇰', code: 'LK' },
  { name: 'Nepal', dial: '+977', flag: '🇳🇵', code: 'NP' },
  { name: 'Philippines', dial: '+63', flag: '🇵🇭', code: 'PH' },
  { name: 'Indonesia', dial: '+62', flag: '🇮🇩', code: 'ID' },
  { name: 'Malaysia', dial: '+60', flag: '🇲🇾', code: 'MY' },
  { name: 'Thailand', dial: '+66', flag: '🇹🇭', code: 'TH' },
  { name: 'Vietnam', dial: '+84', flag: '🇻🇳', code: 'VN' },
  { name: 'South Korea', dial: '+82', flag: '🇰🇷', code: 'KR' },
  { name: 'Italy', dial: '+39', flag: '🇮🇹', code: 'IT' },
  { name: 'Spain', dial: '+34', flag: '🇪🇸', code: 'ES' },
  { name: 'Netherlands', dial: '+31', flag: '🇳🇱', code: 'NL' },
  { name: 'Sweden', dial: '+46', flag: '🇸🇪', code: 'SE' },
  { name: 'Switzerland', dial: '+41', flag: '🇨🇭', code: 'CH' },
  { name: 'New Zealand', dial: '+64', flag: '🇳🇿', code: 'NZ' },
  { name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦', code: 'SA' },
  { name: 'Qatar', dial: '+974', flag: '🇶🇦', code: 'QA' },
  { name: 'Egypt', dial: '+20', flag: '🇪🇬', code: 'EG' },
  { name: 'Kenya', dial: '+254', flag: '🇰🇪', code: 'KE' },
  { name: 'Ghana', dial: '+233', flag: '🇬🇭', code: 'GH' },
  { name: 'Ethiopia', dial: '+251', flag: '🇪🇹', code: 'ET' },
  { name: 'Tanzania', dial: '+255', flag: '🇹🇿', code: 'TZ' },
  { name: 'Uganda', dial: '+256', flag: '🇺🇬', code: 'UG' },
];

export const DEFAULT_COUNTRY = COUNTRIES[0]; // India

// Stable separator — extracted to avoid per-render allocation inside FlatList (#7)
function Separator() {
  return <View className="mx-5 h-px bg-line" />;
}

// Fixed row height for getItemLayout (#6)
const ROW_HEIGHT = 65;

type Props = {
  visible: boolean;
  selected: Country;
  onSelect: (country: Country) => void;
  onClose: () => void;
};

export function CountryPickerModal({ visible, selected, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const searchRef = useRef<RNTextInput>(null);

  // Focus search after the native modal opens.
  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => searchRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const filtered = useMemo(() => {
    if (!query.trim()) return COUNTRIES;
    const q = query.toLowerCase();
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.code.toLowerCase().includes(q),
    );
  }, [query]);

  const handleSelect = useCallback(
    (country: Country) => {
      onSelect(country);
      onClose();
    },
    [onSelect, onClose],
  );

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent
      transparent={false}
      visible={visible}
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-white" style={{ paddingBottom: insets.bottom }}>
        {/* Header */}
        <View className="flex-row items-center justify-between border-b border-line px-5 py-4">
          <Text className="text-lg font-bold text-ink">Select country</Text>
          <Pressable
            accessibilityLabel="Close country picker"
            accessibilityRole="button"
            className="rounded-full bg-cloud px-4 py-2"
            onPress={onClose}
          >
            <Text className="text-sm font-semibold text-slate">Done</Text>
          </Pressable>
        </View>

        {/* Search */}
        <View className="border-b border-line px-5 py-3">
          <View className="flex-row items-center gap-3 rounded-2xl bg-cloud px-4 py-3">
            <Text className="text-base text-slate">🔍</Text>
            <TextInput
              ref={searchRef}
              accessibilityLabel="Search countries"
              className="flex-1 text-base text-ink"
              placeholder="Search country or code"
              placeholderTextColor="#5E6B7E"
              returnKeyType="search"
              value={query}
              onChangeText={setQuery}
            />
            {query.length > 0 && (
              <Pressable
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                onPress={() => setQuery('')}
              >
                <Text className="text-base text-slate">✕</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* List */}
        <FlatList
          data={filtered}
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          initialNumToRender={15}
          keyExtractor={(item) => item.code}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={Separator}
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={`${item.name} ${item.dial}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: item.code === selected.code }}
              className="flex-row items-center gap-4 px-5 py-4"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              onPress={() => handleSelect(item)}
            >
              <RNText style={{ fontSize: 28 }}>{item.flag}</RNText>
              <Text className="flex-1 text-base text-ink">{item.name}</Text>
              <Text className="text-base font-semibold text-cobalt">{item.dial}</Text>
              {item.code === selected.code && (
                <Text className="text-base text-cobalt">✓</Text>
              )}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

type TriggerProps = {
  country: Country;
  onPress: () => void;
};

export function CountryPickerTrigger({ country, onPress }: TriggerProps) {
  return (
    <Pressable
      accessibilityLabel={`Country code ${country.dial}, ${country.name}. Tap to change.`}
      accessibilityRole="button"
      className="flex-row items-center gap-2 bg-white px-4 py-0"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      onPress={onPress}
    >
      <RNText style={{ fontSize: 22 }}>{country.flag}</RNText>
      <Text className="text-base font-bold text-ink">{country.dial}</Text>
      <Text className="text-xs text-slate">▾</Text>
    </Pressable>
  );
}
