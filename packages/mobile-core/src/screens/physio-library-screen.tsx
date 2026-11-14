import { useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '../components/text';
import { Button } from '../components/button';
import { findExercises, library } from '../physio/catalogue';
import { colors } from '../theme';

export function PhysioLibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const exercises = findExercises(query, category);
  return (
    <FlatList
      className="flex-1 bg-cloud"
      data={exercises}
      keyExtractor={item => item.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 28, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}
      ListHeaderComponent={
        <View className="gap-5 pb-2">
          <TextInput
            accessibilityLabel="Search exercises"
            placeholder="Search exercises, equipment or names"
            placeholderTextColor={colors.slate}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
            className="min-h-14 rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
            {[{ id: '', name: 'All exercises' }, ...library.categories].map(item => (
              <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: category === item.id }}
                onPress={() => setCategory(item.id)}
                className={`min-h-12 justify-center rounded-full border px-5 py-3 ${category === item.id ? 'border-deep-blue bg-deep-blue' : 'border-line bg-white'}`}>
                <Text className={`font-semibold ${category === item.id ? 'text-white' : 'text-deep-blue'}`}>{item.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      }
      ListEmptyComponent={
        <View className="gap-4 rounded-3xl bg-white p-6">
          <Text className="text-xl font-bold text-deep-blue">No exercises found</Text>
          <Text className="text-base text-slate">Try another name or browse all categories.</Text>
          <Button title="Clear search and filters" variant="secondary" onPress={() => { setQuery(''); setCategory(''); }} />
        </View>
      }
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.name}`} onPress={() => router.push({ pathname: '/physio/[id]', params: { id: item.id } })}
          className="gap-3 rounded-3xl border border-line bg-white p-5" style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1 text-xs font-bold uppercase tracking-eyebrow text-cobalt">{library.categories.find(c => c.id === item.primary_category)?.name}</Text>
          </View>
          <Text accessibilityRole="header" className="text-xl font-bold text-deep-blue">{item.name}</Text>
          <Text className="text-base leading-6 text-slate">{item.summary}</Text>
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="text-sm text-slate">{item.position.replaceAll('_', ' ')}{item.equipment.length ? ` · ${item.equipment.join(', ')}` : ''}</Text>
            <Text className="font-bold text-cobalt">View movement →</Text>
          </View>
        </Pressable>
      )}
    />
  );
}
