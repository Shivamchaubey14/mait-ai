/**
 * Audit log, for an admin — who did what, in the platform's own words (the portal's W-logs).
 *
 * The trail a dispute or a question of "who changed this" is settled from: every entry a readable
 * sentence rather than a raw diff, with who did it and when. Searchable, newest first. Read-only
 * by nature — the log is the one thing that must not be editable.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAdminAuditTrailQuery } from '@api/endpoints';
import type { AuditEntry } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, ink, radius, spacing, typography, yolk } from '@theme/tokens';

import { SearchBar, adminStyles, useDebounced } from './common';

function toneOf(tone: string | null): { wash: string; tint: string } {
  if (tone === 'danger' || tone === 'error') {return { wash: colors.errorWash, tint: colors.error };}
  if (tone === 'warning') {return { wash: colors.secondaryWash, tint: yolk[800] };}
  if (tone === 'success' || tone === 'good') {return { wash: colors.primaryWash, tint: colors.primaryDark };}
  return { wash: ink[50], tint: ink[500] };
}

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Entry({ entry }: { entry: AuditEntry }): React.JSX.Element {
  const look = toneOf(entry.tone);
  return (
    <View style={styles.entry} testID={`admin-audit-${entry.id}`}>
      <View style={[styles.actionPill, { backgroundColor: look.wash }]}>
        <Text style={[styles.actionLabel, { color: look.tint }]}>{entry.action_label}</Text>
      </View>
      <Text style={styles.summary}>{entry.summary}</Text>
      <Text style={styles.meta} numberOfLines={1}>
        {[entry.actor?.name, entry.entity_label, when(entry.when)].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

export default function AdminAuditScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());

  const data = useAdminAuditTrailQuery({ search });
  const rows = data.data?.results ?? [];

  return (
    <View style={adminStyles.root}>
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder={t('admin.audit.searchPlaceholder')}
        testID="admin-audit-search"
      />
      <ScrollView contentContainerStyle={adminStyles.body}>
        {data.isLoading ? (
          <Loading />
        ) : data.isError ? (
          <EmptyState message={t('admin.audit.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={search ? t('admin.audit.noneFound', { query: search }) : t('admin.audit.none')} />
        ) : (
          rows.map(entry => <Entry key={entry.id} entry={entry} />)
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  entry: {
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[1],
  },
  actionPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  actionLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  summary: { ...typography.body, color: colors.ink },
  meta: { ...typography.caption, color: colors.textMuted },
});
