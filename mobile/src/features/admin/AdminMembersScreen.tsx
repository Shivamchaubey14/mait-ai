/**
 * Members, for an admin — the portal's Members screen (`members.html`), its change-number
 * dialog, and the member record (`member.html`) on a handset.
 *
 * 105,000 rows from the SAP master, so the list is search-first, paged 25 at a time, and
 * narrowed by an MPP (searched, never a menu of thousands), by the members with no number, and
 * by the numbers the office set.
 *
 * A member with no usable number is the case that matters: she cannot authorise a payment, so a
 * Mait who starts a flow for her is stranded with the straw already used. She is shown in red,
 * never filtered away.
 *
 * Two things only an Admin is handed, and the screen says both rules where they apply:
 *
 * - **The Aadhaar**, masked to its last four. *Show* fetches one member's whole number — logged
 *   against the account, rate-limited, never cached — and it masks itself again after thirty
 *   seconds, with the seconds counted down beside it. It is never written anywhere on the
 *   handset; leaving the card forgets it.
 * - **Changing the number**, the one field the office edits. It is where payment and
 *   verification codes go, so the sheet asks why, says what saving will do before it is done,
 *   and shows every earlier change. A number the office sets is marked *Office* and survives a
 *   re-upload of the master. The change carries the number it was opened on, so two admins on
 *   one member are one change and one clear refusal rather than a silent overwrite.
 */

