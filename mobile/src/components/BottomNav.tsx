/**
 * The four places a Mait goes, and the one thing the screen they are on can do.
 *
 * The action is not a tab. It is drawn as a labelled pill above the bar rather than as a
 * destination in the row, and its label follows the screen: start a capture from Home, ask
 * for stock from Stock. One control that says what it does beats a bare "+" the Mait has to
 * learn.
 *
 * The selected tab is shown by a wash pill behind the icon and label together. Colour alone
 * would not survive sunlight on a cheap screen, which is where this is used.
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

import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

/** `newAi` is an action rather than a destination — it never becomes the active tab. */
export type Tab = 'home' | 'stock' | 'history' | 'profile';

const TABS: {
  key: Tab;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { key: 'home', icon: 'home-outline', activeIcon: 'home' },
  { key: 'stock', icon: 'layers-outline', activeIcon: 'layers' },
  { key: 'history', icon: 'time-outline', activeIcon: 'time' },
  { key: 'profile', icon: 'person-outline', activeIcon: 'person' },
];

export default function BottomNav({
  active,
  onChange,
  action,
  /** Unsent records. Rides on Home, so the count is visible from any tab. */
  pending = 0,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  /** The one thing this screen does. Absent, the bar shows tabs alone. */
  action?: { label: string; onPress: () => void; testID?: string };
  pending?: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom + spacing[3] }]}>
      {!!action && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          testID={action.testID ?? 'bar-action'}
        >
          <Text style={styles.actionLabel}>{action.label}</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.surface} />
        </Pressable>
      )}

      <View style={styles.bar}>
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
              <View style={[styles.pill, isActive && styles.pillActive]}>
                <Ionicons
                  name={isActive ? activeIcon : icon}
                  size={20}
                  color={isActive ? colors.primaryDark : colors.textMuted}
                />
                <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
                  {t(`nav.${key}`)}
                </Text>

                {key === 'home' && pending > 0 && (
                  <View style={styles.badge} testID="nav-pending">
                    <Text style={styles.badgeLabel}>{pending > 9 ? '9+' : pending}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The bar floats: lifted off the bottom edge so an old Android handset's hardware buttons
  // do not sit against it, and inset from the sides so it reads as a card rather than a
  // chrome strip welded to the screen.
  wrap: {
    paddingHorizontal: spacing[4],
    alignItems: 'stretch',
  },

  // Full width above the bar, labelled and arrowed. It is the screen's one action, so it is
  // sized like one rather than hidden behind a glyph.
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 4,
    marginBottom: spacing[3],
    paddingHorizontal: spacing[5],
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
    ...shadows.raised,
  },
  actionPressed: { backgroundColor: colors.primaryPressed },
  actionLabel: { ...typography.bodyStrong, color: colors.surface },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
    paddingHorizontal: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  tab: { flex: 1, alignItems: 'center', minHeight: MIN_TOUCH_TARGET },

  // Icon over label on a rounded-rect wash, so the selected tab is a shape rather than a
  // shade. Side by side the wash stretched into a wide bar that read as a rectangle.
  pill: {
    alignItems: 'center',
    gap: spacing[1],
    minWidth: 56,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
  },
  pillActive: { backgroundColor: colors.primaryWash },

  label: { ...typography.caption, color: colors.textMuted },
  labelActive: {
    color: colors.primaryDark,
    fontFamily: typography.bodyStrong.fontFamily,
  },

  badge: {
    position: 'absolute',
    top: 2,
    right: spacing[3],
    minWidth: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.secondary,
    alignItems: 'center',
  },
  badgeLabel: { ...typography.caption, fontSize: 10, color: colors.ink },
});
