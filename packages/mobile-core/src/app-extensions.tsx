import { createContext, useContext, type ComponentType, type ReactNode, type PropsWithChildren } from 'react';
import type { OccurrenceAction, SkipReason, Today } from './api';

export type Occurrence = NonNullable<Today['occurrences']>[number];

// Distribution-specific features are supplied by the app; care code never imports them.
export type AppExtensions = {
  CareProvider?: ComponentType<PropsWithChildren>;
  logActivity?: (occurrence: Occurrence, action: OccurrenceAction, reason?: SkipReason) => Promise<(() => Promise<string | undefined>) | undefined>;
  // An optional screen shown after a plan is confirmed (instead of going straight to Today).
  afterPlanConfirm?: (planId: string) => Promise<string | undefined>;
  alternativeSignIn?: { label: string; connect: () => Promise<unknown> };
  accountAction?: ReactNode;
  moreContent?: ReactNode;
  todaySummary?: ReactNode;
  todayActions?: ReactNode;
  TodayTask?: ComponentType<{ occurrence: Occurrence }>;
  rhythmContent?: ReactNode;
  rhythmAction?: ReactNode;
  skipExplanation?: string;
};

const AppExtensionsContext = createContext<AppExtensions>({});
export const AppExtensionsProvider = AppExtensionsContext.Provider;
export const useAppExtensions = () => useContext(AppExtensionsContext);
