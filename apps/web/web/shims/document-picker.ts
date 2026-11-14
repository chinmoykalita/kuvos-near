// Wraps the real web picker so chosen files are readable through the File shim.
import * as Picker from 'expo-document-picker';
import { registerBlobFile } from './file-system';

export type { DocumentPickerAsset, DocumentPickerOptions, DocumentPickerResult } from 'expo-document-picker';

export async function getDocumentAsync(options?: Picker.DocumentPickerOptions) {
  const result = await Picker.getDocumentAsync({ ...options, base64: false });
  if (!result.canceled) {
    for (const asset of result.assets) {
      if (asset.file) registerBlobFile(asset.uri, new Uint8Array(await asset.file.arrayBuffer()));
    }
  }
  return result;
}
