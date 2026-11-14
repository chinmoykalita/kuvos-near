// Save care and update its UI before optional distribution-specific follow-up work.
export async function saveActivity(
  write: () => Promise<(() => Promise<string | undefined>) | undefined>,
  onSaved: () => void,
) {
  const afterSaved = await write();
  onSaved();
  try {
    return await afterSaved?.();
  } catch {
    return 'Activity saved. Additional confirmation could not be completed.';
  }
}