import React, { useEffect, useMemo, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { EmptyState } from '@/components';
import { SkeletonFeed, SkeletonRecord, SkeletonRows } from '@/components/skeleton';
import { Sheet } from '@/components/BottomSheet';
import { initials } from '@/components/frame';
import {
  useAdminListMembersQuery,
  useChangeMemberMobileMutation,
  useGetMemberQuery,
  useMemberMobileHistoryQuery,
  useRevealMemberAadhaarMutation,
} from '@api/endpoints';
import type { Member } from '@api/types';
import { useAppSelector } from '@/store';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { MppSheet } from './AdminEventsScreen';
import { Disc, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';
import { useDebounced } from './common';

const LIMIT = 25;
/** How long a revealed Aadhaar stays on screen before it masks itself again. */
export const REVEAL_SECONDS = 30;

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}

/** `98123 45678` — the way a number is read out over the phone. */
export function spaced(digits: string | null | undefined): string {
  const d = digits ?? '';
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}

/** `1234 5678 9012`, the way the card prints it. */
export function grouped(digits: string): string {
  return digits.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** The server's rule, echoed so the sheet can say "not a number" before a round trip. */
export function normalise(value: string): string {
  let raw = value.replace(/[\s-]/g, '');
  if (raw.startsWith('+91')) {
    raw = raw.slice(3);
  } else if (raw.startsWith('91') && raw.length === 12) {
    raw = raw.slice(2);
  }
  return /^[6-9]\d{9}$/.test(raw) ? raw : '';
}

function dateOf(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  // A bare date ("2026-10-12") is read off its parts: `new Date` takes it as UTC midnight and
  // can show the day before.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  if (bare) {
    return `${Number(bare[3])} ${months[Number(bare[2]) - 1] ?? ''} ${bare[1]}`;
  }
  const d = new Date(iso);
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

/** Who set a number, and when — the line an office number carries. */
function setBy(t: TFunction, member: Member): string {
  if (member.mobile_source !== 'office') {
    return t('admin.members.fromSap');
  }
  const name = member.mobile_updated_by_name || t('admin.members.theOffice');
  return member.mobile_updated_at
    ? t('admin.members.setByOn', { name, date: dateOf(t, member.mobile_updated_at) })
    : t('admin.members.setBy', { name });
}

type Standing = 'unusable' | 'active' | 'inactive';

function standingOf(member: Member): Standing {
  if (!member.mobile_no) {
    return 'unusable';
  }
  return member.activation_status === 'Yes' ? 'active' : 'inactive';
}

const STANDING_TONE: Record<Standing, ToneName> = {
  unusable: 'red',
  active: 'green',
  inactive: 'slate',
};

/** The green shield an office-set number wears: kept when the master is uploaded again. */
function OfficeBadge({ label }: { label: string }): React.JSX.Element {
  return (
    <View style={styles.office}>
      <Ionicons name="shield-checkmark" size={12} color={colors.surface} />
      <AppText style={styles.officeLabel}>{label}</AppText>
    </View>
  );
}

function BackTo({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      testID="admin-member-back"
    >
      <Ionicons name="arrow-back" size={16} color={colors.surface} />
      <AppText style={styles.backLabel}>{label}</AppText>
    </Pressable>
  );
}

// --------------------------------------------------------------------------------------
// The Aadhaar
// --------------------------------------------------------------------------------------

/**
 * Masked to its last four, with Show for the whole number.
 *
 * The full number lives only in this component's state for thirty seconds, counted down beside
 * it, and is dropped when the time is up, when Hide is pressed, or when the card goes away.
 */
function AadhaarFact({ member }: { member: Member }): React.JSX.Element {
  const { t } = useTranslation();
  const [reveal, revealState] = useRevealMemberAadhaarMutation();
  const [shown, setShown] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const masked = member.aadhar_masked ?? '';

  useEffect(() => {
    if (!shown) {
      return;
    }
    const id = setInterval(() => {
      setLeft(s => {
        if (s <= 1) {
          setShown(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [shown]);

  const open = async () => {
    setProblem(null);
    try {
      const body = await reveal(member.member_code).unwrap();
      setShown(body.aadhar_no || '');
      setLeft(REVEAL_SECONDS);
    } catch (error) {
      const status = (error as { status?: number })?.status;
      setProblem(t(status === 429 ? 'admin.members.revealLimit' : 'admin.members.revealFailed'));
    }
  };

  return (
    <View
      style={[styles.factRow, styles.factRule]}
      testID={`admin-member-aadhaar-${member.member_code}`}
    >
      <Ionicons name="card-outline" size={14} color={yolk[800]} />
      <AppText style={styles.factLabel}>{t('admin.members.factAadhaar')}</AppText>
      <View style={styles.flex}>
        {!masked ? (
          <AppText style={[styles.factValue, styles.muted]}>{t('admin.members.notOnFile')}</AppText>
        ) : shown !== null ? (
          <View style={styles.aadhaarRow}>
            <View style={[styles.aadhaarBox, styles.aadhaarOpen]}>
              <AppText style={styles.aadhaarOpenText} testID="admin-member-aadhaar-full">
                {grouped(shown)}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShown(null)}
              style={({ pressed }) => [styles.reveal, styles.revealHide, pressed && styles.pressed]}
              testID={`admin-member-hide-${member.member_code}`}
            >
              <Ionicons name="eye-off-outline" size={14} color={colors.surface} />
              <AppText style={styles.revealHideLabel}>{t('admin.members.hide')}</AppText>
            </Pressable>
            <AppText style={styles.countdown}>{t('admin.members.masksIn', { s: left })}</AppText>
          </View>
        ) : (
          <View style={styles.aadhaarRow}>
            <View style={styles.aadhaarBox}>
              <AppText style={styles.aadhaarText} testID="admin-member-aadhaar-masked">
                {`XXXX XXXX ${masked.slice(-4)}`}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityHint={t('admin.members.revealLogged')}
              onPress={open}
              disabled={revealState.isLoading}
              style={({ pressed }) => [styles.reveal, pressed && styles.pressed]}
              testID={`admin-member-reveal-${member.member_code}`}
            >
              {revealState.isLoading ? (
                <ActivityIndicator size="small" color={yolk[800]} />
              ) : (
                <Ionicons name="eye-outline" size={14} color={yolk[800]} />
              )}
              <AppText style={styles.revealLabel}>{t('admin.members.show')}</AppText>
            </Pressable>
          </View>
        )}
        {!!problem && <AppText style={styles.problemInline}>{problem}</AppText>}
      </View>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Changing the number
// --------------------------------------------------------------------------------------

const REASONS: [string, string][] = [
  ['admin.members.reasonRang', 'admin.members.reasonRangText'],
  ['admin.members.reasonMait', 'admin.members.reasonMaitText'],
  ['admin.members.reasonSap', 'admin.members.reasonSapText'],
];

function ChangeNumberSheet({
  member,
  onClose,
  onSaved,
  onConflict,
}: {
  member: Member;
  onClose: () => void;
  onSaved: (text: string, tone: ToneName) => void;
  onConflict: (text: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const history = useMemberMobileHistoryQuery(member.member_code, {
    refetchOnMountOrArgChange: true,
  });
  const [change, changeState] = useChangeMemberMobileMutation();

  const next = normalise(typed);
  const current = member.mobile_no || '';

  // What saving will do, in one sentence, before it is done: green when it is ready, red when
  // the server would refuse it, quiet until there is something to say.
  let tone: ToneName | 'quiet' = 'quiet';
  let preview = t('admin.members.previewQuiet');
  let ready = false;
  if (typed.trim() && !next) {
    tone = 'red';
    preview = t('admin.members.previewBad');
  } else if (next && next === current) {
    tone = 'red';
    preview = t('admin.members.previewSame');
  } else if (next && reason.trim().length < 4) {
    tone = 'yolk';
    preview = t('admin.members.previewReason');
  } else if (next) {
    tone = 'green';
    ready = true;
    preview = current
      ? t('admin.members.previewChange', {
          from: spaced(current),
          to: spaced(next),
          name: member.member_name,
        })
      : t('admin.members.previewAdd', { to: spaced(next), name: member.member_name });
  }

  const save = async () => {
    if (!ready) {
      return;
    }
    setProblem(null);
    try {
      const body = await change({
        code: member.member_code,
        mobile_no: next,
        reason: reason.trim(),
        // The number this was opened on: if a colleague changed it since, the server refuses
        // rather than letting this save silently undo their correction.
        expected_mobile: current,
      }).unwrap();
      const shared = body.shared_with ?? [];
      onSaved(
        shared.length
          ? t('admin.members.savedShared', {
              name: member.member_name,
              mobile: spaced(body.member.mobile_no),
              others: shared.map(o => `${o.member_name} (${o.member_code})`).join(', '),
            })
          : t('admin.members.saved', {
              name: member.member_name,
              mobile: spaced(body.member.mobile_no),
            }),
        shared.length ? 'yolk' : 'green',
      );
    } catch (error) {
      const failure = error as { status?: number; data?: Record<string, unknown> };
      const data = failure?.data;
      const said =
        (typeof data?.detail === 'string' && data.detail) ||
        Object.values(data ?? {})
          .flat()
          .filter((v): v is string => typeof v === 'string')
          .join(' · ');
      if (failure?.status === 409) {
        // Somebody else changed it: close, and show the list as it now stands.
        onConflict(said || t('admin.members.conflict'));
        return;
      }
      setProblem(said || t('admin.members.saveFailed'));
    }
  };

  const look = tone === 'quiet' ? null : TONE[tone];
  const rows = history.data?.results ?? [];

  return (
    <Sheet
      visible
      title={t('admin.members.sheetTitle')}
      subtitle={`${member.member_name} · ${member.member_code}`}
      onClose={onClose}
      testID="admin-member-phone"
      footer={
        <View style={styles.sheetFoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready }}
            onPress={save}
            disabled={!ready || changeState.isLoading}
            style={({ pressed }) => [
              styles.primary,
              styles.flex,
              (!ready || changeState.isLoading) && styles.primaryOff,
              pressed && styles.pressed,
            ]}
            testID="admin-member-phone-save"
          >
            {changeState.isLoading ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Ionicons name="checkmark" size={18} color={colors.surface} />
            )}
            <AppText style={styles.primaryLabel}>
              {t(changeState.isLoading ? 'admin.members.saving' : 'admin.members.save')}
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            testID="admin-member-phone-cancel"
          >
            <AppText style={styles.secondaryLabel}>{t('admin.members.cancel')}</AppText>
          </Pressable>
        </View>
      }
    >
      <View style={styles.sheetBody}>
        {/* What is on file now, and where it came from. */}
        <View
          style={[styles.now, { backgroundColor: TONE.blue.wash, borderColor: TONE.blue.border }]}
        >
          <AppText style={styles.nowLabel}>{t('admin.members.onFileNow')}</AppText>
          <AppText style={styles.nowNumber} testID="admin-member-phone-current">
            {current ? spaced(current) : t('admin.members.noNumber')}
          </AppText>
          {member.mobile_source === 'office' ? (
            <OfficeBadge label={setBy(t, member)} />
          ) : (
            <AppText style={styles.nowSource}>{t('admin.members.fromSap')}</AppText>
          )}
        </View>

        <View style={styles.sheetStep}>
          <View style={styles.sheetStepHead}>
            <View style={styles.stepDot}>
              <AppText style={styles.stepDotLabel}>1</AppText>
            </View>
            <AppText style={styles.sheetStepTitle}>{t('admin.members.newNumber')}</AppText>
          </View>
          <View style={styles.phoneInput}>
            <AppText style={styles.prefix}>+91</AppText>
            <TextInput
              style={styles.phoneField}
              value={typed}
              onChangeText={setTyped}
              keyboardType="phone-pad"
              maxLength={16}
              placeholder="98123 45678"
              placeholderTextColor={colors.textDisabled}
              autoFocus
              testID="admin-member-phone-new"
            />
          </View>
          <AppText style={[styles.hint, !!typed.trim() && !next && styles.hintBad]}>
            {t(typed.trim() && !next ? 'admin.members.newBad' : 'admin.members.newHint')}
          </AppText>
        </View>

        <View style={styles.sheetStep}>
          <View style={styles.sheetStepHead}>
            <View style={styles.stepDot}>
              <AppText style={styles.stepDotLabel}>2</AppText>
            </View>
            <AppText style={styles.sheetStepTitle}>{t('admin.members.why')}</AppText>
          </View>
          <View style={styles.reasons}>
            {REASONS.map(([label, text]) => {
              const on = reason === t(text);
              return (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setReason(t(text))}
                  style={[styles.reasonChip, on && styles.reasonChipOn]}
                  testID={`admin-member-reason-${label.split('.').pop()}`}
                >
                  <AppText style={[styles.reasonLabel, on && styles.reasonLabelOn]}>
                    {t(label)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={styles.reasonField}
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={255}
            placeholder={t('admin.members.reasonPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            testID="admin-member-phone-reason"
          />
        </View>

        <View
          style={[
            styles.preview,
            look
              ? { backgroundColor: look.wash, borderColor: look.border }
              : { backgroundColor: ink[50], borderColor: ink[200] },
          ]}
          testID="admin-member-phone-preview"
        >
          {tone === 'green' && (
            <Ionicons name="shield-checkmark" size={16} color={TONE.green.text} />
          )}
          <AppText style={[styles.previewText, look && { color: look.text }]}>{preview}</AppText>
        </View>

        {!!problem && (
          <View style={styles.problem}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <AppText style={styles.problemText}>{problem}</AppText>
          </View>
        )}

        <View style={styles.history}>
          <AppText style={styles.historyTitle}>{t('admin.members.history')}</AppText>
          {history.isLoading ? (
            <SkeletonFeed />
          ) : history.isError ? (
            <AppText style={styles.hint}>{t('admin.members.historyFailed')}</AppText>
          ) : !rows.length ? (
            <AppText style={styles.hint}>{t('admin.members.historyNone')}</AppText>
          ) : (
            rows.map((row, index) => (
              <View key={`${row.when}-${index}`} style={styles.historyRow}>
                <View style={styles.changeDot} />
                <View style={styles.flex}>
                  <AppText style={styles.changeWhat}>
                    <AppText style={styles.changeBefore}>
                      {row.before || t('admin.members.noNumberShort')}
                    </AppText>
                    {'  →  '}
                    <AppText style={styles.changeAfter}>{row.after}</AppText>
                  </AppText>
                  <AppText style={styles.changeMeta}>
                    {[dateOf(t, row.when), row.by, row.reason ? `“${row.reason}”` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                </View>
              </View>
            ))
          )}
        </View>
      </View>
    </Sheet>
  );
}

// --------------------------------------------------------------------------------------
// The member record
// --------------------------------------------------------------------------------------

function Tile({
  tone,
  icon,
  label,
  value,
  pill,
  foot,
  testID,
}: {
  tone: ToneName;
  icon: string;
  label: string;
  value?: string;
  pill?: string;
  foot: string;
  testID?: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.tile, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.tileHead}>
        <View style={[styles.tileChip, { backgroundColor: look.solid }]}>
          <Ionicons name={icon as never} size={13} color={look.onSolid} />
        </View>
        <AppText style={[styles.tileLabel, { color: look.text }]}>{label}</AppText>
      </View>
      {pill ? (
        <View style={styles.tilePill}>
          <Pill label={pill} tone={tone} />
        </View>
      ) : (
        <AppText style={styles.tileValue}>{value}</AppText>
      )}
      <AppText style={styles.tileFoot}>{foot}</AppText>
    </View>
  );
}

function Fact({
  label,
  value,
  sub,
  absent,
  last,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string | null;
  absent?: boolean;
  last?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.recordFact, !last && styles.factRule]}>
      <AppText style={styles.recordFactLabel}>{label}</AppText>
      <View style={styles.recordFactBody}>
        {typeof value === 'string' ? (
          <AppText style={[styles.recordFactValue, absent && styles.muted]}>{value}</AppText>
        ) : (
          value
        )}
        {!!sub && <AppText style={styles.recordFactSub}>{sub}</AppText>}
      </View>
    </View>
  );
}

function Record({ code, onBack }: { code: string; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const detail = useGetMemberQuery(code);
  const record = detail.data;
  const none = t('admin.members.notRecorded');

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={detail.isFetching && !detail.isLoading}
          onRefresh={() => detail.refetch()}
        />
      }
      testID="admin-member-record"
    >
      <BackTo label={t('admin.members.allMembers')} onPress={onBack} />

      {detail.isLoading ? (
        <SkeletonRecord />
      ) : !record ? (
        <EmptyState message={t('admin.members.missing')} />
      ) : (
        (() => {
          const animals = record.animals ?? [];
          const inseminations = animals.reduce((sum, a) => sum + (a.ai_event_count || 0), 0);
          const active = record.activation_status === 'Yes';
          const otp = !!record.can_receive_otp;
          const genderAge = [
            record.gender,
            record.age ? t('admin.members.yrs', { n: record.age }) : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <>
              <View style={styles.hero}>
                <View style={styles.heroTop}>
                  <Disc
                    tone={otp ? 'green' : 'red'}
                    text={initials(record.member_name)}
                    size={44}
                  />
                  <View style={styles.flex}>
                    <AppText style={styles.heroTitle}>{record.member_name || '—'}</AppText>
                    <AppText style={styles.heroMeta}>
                      {[
                        record.member_code,
                        record.mpp_name,
                        record.mpp_code ? `(${record.mpp_code})` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </AppText>
                  </View>
                </View>
              </View>

              {/* The questions asked before anything else, two at a time. */}
              <View style={styles.tiles}>
                <Tile
                  tone={active ? 'green' : 'yolk'}
                  icon={active ? 'checkmark' : 'time'}
                  label={t('admin.members.tileMembership')}
                  pill={t(active ? 'admin.members.state_active' : 'admin.members.state_inactive')}
                  foot={
                    active
                      ? record.activation_date
                        ? t('admin.members.activeSince', {
                            date: dateOf(t, record.activation_date),
                          })
                        : t('admin.members.activeMember')
                      : t('admin.members.notActivated')
                  }
                  testID="admin-member-tile-status"
                />
                {/* Whether a payment can be authorised for her at all: it needs a usable
                    number for the OTP. */}
                <Tile
                  tone={otp ? 'green' : 'red'}
                  icon={otp ? 'key' : 'close'}
                  label={t('admin.members.tileOtp')}
                  pill={t(otp ? 'admin.members.canAuthorise' : 'admin.members.blocked')}
                  foot={record.mobile_no ? spaced(record.mobile_no) : t('admin.members.noUsable')}
                  testID="admin-member-tile-otp"
                />
              </View>
              <View style={styles.tiles}>
                <Tile
                  tone="blue"
                  icon="paw"
                  label={t('admin.members.tileAnimals')}
                  value={num(animals.length)}
                  foot={t(animals.length ? 'admin.members.onRecord' : 'admin.members.noneYet')}
                />
                <Tile
                  tone="blue"
                  icon="medkit"
                  label={t('admin.members.tileEvents')}
                  value={num(inseminations)}
                  foot={t('admin.members.recordedAgainst')}
                />
              </View>

              {/* Who she is, as a column of facts: what an operator reads back down the phone. */}
              <View
                style={[
                  styles.panel,
                  { backgroundColor: TONE.blue.wash, borderColor: TONE.blue.border },
                ]}
              >
                <View style={styles.panelHead}>
                  <View style={[styles.tileChip, { backgroundColor: TONE.blue.solid }]}>
                    <Ionicons name="id-card-outline" size={14} color={colors.surface} />
                  </View>
                  <AppText style={[styles.panelTitle, { color: TONE.blue.text }]}>
                    {t('admin.members.herRecord')}
                  </AppText>
                </View>
                <View style={styles.inset}>
                  <Fact
                    label={t('admin.members.household')}
                    value={
                      record.father_husband_name
                        ? t('admin.members.householdValue', { name: record.father_husband_name })
                        : none
                    }
                    absent={!record.father_husband_name}
                  />
                  <Fact
                    label={t('admin.members.genderAge')}
                    value={genderAge || none}
                    absent={!genderAge}
                  />
                  <Fact
                    label={t('admin.members.category')}
                    value={record.category || none}
                    absent={!record.category}
                  />
                  <Fact
                    label={t('admin.members.education')}
                    value={record.education || none}
                    absent={!record.education}
                  />
                  <Fact
                    label={t('admin.members.factMobile')}
                    value={
                      record.mobile_no ? (
                        spaced(record.mobile_no)
                      ) : (
                        <Pill label={t('admin.members.noNumber')} tone="red" />
                      )
                    }
                  />
                  <Fact label={t('admin.members.factAadhaar')} value={record.aadhar_no || '—'} />
                  <Fact
                    label={t('admin.members.cattle')}
                    value={
                      Number(record.cattle_holding) > 0 ? num(Number(record.cattle_holding)) : none
                    }
                    absent={!(Number(record.cattle_holding) > 0)}
                  />
                  <Fact
                    label={t('admin.members.bank')}
                    value={record.bank_name || none}
                    sub={record.bank_name ? record.ifsc_code : null}
                    absent={!record.bank_name}
                  />
                  <Fact
                    label={t('admin.members.folio')}
                    value={record.folio_no || none}
                    absent={!record.folio_no}
                  />
                  <Fact
                    label={t('admin.members.factMpp')}
                    value={record.mpp_name || '—'}
                    sub={record.mpp_code}
                  />
                  <Fact
                    label={t('admin.members.activated')}
                    value={record.activation_date ? dateOf(t, record.activation_date) : none}
                    absent={!record.activation_date}
                    last
                  />
                </View>
              </View>

              {/* The animals registered to her — the reason this record exists in the portal. */}
              <View
                style={[
                  styles.panel,
                  { backgroundColor: TONE.green.wash, borderColor: TONE.green.border },
                ]}
              >
                <View style={styles.panelHead}>
                  <View style={[styles.tileChip, { backgroundColor: TONE.green.solid }]}>
                    <Ionicons name="paw" size={14} color={colors.surface} />
                  </View>
                  <AppText style={[styles.panelTitle, { color: TONE.green.text }]}>
                    {t('admin.members.animalsTitle')}
                  </AppText>
                  {!!animals.length && (
                    <Pill
                      label={t('admin.members.animalCount', { count: animals.length })}
                      tone="green"
                    />
                  )}
                </View>
                {animals.length ? (
                  animals.map(animal => (
                    <View
                      key={animal.id}
                      style={styles.animal}
                      testID={`admin-member-animal-${animal.id}`}
                    >
                      <View style={styles.animalTop}>
                        <AppText style={styles.animalName}>
                          {animal.animal_type_display || animal.animal_type}
                        </AppText>
                        <AppText style={styles.animalId}>
                          {t('admin.members.animalId', { id: animal.id })}
                        </AppText>
                        <View style={styles.flex} />
                        <View style={styles.aiBubble}>
                          <AppText style={styles.aiBubbleLabel}>
                            {`${t('admin.members.aiCount')} ${num(animal.ai_event_count)}`}
                          </AppText>
                        </View>
                      </View>
                      <AppText style={styles.animalMeta}>
                        {[
                          animal.breed || t('admin.members.notRecorded'),
                          animal.ear_tag_no || t('admin.members.noTag'),
                          animal.last_ai_at
                            ? `${t('admin.members.lastServed')} ${dateOf(t, animal.last_ai_at)}`
                            : t('admin.members.neverServed'),
                        ].join(' · ')}
                      </AppText>
                    </View>
                  ))
                ) : (
                  <AppText style={styles.hint}>{t('admin.members.noAnimals')}</AppText>
                )}
              </View>
            </>
          );
        })()
      )}
    </ScrollView>
  );
}

// --------------------------------------------------------------------------------------
// The list
// --------------------------------------------------------------------------------------

function MemberCard({
  member,
  canChange,
  onChange,
  onOpen,
}: {
  member: Member;
  canChange: boolean;
  onChange: () => void;
  onOpen: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const standing = standingOf(member);
  const tone = STANDING_TONE[standing];
  const look = TONE[tone];
  const hasAadhaar = Object.prototype.hasOwnProperty.call(member, 'aadhar_masked');

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: look.wash, borderColor: look.border },
        pressed && styles.pressed,
      ]}
      testID={`admin-member-${member.member_code}`}
    >
      <View style={styles.cardTop}>
        <Disc tone={tone} text={initials(member.member_name)} />
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{member.member_name || '—'}</AppText>
          {!!member.father_husband_name && (
            <AppText style={styles.cardSub}>{member.father_husband_name}</AppText>
          )}
          <View style={[styles.code, { borderColor: look.border }]}>
            <AppText style={[styles.codeLabel, { color: look.text }]}>{member.member_code}</AppText>
          </View>
        </View>
        <Pill label={t(`admin.members.state_${standing}`)} tone={tone} />
      </View>

      {/* White is paper, only inside a tinted card. */}
      <View style={styles.inset}>
        <View style={[styles.factRow, styles.factRule]}>
          <Ionicons name="location-outline" size={14} color={colors.info} />
          <AppText style={styles.factLabel}>{t('admin.members.factMpp')}</AppText>
          <AppText style={[styles.factValue, styles.flex]}>{member.mpp_code || '—'}</AppText>
        </View>
        {hasAadhaar && <AadhaarFact member={member} />}
        <View style={styles.factRow}>
          <Ionicons
            name="phone-portrait-outline"
            size={14}
            color={member.mobile_no ? colors.primaryDark : colors.error}
          />
          <AppText style={styles.factLabel}>{t('admin.members.factMobile')}</AppText>
          <View style={[styles.flex, styles.mobileRow]}>
            <AppText
              style={[styles.factValue, !member.mobile_no && styles.missing]}
              testID={`admin-member-mobile-${member.member_code}`}
            >
              {member.mobile_no ? spaced(member.mobile_no) : t('admin.members.noNumber')}
            </AppText>
            {member.mobile_source === 'office' && !!member.mobile_no && (
              <OfficeBadge label={t('admin.members.office')} />
            )}
          </View>
        </View>
      </View>

      <View style={styles.cardFoot}>
        {canChange ? (
          <Pressable
            accessibilityRole="button"
            onPress={onChange}
            style={({ pressed }) => [styles.change, pressed && styles.pressed]}
            testID={`admin-member-change-${member.member_code}`}
          >
            <Ionicons name="call-outline" size={15} color={colors.ink} />
            <AppText style={styles.changeLabel}>
              {t(member.mobile_no ? 'admin.members.changeNumber' : 'admin.members.addNumber')}
            </AppText>
          </Pressable>
        ) : (
          <View />
        )}
        <View style={styles.open}>
          <AppText style={[styles.openLabel, { color: look.text }]}>
            {t('admin.members.open')}
          </AppText>
          <Ionicons name="chevron-forward" size={15} color={look.text} />
        </View>
      </View>
    </Pressable>
  );
}

export default function AdminMembersScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const role = useAppSelector(state => state.auth.user?.role);
  // The API gates the change to Admins; nobody else is shown a button that only returns 403.
  const canChange = role === 'super_admin' || role === 'admin';

  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [mpp, setMpp] = useState<{ code: string; name: string } | null>(null);
  const [noMobile, setNoMobile] = useState(false);
  const [office, setOffice] = useState(false);
  const [offset, setOffset] = useState(0);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: ToneName } | null>(null);

  const filters = useMemo(
    () => ({ search, mpp: mpp?.code, noMobile, office }),
    [search, mpp, noMobile, office],
  );
  const list = useAdminListMembersQuery({ ...filters, offset });

  useEffect(() => {
    setOffset(0);
  }, [filters]);

  useEffect(() => {
    if (open === null) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  if (open !== null) {
    return (
      <View style={styles.root}>
        <Record code={open} onBack={() => setOpen(null)} />
      </View>
    );
  }

  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  const unusable = rows.filter(m => !m.mobile_no).length;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={list.isFetching && !list.isLoading}
            onRefresh={() => list.refetch()}
          />
        }
        testID="admin-members"
      >
        <View style={styles.top}>
          <AppText style={styles.count} testID="admin-members-count">
            {list.data ? t('admin.members.rows', { count, n: num(count) }) : '—'}
          </AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => setFlash({ text: t('admin.members.exportSoon'), tone: 'yolk' })}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            testID="admin-members-export"
          >
            <Ionicons name="download-outline" size={15} color={colors.ink} />
            <AppText style={styles.secondaryLabel}>{t('admin.members.export')}</AppText>
          </Pressable>
        </View>

        {!!flash && (
          <Notice
            tone={flash.tone}
            icon={
              flash.tone === 'green' ? 'checkmark' : flash.tone === 'red' ? 'alert' : 'information'
            }
            title={flash.text}
            body=""
            testID="admin-members-flash"
          />
        )}

        {/* Said on the screen rather than assumed: an operator who thinks they are seeing full
            numbers will read a masked one out to a farmer. */}
        <Notice
          tone="slate"
          icon="eye-off"
          title={t('admin.members.maskTitle')}
          body={t('admin.members.maskBody')}
          testID="admin-members-mask-note"
        />
        <Notice
          tone="green"
          icon="shield-checkmark"
          title={t('admin.members.mobileRuleTitle')}
          body={t('admin.members.mobileRuleBody')}
          testID="admin-members-mobile-note"
        />

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.info} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={text => {
              setFlash(null);
              setTerm(text);
            }}
            placeholder={t('admin.members.searchPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            testID="admin-members-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <View style={styles.filters}>
          <FilterChip
            label={mpp ? mpp.name : t('admin.members.mppAll')}
            icon="business-outline"
            tone="blue"
            active={!!mpp}
            onPress={() => setPicking(true)}
            testID="admin-members-filter-mpp"
          />
          <FilterChip
            label={t('admin.members.filterNoMobile')}
            icon="call-outline"
            tone="red"
            active={noMobile}
            onPress={() => setNoMobile(on => !on)}
            testID="admin-members-filter-no-mobile"
          />
          <FilterChip
            label={t('admin.members.filterOffice')}
            icon="shield-checkmark-outline"
            tone="green"
            active={office}
            onPress={() => setOffice(on => !on)}
            testID="admin-members-filter-office"
          />
        </View>

        {list.isLoading ? (
          <SkeletonRows />
        ) : list.isError ? (
          <EmptyState message={t('admin.members.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.members.noneMatch')} />
        ) : (
          rows.map(member => (
            <MemberCard
              key={member.member_code}
              member={member}
              canChange={canChange}
              onChange={() => {
                setFlash(null);
                setEditing(member);
              }}
              onOpen={() => setOpen(member.member_code)}
            />
          ))
        )}

        {count > LIMIT && (
          <View style={styles.pager} testID="admin-members-pager">
            <Pressable
              accessibilityRole="button"
              disabled={offset === 0 || list.isFetching}
              onPress={() => setOffset(o => Math.max(0, o - LIMIT))}
              style={[styles.pageStep, offset === 0 && styles.pageStepOff]}
            >
              <Ionicons name="chevron-back" size={16} color={colors.info} />
              <AppText style={styles.pageStepLabel}>{t('admin.members.prev')}</AppText>
            </Pressable>
            <AppText style={styles.pageOf}>
              {t('admin.members.pageOf', {
                from: num(offset + 1),
                to: num(Math.min(count, offset + rows.length)),
                total: num(count),
              })}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={offset + LIMIT >= count || list.isFetching}
              onPress={() => setOffset(o => o + LIMIT)}
              style={[styles.pageStep, offset + LIMIT >= count && styles.pageStepOff]}
            >
              <AppText style={styles.pageStepLabel}>{t('admin.members.next')}</AppText>
              <Ionicons name="chevron-forward" size={16} color={colors.info} />
            </Pressable>
          </View>
        )}

        {unusable > 0 && (
          <AppText style={styles.unusable} testID="admin-members-unusable">
            {t('admin.members.unusableNote', { count: unusable })}
          </AppText>
        )}
      </ScrollView>

      <MppSheet
        visible={picking}
        selected={mpp?.code ?? null}
        onSelect={setMpp}
        onClose={() => setPicking(false)}
      />

      {!!editing && (
        <ChangeNumberSheet
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={(text, tone) => {
            setEditing(null);
            setFlash({ text, tone });
          }}
          onConflict={text => {
            setEditing(null);
            setFlash({ text, tone: 'red' });
            list.refetch();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  muted: { color: colors.textMuted },
  missing: { color: colors.error },

  top: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[3] },
  count: { ...typography.h3, color: colors.ink, flex: 1, minWidth: 140 },

  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  backLabel: { ...typography.label, color: colors.surface },

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
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  cardName: { ...typography.h3, color: colors.ink },
  cardSub: { ...typography.caption, color: colors.textMuted },
  code: {
    alignSelf: 'flex-start',
    marginTop: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  codeLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 8 },
  factRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  factLabel: { ...typography.caption, color: colors.textMuted, width: 56 },
  factValue: { ...typography.label, color: colors.ink },
  mobileRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2] },
  office: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  officeLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  // The portal's warn-toned button: a correction, not the screen's main act.
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: yolk[400],
  },
  changeLabel: { ...typography.label, color: colors.ink },
  open: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
  openLabel: { ...typography.label },

  aadhaarRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2] },
  aadhaarBox: {
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: yolk[300],
    backgroundColor: colors.secondaryWash,
  },
  aadhaarText: {
    ...typography.label,
    fontFamily: typography.h3.fontFamily,
    color: colors.ink,
    letterSpacing: 1,
  },
  aadhaarOpen: {
    borderStyle: 'solid',
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  aadhaarOpenText: {
    ...typography.label,
    fontFamily: typography.h3.fontFamily,
    color: colors.error,
    letterSpacing: 1,
  },
  reveal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 30,
    paddingHorizontal: spacing[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: yolk[300],
    backgroundColor: colors.surface,
  },
  revealLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: yolk[800] },
  revealHide: { borderColor: colors.ink, backgroundColor: colors.ink },
  revealHideLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  countdown: { ...typography.caption, color: colors.error },
  problemInline: { ...typography.caption, color: colors.error, marginTop: 2 },

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
  unusable: { ...typography.caption, color: colors.error, textAlign: 'center' },

  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryOff: { backgroundColor: ink[200] },
  primaryLabel: { ...typography.label, color: colors.surface },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  secondaryLabel: { ...typography.label, color: colors.ink },

  sheetBody: { gap: spacing[3] },
  sheetFoot: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  now: { padding: spacing[3], gap: 4, borderRadius: radius.md, borderWidth: 1 },
  nowLabel: { ...typography.caption, color: colors.info },
  nowNumber: { ...typography.h2, color: colors.ink },
  nowSource: { ...typography.caption, color: colors.textMuted },
  sheetStep: { gap: spacing[2] },
  sheetStepHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.info,
  },
  stepDotLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  sheetStepTitle: { ...typography.bodyStrong, color: colors.ink },
  phoneInput: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  prefix: {
    ...typography.bodyStrong,
    color: colors.info,
    paddingHorizontal: spacing[3],
    alignSelf: 'stretch',
    textAlignVertical: 'center',
    paddingTop: spacing[3],
    backgroundColor: colors.infoWash,
  },
  phoneField: { flex: 1, ...typography.h3, color: colors.ink, paddingHorizontal: spacing[3] },
  hint: { ...typography.caption, color: colors.textMuted },
  hintBad: { color: colors.error },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  reasonChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  reasonChipOn: { backgroundColor: colors.info },
  reasonLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.info,
  },
  reasonLabelOn: { color: colors.surface },
  reasonField: {
    ...typography.body,
    color: colors.ink,
    minHeight: 64,
    padding: spacing[3],
    textAlignVertical: 'top',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  previewText: { ...typography.label, color: colors.textMuted, flex: 1 },
  problem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  problemText: { ...typography.label, color: colors.error, flex: 1 },
  history: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: ink[50],
  },
  historyTitle: { ...typography.bodyStrong, color: colors.ink },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  changeDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 6,
    backgroundColor: colors.primary,
  },
  changeWhat: { ...typography.label, color: colors.ink },
  changeBefore: {
    ...typography.label,
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  changeAfter: { ...typography.label, color: colors.primaryDark },
  changeMeta: { ...typography.caption, color: colors.textMuted },

  hero: { padding: spacing[4], borderRadius: radius.lg, backgroundColor: colors.ink },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroTitle: { ...typography.h2, color: colors.surface },
  heroMeta: { ...typography.caption, color: yolk[300] },
  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: { flex: 1, padding: spacing[3], gap: 4, borderRadius: radius.md, borderWidth: 1 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileChip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, flex: 1 },
  tileValue: { ...typography.h1, color: colors.ink },
  tilePill: { flexDirection: 'row', marginVertical: 4 },
  tileFoot: { ...typography.caption, color: colors.ink },
  panel: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  panelTitle: { ...typography.h3, flex: 1 },
  recordFact: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    paddingVertical: 8,
  },
  recordFactLabel: { ...typography.caption, color: colors.textMuted, width: 92 },
  recordFactBody: { flex: 1, alignItems: 'flex-start' },
  recordFactValue: { ...typography.label, color: colors.ink },
  recordFactSub: { ...typography.caption, color: colors.textMuted },
  animal: {
    gap: 3,
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  animalTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  animalName: { ...typography.bodyStrong, color: colors.ink },
  animalId: { ...typography.caption, color: colors.textMuted },
  aiBubble: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
  },
  aiBubbleLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  animalMeta: { ...typography.caption, color: colors.textMuted },
});
