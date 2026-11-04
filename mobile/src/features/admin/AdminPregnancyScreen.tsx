/**
 * Pregnancy diagnosis, for an admin — the portal's `pregnancy.html` on a handset.
 *
 * The app's own pregnancy screens answer a Mait's question — which yard do I walk to next. This
 * one answers an admin's: *is anybody's round being dropped*, and *is any of this working*. So
 * the list is by Mait rather than by animal, most overdue first, and the headline is conception
 * rate — the only number here that says whether the work is achieving anything.
 *
 * Opening a Mait's round shows the animals behind the counts, in the shape an admin reads down
 * the phone to that Mait: who, the tag, the dates, where (village and the event's own pin), a
 * number to ring, a map, and the insemination record.
 *
 * Read-only. Recording a result is the Mait's job, done with a hand on the animal; a button
 * here that wrote an outcome would be a result nobody took.
 *
 * Colours: overdue is yellow, never red — a check nobody walked is waiting work, not blocked
 * work. Red is kept for "not pregnant", and a refusal is grey: an owner who would not have the
 * animal examined has told us nothing about whether the insemination took.
 */

import React, { useMemo, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { Banner, EmptyState } from '@/components';
import { SkeletonOverview, SkeletonRows } from '@/components/skeleton';
import { parseIsoDate } from '@/components/dateRange';
import { initials } from '@/components/frame';
import { useAdminMaitPregnancyChecksQuery, useAdminPregnancyOversightQuery } from '@api/endpoints';
import { downloadAndShare, XLSX_MIME } from '@api/files';
import type { PregnancyCheck, PregnancyRow, PregnancyWindow } from '@api/types';
import type { RootState } from '@/store';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { EventRecord } from './AdminEventsScreen';
import { Disc, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';

/** Where a rate stops being reassuring. Field conception rates sit in the 35–50% band. */
const RATE_GOOD = 40;
const RATE_POOR = 25;

/**
 * Null and zero are different answers: 0% is a Mait whose inseminations are failing, no rate
 * is a Mait whose first checks are not due yet. Only the first wears a colour.
 */
export function rateTone(percent: number | null | undefined): ToneName | null {
  if (percent === null || percent === undefined) {
    return null;
  }
  if (percent >= RATE_GOOD) {
    return 'green';
  }
  return percent >= RATE_POOR ? 'yolk' : 'red';
}

/**
 * "98765 43210" — how an Indian mobile is said out loud, because this number exists to be read
 * down a phone. Anything that is not ten digits is left exactly as it came.
 */
export function phone(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : String(raw ?? '');
}

/** Null on an event captured before the handset sent a position. Zero is a real place. */
function hasPin(check: PregnancyCheck): boolean {
  return (
    check.gps_lat !== null &&
    check.gps_lat !== undefined &&
    check.gps_lng !== null &&
    check.gps_lng !== undefined
  );
}

/** Hemispheres are computed, not assumed: a card printing "° N" beside a negative is believed. */
export function coords(lat: number, lng: number): string {
  return (
    `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ` +
    `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`
  );
}

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}

function rupees(value: string | number): string {
  return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

function day(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const months = t('calendar.months', { returnObjects: true }) as string[];
  const d = parseIsoDate(iso.slice(0, 10));
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

function dayTime(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const at = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${at.getDate()} ${months[at.getMonth()] ?? ''} ${at.getFullYear()}, ${hh}:${mm}`;
}

/** The tint a check card wears, so a round's shape is visible before a word is read. */
function checkTone(check: PregnancyCheck): ToneName {
  if (check.outcome === 'pregnant') {
    return 'green';
  }
  if (check.outcome === 'not_pregnant') {
    return 'red';
  }
  if (check.outcome === 'unsure' || check.outcome === 'declined') {
    // The same grey for both, because both settled just as little.
    return 'slate';
  }
  // Open: late is waiting work; not yet due is simply a fact on the calendar.
  return check.days_until < 0 ? 'yolk' : 'blue';
}

const OUTCOME_TONE: Record<string, ToneName> = {
  pregnant: 'green',
  not_pregnant: 'red',
  unsure: 'yolk',
  declined: 'slate',
};

function dueBadge(t: TFunction, check: PregnancyCheck): { label: string; tone: ToneName } {
  if (check.outcome) {
    return {
      label: t(`admin.pregnancy.outcome_${check.outcome}`, {
        defaultValue: check.outcome_display,
      }),
      tone: OUTCOME_TONE[check.outcome] ?? 'blue',
    };
  }
  const until = check.days_until;
  if (until < 0) {
    return { label: t('admin.pregnancy.daysOverdue', { count: Math.abs(until) }), tone: 'yolk' };
  }
  if (until === 0) {
    return { label: t('admin.pregnancy.dueToday'), tone: 'blue' };
  }
  return { label: t('admin.pregnancy.inDays', { count: until }), tone: 'blue' };
}

/** "Buffalo · MURRAH". The breed is left as the straw prints it. */
function animalOf(t: TFunction, check: PregnancyCheck): string {
  const species = check.animal_type
    ? t(check.animal_type === 'BUFF' ? 'admin.pregnancy.buffalo' : 'admin.pregnancy.cow')
    : '—';
  return species + (check.breed ? ` · ${check.breed}` : '');
}

function Tile({
  tone,
  icon,
  label,
  value,
  foot,
  testID,
}: {
  tone: ToneName;
  icon: string;
  label: string;
  value: string;
  foot: string;
  testID: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.tile, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.tileHead}>
        <View style={[styles.chip, { backgroundColor: look.solid }]}>
          <Ionicons name={icon as never} size={13} color={look.onSolid} />
        </View>
        <AppText style={[styles.tileLabel, { color: look.text }]}>{label}</AppText>
      </View>
      <AppText
        style={styles.tileValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        testID={`${testID}-value`}
      >
        {value}
      </AppText>
      <AppText style={styles.tileFoot} testID={`${testID}-foot`}>
        {foot}
      </AppText>
    </View>
  );
}

function RateBar({ percent }: { percent: number }): React.JSX.Element {
  const tone = rateTone(percent) ?? 'slate';
  return (
    <View style={styles.meter}>
      <View
        style={[
          styles.meterFill,
          { width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: TONE[tone].solid },
        ]}
      />
    </View>
  );
}

/** Three MPP codes, the rest behind their own count — opened in place, one row at a time. */
const MPP_SHOWN = 3;

function MppCodes({ codes, testID }: { codes: string[]; testID: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!codes.length) {
    return <AppText style={styles.sub}>{t('admin.pregnancy.noMpps')}</AppText>;
  }
  const hidden = codes.length - MPP_SHOWN;
  const shown = open ? codes : codes.slice(0, MPP_SHOWN);
  return (
    <View style={styles.codes} testID={testID}>
      {shown.map(code => (
        <View key={code} style={styles.code}>
          <AppText style={styles.codeLabel}>{code}</AppText>
        </View>
      ))}
      {hidden > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(o => !o)}
          hitSlop={6}
          style={styles.more}
          testID={`${testID}-more`}
        >
          <AppText style={styles.moreLabel}>
            {open ? t('admin.pregnancy.showFewer') : t('admin.pregnancy.moreN', { n: hidden })}
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

function Figure({
  label,
  value,
  tone,
  testID,
}: {
  label: string;
  value: string;
  tone?: ToneName;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.figure}>
      <AppText style={[styles.figureValue, tone && { color: TONE[tone].text }]} testID={testID}>
        {value}
      </AppText>
      <AppText style={styles.sub}>{label}</AppText>
    </View>
  );
}

function MaitCard({ row, onOpen }: { row: PregnancyRow; onOpen: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const code = row.sahayak_vendor_code;
  const settled = row.conception_rate !== null && row.conception_rate !== undefined;
  const tone: ToneName = row.overdue ? 'yolk' : settled ? 'green' : 'slate';
  const look = TONE[tone];

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-pregnancy-${code}`}
    >
      <View style={styles.cardTop}>
        <Disc tone={tone} text={initials(row.name)} size={34} />
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{row.name}</AppText>
          <AppText style={styles.sub}>{code}</AppText>
        </View>
        {row.overdue > 0 && (
          <Pill label={t('admin.pregnancy.overdueN', { count: row.overdue })} tone="yolk" />
        )}
      </View>

      <MppCodes codes={row.mpp_codes ?? []} testID={`admin-pregnancy-mpps-${code}`} />

      <View style={styles.inset}>
        <View style={styles.figures}>
          <Figure
            label={t('admin.pregnancy.open')}
            value={num(row.open)}
            testID={`admin-pregnancy-open-${code}`}
          />
          <Figure
            label={t('admin.pregnancy.overdue')}
            value={num(row.overdue)}
            tone={row.overdue ? 'yolk' : undefined}
            testID={`admin-pregnancy-overdue-${code}`}
          />
          <Figure
            label={t('admin.pregnancy.recorded')}
            value={num(row.recorded)}
            testID={`admin-pregnancy-recorded-${code}`}
          />
        </View>
        <View style={[styles.rateBlock, styles.rule]}>
          <AppText style={styles.sub}>{t('admin.pregnancy.conceptionRate')}</AppText>
          {settled ? (
            <>
              <View style={styles.rateLine}>
                <AppText
                  style={[styles.rateValue, { color: TONE[rateTone(row.conception_rate)!].text }]}
                  testID={`admin-pregnancy-rate-${code}`}
                >
                  {`${row.conception_rate!.toFixed(1)}%`}
                </AppText>
                {/* The fraction behind it: 50% of two and 50% of two hundred differ. */}
                <AppText style={styles.sub}>
                  {t('admin.pregnancy.ofN', { a: num(row.conceived), b: num(row.decided) })}
                </AppText>
              </View>
              <RateBar percent={row.conception_rate!} />
            </>
          ) : (
            // Words, not a dash: a dash reads as data that failed to load.
            <AppText style={styles.rateNone} testID={`admin-pregnancy-rate-${code}`}>
              {t(row.open ? 'admin.pregnancy.nothingSettled' : 'admin.pregnancy.noChecks')}
            </AppText>
          )}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
        testID={`admin-pregnancy-round-${code}`}
      >
        <Ionicons name="clipboard-outline" size={16} color={TONE.yolk.onSolid} />
        <AppText style={styles.roundButtonLabel}>{t('admin.pregnancy.round')}</AppText>
        <Ionicons name="chevron-forward" size={16} color={TONE.yolk.onSolid} />
      </Pressable>
    </View>
  );
}

function Fact({
  label,
  value,
  muted,
  strong,
  testID,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.fact}>
      <AppText style={styles.factLabel}>{label}</AppText>
      <AppText
        style={[styles.factValue, muted && styles.factMuted, strong && styles.factStrong]}
        testID={testID}
      >
        {value}
      </AppText>
    </View>
  );
}

