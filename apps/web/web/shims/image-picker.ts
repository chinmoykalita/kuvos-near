// Wraps the real web picker so chosen photos are readable through the File shim.
import * as Picker from 'expo-image-picker';
import { registerBlobFile } from './file-system';

export type { ImagePickerAsset, ImagePickerOptions, ImagePickerResult } from 'expo-image-picker';

async function register(result: Picker.ImagePickerResult) {
  if (!result.canceled) {
    for (const asset of result.assets) {
      const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
      registerBlobFile(asset.uri, new Uint8Array(await blob.arrayBuffer()));
    }
  }
  return result;
}

// The browser's own file and camera prompts handle consent.
const granted = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' } as const;
export async function requestCameraPermissionsAsync() { return granted as Picker.CameraPermissionResponse; }
export async function requestMediaLibraryPermissionsAsync() { return granted as Picker.MediaLibraryPermissionResponse; }

export async function launchCameraAsync(options?: Picker.ImagePickerOptions) {
  return register(await Picker.launchCameraAsync(options));
}

export async function launchImageLibraryAsync(options?: Picker.ImagePickerOptions) {
  return register(await Picker.launchImageLibraryAsync(options));
}
