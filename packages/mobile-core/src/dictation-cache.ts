import { Directory, File, Paths } from "expo-file-system";
import { isDictationRecording } from "./chat";

export function clearDictationRecordings(keepUri?: string | null) {
  // Expo uses ExpoAudio on iOS and Audio on Android. Only remove files marked as our dictation.
  for (const name of ["ExpoAudio", "Audio"]) {
    const directory = new Directory(Paths.cache, name);
    if (!directory.exists) continue;
    for (const entry of directory.list()) {
      if (
        entry instanceof File &&
        entry.uri !== keepUri &&
        isDictationRecording(entry.name)
      )
        entry.delete();
    }
  }
}

export function deleteDictationRecording(uri: string | null | undefined) {
  if (!uri) return;
  const file = new File(uri);
  if (file.exists && isDictationRecording(file.name)) file.delete();
}
