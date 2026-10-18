/**
 * SAP upload, for an admin — the import history (the portal's Uploads screen), read-only.
 *
 * The masters are 100k+ rows and arrive as .xlsx from SAP; uploading one belongs at a desk, not
 * on a phone balanced in one hand. What a field account actually opens the app for is the other
 * half: did last night's Member Master land, is the one running now nearly done, and did it
 * reject any rows. So this screen is the status board — newest first, each job with its tally
 * and a live bar while it runs — and it says plainly that the file itself is uploaded on the
 * portal, so nobody hunts for an upload button that is deliberately not here.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminUploadHistoryQuery } from '@api/endpoints';
import type { UploadJob } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, ink, radius, spacing, typography, yolk } from '@theme/tokens';

import { adminStyles } from './common';

const PENDING = { wash: ink[50], tint: ink[500], icon: 'time' };
const LOOK: Record<string, { wash: string; tint: string; icon: string }> = {
  completed: { wash: colors.primaryWash, tint: colors.primaryDark, icon: 'checkmark-circle' },
  completed_with_errors: { wash: colors.secondaryWash, tint: yolk[800], icon: 'alert-circle' },
  failed: { wash: colors.errorWash, tint: colors.error, icon: 'close-circle' },
  processing: { wash: colors.infoWash, tint: colors.info, icon: 'sync' },
  pending: PENDING,
};

function look(status: string): { wash: string; tint: string; icon: string } {
  return LOOK[status] ?? PENDING;
}

function when(iso: string | null): string {
  if (!iso) {return '—';}
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Job({ job }: { job: UploadJob }): React.JSX.Element {
  const { t } = useTranslation();
  const l = look(job.status);
  const running = job.status === 'processing' || job.status === 'pending';

  return (
    <View style={styles.card} testID={`admin-upload-${job.id}`}>
      <View style={styles.head}>
        <View style={[styles.mark, { backgroundColor: l.wash }]}>
          <Ionicons name={l.icon as never} size={18} color={l.tint} />
        </View>
        <View style={styles.headBody}>
          <Text style={styles.type} numberOfLines={1}>
            {job.upload_type_display}
          </Text>
          <Text style={styles.file} numberOfLines={1}>
            {job.file_name}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: l.wash }]}>
          <Text style={[styles.pillLabel, { color: l.tint }]}>{job.status_display}</Text>
        </View>
      </View>

      {running && (
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.min(100, Math.max(2, job.progress_percent))}%` }]} />
        </View>
      )}

      <View style={styles.tallies}>
        <Tally label={t('admin.uploads.rows')} value={job.total_rows} />
        <Tally label={t('admin.uploads.saved')} value={job.success_rows} tint={colors.primaryDark} />
        {job.skipped_rows > 0 && <Tally label={t('admin.uploads.skipped')} value={job.skipped_rows} />}
        {job.error_count > 0 && (
          <Tally label={t('admin.uploads.rejected')} value={job.error_count} tint={colors.error} />
        )}
      </View>

      <Text style={styles.meta} numberOfLines={1}>
        {[job.uploaded_by_name, when(job.finished_at ?? job.created_at)].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

function Tally({ label, value, tint }: { label: string; value: number; tint?: string }): React.JSX.Element {
  return (
    <View style={styles.tally}>
      <Text style={[styles.tallyValue, tint ? { color: tint } : null]}>{value.toLocaleString('en-IN')}</Text>
      <Text style={styles.tallyLabel}>{label}</Text>
    </View>
  );
}

export default function AdminUploadsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const data = useAdminUploadHistoryQuery();
  const rows = data.data?.results ?? [];

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={adminStyles.body}>
        <View style={styles.note}>
          <Ionicons name="desktop-outline" size={16} color={colors.info} />
          <Text style={styles.noteText}>{t('admin.uploads.deskNote')}</Text>
        </View>

        {data.isLoading ? (
          <Loading />
        ) : data.isError ? (
          <EmptyState message={t('admin.uploads.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.uploads.none')} />
        ) : (
          rows.map(job => <Job key={job.id} job={job} />)
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.infoWash,
  },
  noteText: { ...typography.caption, color: colors.info, flex: 1 },

  card: {
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[3],
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  mark: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  headBody: { flex: 1 },
  type: { ...typography.h3, color: colors.ink },
  file: { ...typography.caption, color: colors.textMuted },
  pill: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radius.pill },
  pillLabel: { ...typography.caption, fontSize: 11, fontFamily: typography.label.fontFamily },

  bar: { height: 6, borderRadius: radius.pill, backgroundColor: ink[50], overflow: 'hidden' },
  barFill: { height: 6, borderRadius: radius.pill, backgroundColor: colors.info },

  tallies: { flexDirection: 'row', gap: spacing[4] },
  tally: { alignItems: 'flex-start' },
  tallyValue: { ...typography.h3, color: colors.ink },
  tallyLabel: { ...typography.caption, color: colors.textMuted },

  meta: { ...typography.caption, color: colors.textMuted },
});
