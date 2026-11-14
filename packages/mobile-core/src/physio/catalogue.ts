import library from './library.json';

export type Exercise = (typeof library.exercises)[number];
export { library };

export function findExercises(query: string, category: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return library.exercises.filter(exercise => {
    const text = [exercise.name, exercise.summary, ...exercise.aliases, ...exercise.equipment].join(' ').toLowerCase();
    return (!category || exercise.categories.includes(category)) && terms.every(term => text.includes(term));
  });
}

export function suggestedExercises(instruction: string) {
  const text = ` ${instruction.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const named = library.exercises.filter(exercise => [exercise.name, ...exercise.aliases].some(name => {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return normalized.length > 2 && text.includes(` ${normalized} `);
  }));
  if (named.length) return { exercises: named, reason: 'Possible name matches — check the movement and variation.' };
  const bodyWords = ['knee', 'ankle', 'foot', 'hip', 'glutes', 'shoulder', 'neck', 'back', 'core', 'breathing', 'balance', 'posture'];
  const categories = library.categories.filter(category => text.includes(` ${category.name.toLowerCase()} `) ||
    bodyWords.some(word => category.id.split('_').includes(word) && text.includes(` ${word} `)));
  const tags = library.tags.filter(tag => text.includes(` ${tag.name.toLowerCase()} `));
  return {
    exercises: categories.length || tags.length ? library.exercises.filter(exercise =>
      (!categories.length || categories.some(category => exercise.categories.includes(category.id))) &&
      (!tags.length || tags.some(tag => exercise.tags.includes(tag.id)))) : [],
    reason: 'Related to the area or goal mentioned — choose only the exercises you intend to add.',
  };
}
