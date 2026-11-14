import { type Href, usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Me } from '@kuvos/mobile-core/api';
import { assistantName } from '@kuvos/mobile-core/chat';
import { BrandLogo } from '@kuvos/mobile-core/components/brand-logo';
import { TabIcon } from '@kuvos/mobile-core/components/tab-icon';
import { Text } from '@kuvos/mobile-core/components/text';
import { logoWordmark } from '@kuvos/mobile-core/config';
import { colors } from '@kuvos/mobile-core/theme';
import { SIDEBAR_WIDTH } from './layout';

type Section = 'today' | 'rhythm' | 'chat' | 'plan' | 'circle' | 'near' | 'more';

// Same destinations and order as the bottom tab bar (Fitness is iOS-only and never shown here).
function items(role: 'PATIENT' | 'CAREGIVER'): { section: Section; label: string; href: Href }[] {
  return [
    { section: 'today', label: 'Today', href: '/today' },
    { section: 'rhythm', label: 'Rhythm', href: '/rhythm' },
    { section: 'chat', label: assistantName, href: '/chat' },
    { section: 'plan', label: 'Plan', href: '/plan' },
    ...(role === 'CAREGIVER' ? [{ section: 'circle' as const, label: 'Home', href: '/circle' as Href }] : []),
    { section: 'near', label: 'Proofs', href: '/near' },
    { section: 'more', label: 'More', href: '/more' },
  ];
}

// Detail screens keep the tab they were opened from highlighted.
function sectionFor(path: string): Section | undefined {
  if (/^\/(today|task)\b/.test(path)) return 'today';
  if (path.startsWith('/rhythm')) return 'rhythm';
  if (path.startsWith('/chat')) return 'chat';
  if (/^\/(plan|upload|extraction|review|preview|source)\b/.test(path)) return 'plan';
  if (path.startsWith('/circle')) return 'circle';
  if (path.startsWith('/near') || path.startsWith('/proofs')) return 'near';
  if (/^\/(more|physio)\b/.test(path)) return 'more';
  return undefined;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '·';
}

function NavItem({ active, label, section, onPress }: { active: boolean; label: string; section: Section; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      aria-current={active ? 'page' : undefined}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      className="h-12 flex-row items-center gap-3 rounded-2xl px-3"
      style={{ backgroundColor: active ? colors.white : hovered ? 'rgba(12, 28, 51, 0.05)' : 'transparent', boxShadow: active ? '0 1px 2px rgba(12, 28, 51, 0.08), 0 0 0 1px rgba(12, 28, 51, 0.06)' : undefined }}
    >
      {section === 'near' ? (
        <Text style={{ width: 24, textAlign: 'center', fontSize: 18, color: active ? colors.deepBlue : colors.slate }}>⋈</Text>
      ) : (
        <TabIcon color={active ? colors.deepBlue : colors.slate} focused={active} name={section} />
      )}
      <Text className={`text-base ${active ? 'font-bold text-deep-blue' : 'font-medium text-slate'}`}>{label}</Text>
    </Pressable>
  );
}

export function Sidebar({ me }: { me: Me }) {
  const router = useRouter();
  const pathname = usePathname();
  const membership = me.memberships[0];
  const active = sectionFor(pathname);
  if (!membership) return null;
  const caregiver = membership.role === 'CAREGIVER';

  return (
    <View
      role="navigation"
      className="border-r border-line px-4 pb-5 pt-6"
      style={{ width: SIDEBAR_WIDTH, backgroundColor: '#ECEFF5' }}
    >
      <Pressable accessibilityRole="link" accessibilityLabel="Today" onPress={() => router.navigate('/today')} className="flex-row items-center gap-2.5 px-2" style={{ marginBottom: 32 }}>
        <BrandLogo size={34} />
        <Text className="text-brand font-extrabold tracking-tight text-deep-blue">{logoWordmark}</Text>
      </Pressable>
      <View className="gap-1">
        {items(membership.role).map((item) => (
          <NavItem
            key={item.section}
            active={active === item.section}
            label={item.label}
            section={item.section}
            onPress={() => router.navigate(item.href)}
          />
        ))}
      </View>
      <View className="mt-auto flex-row items-center gap-3 rounded-2xl bg-white p-3" style={{ boxShadow: '0 0 0 1px rgba(12, 28, 51, 0.06)' }}>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-cobalt/10">
          <Text className="text-sm font-bold text-cobalt">{initials(me.user.name)}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-sm font-bold text-deep-blue">{me.user.name}</Text>
          <Text numberOfLines={1} className="text-xs text-slate">
            {caregiver ? `Caring for ${membership.patient.name}` : 'Patient'}
          </Text>
        </View>
      </View>
    </View>
  );
}
