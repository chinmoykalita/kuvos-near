import { BadRequestException } from '@nestjs/common';
import { physioCatalogue } from './physio-catalogue';

export type PhysioSelection = {
  exercise_id: string;
  origin: 'document_match' | 'reviewer_added';
  selected_by: string;
  library_version: string;
  dosage?: string;
  instruction_snapshot: string;
};

export function reviewPhysio(
  value: unknown,
  userId: string,
  added: boolean,
): PhysioSelection | undefined {
  if (value === undefined || value === null) {
    if (added)
      throw new BadRequestException('Choose an exercise for the added item.');
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid exercise selection.');
  const input = value as Record<string, unknown>;
  const exercise = physioCatalogue.exercises.find(
    (e) => e.id === input.exercise_id,
  );
  if (!exercise)
    throw new BadRequestException('This exercise is not in the library.');
  const dosage = typeof input.dosage === 'string' ? input.dosage.trim() : '';
  if (added && (!dosage || dosage.length > 500))
    throw new BadRequestException(
      'Enter exercise repetitions, holds or session duration (up to 500 characters).',
    );
  return {
    exercise_id: exercise.id,
    origin: added ? 'reviewer_added' : 'document_match',
    selected_by: userId,
    library_version: physioCatalogue.version,
    ...(added ? { dosage } : {}),
    instruction_snapshot: [
      exercise.name,
      exercise.form.start,
      ...exercise.form.cues,
      exercise.form.breathe,
      ...exercise.precautions,
    ].join('\n'),
  };
}

export function checkReviewMembership(
  candidates: { candidate_id: string }[],
  originalIds: string[],
) {
  const originals = new Set(originalIds);
  const ids = new Set(candidates.map((c) => c.candidate_id));
  if (
    ids.size !== candidates.length ||
    !originalIds.every((id) => ids.has(id)) ||
    candidates.some(
      (c) =>
        !originals.has(c.candidate_id) &&
        !/^library:[a-z0-9-]+$/.test(c.candidate_id),
    ) ||
    candidates.length > originalIds.length + physioCatalogue.exercises.length
  ) {
    throw new BadRequestException(
      'Review candidates do not match the extraction.',
    );
  }
}
