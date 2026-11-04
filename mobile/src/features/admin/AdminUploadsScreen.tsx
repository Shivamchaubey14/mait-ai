/**
 * SAP upload, for an admin — the portal's Uploads screen on a phone.
 *
 * The same three things the portal shows, in the same order: one card per master to send a
 * file from, a live card for every import in flight, and the history. "Download masters" hands
 * back the workbook each master last landed as, for checking a column before re-uploading.
 *
 * Three cards rather than one picker with a type: choosing the wrong type imports 105,000
 * members as Maits, so the three are three distinct coloured objects. And the running card has
 * to look alive — the Member master is parsed in the background for minutes, and a still card
 * with a figure that does not move reads as an app that has hung, so the figure is eased toward
 * each poll's number and the bar travels while the file is still going up.
 *
 * Nothing on this screen is cut short with "…": beside the section rail the column is narrow,
 * and a file name or a Hindi line that wraps is still read where a truncated one is not.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { api } from '@api/client';
import {
  useAdminLastUploadQuery,
  useAdminUploadHistoryQuery,
  useAdminUploadSnapshotsQuery,
  useAdminUploadStatusQuery,
} from '@api/endpoints';
import {
  XLSX_MIME,
  downloadMaster,
  sendMaster,
  type DownloadPhase,
  type MasterEndpoint,
  type MasterType,
} from '@api/masters';
import type { MasterSnapshot, UploadJob } from '@api/types';
import { Banner, EmptyState } from '@/components';
import { SkeletonRows } from '@/components/skeleton';
import { Sheet } from '@/components/BottomSheet';
import { useAppDispatch, type RootState } from '@/store';
import { colors, green, ink, radius, spacing, typography, yolk } from '@theme/tokens';

import { adminStyles } from './common';

const POLL_MS = 2000;

/** The three masters, each pairing the URL a file is posted to with the type it is stored as. */
const MASTERS: {
  endpoint: MasterEndpoint;
  type: MasterType;
  icon: string;
  wash: string;
  edge: string;
  tint: string;
}[] = [
  {
    endpoint: 'members',
    type: 'member',
    icon: 'people',
    wash: colors.primaryWash,
    edge: green[200],
    tint: colors.primaryDark,
  },
  {
    endpoint: 'maits',
    type: 'mait',
    icon: 'person',
    wash: colors.infoWash,
    edge: ink[100],
    tint: colors.info,
  },
  {
    endpoint: 'mpp',
    type: 'mpp',
    icon: 'home',
    wash: colors.secondaryWash,
    edge: yolk[200],
    tint: yolk[800],
  },
];

const RUNNING = ['queued', 'processing'];

function num(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('en-IN');
}

function dateOf(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''}`;
}

function dateTimeOf(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  return `${dateOf(t, iso)}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function typeLabel(t: TFunction, type: string, fallback?: string): string {
  return t(`admin.uploads.type.${type}`, { defaultValue: fallback ?? type });
}

/* --- the moving parts ------------------------------------------------------------------- */

/**
 * A bar that fills to `percent`, eased, or — with `percent` null — a stripe that travels the
 * track to say "working, length unknown" without ever having to go backwards.
 */
export function ProgressBar({
  percent,
  tint,
  track,
  height = 10,
  testID,
}: {
  percent: Animated.Value | number | null;
  tint: string;
  track: string;
  height?: number;
  testID?: string;
}): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;
  const indeterminate = percent === null;

  useEffect(() => {
    if (!indeterminate) {
      return;
    }
    const loop = Animated.loop(
      Animated.timing(slide, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [indeterminate, slide]);

  let fill: React.ReactNode;
  if (indeterminate) {
    const stripe = Math.max(24, width * 0.3);
    fill = (
      <Animated.View
        style={[
          styles.barFill,
          {
            width: stripe,
            backgroundColor: tint,
            transform: [
              {
                translateX: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-stripe, width],
                }),
              },
            ],
          },
        ]}
      />
    );
  } else {
    const w =
      typeof percent === 'number'
        ? `${Math.min(100, Math.max(0, percent))}%`
        : percent.interpolate({
            inputRange: [0, 100],
            outputRange: ['0%', '100%'],
            extrapolate: 'clamp',
          });
    fill = <Animated.View style={[styles.barFill, { width: w as never, backgroundColor: tint }]} />;
  }

  return (
    <View
      style={[styles.bar, { height, backgroundColor: track }]}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      testID={testID}
    >
      {fill}
    </View>
  );
}

