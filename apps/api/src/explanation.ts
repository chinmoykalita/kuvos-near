import { BadRequestException } from '@nestjs/common';

export function reviewExplanation(submitted: unknown, original: unknown) {
  const source =
    original && typeof original === 'object' && !Array.isArray(original)
      ? (original as Record<string, unknown>)
      : {};
  const originalText = typeof source.text === 'string' ? source.text : '';
  let text = originalText;
  if (submitted !== undefined) {
    if (
      !submitted ||
      typeof submitted !== 'object' ||
      Array.isArray(submitted)
    ) {
      throw new BadRequestException('Invalid explanation.');
    }
    const value = (submitted as Record<string, unknown>).text;
    if (typeof value !== 'string' || value.length > 1200) {
      throw new BadRequestException(
        'Explanation must be text of at most 1200 characters.',
      );
    }
    text = value.trim();
  }
  return {
    text,
    sources: Array.isArray(source.sources) ? source.sources : [],
    original_text: originalText,
    reviewer_edited: text !== originalText,
  };
}
