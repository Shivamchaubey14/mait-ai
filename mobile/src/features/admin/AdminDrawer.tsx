/**
 * The admin drawer — the portal's aside, slid out from the hamburger.
 *
 * A scrollable card of every section the portal has, in the portal's own order, so an admin who
 * knows the browser finds the same list in the same place. The section they are on is lit; the
 * ones without a handset screen yet are muted and carry a "soon" chip, so the whole surface is
 * visible and nothing looks broken — tapping one says it is on the way rather than failing.
 *
 * A Modal rather than an in-tree overlay: it sits above everything including the header, takes
 * the back gesture itself (`onRequestClose`), and traps the backdrop tap to dismiss. The panel
 * holds the top and bottom safe areas so the first row and the sign-out are both reachable.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { SignOutButton } from '@/components';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { ADMIN_SECTIONS } from './sections';

export default function AdminDrawer({
  visible,
  activeKey,
  name,
  roleLabel,
  onSelect,
  onClose,
  onSignOut,
}: {
  visible: boolean;
  activeKey: string;
  name: string;
  roleLabel: string;
  onSelect: (key: string) => void;
  onClose: () => void;
  onSignOut: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="admin-drawer-backdrop" />
      <View style={[styles.panel, { paddingTop: insets.top + spacing[3] }]} testID="admin-drawer">
        <View style={styles.head}>
          <View style={styles.headMark}>
            <Ionicons name="briefcase" size={18} color={colors.surface} />
          </View>
          <View style={styles.headBody}>
            <Text style={styles.headName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.headRole} numberOfLines={1}>
              {roleLabel}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} testID="admin-drawer-close">
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={{ paddingBottom: spacing[3] }}
          showsVerticalScrollIndicator={false}
        >
          {ADMIN_SECTIONS.map(section => {
            const active = section.key === activeKey;
            return (
              <Pressable
                key={section.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(section.key)}
                style={({ pressed }) => [
                  styles.link,
                  active && styles.linkActive,
                  pressed && !active && styles.linkPressed,
                ]}
                testID={`admin-drawer-${section.key}`}
              >
                <Ionicons
                  name={section.icon}
                  size={18}
                  color={active ? colors.primaryDark : section.built ? colors.ink : colors.textMuted}
                />
                <Text
                  style={[
                    styles.linkLabel,
                    active && styles.linkLabelActive,
                    !section.built && !active && styles.linkLabelSoon,
                  ]}
                  numberOfLines={1}
                >
                  {section.label}
                </Text>
                {!section.built && (
                  <View style={styles.soon}>
                    <Text style={styles.soonLabel}>{t('admin.soon')}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={[styles.foot, { paddingBottom: insets.bottom + spacing[3] }]}>
          <SignOutButton label={t('settings.signOut')} onPress={onSignOut} testID="admin-sign-out" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,30,40,0.45)' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '84%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headMark: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  headBody: { flex: 1 },
  headName: { ...typography.h3, color: colors.ink },
  headRole: { ...typography.caption, color: colors.textMuted, marginTop: 1 },

  list: { flex: 1, paddingHorizontal: spacing[2], paddingTop: spacing[2] },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
  },
  linkActive: { backgroundColor: colors.primaryWash },
  linkPressed: { backgroundColor: colors.background },
  linkLabel: { ...typography.body, color: colors.ink, flex: 1 },
  linkLabelActive: { color: colors.primaryDark, fontFamily: typography.label.fontFamily },
  linkLabelSoon: { color: colors.textMuted },
  soon: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: ink[50],
  },
  soonLabel: { ...typography.caption, fontSize: 10, color: colors.textMuted },

  foot: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