function CheckCard({
  check,
  onEvent,
}: {
  check: PregnancyCheck;
  onEvent: (id: number) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = checkTone(check);
  const look = TONE[tone];
  const badge = dueBadge(t, check);
  const isMember = check.owner_type === 'member';
  const pin = hasPin(check);
  const lat = Number(check.gps_lat);
  const lng = Number(check.gps_lng);
  const dial = String(check.owner_mobile ?? '').replace(/\s/g, '');

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-pregnancy-check-${check.id}`}
    >
      <View style={styles.cardTop}>
        <Disc tone={tone} icon={isMember ? 'person' : 'person-outline'} size={34} />
        <View style={styles.flex}>
          <AppText style={styles.cardName}>
            {check.owner_name || t('admin.pregnancy.unnamed')}
          </AppText>
          {/* Who she is: her member code is what the dairy's office knows her by. */}
          <AppText style={styles.sub} testID={`admin-pregnancy-owner-${check.id}`}>
            {isMember
              ? check.member_code
                ? `${t('admin.pregnancy.member')} · ${check.member_code}`
                : t('admin.pregnancy.member')
              : t('admin.pregnancy.nonMember')}
          </AppText>
        </View>
        <View testID={`admin-pregnancy-badge-${check.id}`}>
          <Pill label={badge.label} tone={badge.tone} />
        </View>
      </View>

      {/* A number to ring: ninety days on, the animal may be at a relative's. */}
      {check.owner_mobile ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => Linking.openURL(`tel:${dial}`).catch(() => undefined)}
          style={({ pressed }) => [styles.phone, pressed && styles.pressed]}
          testID={`admin-pregnancy-phone-${check.id}`}
        >
          <Ionicons name="call" size={14} color={colors.primaryDark} />
          <AppText style={styles.phoneLabel}>{phone(check.owner_mobile)}</AppText>
        </Pressable>
      ) : (
        <AppText style={styles.noPhone}>{t('admin.pregnancy.noNumber')}</AppText>
      )}

      <View style={styles.inset}>
        {check.ear_tag_no ? (
          <Fact
            label={t('admin.pregnancy.tag')}
            value={check.ear_tag_no}
            strong
            testID={`admin-pregnancy-tag-${check.id}`}
          />
        ) : (
          <Fact
            label={t('admin.pregnancy.tag')}
            value={t('admin.pregnancy.notTagged')}
            muted
            testID={`admin-pregnancy-tag-${check.id}`}
          />
        )}
        <Fact label={t('admin.pregnancy.due')} value={day(t, check.due_on)} />
        <Fact label={t('admin.pregnancy.served')} value={day(t, check.served_on)} />
        <Fact label={t('admin.pregnancy.animal')} value={animalOf(t, check)} />
        {!!check.calving_due_on && (
          <Fact label={t('admin.pregnancy.calving')} value={day(t, check.calving_due_on)} />
        )}
        {!!check.checked_at && (
          <Fact label={t('admin.pregnancy.checked')} value={dayTime(t, check.checked_at)} />
        )}
        {/* Stamped at the time, so a row shows what the farmer was actually quoted. */}
        {!!check.outcome &&
          (check.amount_charged ? (
            <Fact
              label={t('admin.pregnancy.charged')}
              value={rupees(check.amount_charged)}
              testID={`admin-pregnancy-charged-${check.id}`}
            />
          ) : (
            <Fact
              label={t('admin.pregnancy.charged')}
              value={t(
                check.outcome === 'declined'
                  ? 'admin.pregnancy.chargedNothing'
                  : 'admin.pregnancy.noRate',
              )}
              muted
              testID={`admin-pregnancy-charged-${check.id}`}
            />
          ))}
      </View>

      {/* Where, said twice: the village plans the round, the pin finds the yard. */}
      <View style={styles.where}>
        <Disc tone="blue" icon="location" size={28} />
        <View style={styles.flex}>
          <AppText style={styles.whereVillage}>
            {(check.mpp_name || t('admin.pregnancy.unknownVillage')) +
              (check.mpp_code ? ` · ${check.mpp_code}` : '')}
          </AppText>
          <AppText style={styles.sub} testID={`admin-pregnancy-pin-${check.id}`}>
            {pin
              ? coords(lat, lng) +
                (check.gps_source === 'photo' ? ` · ${t('admin.pregnancy.fromPhoto')}` : '')
              : t('admin.pregnancy.noPin')}
          </AppText>
        </View>
      </View>

      {!!check.note && (
        <View style={styles.note}>
          <Ionicons name="chatbox-ellipses-outline" size={14} color={colors.textMuted} />
          <AppText style={styles.noteText}>{check.note}</AppText>
        </View>
      )}

      <View style={styles.actions}>
        {pin && (
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${lat},${lng}`,
                )}`,
              ).catch(() => undefined)
            }
            style={({ pressed }) => [styles.action, styles.actionMap, pressed && styles.pressed]}
            testID={`admin-pregnancy-map-${check.id}`}
          >
            <Ionicons name="map" size={15} color={TONE.blue.onSolid} />
            <AppText style={[styles.actionLabel, { color: TONE.blue.onSolid }]}>
              {t('admin.pregnancy.map')}
            </AppText>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => onEvent(check.ai_event_id)}
          style={({ pressed }) => [styles.action, styles.actionEvent, pressed && styles.pressed]}
          testID={`admin-pregnancy-event-${check.id}`}
        >
          <Ionicons name="document-text" size={15} color={TONE.green.onSolid} />
          <AppText style={[styles.actionLabel, { color: TONE.green.onSolid }]}>
            {t('admin.pregnancy.insemination')}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const WINDOWS: PregnancyWindow[] = ['due', 'done', 'all'];

/**
 * One Mait's round: which animals, read down the phone to the Mait it belongs to. Exported so
 * the Exceptions screen's overdue queue opens the same round rather than a second copy of it.
 */
export function PregnancyRound({
  maitId,
  name,
  code,
  onBack,
  onEvent,
}: {
  maitId: number;
  name: string;
  code: string;
  onBack: () => void;
  onEvent: (id: number) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [window, setWindow] = useState<PregnancyWindow>('due');
  const round = useAdminMaitPregnancyChecksQuery({ maitId, window, limit: 100 });
  const data = round.data;
  const summary = data?.summary;
  const checks = data?.results ?? [];
  const mait = data?.mait;
  const rate = summary?.conception_rate;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={round.isFetching && !round.isLoading}
            onRefresh={() => round.refetch()}
          />
        }
        testID="admin-pregnancy-round"
      >
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          hitSlop={8}
          style={styles.back}
          testID="admin-pregnancy-round-back"
        >
          <Ionicons name="arrow-back" size={18} color={colors.ink} />
          <AppText style={styles.backLabel}>{t('admin.pregnancy.backToList')}</AppText>
        </Pressable>

        <View style={styles.banner}>
          <View style={styles.bannerTop}>
            <Disc tone="blue" icon="person" size={40} />
            <View style={styles.flex}>
              <AppText style={styles.bannerName} testID="admin-pregnancy-round-title">
                {`${mait?.name ?? name} · ${mait?.sahayak_vendor_code ?? code}`}
              </AppText>
              {!!summary && (
                <AppText style={styles.bannerMeta} testID="admin-pregnancy-round-owed">
                  {t('admin.pregnancy.stillOwedN', { n: num(summary.open) })}
                </AppText>
              )}
            </View>
          </View>
          {!!summary && (
            <View style={styles.bannerPills} testID="admin-pregnancy-round-summary">
              <Pill
                label={
                  summary.overdue
                    ? t('admin.pregnancy.overdueN', { count: summary.overdue })
                    : t('admin.pregnancy.noneOverdue')
                }
                tone={summary.overdue ? 'yolk' : 'green'}
              />
              <Pill
                label={
                  rate === null || rate === undefined
                    ? t('admin.pregnancy.noRateYet')
                    : t('admin.pregnancy.conceived', { pct: rate.toFixed(1) })
                }
                tone={rateTone(rate) ?? 'slate'}
              />
            </View>
          )}
        </View>

        <View style={styles.tabs}>
          {WINDOWS.map(w => (
            <FilterChip
              key={w}
              label={t(`admin.pregnancy.window_${w}`)}
              icon={w === 'due' ? 'time-outline' : w === 'done' ? 'checkmark-done' : 'list'}
              tone="blue"
              active={window === w}
              onPress={() => setWindow(w)}
              testID={`admin-pregnancy-window-${w}`}
            />
          ))}
        </View>

        {round.isLoading || (round.isFetching && !data) ? (
          <SkeletonRows />
        ) : round.isError ? (
          <Banner
            tone="error"
            message={
              (round.error as { data?: { detail?: string } })?.data?.detail ??
              t('admin.pregnancy.roundError')
            }
          />
        ) : checks.length === 0 ? (
          <EmptyState
            message={t(
              window === 'done' ? 'admin.pregnancy.nothingRecorded' : 'admin.pregnancy.roundClear',
            )}
          />
        ) : (
          <>
            {checks.map(check => (
              <CheckCard key={check.id} check={check} onEvent={onEvent} />
            ))}
            {/* Capped rather than paged; the count says how deep it really goes. */}
            {(data?.count ?? checks.length) > checks.length && (
              <AppText style={styles.foot} testID="admin-pregnancy-round-more">
                {t('admin.pregnancy.firstN', {
                  n: num(checks.length),
                  total: num(data?.count),
                })}
              </AppText>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default function AdminPregnancyScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const store = useStore<RootState>();
  const data = useAdminPregnancyOversightQuery();
  const [term, setTerm] = useState('');
  const [overdueFirst, setOverdueFirst] = useState(true);
  const [openMait, setOpenMait] = useState<number | null>(null);
  const [eventId, setEventId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const summary = data.data?.summary;
  const rows = useMemo(() => data.data?.results ?? [], [data.data]);

  const needle = term.trim().toLowerCase();
  const shown = useMemo(() => {
    const found = needle
      ? rows.filter(
          row =>
            row.name.toLowerCase().includes(needle) ||
            row.sahayak_vendor_code.toLowerCase().includes(needle) ||
            (row.mpp_codes ?? []).join(' ').toLowerCase().includes(needle),
        )
      : rows;
    // The server already sends them most overdue first.
    return overdueFirst ? found : [...found].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, needle, overdueFirst]);

  /** The file carries the search with it: a Mait typed in means that Mait. */
  const exportReport = async () => {
    const access = store.getState().auth.accessToken;
    if (!access || exporting) {
      return;
    }
    setProblem(null);
    setExporting(true);
    const query = term.trim() ? `?search=${encodeURIComponent(term.trim())}` : '';
    try {
      await downloadAndShare(
        `/reports/pregnancy/${query}`,
        'pregnancy-checks.xlsx',
        XLSX_MIME,
        access,
      );
    } catch {
      setProblem(t('admin.pregnancy.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  if (eventId !== null) {
    return (
      <EventRecord
        eventId={eventId}
        canDelete={false}
        onBack={() => setEventId(null)}
        onDeleted={() => setEventId(null)}
      />
    );
  }

  const opened = openMait !== null ? rows.find(r => r.mait_id === openMait) : undefined;
  if (opened) {
    return (
      <PregnancyRound
        maitId={opened.mait_id}
        name={opened.name}
        code={opened.sahayak_vendor_code}
        onBack={() => setOpenMait(null)}
        onEvent={setEventId}
      />
    );
  }

  const rate = summary?.conception_rate;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={data.isFetching && !data.isLoading}
            onRefresh={() => data.refetch()}
          />
        }
        testID="admin-pregnancy"
      >
        <View style={styles.header}>
          <View style={styles.flex}>
            <AppText style={styles.title}>{t('admin.pregnancy.title')}</AppText>
            <AppText style={styles.sub} testID="admin-pregnancy-meta">
              {t('admin.pregnancy.meta', { n: summary ? num(summary.maits) : '—' })}
            </AppText>
          </View>
          {/* Ink, as every export is: a file leaving the platform. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: exporting }}
            disabled={exporting}
            onPress={exportReport}
            style={({ pressed }) => [styles.export, pressed && styles.pressed]}
            testID="admin-pregnancy-export"
          >
            <Ionicons name="download-outline" size={16} color={colors.surface} />
            <AppText style={styles.exportLabel}>
              {t(exporting ? 'admin.pregnancy.preparing' : 'admin.pregnancy.download')}
            </AppText>
          </Pressable>
        </View>

        {!!problem && <Banner tone="error" message={problem} />}

        {data.isLoading ? (
          <SkeletonOverview chart />
        ) : data.isError || !summary ? (
          <EmptyState message={t('admin.pregnancy.error')} />
        ) : (
          <>
            {/* Conception rate leads: the number the platform is judged on. */}
            <View style={styles.tiles}>
              <Tile
                tone="green"
                icon="checkmark-circle"
                label={t('admin.pregnancy.conceptionRate')}
                value={rate === null || rate === undefined ? '—' : `${rate.toFixed(1)}%`}
                foot={
                  summary.decided
                    ? t('admin.pregnancy.settledN', {
                        a: num(summary.conceived),
                        b: num(summary.decided),
                      })
                    : t('admin.pregnancy.noAnswerYet')
                }
                testID="admin-pregnancy-tile-rate"
              />
              <Tile
                tone="yolk"
                icon="warning"
                label={t('admin.pregnancy.overdue')}
                value={num(summary.overdue)}
                foot={t(
                  summary.overdue ? 'admin.pregnancy.nobodyWalked' : 'admin.pregnancy.upToDate',
                )}
                testID="admin-pregnancy-tile-overdue"
              />
            </View>
            <View style={styles.tiles}>
              <Tile
                tone="blue"
                icon="calendar"
                label={t('admin.pregnancy.dueThisWeek')}
                value={num(summary.due_this_week)}
                foot={t('admin.pregnancy.includingOverdue')}
                testID="admin-pregnancy-tile-due"
              />
              <Tile
                tone="slate"
                icon="document-text"
                label={t('admin.pregnancy.recorded')}
                value={num(summary.recorded)}
                // Refusals are named, never folded into "not".
                foot={
                  t('admin.pregnancy.split', {
                    p: num(summary.pregnant),
                    n: num(summary.not_pregnant),
                    u: num(summary.unsure),
                  }) +
                  (summary.declined
                    ? ` · ${t('admin.pregnancy.declinedN', { n: num(summary.declined) })}`
                    : '')
                }
                testID="admin-pregnancy-tile-recorded"
              />
            </View>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.info} />
              <TextInput
                style={styles.searchInput}
                value={term}
                onChangeText={setTerm}
                placeholder={t('admin.pregnancy.searchPlaceholder')}
                placeholderTextColor={colors.textDisabled}
                autoCorrect={false}
                autoCapitalize="none"
                testID="admin-pregnancy-search"
              />
              {term.length > 0 && (
                <Pressable onPress={() => setTerm('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </Pressable>
              )}
            </View>
            <View style={styles.filterRow}>
              <FilterChip
                label={t('admin.pregnancy.overdueFirst')}
                icon="swap-vertical"
                tone="yolk"
                active={overdueFirst}
                onPress={() => setOverdueFirst(v => !v)}
                testID="admin-pregnancy-overdue-first"
              />
              <AppText style={styles.sub} testID="admin-pregnancy-count">
                {needle
                  ? t('admin.pregnancy.countOf', { n: num(shown.length), total: num(rows.length) })
                  : t('admin.pregnancy.countN', { count: rows.length })}
              </AppText>
            </View>

            {shown.length === 0 ? (
              <EmptyState
                message={t(rows.length ? 'admin.pregnancy.noMatch' : 'admin.pregnancy.none')}
              />
            ) : (
              shown.map(row => (
                <MaitCard key={row.mait_id} row={row} onOpen={() => setOpenMait(row.mait_id)} />
              ))
            )}

            <Notice
              tone="blue"
              icon="information-circle"
              title={t('admin.pregnancy.noticeTitle')}
              body={t('admin.pregnancy.noticeBody')}
              testID="admin-pregnancy-notice"
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  sub: { ...typography.caption, color: colors.textMuted },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  foot: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  title: { ...typography.h3, color: colors.ink },
  export: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  exportLabel: { ...typography.label, color: colors.surface },

  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: { flex: 1, padding: spacing[3], gap: 4, borderRadius: radius.md, borderWidth: 1 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, flex: 1 },
  tileValue: { ...typography.h1, color: colors.ink },
  tileFoot: { ...typography.caption, color: colors.ink },

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
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  cardName: { ...typography.bodyStrong, color: colors.ink },
  inset: {
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },

  codes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  code: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: ink[200],
  },
  codeLabel: { ...typography.caption, color: colors.ink },
  more: { paddingHorizontal: 4, paddingVertical: 2 },
  moreLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.info },

  figures: { flexDirection: 'row', paddingVertical: 8 },
  figure: { flex: 1, alignItems: 'center' },
  figureValue: { ...typography.h3, color: colors.ink },
  rateBlock: { paddingVertical: 8, gap: 4 },
  rateLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[2] },
  rateValue: { ...typography.h3 },
  rateNone: { ...typography.label, color: colors.textMuted },
  meter: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: ink[50],
  },
  meterFill: { height: '100%', borderRadius: 4 },

  roundButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    backgroundColor: TONE.yolk.solid,
  },
  roundButtonLabel: { ...typography.label, color: TONE.yolk.onSolid },

  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: MIN_TOUCH_TARGET },
  backLabel: { ...typography.label, color: colors.ink },
  banner: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: TONE.blue.wash,
    borderColor: TONE.blue.border,
  },
  bannerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  bannerName: { ...typography.bodyStrong, color: colors.ink },
  bannerMeta: { ...typography.caption, color: TONE.blue.text },
  bannerPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },

  phone: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: TONE.green.border,
  },
  phoneLabel: { ...typography.label, color: colors.primaryDark },
  noPhone: { ...typography.caption, color: colors.textMuted, fontStyle: 'italic' },

  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: 6,
  },
  factLabel: { ...typography.caption, color: colors.textMuted },
  factValue: { ...typography.label, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  factMuted: { color: colors.textMuted, fontStyle: 'italic' },
  factStrong: { letterSpacing: 1 },

  where: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  whereVillage: { ...typography.label, color: colors.ink },
  note: {
    flexDirection: 'row',
    gap: 6,
    padding: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  noteText: { ...typography.caption, color: colors.ink, flex: 1 },

  actions: { flexDirection: 'row', gap: spacing[2] },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
  },
  actionMap: { backgroundColor: TONE.blue.solid },
  actionEvent: { backgroundColor: TONE.green.solid },
  actionLabel: { ...typography.label },
});
