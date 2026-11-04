/**
 * Mait ↔ MPP assignment, for an admin — the portal's Assignment screen (`assignments.html`).
 *
 * An MPP is the village collection point a Mait works, and the assignment is what scopes their
 * whole app: they see the members of the MPPs they cover and can record an AI event only for
 * those. So this screen moves farmers and permissions around, not labels, and it says so.
 *
 * Two ways in, because the two jobs are different sizes, and both are here as on the portal:
 *
 * - **The round trip**, numbered because the order is the instruction: download the sheet,
 *   already filled with who covers what; edit it in Excel; send it back. It runs on the SAP
 *   pipeline — queued, polled, partial success — so the same live card watches it, and the rows
 *   that did not land come back with their spreadsheet row numbers.
 * - **One Mait at a time**, from the roster below: the same editor the Maits screen opens, so
 *   one record is corrected the same way wherever the admin is standing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { EmptyState } from '@/components';
import { SkeletonFeed, SkeletonRows } from '@/components/skeleton';
import { initials } from '@/components/frame';
import { api } from '@api/client';
import {
  useAdminLastUploadQuery,
  useAdminListMaitsQuery,
  useAdminUploadErrorsQuery,
  useAdminUploadStatusQuery,
} from '@api/endpoints';
import { downloadAndShare } from '@api/files';
import { XLSX_MIME, sendMaster } from '@api/masters';
import type { AdminMait, UploadJob } from '@api/types';
import { useAppDispatch, type RootState } from '@/store';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { Disc, Editor, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';
import { ProgressBar, useEased } from './AdminUploadsScreen';
import { useDebounced } from './common';

const LIMIT = 25;
const POLL_MS = 1500;
const RUNNING = ['queued', 'processing'];
/** Coverage chips drawn on a card before the rest are counted — a Mait with forty is a wall. */
const CHIPS_SHOWN = 6;

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}

function stamp(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Where the account stands, in this screen's order: the number first, because without one a
 * Mait cannot even be activated.
 */
type Standing = 'noMobile' | 'notActivated' | 'deactivated' | 'active';

function standingOf(mait: AdminMait): Standing {
  if (!mait.mobile_no) {
    return 'noMobile';
  }
  if (!mait.activated) {
    return 'notActivated';
  }
  if (mait.account_active === false) {
    return 'deactivated';
  }
  return 'active';
}

const STANDING_TONE: Record<Standing, ToneName> = {
  noMobile: 'red',
  notActivated: 'yolk',
  deactivated: 'red',
  active: 'green',
};

// --------------------------------------------------------------------------------------
// The round trip
// --------------------------------------------------------------------------------------

function Step({
  n,
  tone,
  icon,
  title,
  children,
  testID,
}: {
  n: number;
  tone: ToneName;
  icon: string;
  title: string;
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.step, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.stepHead}>
        <View style={[styles.stepNumber, { backgroundColor: look.solid }]}>
          <AppText style={[styles.stepNumberLabel, { color: look.onSolid }]}>{n}</AppText>
        </View>
        <Ionicons name={icon as never} size={16} color={look.text} />
        <AppText style={[styles.stepTitle, { color: look.text }]}>{title}</AppText>
      </View>
      {children}
    </View>
  );
}

interface Run {
  fileName: string;
  startedAt: string;
  sending: boolean;
  sentPercent: number;
  /** Null until the POST has answered — the card is painted before then. */
  id: number | null;
  seed: UploadJob | null;
}

function Stage({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'live' | 'done' | 'idle';
}): React.JSX.Element {
  const tint = tone === 'done' ? colors.primaryDark : tone === 'live' ? colors.info : null;
  return (
    <View style={styles.stage}>
      <View style={styles.stageHead}>
        <Ionicons name={icon as never} size={14} color={tint ?? colors.textMuted} />
        <AppText style={styles.stageLabel}>{label}</AppText>
      </View>
      <AppText style={[styles.stageValue, tint ? { color: tint } : null]}>{value}</AppText>
    </View>
  );
}

/**
 * The import in flight — the SAP upload screen's card, because it is the same pipeline and
 * nobody should have to open that screen to watch this file. The figure eases toward each
 * poll and never goes backwards; while the file is still going up the bar is a travelling
 * stripe, since there is nothing yet to be a fraction of.
 */
