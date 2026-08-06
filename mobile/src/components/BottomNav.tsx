/**
 * The four places a Mait goes.
 *
 * Deliberately not shown during the six-step capture flow. That flow is one task with one
 * forward path, and a tab bar under it is an invitation to leave halfway — with an animal
 * served, a straw scanned, and nothing recorded.
 *
 * "New AI" is the middle tab and the only green one. It is the job; everything else on this
 * bar is something you check between jobs.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

export type Tab = 'home' | 'newAi' | 'stock' | 'profile';

const TABS: { key: Tab; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'home', icon: 'home-outline' },
  { key: 'newAi', icon: 'add-circle' },
  { key: 'stock', icon: 'layers-outline' },
  { key: 'profile', icon: 'person-outline' },
];

export default function BottomNav({
  active,
  onChange,
  /** Unsent records, shown on Home so the count is visible from wherever they are. */
  pending = 0,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  pending?: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + spacing[2] }]}>
      {TABS.map(({ key, icon }) => {
        const isActive = key === active;
        const isPrimary = key === 'newAi';

        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={t(`nav.${key}`)}
            onPress={() => onChange(key)}
            style={styles.tab}
            testID={`tab-${key}`}
          >
            <View style={[styles.iconWrap, isPrimary && styles.iconWrapPrimary]}>
              <Ionicons
                name={icon}
                size={isPrimary ? 26 : 22}
                color={
                  isPrimary ? colors.surface : isActive ? colors.primaryDark : colors.textMuted
                }
              />
              {key === 'home' && pending > 0 && (
                <View style={styles.badge} testID="nav-pending">
                  <Text style={styles.badgeLabel}>{pending > 9 ? '9+' : pending}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
              {t(`nav.${key}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: spacing[2],
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: spacing[1],
    minHeight: MIN_TOUCH_TARGET,
  },
  iconWrap: {
    width: 44,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapPrimary: {
    width: 52,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  label: { ...typography.caption, color: colors.textMuted },
  labelActive: { color: colors.primaryDark, fontFamily: typography.bodyStrong.fontFamily },

  // Unsent work is the one thing worth interrupting a glance for.
  badge: {
    position: 'absolute',
    top: -2,
    right: 4,
    minWidth: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.secondary,
    alignItems: 'center',
  },
  badgeLabel: { ...typography.caption, fontSize: 10, color: colors.ink },
});
