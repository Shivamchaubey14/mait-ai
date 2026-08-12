/**
 * The four places a Mait goes.
 *
 * Destinations only. The screen's action — "Start new AI", "Request stock" — used to float
 * above this bar as a pill; it now lives in the screen it belongs to, at the foot of that
 * screen's content. A control that changes its job depending on which tab is open, while
 * sitting in the furniture that never changes, is the one thing on screen that cannot be
 * learned once.
 *
 * The selected tab is a filled glyph and a green label; the rest are outlines in grey. The
 * shape carries it as well as the colour, because colour alone does not survive sunlight on a
 * cheap screen, which is where this is used.
 *
 * Hidden entirely during the capture flow: that flow is one task with one forward path, and a
 * tab bar under it is an invitation to leave halfway, with an animal served, a straw scanned
 * and nothing recorded.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

/**
 * The keys are the app's own names for these screens; the labels a Mait reads come from
 * `nav.*` in the translations — "stock" is shown as Inventory, "history" as AI events, and
 * "settings" as Profile.
 */
export type Tab = 'home' | 'stock' | 'history' | 'settings';

const TABS: {
  key: Tab;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { key: 'home', icon: 'home-outline', activeIcon: 'home' },
  { key: 'stock', icon: 'cube-outline', activeIcon: 'cube' },
  { key: 'history', icon: 'document-text-outline', activeIcon: 'document-text' },
  { key: 'settings', icon: 'person-outline', activeIcon: 'person' },
];

export default function BottomNav({
  active,
  onChange,
  /** Unsent records. Rides on AI events, which is where they are waiting. */
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
      {TABS.map(({ key, icon, activeIcon }) => {
        const isActive = key === active;
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
            <View>
              <Ionicons
                name={isActive ? activeIcon : icon}
                size={22}
                color={isActive ? colors.primary : colors.textMuted}
              />

              {/* On AI events rather than Home: the count is of records waiting to sync, and
                  that is the screen a Mait goes to when they want to look at them. */}
              {key === 'history' && pending > 0 && (
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
  // Flat and full width, welded to the bottom edge. It is chrome, and chrome that floats
  // takes up room the content below it could have used.
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: spacing[3],
    paddingHorizontal: spacing[2],
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
  label: { ...typography.caption, color: colors.textMuted },
  labelActive: {
    color: colors.primary,
    fontFamily: typography.bodyStrong.fontFamily,
  },

  badge: {
    position: 'absolute',
    top: -6,
    left: 12,
    minWidth: 18,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.secondary,
    alignItems: 'center',
  },
  badgeLabel: { ...typography.caption, fontSize: 10, color: colors.ink },
});
