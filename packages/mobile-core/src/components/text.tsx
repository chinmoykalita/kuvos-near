import { forwardRef } from 'react';
import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

export function Text({ className, ...props }: TextProps & { className?: string }) {
  const handwritten = className?.includes('font-hand') || className?.includes('font-serif');
  return (
    <RNText
      className={`${handwritten ? '' : 'font-sans'} ${className ?? ''}`}
      {...props}
    />
  );
}

export const TextInput = forwardRef<RNTextInput, TextInputProps & { className?: string }>(
  function TextInput({ className, ...props }, ref) {
    return <RNTextInput ref={ref} className={`font-sans ${className ?? ''}`} {...props} />;
  },
);
