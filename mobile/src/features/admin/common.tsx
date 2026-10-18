/**
 * The pieces the admin roster screens share — a search box, a record field, a record header,
 * and the styles under them. Pulled out because Maits, MPPs and Non-members are the same screen
 * with a different query behind it: search a list, open a row, read it back.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

/** Wait for the typing to settle before the query fires — one lookup, not one per keystroke. */
export function useDebounced(value: string, ms = 350): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function SearchBar({
  value,
  onChange,
  placeholder,
  testID,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={adminStyles.searchBar}>
      <Ionicons name="search" size={16} color={colors.textMuted} />
      <TextInput
        style={adminStyles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textDisabled}
        autoCorrect={false}
        testID={testID}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChange('')} hitSlop={8}>
          <Ionicons name="close-circle" size={16} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

export function Field({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}): React.JSX.Element | null {
  if (value === null || value === undefined || value === '') {return null;}
  return (
    <View style={adminStyles.field}>
      <Text style={adminStyles.fieldLabel}>{label}</Text>
      <Text style={adminStyles.fieldValue}>{value}</Text>
    </View>
  );
}

export function RecordHead({
  title,
  onBack,
  testID,
}: {
  title: string;
  onBack: () => void;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={adminStyles.recordHead}>
      <Pressable onPress={onBack} hitSlop={8} style={adminStyles.recordBack} testID={testID}>
        <Ionicons name="arrow-back" size={20} color={colors.ink} />
      </Pressable>
      <Text style={adminStyles.recordTitle} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

export const adminStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginTop: spacing[3],
    marginBottom: spacing[3],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },

  body: { padding: spacing[4], paddingTop: 0, gap: spacing[3] },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.background },
  rowChip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoWash,
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: { ...typography.h3, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted },

  recordHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  recordBack: { padding: spacing[1] },
  recordTitle: { ...typography.h3, color: colors.ink, flex: 1 },

  field: { paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.border },
  fieldLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 2 },
  fieldValue: { ...typography.body, color: colors.ink },

  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: 2,
  },
  pillLabel: { ...typography.caption, fontSize: 11 },
});
