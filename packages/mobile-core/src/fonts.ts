import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Lora_400Regular, Lora_400Regular_Italic } from '@expo-google-fonts/lora';
import { Kalam_300Light } from '@expo-google-fonts/kalam';
export function useAppFonts() {
  return useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Lora_400Regular, Lora_400Regular_Italic, Kalam_300Light });
}
