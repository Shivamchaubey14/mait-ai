/**
 * The admin app's sections, down the left edge of every screen — the portal's aside on a phone.
 *
 * It replaces a drawer behind a menu button. A drawer hid every section until it was opened,
 * so moving between two of them was always three taps, and an office user who knows the portal
 * looked for the sidebar they know and found a button instead. The rail is always there: the
 * logo at the top, each section as an icon with its name, the one open lit in green, and
 * signing out at the foot.
 *
 * Narrow on purpose. Every point it takes comes off the screen beside it, so a section is an
 * icon over a short name, and a Hindi name wraps or shrinks under its icon rather than
 * widening the rail.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import AppText from '@/components/AppText';
import { BrandLogo } from '@/components/brand';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { ADMIN_SECTIONS, sectionName } from './sections';

/** How wide the rail is. Wide enough for an icon over two short lines, and no wider. */
export const RAIL_WIDTH = 84;

export default function AdminRail({
  activeKey,
  onSelect,
  onSignOut,
}: {
  activeKey: string;
  onSelect: (key: string) => void;
  onSignOut: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.rail, { paddingTop: insets.top + spacing[2] }]} testID="admin-rail">
      <View style={styles.brand}>
        <BrandLogo size={40} />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {ADMIN_SECTIONS.map(section => {
          const active = section.key === activeKey;
          return (
            <Pressable
              key={section.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={sectionName(t, section)}
              onPress={() => onSelect(section.key)}
              style={({ pressed }) => [
                styles.item,
                active && styles.itemActive,
                pressed && !active && styles.itemPressed,
              ]}
              testID={`admin-rail-${section.key}`}
            >
              <Ionicons
                name={section.icon}
                size={20}
                color={active ? colors.surface : 'rgba(255,255,255,0.72)'}
              />
              <AppText style={[styles.label, active && styles.labelActive]} numberOfLines={2}>
                {sectionName(t, section)}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        onPress={onSignOut}
        style={({ pressed }) => [
          styles.item,
          styles.signOut,
          { paddingBottom: spacing[3] + insets.bottom },
          pressed && styles.signOutPressed,
        ]}
        testID="admin-sign-out"
      >
        <Ionicons name="log-out-outline" size={20} color={colors.surface} />
        <AppText style={[styles.label, styles.labelActive]} numberOfLines={2}>
          {t('settings.signOut')}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  rail: {
    width: RAIL_WIDTH,
    backgroundColor: colors.ink,
  },
  brand: { alignItems: 'center', paddingBottom: spacing[3] },
  list: { gap: 2, paddingHorizontal: spacing[1], paddingBottom: spacing[2] },
  item: {
    alignItems: 'center',
    gap: 3,
    paddingVertical: spacing[2],
    paddingHorizontal: 2,
    borderRadius: radius.md,
  },
  itemActive: { backgroundColor: colors.primary },
  itemPressed: { backgroundColor: 'rgba(255,255,255,0.12)' },
  label: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 13,
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  labelActive: { color: colors.surface, fontFamily: typography.label.fontFamily },
  // Red, square and the rail's full width, down to the bottom of the screen: leaving is not
  // another section.
  signOut: {
    paddingTop: spacing[3],
    backgroundColor: colors.error,
    borderRadius: 0,
  },
  signOutPressed: { opacity: 0.85 },
});
