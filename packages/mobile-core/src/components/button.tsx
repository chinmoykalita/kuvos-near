import { ActivityIndicator, Pressable, type PressableProps } from 'react-native';

import { Text } from './text';
import { colors } from '../theme';

const variants = {
  primary: { container: 'bg-deep-blue', label: 'text-white', spinner: colors.white },
  secondary: {
    container: 'border border-line bg-white',
    label: 'text-deep-blue',
    spinner: colors.cobalt,
  },
  quiet: { container: 'bg-ice', label: 'text-deep-blue', spinner: colors.deepBlue },
  danger: {
    container: 'border border-coral bg-white',
    label: 'text-coral',
    spinner: colors.coral,
  },
} as const;

const sizes = {
  default: 'min-h-[52px] rounded-2xl px-5',
  hero: 'min-h-[72px] rounded-full px-6',
  compact: 'min-h-12 rounded-full px-5',
} as const;

export function Button({
  title,
  variant = 'primary',
  size = 'default',
  loading = false,
  disabled,
  className = '',
  ...props
}: PressableProps & {
  title: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  className?: string;
}) {
  const styles = variants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      className={`${sizes[size]} items-center justify-center ${styles.container} ${className}`}
      disabled={disabled || loading}
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.72 : 1 })}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={styles.spinner} />
      ) : (
        <Text
          className={`${size === 'compact' ? 'text-base' : 'text-lg'} font-bold ${styles.label}`}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