/**
 * The figure shown for a running import, eased toward the last number the server gave.
 *
 * Progress arrives every two seconds in chunks of a thousand rows; printed raw it steps 1%,
 * 12%, 23% and reads as a screen redrawing rather than work happening. Never backwards: a bar
 * that retreats reads as work being undone.
 */
export function useEased(target: number): { value: Animated.Value; shown: number } {
  const value = useRef(new Animated.Value(0)).current;
  const high = useRef(0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = value.addListener(({ value: v }) => setShown(Math.round(v)));
    return () => value.removeListener(id);
  }, [value]);

  useEffect(() => {
    high.current = Math.max(high.current, target);
    const animation = Animated.timing(value, {
      toValue: high.current,
      duration: POLL_MS - 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [target, value]);

  return { value, shown };
}

/* --- a master to send ------------------------------------------------------------------- */

function lastLine(t: TFunction, last: UploadJob | undefined, loaded: boolean): string {
  if (!loaded) {
    return '—';
  }
  if (!last) {
    return t('admin.uploads.never');
  }
  if (last.status === 'failed') {
    return t('admin.uploads.lastFailed', { when: dateTimeOf(t, last.created_at) });
  }
  if (!last.finished_at) {
    return t('admin.uploads.importingNow', { rows: num(last.processed_rows) });
  }
  return t('admin.uploads.last', {
    rows: num(last.total_rows),
    when: dateOf(t, last.finished_at),
  });
}

function MasterCard({
  master,
  busy,
  onChoose,
}: {
  master: (typeof MASTERS)[number];
  busy: boolean;
  onChoose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const last = useAdminLastUploadQuery(master.type);

  return (
    <View
      style={[styles.drop, { backgroundColor: master.wash, borderColor: master.edge }]}
      testID={`admin-upload-card-${master.type}`}
    >
      <View style={styles.dropHead}>
        <View style={styles.chip}>
          <Ionicons name={master.icon as never} size={22} color={master.tint} />
        </View>
        <View style={styles.flex}>
          <AppText style={styles.dropTitle}>{t(`admin.uploads.master.${master.type}`)}</AppText>
          <AppText style={styles.dropMeta} testID={`admin-upload-last-${master.type}`}>
            {lastLine(t, last.data?.results?.[0], !last.isLoading)}
          </AppText>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onChoose}
        style={({ pressed }) => [
          styles.choose,
          pressed && styles.choosePressed,
          busy && styles.chooseBusy,
        ]}
        testID={`admin-upload-choose-${master.type}`}
      >
        <Ionicons name="document-attach-outline" size={17} color={colors.surface} />
        <AppText style={styles.chooseLabel}>{t('admin.uploads.chooseFile')}</AppText>
      </Pressable>
    </View>
  );
}

/* --- an import in flight ---------------------------------------------------------------- */

interface Run {
  key: MasterType;
  fileName: string;
  startedAt: string;
  sending: boolean;
  sentPercent: number;
  /** Null until the POST has answered — the card exists before then. */
  id: number | null;
  /** The row as the POST (or the history) last gave it, before the first poll lands. */
  seed: UploadJob | null;
}

type Tone = 'live' | 'done' | 'idle';

const STAGE_ICON: Record<string, string> = {
  uploaded: 'cloud-upload-outline',
  validated: 'eye-outline',
  written: 'server-outline',
  report: 'document-text-outline',
};

function Stage({
  name,
  value,
  tone,
}: {
  name: string;
  value: string;
  tone: Tone;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tint = tone === 'done' ? colors.primaryDark : tone === 'live' ? colors.info : null;
  return (
    <View style={styles.stage} testID={`admin-upload-stage-${name}`}>
      <View style={styles.stageHead}>
        <Ionicons name={STAGE_ICON[name] as never} size={14} color={tint ?? colors.textMuted} />
        <AppText style={styles.stageLabel}>{t(`admin.uploads.stage.${name}`)}</AppText>
      </View>
      <AppText style={[styles.stageValue, tint ? { color: tint } : null]}>{value}</AppText>
    </View>
  );
}

function RunCard({
  run,
  onFinished,
}: {
  run: Run;
  onFinished: (key: MasterType) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const status = useAdminUploadStatusQuery(run.id ?? 0, {
    skip: run.id === null,
    pollingInterval: over ? 0 : POLL_MS,
  });
  const job = (run.id !== null ? status.data : null) ?? run.seed;

  const finished = !!job && !run.sending && !RUNNING.includes(job.status);
  // A file rejected part-way did not reach 100% of anything, so only a landed import is
  // walked to the end.
  const target = run.sending
    ? 0
    : finished && job?.status !== 'failed'
      ? 100
      : (job?.progress_percent ?? 0);
  const { value, shown } = useEased(target);

  // Let the figure land before the card goes, so the last thing seen is the import finishing
  // rather than a card vanishing mid-count. The timer lives in a ref and is cleared only when
  // the card unmounts: as an effect's cleanup, the re-render that stopped the polling cancelled
  // it, and a finished card never closed.
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
    closing.current = setTimeout(() => onFinished(run.key), 1200);
  }, [finished, onFinished, run.key]);

  // A dropped poll is not a failed import. Stop asking and let the history say how it went.
  useEffect(() => {
    if (status.isError && !over) {
      setOver(true);
      onFinished(run.key);
    }
  }, [status.isError, over, onFinished, run.key]);

  const total = job?.total_rows ?? 0;
  const processed = job?.processed_rows ?? 0;
  const reading = !total || processed < total;
  const success = job?.success_rows ?? 0;
  const skipped = job?.skipped_rows ?? 0;
  const kept = job?.kept_rows ?? 0;
  const failed = job?.failed_rows ?? 0;

  const written = [
    t('admin.uploads.added', { n: num(success) }),
    skipped ? t('admin.uploads.onRecord', { n: num(skipped) }) : null,
    // A member master that disagreed with a number the office set, and lost: said, so nobody
    // wonders whether the upload quietly undid a correction.
    kept ? t('admin.uploads.kept', { count: kept, n: num(kept) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const meta = [
    typeLabel(t, run.key),
    run.sending
      ? t('admin.uploads.metaSending', { percent: run.sentPercent })
      : total
        ? t('admin.uploads.metaRows', { rows: num(total) })
        : t('admin.uploads.metaCounting'),
    t('admin.uploads.started', { when: dateTimeOf(t, run.startedAt) }),
  ].join(' · ');

  return (
    <View style={styles.run} testID={`admin-upload-run-${run.key}`}>
      <View style={styles.runHead}>
        <ActivityIndicator size="small" color={colors.info} style={styles.runSpin} />
        <AppText style={styles.runTitle}>
          {t(run.sending ? 'admin.uploads.sendingTitle' : 'admin.uploads.importingTitle', {
            file: run.fileName,
          })}
        </AppText>
        <AppText
          style={[styles.runPercent, run.sending && styles.runPercentSending]}
          testID={`admin-upload-percent-${run.key}`}
        >
          {run.sending ? t('admin.uploads.sendingPercent') : `${shown}%`}
        </AppText>
      </View>
      <AppText style={styles.runMeta} accessibilityLiveRegion="polite">
        {meta}
      </AppText>

      <ProgressBar
        percent={run.sending ? null : value}
        tint={colors.info}
        track={colors.surface}
        testID={`admin-upload-bar-${run.key}`}
      />

      <View style={styles.stages}>
        <Stage
          name="uploaded"
          value={t(run.sending ? 'admin.uploads.sending' : 'admin.uploads.received')}
          tone={run.sending ? 'live' : 'done'}
        />
        <Stage
          name="validated"
          value={
            total
              ? t('admin.uploads.readOf', { done: num(processed), total: num(total) })
              : t('admin.uploads.readRows', { done: num(processed) })
          }
          tone={run.sending ? 'idle' : reading ? 'live' : 'done'}
        />
        <Stage name="written" value={written} tone={reading ? 'idle' : 'live'} />
        <Stage
          name="report"
          value={
            failed
              ? t('admin.uploads.rejectedCount', { n: num(failed) })
              : t('admin.uploads.reportLater')
          }
          tone={failed ? 'live' : 'idle'}
        />
      </View>
    </View>
  );
}

/* --- the history ------------------------------------------------------------------------ */

const PENDING = { wash: ink[50], tint: ink[500], icon: 'time' };
const LOOK: Record<string, { wash: string; tint: string; icon: string }> = {
  completed: { wash: colors.primaryWash, tint: colors.primaryDark, icon: 'checkmark-circle' },
  completed_with_errors: { wash: colors.secondaryWash, tint: yolk[800], icon: 'alert-circle' },
  failed: { wash: colors.errorWash, tint: colors.error, icon: 'close-circle' },
  processing: { wash: colors.infoWash, tint: colors.info, icon: 'sync' },
  queued: PENDING,
};

function look(status: string): { wash: string; tint: string; icon: string } {
  return LOOK[status] ?? PENDING;
}

function Job({ job }: { job: UploadJob }): React.JSX.Element {
  const { t } = useTranslation();
  const l = look(job.status);
  const running = RUNNING.includes(job.status);

  return (
    <View style={styles.card} testID={`admin-upload-${job.id}`}>
      <View style={styles.head}>
        <View style={[styles.mark, { backgroundColor: l.wash }]}>
          <Ionicons name={l.icon as never} size={18} color={l.tint} />
        </View>
        <View style={styles.flex}>
          <AppText style={styles.type}>{job.upload_type_display}</AppText>
          <AppText style={styles.file}>{job.file_name}</AppText>
        </View>
      </View>

      {running && (
        <ProgressBar
          percent={Math.max(2, job.progress_percent)}
          tint={colors.info}
          track={ink[50]}
          height={6}
        />
      )}

      <View style={styles.tallies}>
        <Tally label={t('admin.uploads.rows')} value={job.total_rows} />
        <Tally
          label={t('admin.uploads.saved')}
          value={job.success_rows}
          tint={colors.primaryDark}
        />
        {job.skipped_rows > 0 && (
          <Tally label={t('admin.uploads.skipped')} value={job.skipped_rows} />
        )}
        {job.error_count > 0 && (
          <Tally label={t('admin.uploads.rejected')} value={job.error_count} tint={colors.error} />
        )}
      </View>

      <View style={styles.foot}>
        <View style={[styles.pill, { backgroundColor: l.wash }]}>
          <AppText style={[styles.pillLabel, { color: l.tint }]}>{job.status_display}</AppText>
        </View>
        <AppText style={styles.meta}>
          {[job.uploaded_by_name, dateTimeOf(t, job.finished_at ?? job.created_at)]
            .filter(Boolean)
            .join(' · ')}
        </AppText>
      </View>
    </View>
  );
}

function Tally({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint?: string;
}): React.JSX.Element {
  return (
    <View style={styles.tally}>
      <AppText style={[styles.tallyValue, tint ? { color: tint } : null]}>{num(value)}</AppText>
      <AppText style={styles.tallyLabel}>{label}</AppText>
    </View>
  );
}

/* --- downloading a master --------------------------------------------------------------- */

function masterMeta(t: TFunction, row: MasterSnapshot): string {
  if (!row.available) {
    return t('admin.uploads.nothingYet');
  }
  return [
    dateOf(t, row.uploaded_at),
    row.failed_rows
      ? t('admin.uploads.masterRowsOf', { rows: num(row.success_rows), total: num(row.total_rows) })
      : t('admin.uploads.masterRows', { rows: num(row.success_rows) }),
    row.file_name,
    row.ready ? null : t('admin.uploads.slowFirst'),
  ]
    .filter(Boolean)
    .join(' · ');
}

function MasterDownload({
  master,
  row,
  checking,
  failedToCheck,
  token,
  onError,
}: {
  master: (typeof MASTERS)[number];
  row: MasterSnapshot | undefined;
  checking: boolean;
  failedToCheck: boolean;
  token: () => string | null;
  onError: (message: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<DownloadPhase | null>(null);
  const busy = phase !== null && phase.phase !== 'done';
  const name = t(`admin.uploads.master.${master.type}`);

  const start = async () => {
    const access = token();
    if (!access) {
      return;
    }
    try {
      const file = await downloadMaster(master.type, access, setPhase);
      // Left on screen while the share sheet is up, so the bar is seen to finish.
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: XLSX_MIME,
          dialogTitle: name,
          UTI: 'org.openxmlformats.spreadsheetml.sheet',
        });
      }
      setTimeout(() => setPhase(null), 1400);
    } catch {
      setPhase(null);
      onError(t('admin.uploads.downloadFailed'));
    }
  };

  const meta = checking
    ? t('admin.uploads.checking')
    : failedToCheck || !row
      ? t('admin.uploads.couldNotCheck')
      : masterMeta(t, row);

  let label = '';
  let percent: number | null = null;
  if (phase?.phase === 'done') {
    label = t('admin.uploads.ready');
    percent = 100;
  } else if (phase) {
    label = t(
      phase.phase === 'preparing' ? 'admin.uploads.preparing' : 'admin.uploads.downloading',
    );
    percent = phase.fraction === null ? null : Math.round(phase.fraction * 100);
  }

  const disabled = busy || checking || !row?.available;

  return (
    <View
      style={[styles.master, { backgroundColor: master.wash, borderColor: master.edge }]}
      testID={`admin-master-${master.type}`}
    >
      <View style={styles.chipSmall}>
        <Ionicons name={master.icon as never} size={20} color={master.tint} />
      </View>
      <View style={styles.flex}>
        <AppText style={styles.masterTitle}>{name}</AppText>
        <AppText style={styles.masterMeta}>{meta}</AppText>
        {phase && (
          <View style={styles.masterProgress}>
            <View style={styles.masterStatus}>
              <AppText style={styles.masterPhase} accessibilityLiveRegion="polite">
                {label}
              </AppText>
              {percent !== null && (
                <AppText style={[styles.masterPercent, { color: master.tint }]}>{percent}%</AppText>
              )}
            </View>
            <ProgressBar percent={percent} tint={master.tint} track={colors.surface} height={6} />
          </View>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('admin.uploads.download', { name })}
        disabled={disabled}
        onPress={start}
        style={({ pressed }) => [
          styles.get,
          pressed && styles.getPressed,
          disabled && styles.getDisabled,
        ]}
        testID={`admin-master-get-${master.type}`}
      >
        <Ionicons name="download-outline" size={20} color={colors.surface} />
      </Pressable>
    </View>
  );
}

function MastersSheet({
  visible,
  onClose,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  token: () => string | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  // Read on open, never kept from earlier: an upload may have landed in the meantime, and a
  // sheet offering yesterday's file is the mistake this exists to prevent.
  const snapshots = useAdminUploadSnapshotsQuery(undefined, {
    skip: !visible,
    refetchOnMountOrArgChange: true,
  });
  const rows = snapshots.data?.results ?? [];

  return (
    <Sheet
      visible={visible}
      title={t('admin.uploads.sheetTitle')}
      subtitle={t('admin.uploads.sheetLede')}
      onClose={onClose}
      testID="admin-masters-sheet"
    >
      <View style={styles.masters}>
        {!!error && <Banner message={error} />}
        {MASTERS.map(master => (
          <MasterDownload
            key={master.type}
            master={master}
            row={rows.find(r => r.upload_type === master.type)}
            checking={snapshots.isFetching}
            failedToCheck={snapshots.isError}
            token={token}
            onError={setError}
          />
        ))}
      </View>
    </Sheet>
  );
}

/* --- the screen ------------------------------------------------------------------------- */

export default function AdminUploadsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const store = useStore<RootState>();
  const dispatch = useAppDispatch();
  const history = useAdminUploadHistoryQuery();
  const rows = history.data?.results ?? [];

  const [runs, setRuns] = useState<Partial<Record<MasterType, Run>>>({});
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  const token = useCallback(() => store.getState().auth.accessToken, [store]);

  // Every running import the history knows of, not only the ones sent from here: coming back
  // to this screen mid-way through three imports has to show all three.
  useEffect(() => {
    const running = (history.data?.results ?? []).filter(job => RUNNING.includes(job.status));
    if (!running.length) {
      return;
    }
    setRuns(current => {
      let next = current;
      for (const job of running) {
        const key = job.upload_type as MasterType;
        if (!MASTERS.some(m => m.type === key) || current[key]) {
          continue;
        }
        next = {
          ...next,
          [key]: {
            key,
            fileName: job.file_name,
            startedAt: job.created_at,
            sending: false,
            sentPercent: 0,
            id: job.id,
            seed: job,
          },
        };
      }
      return next;
    });
  }, [history.data]);

  const finish = useCallback(
    (key: MasterType) => {
      setRuns(current => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      dispatch(api.util.invalidateTags(['Upload']));
    },
    [dispatch],
  );

  const choose = async (master: (typeof MASTERS)[number]) => {
    setError(null);
    let picked: DocumentPicker.DocumentPickerAsset | undefined;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [XLSX_MIME, 'application/vnd.ms-excel', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) {
        return;
      }
      picked = result.assets[0];
    } catch {
      setError(t('admin.uploads.pickFailed'));
      return;
    }
    if (!picked) {
      return;
    }
    const file = picked;

    // Painted before the request leaves, so a small master that is sent in one event still
    // shows a card at all.
    const base: Run = {
      key: master.type,
      fileName: file.name,
      startedAt: new Date().toISOString(),
      sending: true,
      sentPercent: 0,
      id: null,
      seed: null,
    };
    setRuns(current => ({ ...current, [master.type]: base }));
    const sent = (fraction: number | null) =>
      setRuns(current =>
        current[master.type]?.sending
          ? {
              ...current,
              [master.type]: {
                ...current[master.type]!,
                sentPercent: fraction === null ? 0 : Math.round(fraction * 100),
              },
            }
          : current,
      );

    const attempt = async () => {
      const access = token();
      return access ? sendMaster(master.endpoint, file, access, sent) : null;
    };

    try {
      let result = await attempt();
      if (result?.status === 401) {
        // An expired access token. Any RTK read refreshes it, so ask for the history and send
        // again once with whatever token that leaves behind.
        await history.refetch();
        result = await attempt();
      }
      if (!result || !result.upload) {
        finish(master.type);
        setError(result?.problem ?? t('admin.uploads.sendFailed'));
        return;
      }
      const upload = result.upload;
      setRuns(current => ({
        ...current,
        [master.type]: {
          ...base,
          sending: false,
          sentPercent: 100,
          id: upload.id,
          seed: upload,
          startedAt: upload.created_at ?? base.startedAt,
        },
      }));
      dispatch(api.util.invalidateTags(['Upload']));
    } catch {
      finish(master.type);
      setError(t('admin.uploads.sendFailed'));
    }
  };

  const live = MASTERS.map(m => runs[m.type]).filter((r): r is Run => !!r);

  return (
    <View style={adminStyles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={history.isFetching && !history.isLoading}
            onRefresh={() => dispatch(api.util.invalidateTags(['Upload']))}
          />
        }
        testID="admin-uploads"
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => setSheet(true)}
          style={({ pressed }) => [styles.templates, pressed && styles.templatesPressed]}
          testID="admin-upload-masters"
        >
          <Ionicons name="download-outline" size={18} color={colors.surface} />
          <AppText style={styles.templatesLabel}>{t('admin.uploads.downloadMasters')}</AppText>
        </Pressable>

        {!!error && <Banner message={error} testID="admin-upload-error" />}

        {MASTERS.map(master => (
          <MasterCard
            key={master.type}
            master={master}
            busy={!!runs[master.type]?.sending}
            onChoose={() => choose(master)}
          />
        ))}

        {live.map(run => (
          <RunCard key={`${run.key}-${run.id ?? 'sending'}`} run={run} onFinished={finish} />
        ))}

        <AppText style={styles.sectionTitle}>{t('admin.uploads.history')}</AppText>
        {history.isLoading ? (
          <SkeletonRows rows={4} />
        ) : history.isError ? (
          <EmptyState message={t('admin.uploads.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.uploads.none')} />
        ) : (
          rows.map(job => <Job key={job.id} job={job} />)
        )}
      </ScrollView>

      <MastersSheet visible={sheet} onClose={() => setSheet(false)} token={token} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },

  templates: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  templatesPressed: { opacity: 0.85 },
  templatesLabel: { ...typography.label, color: colors.surface, textAlign: 'center' },

  // One card per master, the colour carried by the whole card: three distinct objects at a
  // glance. Icon and words side by side rather than stacked, so three fit on one screen.
  drop: {
    padding: spacing[3],
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  dropHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  chip: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  dropTitle: { ...typography.h3, color: colors.ink },
  dropMeta: { ...typography.caption, color: colors.textMuted },
  choose: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 42,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  choosePressed: { backgroundColor: colors.primaryPressed },
  chooseBusy: { opacity: 0.5 },
  chooseLabel: { ...typography.label, color: colors.surface, textAlign: 'center' },

  // The running import: the one card an admin is asked to sit and watch.
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

  bar: { borderRadius: radius.pill, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.pill },

  // Two by two: four across beside the rail would leave each stage too narrow to say anything.
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
  stageValue: {
    ...typography.label,
    color: colors.ink,
    textAlign: 'center',
    alignSelf: 'stretch',
  },

  sectionTitle: { ...typography.h3, color: colors.ink, marginTop: spacing[2] },

  card: {
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[3],
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  mark: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  type: { ...typography.h3, color: colors.ink },
  file: { ...typography.caption, color: colors.textMuted },
  foot: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[2],
  },
  pill: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radius.pill },
  pillLabel: { ...typography.caption, fontSize: 11, fontFamily: typography.label.fontFamily },

  tallies: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing[4], rowGap: spacing[2] },
  tally: { alignItems: 'flex-start' },
  tallyValue: { ...typography.h3, color: colors.ink },
  tallyLabel: { ...typography.caption, color: colors.textMuted },

  meta: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },

  masters: { gap: spacing[3] },
  master: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  chipSmall: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  masterTitle: { ...typography.bodyStrong, color: colors.ink },
  masterMeta: { ...typography.caption, color: colors.textMuted },
  masterProgress: { marginTop: spacing[2], gap: 4 },
  masterStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  masterPhase: { ...typography.caption, color: colors.ink, flex: 1 },
  masterPercent: { ...typography.label },
  get: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  getPressed: { opacity: 0.85 },
  getDisabled: { opacity: 0.35 },
});