function RunCard({
  run,
  onFinished,
}: {
  run: Run;
  onFinished: (job: UploadJob | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const status = useAdminUploadStatusQuery(run.id ?? 0, {
    skip: run.id === null,
    pollingInterval: over ? 0 : POLL_MS,
  });
  const job = (run.id !== null ? status.data : null) ?? run.seed;
  const finished = !!job && !run.sending && !RUNNING.includes(job.status);
  const { value, shown } = useEased(
    run.sending ? 0 : finished && job?.status !== 'failed' ? 100 : (job?.progress_percent ?? 0),
  );

  // Let the figure land before the card goes. The timer lives in a ref and is cleared only
  // when the card unmounts: kept as an effect's cleanup, the re-render that stops the polling
  // cancelled it, and the card never closed.
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closing.current) {
        clearTimeout(closing.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (!finished || closing.current) {
      return;
    }
    setOver(true);
    closing.current = setTimeout(() => onFinished(job), 900);
  }, [finished, onFinished, job]);

  // A dropped poll is not a failed import: stop asking and let the roster reload.
  useEffect(() => {
    if (status.isError && !over) {
      setOver(true);
      onFinished(null);
    }
  }, [status.isError, over, onFinished]);

  const total = job?.total_rows ?? 0;
  const processed = job?.processed_rows ?? 0;
  const reading = !total || processed < total;
  const failed = job?.failed_rows ?? 0;

  return (
    <View style={styles.run} testID="admin-assign-run">
      <View style={styles.runHead}>
        <ActivityIndicator size="small" color={colors.info} style={styles.runSpin} />
        <AppText style={styles.runTitle}>
          {t(run.sending ? 'admin.assignment.sendingTitle' : 'admin.assignment.applyingTitle', {
            file: run.fileName,
          })}
        </AppText>
        <AppText
          style={[styles.runPercent, run.sending && styles.runPercentSending]}
          testID="admin-assign-percent"
        >
          {run.sending ? t('admin.assignment.sendingPercent') : `${shown}%`}
        </AppText>
      </View>
      <AppText style={styles.runMeta}>
        {[
          run.sending
            ? t('admin.assignment.metaSending', { percent: run.sentPercent })
            : total
              ? t('admin.assignment.metaRows', { rows: num(total) })
              : t('admin.assignment.metaCounting'),
          t('admin.assignment.started', { when: stamp(t, run.startedAt) }),
        ].join(' · ')}
      </AppText>
      <ProgressBar percent={run.sending ? null : value} tint={colors.info} track={colors.surface} />
      <View style={styles.stages}>
        <Stage
          icon="cloud-upload-outline"
          label={t('admin.assignment.stageUploaded')}
          value={t(run.sending ? 'admin.assignment.sending' : 'admin.assignment.received')}
          tone={run.sending ? 'live' : 'done'}
        />
        <Stage
          icon="eye-outline"
          label={t('admin.assignment.stageRead')}
          value={
            total
              ? t('admin.assignment.readOf', { done: num(processed), total: num(total) })
              : t('admin.assignment.readRows', { done: num(processed) })
          }
          tone={run.sending ? 'idle' : reading ? 'live' : 'done'}
        />
        <Stage
          icon="server-outline"
          label={t('admin.assignment.stageApplied')}
          value={t('admin.assignment.applied', { n: num(job?.success_rows) })}
          tone={reading ? 'idle' : 'live'}
        />
        <Stage
          icon="close-circle-outline"
          label={t('admin.assignment.stageRejected')}
          value={
            failed
              ? t('admin.assignment.rejectedN', { n: num(failed) })
              : t('admin.assignment.noneSoFar')
          }
          tone={failed ? 'live' : 'idle'}
        />
      </View>
    </View>
  );
}

/** The rows that did not land, by spreadsheet row number, so the fix happens in the sheet. */
function Rejects({ uploadId, onDismiss }: { uploadId: number; onDismiss: () => void }) {
  const { t } = useTranslation();
  const report = useAdminUploadErrorsQuery(uploadId);
  const look = TONE.red;
  if (!report.data) {
    return report.isLoading ? <SkeletonFeed /> : null;
  }
  return (
    <View
      style={[styles.rejects, { backgroundColor: look.wash, borderColor: look.border }]}
      testID="admin-assign-rejects"
    >
      <View style={styles.rejectsHead}>
        <Disc tone="red" icon="close" size={30} />
        <AppText style={[styles.rejectsTitle, { color: look.text }]}>
          {t('admin.assignment.rejectsTitle')}
        </AppText>
        <Pill
          label={t('admin.assignment.rejectedN', { n: num(report.data.failed_rows) })}
          tone="red"
        />
      </View>
      <AppText style={styles.rejectsBody}>{t('admin.assignment.rejectsBody')}</AppText>
      <View style={styles.rejectList}>
        {report.data.results.map((item, index) => (
          <View
            key={`${item.row ?? 'x'}-${index}`}
            style={[styles.reject, index > 0 && styles.rejectRule]}
          >
            <View style={styles.rejectRow}>
              <AppText style={styles.rejectRowLabel}>
                {t('admin.assignment.row', { n: item.row ?? '—' })}
              </AppText>
            </View>
            <AppText style={styles.rejectWhy}>{item.error}</AppText>
          </View>
        ))}
        {report.data.truncated && (
          <AppText style={styles.rejectWhy}>{t('admin.assignment.truncated')}</AppText>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onDismiss}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        testID="admin-assign-rejects-dismiss"
      >
        <AppText style={styles.secondaryLabel}>{t('admin.assignment.dismiss')}</AppText>
      </Pressable>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// The roster
// --------------------------------------------------------------------------------------

function MaitRow({ mait, onEdit }: { mait: AdminMait; onEdit: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const standing = standingOf(mait);
  const codes = mait.mpp_codes ?? [];
  // A Mait with no MPPs can record nothing — the row worth filling, tinted yellow as on the
  // portal. Everyone else reads in the colour of where their account stands.
  const tone: ToneName = codes.length ? STANDING_TONE[standing] : 'yolk';
  const look = TONE[tone];

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-assign-mait-${mait.sahayak_vendor_code}`}
    >
      <View style={styles.cardTop}>
        <Disc tone={tone} text={initials(mait.name)} />
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{mait.name}</AppText>
          <AppText style={[styles.cardCode, { color: look.text }]}>
            {mait.sahayak_vendor_code}
          </AppText>
        </View>
        <Pill label={t(`admin.assignment.state_${standing}`)} tone={STANDING_TONE[standing]} />
      </View>

      <View style={styles.inset}>
        <View style={[styles.factRow, styles.factRule]}>
          <Ionicons
            name="phone-portrait-outline"
            size={14}
            color={mait.mobile_no ? colors.info : colors.error}
          />
          <AppText style={styles.factLabel}>{t('admin.assignment.mobile')}</AppText>
          <AppText style={[styles.factValue, !mait.mobile_no && styles.factMissing]}>
            {mait.mobile_no || '—'}
          </AppText>
        </View>
        <View style={styles.coverage}>
          <View style={styles.coverageHead}>
            <Ionicons name="location-outline" size={14} color={colors.primaryDark} />
            <AppText style={styles.factLabel}>{t('admin.assignment.mppsCovered')}</AppText>
            <View style={styles.bubble}>
              <AppText style={styles.bubbleLabel}>{codes.length}</AppText>
            </View>
          </View>
          {codes.length ? (
            <View style={styles.codes}>
              {codes.slice(0, CHIPS_SHOWN).map(code => (
                <View key={code} style={styles.codeChip}>
                  <AppText style={styles.codeChipLabel}>{code}</AppText>
                </View>
              ))}
              {codes.length > CHIPS_SHOWN && (
                <View style={[styles.codeChip, styles.codeChipMore]}>
                  <AppText style={styles.codeChipMoreLabel}>+{codes.length - CHIPS_SHOWN}</AppText>
                </View>
              )}
            </View>
          ) : (
            <AppText style={styles.noMpps}>{t('admin.assignment.noMppsRow')}</AppText>
          )}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onEdit}
        style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
        testID={`admin-assign-edit-${mait.sahayak_vendor_code}`}
      >
        <Ionicons name="create-outline" size={15} color={colors.ink} />
        <AppText style={styles.editLabel}>{t('admin.maits.edit')}</AppText>
      </Pressable>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// The screen
// --------------------------------------------------------------------------------------

export default function AdminAssignmentScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const store = useStore<RootState>();
  const dispatch = useAppDispatch();

  const [editing, setEditing] = useState<AdminMait | null>(null);
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [uncoveredOnly, setUncoveredOnly] = useState(false);
  const [noMobileOnly, setNoMobileOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  const [run, setRun] = useState<Run | null>(null);
  const [rejectsId, setRejectsId] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: ToneName } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const args = useMemo(
    () => ({ search, needsMobile: noMobileOnly, offset }),
    [search, noMobileOnly, offset],
  );
  const roster = useAdminListMaitsQuery(args);
  const latest = useAdminLastUploadQuery('assignment');

  useEffect(() => {
    setOffset(0);
  }, [search, noMobileOnly]);

  // An import already running when the screen opened — a sheet takes a while, and without
  // this the card would only ever exist in the session that sent it.
  useEffect(() => {
    const job = latest.data?.results?.[0];
    if (job && RUNNING.includes(job.status) && !run) {
      setRun({
        fileName: job.file_name,
        startedAt: job.created_at,
        sending: false,
        sentPercent: 0,
        id: job.id,
        seed: job,
      });
    }
    // Only on what the server says, not on the card coming and going.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest.data]);

  useEffect(() => {
    if (!editing) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setEditing(null);
      return true;
    });
    return () => sub.remove();
  }, [editing]);

  const token = () => store.getState().auth.accessToken;

  const finish = useCallback(
    (job: UploadJob | null) => {
      setRun(null);
      dispatch(api.util.invalidateTags(['Upload', 'Mait', 'MPP']));
      if (!job) {
        return;
      }
      // Say what happened in one line, then show the rows that did not land.
      const failed = job.failed_rows ?? 0;
      setFlash({
        text: failed
          ? t('admin.assignment.finishedRejected', {
              applied: num(job.success_rows),
              total: num(job.total_rows),
              rejected: num(failed),
            })
          : t('admin.assignment.finished', {
              applied: num(job.success_rows),
              total: num(job.total_rows),
            }),
        tone: failed ? 'red' : 'green',
      });
      setRejectsId(failed ? job.id : null);
    },
    [dispatch, t],
  );

  const download = async () => {
    const access = token();
    if (!access || downloading) {
      return;
    }
    setFlash(null);
    setDownloading(true);
    try {
      await downloadAndShare(
        '/admin/uploads/assignment-template/',
        'mait-mpp-assignments.xlsx',
        XLSX_MIME,
        access,
      );
    } catch {
      setFlash({ text: t('admin.assignment.downloadFailed'), tone: 'red' });
    } finally {
      setDownloading(false);
    }
  };

  const upload = async () => {
    setFlash(null);
    setRejectsId(null);
    let file: DocumentPicker.DocumentPickerAsset | undefined;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [XLSX_MIME, 'application/vnd.ms-excel', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) {
        return;
      }
      file = picked.assets[0];
    } catch {
      setFlash({ text: t('admin.assignment.pickFailed'), tone: 'red' });
      return;
    }
    if (!file) {
      return;
    }
    const chosen = file;

    // Painted before the request leaves: a workbook this size goes up in one event, and a card
    // painted only from the transfer is a card nobody sees.
    const base: Run = {
      fileName: chosen.name,
      startedAt: new Date().toISOString(),
      sending: true,
      sentPercent: 0,
      id: null,
      seed: null,
    };
    setRun(base);
    const sent = (fraction: number | null) =>
      setRun(current =>
        current?.sending
          ? { ...current, sentPercent: fraction === null ? 0 : Math.round(fraction * 100) }
          : current,
      );
    const attempt = async () => {
      const access = token();
      return access ? sendMaster('assignments', chosen, access, sent) : null;
    };

    try {
      let result = await attempt();
      if (result?.status === 401) {
        // An expired access token; any RTK read refreshes it. Send once more after that.
        await roster.refetch();
        result = await attempt();
      }
      if (!result?.upload) {
        setRun(null);
        setFlash({ text: result?.problem ?? t('admin.assignment.sendFailed'), tone: 'red' });
        return;
      }
      const job = result.upload;
      setRun({ ...base, sending: false, id: job.id, seed: job, startedAt: job.created_at });
    } catch {
      setRun(null);
      setFlash({ text: t('admin.assignment.sendFailed'), tone: 'red' });
    }
  };

  if (editing) {
    return (
      <View style={styles.root}>
        <Editor
          mait={editing}
          onDone={saved => {
            setEditing(null);
            if (saved) {
              setFlash({
                text: t('admin.assignment.savedCovered', {
                  name: saved.name,
                  count: saved.mpp_count ?? saved.mpp_codes.length,
                }),
                tone: 'green',
              });
            }
          }}
        />
      </View>
    );
  }

  const all = roster.data?.results ?? [];
  // Coverage is not a server-side filter, so it narrows the page that arrived.
  const rows = uncoveredOnly ? all.filter(m => !(m.mpp_codes ?? []).length) : all;
  const summary = roster.data?.summary;
  const count = roster.data?.count ?? 0;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={roster.isFetching && !roster.isLoading}
            onRefresh={() => {
              roster.refetch();
              latest.refetch();
            }}
          />
        }
        testID="admin-assignment"
      >
        <AppText style={styles.count} testID="admin-assign-count">
          {roster.data
            ? t('admin.assignment.rosterCount', {
                total: num(summary?.total ?? count),
                without: num(summary?.without_mobile),
              })
            : '—'}
        </AppText>

        {!!flash && (
          <Notice
            tone={flash.tone}
            icon={flash.tone === 'green' ? 'checkmark' : 'alert'}
            title={flash.text}
            body=""
            testID="admin-assign-flash"
          />
        )}

        {/* Numbered, because the order is the instruction: an admin who uploads without
            downloading first is composing a file by hand and guessing at the headers. */}
        <Step
          n={1}
          tone="blue"
          icon="download-outline"
          title={t('admin.assignment.step1Title')}
          testID="admin-assign-step-1"
        >
          <AppText style={styles.stepBody}>{t('admin.assignment.step1Body')}</AppText>
          <Pressable
            accessibilityRole="button"
            onPress={download}
            disabled={downloading}
            style={({ pressed }) => [styles.dark, pressed && styles.pressed]}
            testID="admin-assign-download"
          >
            {downloading ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <Ionicons name="download-outline" size={16} color={colors.surface} />
            )}
            <AppText style={styles.darkLabel}>
              {t(downloading ? 'admin.assignment.preparing' : 'admin.assignment.download')}
            </AppText>
          </Pressable>
        </Step>

        <Step n={2} tone="yolk" icon="create-outline" title={t('admin.assignment.step2Title')}>
          <AppText style={styles.stepBody}>{t('admin.assignment.step2Body')}</AppText>
          <View style={styles.paper}>
            <Ionicons name="warning-outline" size={14} color={yolk[800]} />
            <AppText style={styles.paperText}>{t('admin.assignment.step2Note')}</AppText>
          </View>
        </Step>

        <Step
          n={3}
          tone="green"
          icon="cloud-upload-outline"
          title={t('admin.assignment.step3Title')}
          testID="admin-assign-step-3"
        >
          <AppText style={styles.stepBody}>{t('admin.assignment.step3Body')}</AppText>
          <Pressable
            accessibilityRole="button"
            onPress={upload}
            disabled={!!run}
            style={({ pressed }) => [
              styles.primary,
              !!run && styles.busy,
              pressed && styles.pressed,
            ]}
            testID="admin-assign-upload"
          >
            <Ionicons name="document-attach-outline" size={16} color={colors.surface} />
            <AppText style={styles.primaryLabel}>{t('admin.assignment.chooseFile')}</AppText>
          </Pressable>
        </Step>

        {!!run && <RunCard key={run.id ?? 'sending'} run={run} onFinished={finish} />}

        {rejectsId !== null && (
          <Rejects uploadId={rejectsId} onDismiss={() => setRejectsId(null)} />
        )}

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.info} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={setTerm}
            placeholder={t('admin.assignment.searchMaits')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            testID="admin-assign-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Toned to the rows they pull up: no MPPs tints a card yellow, and no mobile means
            the Mait cannot sign in at all. */}
        <View style={styles.filters}>
          <FilterChip
            label={t('admin.assignment.filterNoMpps')}
            icon="location-outline"
            tone="yolk"
            active={uncoveredOnly}
            onPress={() => setUncoveredOnly(on => !on)}
            testID="admin-assign-filter-uncovered"
          />
          <FilterChip
            label={t('admin.assignment.filterNoMobile')}
            icon="call-outline"
            tone="red"
            active={noMobileOnly}
            onPress={() => setNoMobileOnly(on => !on)}
            testID="admin-assign-filter-nomobile"
          />
        </View>

        {roster.isLoading ? (
          <SkeletonRows />
        ) : roster.isError ? (
          <EmptyState message={t('admin.assignment.rosterError')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.assignment.noneMatch')} />
        ) : (
          rows.map(mait => (
            <MaitRow
              key={mait.id}
              mait={mait}
              onEdit={() => {
                setFlash(null);
                setEditing(mait);
              }}
            />
          ))
        )}

        {count > LIMIT && (
          <View style={styles.pager} testID="admin-assign-pager">
            <Pressable
              accessibilityRole="button"
              disabled={offset === 0 || roster.isFetching}
              onPress={() => setOffset(o => Math.max(0, o - LIMIT))}
              style={[styles.pageStep, offset === 0 && styles.pageStepOff]}
            >
              <Ionicons name="chevron-back" size={16} color={colors.info} />
              <AppText style={styles.pageStepLabel}>{t('admin.maits.prev')}</AppText>
            </Pressable>
            <AppText style={styles.pageOf}>
              {t('admin.maits.pageOf', {
                from: num(offset + 1),
                to: num(Math.min(count, offset + all.length)),
                total: num(count),
              })}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={offset + LIMIT >= count || roster.isFetching}
              onPress={() => setOffset(o => o + LIMIT)}
              style={[styles.pageStep, offset + LIMIT >= count && styles.pageStepOff]}
            >
              <AppText style={styles.pageStepLabel}>{t('admin.maits.next')}</AppText>
              <Ionicons name="chevron-forward" size={16} color={colors.info} />
            </Pressable>
          </View>
        )}

        <Notice
          tone="slate"
          icon="information"
          title={t('admin.assignment.areaTitle')}
          body={t('admin.assignment.areaBody')}
          testID="admin-assign-area"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  busy: { opacity: 0.5 },
  count: { ...typography.h3, color: colors.ink },

  step: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberLabel: { ...typography.label, fontFamily: typography.h3.fontFamily },
  stepTitle: { ...typography.h3, flex: 1 },
  stepBody: { ...typography.caption, color: colors.ink },
  paper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[2],
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  paperText: { ...typography.label, color: yolk[800], flex: 1 },
  dark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 42,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  darkLabel: { ...typography.label, color: colors.surface },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 42,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryLabel: { ...typography.label, color: colors.surface },
  secondary: {
    alignSelf: 'flex-start',
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  secondaryLabel: { ...typography.label, color: colors.ink },

  run: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: ink[100],
    backgroundColor: colors.infoWash,
  },
  runHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  runSpin: { marginTop: 2 },
  runTitle: { ...typography.label, color: colors.ink, flex: 1 },
  runPercent: { ...typography.h2, color: colors.info },
  runPercentSending: { ...typography.label, color: colors.info, marginTop: 2 },
  runMeta: { ...typography.caption, color: colors.textMuted },
  stages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  stage: {
    flexGrow: 1,
    flexBasis: '46%',
    padding: spacing[2],
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    gap: 2,
  },
  stageHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stageLabel: { ...typography.caption, color: colors.textMuted },
  stageValue: { ...typography.label, color: colors.ink, textAlign: 'center', alignSelf: 'stretch' },

  rejects: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  rejectsHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2] },
  rejectsTitle: { ...typography.h3, flex: 1 },
  rejectsBody: { ...typography.caption, color: colors.ink },
  rejectList: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  reject: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], paddingVertical: 7 },
  rejectRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rejectRow: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.error,
  },
  rejectRowLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  rejectWhy: { ...typography.caption, color: colors.ink, flex: 1 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  cardName: { ...typography.h3, color: colors.ink },
  cardCode: { ...typography.caption, fontFamily: typography.label.fontFamily },
  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 7 },
  factRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  factLabel: { ...typography.caption, color: colors.textMuted },
  factValue: { ...typography.label, color: colors.ink, flex: 1 },
  factMissing: { color: colors.error },
  coverage: { paddingVertical: 7, gap: spacing[2] },
  coverageHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  bubble: {
    minWidth: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  bubbleLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  codes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  codeChip: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  codeChipLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.info,
  },
  codeChipMore: { backgroundColor: colors.info },
  codeChipMoreLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  noMpps: { ...typography.caption, color: yolk[800] },
  edit: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: yolk[400],
  },
  editLabel: { ...typography.label, color: colors.ink },

  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  pageStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  pageStepOff: { opacity: 0.4 },
  pageStepLabel: { ...typography.label, color: colors.info },
  pageOf: { ...typography.caption, color: colors.textMuted, textAlign: 'center', flexShrink: 1 },
});
