/**
 * Super OTP — the portal's Login codes screen (`super-otp.html`, W22), on a handset.
 *
 * When the SMS gateway is not delivering, every step that sends a code stops: signing in, the
 * farmer check, and her authorising a payment. At each, the field app offers to ask the office;
 * the ask lands here with the step it is for. An admin generates a one-time code and reads it
 * out on the phone — to the account holder for sign-in, and to *the farmer* for her steps, never
 * to the Mait who asked. She tells the Mait the code, exactly as she would have read the SMS.
 *
 * The screen is built around the one way this can go wrong: somebody who is not the account
 * holder ringing the office. So the yellow rule leads, the number on each card is the number
 * *on file*, the reveal says whom to call, and the code is shown once and then gone — never
 * kept anywhere it could be read back. The last SMS is the other half of the judgement: a code
 * the gateway delivered two minutes ago is a reason to ask them to look at their messages first.
 *
 * Every column of the portal's table is on the card: the step, who, the number on file, when
 * and how often they asked and why, their last SMS, and the state with its detail line. The
 * list refreshes every twenty seconds while open, as the portal does — asks arrive from the
 * field, and nobody watching should have to pull to see the one that just came in.
 *
 * Colours follow the state: waiting is yellow (somebody to call), a code given is blue, used is
 * green, locked out on wrong tries is red, and the rest are history in slate.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { Banner, EmptyState } from '@/components';
import { SkeletonRows } from '@/components/skeleton';
import {
  useAdminDeclineSuperOtpMutation,
  useAdminIssueFieldCodeMutation,
  useAdminIssueSuperOtpForNumberMutation,
  useAdminIssueSuperOtpMutation,
  useAdminSuperOtpListQuery,
} from '@api/endpoints';
import type { SuperOtpIssued, SuperOtpRow, SuperOtpSms } from '@api/types';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { Disc, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';
import { problemLines } from './AdminUsersScreen';
import { useDebounced } from './common';

type Scope = 'open' | 'all';

/** As the portal: the asks arrive from the field, so an open screen keeps up by itself. */
export const REFRESH_MS = 20000;

export const STATE_TONE: Record<SuperOtpRow['state'], ToneName> = {
  waiting: 'yolk',
  issued: 'blue',
  used: 'green',
  locked: 'red',
  expired: 'slate',
  declined: 'slate',
  revoked: 'slate',
  lapsed: 'slate',
};

function clock(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "4 min ago", "2 h ago", then the date — how long somebody has been waiting. */
export function ago(t: TFunction, iso: string | null, now: number = Date.now()): string {
  if (!iso) {
    return '—';
  }
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) {
    return t('admin.superOtp.justNow');
  }
  if (minutes < 60) {
    return t('admin.superOtp.minAgo', { n: minutes });
  }
  if (minutes < 24 * 60) {
    return t('admin.superOtp.hAgo', { n: Math.round(minutes / 60) });
  }
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

function secondsLeft(expiresAt: string | null): number {
  if (!expiresAt) {
    return 0;
  }
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

/** The words, then the digits — a name, a Mait code or a store, or three digits of a number. */
export function matches(row: SuperOtpRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const digits = needle.replace(/\D/g, '');
  const words = [row.full_name, row.who, row.farmer_name, row.context, row.step]
    .join(' ')
    .toLowerCase();
  const numbers = [row.number_on_file, row.mobile_no].join(' ');
  return words.includes(needle) || (digits.length >= 3 && numbers.includes(digits));
}

/** Whom the code is for — the farmer for her steps, the account holder for sign-in. */
function personOf(t: TFunction, row: SuperOtpRow): string {
  return row.for_farmer ? row.farmer_name || t('admin.superOtp.theFarmer') : row.full_name;
}

// --------------------------------------------------------------------------------------
// Parts
// --------------------------------------------------------------------------------------

function Fact({
  icon,
  label,
  children,
  testID,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.fact} testID={testID}>
      <Ionicons name={icon as never} size={15} color={colors.textMuted} />
      <AppText style={styles.factLabel}>{label}</AppText>
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

function Button({
  label,
  icon,
  tone,
  outline,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  icon: string;
  tone: ToneName | 'ink';
  outline?: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}): React.JSX.Element {
  const solid = tone === 'ink' ? colors.ink : TONE[tone].solid;
  const onSolid = tone === 'ink' ? colors.surface : TONE[tone].onSolid;
  const fore = outline ? (tone === 'ink' ? colors.ink : TONE[tone].text) : onSolid;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        outline
          ? {
              backgroundColor: tone === 'ink' ? colors.surface : TONE[tone].wash,
              borderColor: tone === 'ink' ? ink[300] : TONE[tone].border,
            }
          : { backgroundColor: solid, borderColor: solid },
        disabled && styles.off,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Ionicons name={icon as never} size={15} color={fore} />
      <AppText style={[styles.buttonLabel, { color: fore }]}>{label}</AppText>
    </Pressable>
  );
}

function SmsLine({ sms }: { sms: SuperOtpSms | null }): React.JSX.Element {
  const { t } = useTranslation();
  if (!sms) {
    return <AppText style={styles.hint}>{t('admin.superOtp.noSms')}</AppText>;
  }
  return (
    <>
      <AppText style={[styles.value, { color: sms.delivered ? TONE.green.text : TONE.red.text }]}>
        {sms.delivered
          ? t('admin.superOtp.smsSent', { time: clock(sms.sent_at) })
          : t('admin.superOtp.smsNotDelivered', { time: clock(sms.sent_at) })}
      </AppText>
      <AppText style={styles.hint}>
        {t('admin.superOtp.sentLastHour', { count: sms.sent_last_hour })}
        {sms.verified ? ` · ${t('admin.superOtp.lastUsed')}` : ''}
      </AppText>
    </>
  );
}

/** The line under the state pill: who gave it and until when, when it was used, or why not. */
function stateDetail(t: TFunction, row: SuperOtpRow): string {
  if (row.state === 'issued') {
    return [
      t('admin.superOtp.issuedBy', {
        name: row.issued_by_name || '—',
        at: clock(row.issued_at),
        until: clock(row.expires_at),
      }),
      ...(row.attempt_count ? [t('admin.superOtp.wrongN', { n: row.attempt_count })] : []),
    ].join(' · ');
  }
  if (row.state === 'used') {
    return t('admin.superOtp.usedAt', { at: clock(row.used_at) });
  }
  if (row.state === 'declined' && row.decline_reason) {
    return row.decline_reason;
  }
  return '';
}

function AskCard({
  row,
  busy,
  onGenerate,
  onDecline,
  onNewCode,
}: {
  row: SuperOtpRow;
  busy: boolean;
  onGenerate: () => void;
  onDecline: () => void;
  onNewCode: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = STATE_TONE[row.state] ?? 'slate';
  const look = TONE[tone];
  // Only sign-in is remade by number: a farmer's code belongs to her and the payment on the
  // Mait's screen, and a fresh one is asked for from there.
  const canNewCode =
    !row.for_farmer &&
    (row.state === 'issued' || row.state === 'expired' || row.state === 'locked');
  const detail = stateDetail(t, row);

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-superotp-${row.id}`}
    >
      <View style={styles.row}>
        <Disc tone={row.for_farmer ? 'blue' : tone} icon={row.for_farmer ? 'person' : 'key'} />
        <View style={styles.flex}>
          <AppText style={styles.name}>{personOf(t, row)}</AppText>
          <AppText style={styles.hint}>
            {row.for_farmer
              ? [row.context, t('admin.superOtp.askedBy', { name: row.full_name })]
                  .filter(Boolean)
                  .join(' · ')
              : row.who}
          </AppText>
        </View>
      </View>

      <View style={styles.wrap} testID={`admin-superotp-pills-${row.id}`}>
        <Pill label={row.step} tone={row.for_farmer ? 'blue' : 'slate'} />
        <Pill
          label={t(`admin.superOtp.state_${row.state}`, { defaultValue: row.status_display })}
          tone={tone}
        />
      </View>

      <View style={styles.inset}>
        <Fact icon="call" label={t('admin.superOtp.numberOnFile')}>
          <AppText style={styles.number} testID={`admin-superotp-number-${row.id}`}>
            {row.number_on_file}
          </AppText>
        </Fact>
        <Fact
          icon="time"
          label={t('admin.superOtp.asked')}
          testID={`admin-superotp-asked-${row.id}`}
        >
          {row.requested_at ? (
            <>
              <AppText style={styles.value}>
                {ago(t, row.requested_at)}
                {row.request_count > 1
                  ? ` · ${t('admin.superOtp.askedTimes', { n: row.request_count })}`
                  : ''}
              </AppText>
              {!!row.reason && <AppText style={styles.quote}>“{row.reason}”</AppText>}
            </>
          ) : (
            <AppText style={styles.hint}>{t('admin.superOtp.phonedOffice')}</AppText>
          )}
        </Fact>
        <Fact
          icon="chatbubble-ellipses"
          label={t('admin.superOtp.lastSms')}
          testID={`admin-superotp-sms-${row.id}`}
        >
          <SmsLine sms={row.sms} />
        </Fact>
        {!!detail && (
          <Fact icon="information-circle" label={t('admin.superOtp.state')}>
            <AppText style={styles.hint} testID={`admin-superotp-detail-${row.id}`}>
              {detail}
            </AppText>
          </Fact>
        )}
      </View>

      {row.state === 'waiting' && (
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button
              label={t('admin.superOtp.generate')}
              icon="key"
              tone="green"
              disabled={busy}
              onPress={onGenerate}
              testID={`admin-superotp-generate-${row.id}`}
            />
          </View>
          <Button
            label={t('admin.superOtp.decline')}
            icon="close-circle"
            tone="red"
            outline
            disabled={busy}
            onPress={onDecline}
            testID={`admin-superotp-decline-${row.id}`}
          />
        </View>
      )}
      {canNewCode && (
        <Button
          label={t('admin.superOtp.newCode')}
          icon="refresh"
          tone="ink"
          outline
          disabled={busy}
          onPress={onNewCode}
          testID={`admin-superotp-newcode-${row.id}`}
        />
      )}
    </View>
  );
}

/**
 * The code, the one time it exists outside a hash. Large and spaced for reading down a phone
 * line, with the clock it runs against; gone on dismiss and when it lapses.
 */
function Reveal({
  issued,
  onClose,
}: {
  issued: SuperOtpIssued;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [left, setLeft] = useState(() => secondsLeft(issued.expires_at));

  useEffect(() => {
    const id = setInterval(() => {
      const s = secondsLeft(issued.expires_at);
      setLeft(s);
      if (s <= 0) {
        onClose();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [issued.expires_at, onClose]);

  const who = issued.for_farmer
    ? [issued.farmer_name || t('admin.superOtp.theFarmer'), issued.step, issued.context]
        .filter(Boolean)
        .join(' · ')
    : `${issued.full_name} · ${issued.who}`;
  const call = issued.for_farmer
    ? t('admin.superOtp.callHer', { number: issued.number_on_file, name: issued.full_name })
    : t('admin.superOtp.callOnFile', { number: issued.number_on_file });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet} testID="admin-superotp-reveal">
        <AppText style={styles.readTo}>{t('admin.superOtp.readTo')}</AppText>
        <AppText style={styles.sheetWho} testID="admin-superotp-reveal-who">
          {who}
        </AppText>
        <View style={styles.callLine}>
          <Ionicons name="call" size={16} color={TONE.yolk.text} />
          <AppText style={styles.callText} testID="admin-superotp-reveal-call">
            {call}
          </AppText>
        </View>
        <View style={styles.codeBox}>
          <AppText style={styles.code} testID="admin-superotp-code">
            {issued.code.split('').join(' ')}
          </AppText>
        </View>
        <AppText style={[styles.hint, styles.center]} testID="admin-superotp-reveal-foot">
          <AppText style={[styles.expiry, left === 0 && { color: TONE.red.text }]}>
            {left > 0
              ? t('admin.superOtp.worksFor', {
                  time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
                })
              : t('admin.superOtp.expired')}
          </AppText>
          {` · ${t('admin.superOtp.revealFoot')}`}
        </AppText>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.done, pressed && styles.pressed]}
          testID="admin-superotp-reveal-close"
        >
          <Ionicons name="eye-off" size={16} color={colors.surface} />
          <AppText style={styles.doneLabel}>{t('admin.superOtp.doneReading')}</AppText>
        </Pressable>
      </View>
    </Modal>
  );
}

/** A reason for declining, kept on the record — Android has no Alert.prompt, so this is a sheet. */
function DeclineSheet({
  row,
  busy,
  onCancel,
  onConfirm,
}: {
  row: SuperOtpRow;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [reason, setReason] = useState(t('admin.superOtp.declineDefault'));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View
        style={[styles.sheet, { backgroundColor: TONE.red.wash, borderColor: TONE.red.border }]}
        testID="admin-superotp-decline-sheet"
      >
        <Disc tone="red" icon="close-circle" />
        <AppText style={styles.sheetWho}>
          {t('admin.superOtp.declineTitle', { name: personOf(t, row) })}
        </AppText>
        <AppText style={[styles.hint, styles.center]}>{t('admin.superOtp.declineHint')}</AppText>
        <TextInput
          style={styles.reason}
          value={reason}
          onChangeText={setReason}
          placeholder={t('admin.superOtp.declinePlaceholder')}
          placeholderTextColor={colors.textDisabled}
          multiline
          testID="admin-superotp-decline-reason"
        />
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button
              label={t('common.cancel')}
              icon="arrow-back"
              tone="ink"
              outline
              onPress={onCancel}
              testID="admin-superotp-decline-cancel"
            />
          </View>
          <View style={styles.flex}>
            {busy ? (
              <ActivityIndicator color={colors.error} style={styles.spinner} />
            ) : (
              <Button
                label={t('admin.superOtp.decline')}
                icon="close-circle"
                tone="red"
                onPress={() => onConfirm(reason.trim())}
                testID="admin-superotp-decline-confirm"
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// --------------------------------------------------------------------------------------
// The screen
// --------------------------------------------------------------------------------------

export default function AdminSuperOtpScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>('open');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [phone, setPhone] = useState('');
  // The no-signal farmer-check card: which Mait rang, and which farmer is in front of them —
  // a member by code, or a non-member by number and name. The portal's field-code card, on a
  // handset. `mait` is kept after a code is generated so the office can issue for the next
  // farmer this Mait reads out without re-typing the vendor code.
  const [fieldMait, setFieldMait] = useState('');
  const [fieldMember, setFieldMember] = useState('');
  const [fieldMobile, setFieldMobile] = useState('');
  const [fieldName, setFieldName] = useState('');
  const [revealed, setRevealed] = useState<SuperOtpIssued | null>(null);
  const [declining, setDeclining] = useState<SuperOtpRow | null>(null);
  const [flash, setFlash] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const list = useAdminSuperOtpListQuery({ state: scope }, { pollingInterval: REFRESH_MS });
  const [issue, issueState] = useAdminIssueSuperOtpMutation();
  const [issueForNumber, forNumberState] = useAdminIssueSuperOtpForNumberMutation();
  const [issueFieldCode, fieldCodeState] = useAdminIssueFieldCodeMutation();
  const [decline, declineState] = useAdminDeclineSuperOtpMutation();

  const all = useMemo(() => list.data ?? [], [list.data]);
  const rows = useMemo(() => all.filter(row => matches(row, search)), [all, search]);
  const waiting = all.filter(row => row.state === 'waiting').length;
  const busy = issueState.isLoading || forNumberState.isLoading || fieldCodeState.isLoading;

  const failed = (error: unknown) => {
    setFlash(null);
    setProblem(problemLines(error, t('admin.superOtp.failedBody')).join(' · '));
  };

  /** The code on screen, a line naming whom to call, and the list caught up. */
  const issued = (res: SuperOtpIssued) => {
    setProblem(null);
    setRevealed(res);
    setFlash({
      tone: 'info',
      text: t('admin.superOtp.generated', {
        name: res.for_farmer ? res.farmer_name || t('admin.superOtp.theFarmer') : res.full_name,
        number: res.number_on_file,
      }),
    });
    list.refetch();
  };

  const doGenerate = (row: SuperOtpRow) => {
    Alert.alert(
      t('admin.superOtp.generate'),
      row.for_farmer
        ? t('admin.superOtp.confirmFarmer', {
            step: row.step.toLowerCase(),
            name: row.farmer_name || t('admin.superOtp.theFarmer'),
            number: row.number_on_file,
            asker: row.full_name,
          })
        : t('admin.superOtp.confirmUser', { name: row.full_name, number: row.number_on_file }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.superOtp.generate'),
          onPress: async () => {
            try {
              issued(await issue(row.id).unwrap());
            } catch (error) {
              failed(error);
            }
          },
        },
      ],
    );
  };

  const doNewCode = (row: SuperOtpRow) => {
    Alert.alert(
      t('admin.superOtp.newCode'),
      t('admin.superOtp.confirmNew', { number: row.number_on_file }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.superOtp.newCode'),
          onPress: async () => {
            try {
              issued(
                await issueForNumber({ mobileNo: row.number_on_file.replace(/\D/g, '') }).unwrap(),
              );
            } catch (error) {
              failed(error);
            }
          },
        },
      ],
    );
  };

  const doDecline = async (reason: string) => {
    if (!declining) {
      return;
    }
    try {
      await decline({ id: declining.id, reason }).unwrap();
      setDeclining(null);
      setProblem(null);
      setFlash({ tone: 'warning', text: t('admin.superOtp.declined') });
      list.refetch();
    } catch (error) {
      setDeclining(null);
      failed(error);
    }
  };

  const doPhoneIssue = () => {
    const mobile = phone.replace(/\D/g, '');
    if (mobile.length !== 10) {
      setFlash(null);
      setProblem(t('admin.superOtp.badNumberBody'));
      return;
    }
    Alert.alert(
      t('admin.superOtp.generate'),
      t('admin.superOtp.confirmPhone', { number: mobile }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.superOtp.generate'),
          onPress: async () => {
            try {
              const res = await issueForNumber({ mobileNo: mobile }).unwrap();
              setPhone('');
              issued(res);
            } catch (error) {
              failed(error);
            }
          },
        },
      ],
    );
  };

  /**
   * A farmer-check code for a Mait with no signal. The Mait is required; the farmer is a member
   * by code or a non-member by number — exactly one, the same rule the portal and the server
   * both enforce. `mait` is kept after issuing so the next farmer this Mait reads out does not
   * need the vendor code typed again; the farmer fields are cleared.
   */
  const doFieldIssue = () => {
    const mait = fieldMait.trim();
    const member = fieldMember.trim();
    const mobile = fieldMobile.replace(/\D/g, '');
    if (!mait) {
      setFlash(null);
      setProblem(t('admin.superOtp.fieldCheckMaitRequired'));
      return;
    }
    // One of the two, never both and never neither — `!!member === (mobile is 10 digits)` is
    // true exactly when they are the same, which is the invalid case.
    if (!!member === (mobile.length === 10)) {
      setFlash(null);
      setProblem(t('admin.superOtp.fieldCheckOneOf'));
      return;
    }
    Alert.alert(
      t('admin.superOtp.generate'),
      t('admin.superOtp.confirmFieldCheck', { who: member || mobile }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.superOtp.generate'),
          onPress: async () => {
            try {
              const res = await issueFieldCode({
                mait,
                memberCode: member || undefined,
                farmerMobile: member ? undefined : mobile,
                farmerName: fieldName.trim() || undefined,
              }).unwrap();
              setFieldMember('');
              setFieldMobile('');
              setFieldName('');
              issued(res);
            } catch (error) {
              failed(error);
            }
          },
        },
      ],
    );
  };

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
        testID="admin-superotp"
      >
        <View>
          <AppText style={styles.title}>{t('admin.superOtp.title')}</AppText>
          <AppText
            style={[styles.hint, waiting > 0 && { color: TONE.yolk.text }]}
            testID="admin-superotp-count"
          >
            {waiting > 0
              ? t('admin.superOtp.waitingCount', { count: waiting })
              : t('admin.superOtp.nobodyWaiting')}
          </AppText>
        </View>

        {/* Yellow, because it is the one rule here that matters more than the rest. */}
        <Notice
          tone="yolk"
          icon="call"
          title={t('admin.superOtp.ruleTitle')}
          body={t('admin.superOtp.ruleBody')}
          testID="admin-superotp-rule"
        />

        {!!problem && <Banner tone="error" message={problem} testID="admin-superotp-problem" />}
        {!!flash && <Banner tone={flash.tone} message={flash.text} testID="admin-superotp-flash" />}

        <View style={styles.phoneCard}>
          <View style={styles.row}>
            <Disc tone="blue" icon="call" size={32} />
            <AppText style={[styles.name, styles.flex]}>{t('admin.superOtp.phonedIn')}</AppText>
          </View>
          <View style={styles.row}>
            <TextInput
              style={styles.phoneInput}
              value={phone}
              onChangeText={v => setPhone(v.replace(/\D/g, '').slice(0, 10))}
              placeholder={t('admin.superOtp.phonePlaceholder')}
              placeholderTextColor={colors.textDisabled}
              keyboardType="number-pad"
              maxLength={10}
              testID="admin-superotp-phone"
            />
            <Button
              label={t('admin.superOtp.generateShort')}
              icon="key"
              tone="blue"
              disabled={busy}
              onPress={doPhoneIssue}
              testID="admin-superotp-phone-issue"
            />
          </View>
          <AppText style={styles.hint}>{t('admin.superOtp.phoneHint')}</AppText>
        </View>

        {/* A Mait with no signal at all cannot ask from the app, so she phones. The office picks
            the Mait and the farmer; the phone checks this code itself when it next syncs. */}
        <View style={styles.fieldCard} testID="admin-superotp-field">
          <View style={styles.row}>
            <Disc tone="yolk" icon="person" size={32} />
            <AppText style={[styles.name, styles.flex]}>
              {t('admin.superOtp.fieldCheckTitle')}
            </AppText>
          </View>
          <TextInput
            style={styles.fieldInput}
            value={fieldMait}
            onChangeText={setFieldMait}
            placeholder={t('admin.superOtp.fieldCheckMaitPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={15}
            testID="admin-superotp-field-mait"
          />
          <TextInput
            style={styles.fieldInput}
            value={fieldMember}
            onChangeText={setFieldMember}
            placeholder={t('admin.superOtp.fieldCheckMemberPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
            testID="admin-superotp-field-member"
          />
          <TextInput
            style={styles.fieldInput}
            value={fieldMobile}
            onChangeText={v => setFieldMobile(v.replace(/\D/g, '').slice(0, 10))}
            placeholder={t('admin.superOtp.fieldCheckMobilePlaceholder')}
            placeholderTextColor={colors.textDisabled}
            keyboardType="number-pad"
            maxLength={10}
            testID="admin-superotp-field-mobile"
          />
          <TextInput
            style={styles.fieldInput}
            value={fieldName}
            onChangeText={setFieldName}
            placeholder={t('admin.superOtp.fieldCheckNamePlaceholder')}
            placeholderTextColor={colors.textDisabled}
            maxLength={150}
            testID="admin-superotp-field-name"
          />
          <Button
            label={t('admin.superOtp.generateShort')}
            icon="key"
            tone="yolk"
            disabled={busy}
            onPress={doFieldIssue}
            testID="admin-superotp-field-issue"
          />
          <AppText style={styles.hint}>{t('admin.superOtp.fieldCheckHint')}</AppText>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.info} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={setTerm}
            placeholder={t('admin.superOtp.searchPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            autoCapitalize="none"
            testID="admin-superotp-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
        <View style={styles.wrap}>
          <FilterChip
            label={t('admin.superOtp.scope_open')}
            icon="hourglass"
            tone="yolk"
            active={scope === 'open'}
            onPress={() => setScope('open')}
            testID="admin-superotp-scope-open"
          />
          <FilterChip
            label={t('admin.superOtp.scope_all')}
            icon="list"
            tone="slate"
            active={scope === 'all'}
            onPress={() => setScope('all')}
            testID="admin-superotp-scope-all"
          />
        </View>

        {list.isLoading ? (
          <SkeletonRows />
        ) : list.isError ? (
          <EmptyState message={t('admin.superOtp.error')} />
        ) : rows.length === 0 ? (
          <EmptyState
            message={
              search
                ? t('admin.superOtp.noneFound', { query: search })
                : t(scope === 'open' ? 'admin.superOtp.noneOpen' : 'admin.superOtp.noneAll')
            }
          />
        ) : (
          rows.map(row => (
            <AskCard
              key={row.id}
              row={row}
              busy={busy}
              onGenerate={() => doGenerate(row)}
              onDecline={() => setDeclining(row)}
              onNewCode={() => doNewCode(row)}
            />
          ))
        )}
      </ScrollView>

      {revealed && <Reveal issued={revealed} onClose={() => setRevealed(null)} />}
      {declining && (
        <DeclineSheet
          row={declining}
          busy={declineState.isLoading}
          onCancel={() => setDeclining(null)}
          onConfirm={doDecline}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  off: { opacity: 0.5 },
  title: { ...typography.h3, color: colors.ink },
  hint: { ...typography.caption, color: colors.textMuted },
  value: { ...typography.label, color: colors.ink },
  quote: { ...typography.caption, color: colors.ink, fontStyle: 'italic' },
  name: { ...typography.bodyStrong, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', gap: spacing[2], alignSelf: 'stretch' },

  phoneCard: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: TONE.blue.border,
    backgroundColor: TONE.blue.wash,
  },
  phoneInput: {
    flex: 1,
    ...typography.body,
    color: colors.ink,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: TONE.blue.border,
    backgroundColor: colors.surface,
  },

  // Yolk rather than blue: the farmer-check card is the one the warning rule above is really
  // about — the code goes to the farmer, never the Mait who rang — so it does not read as the
  // same thing as the sign-in card right above it. Inputs stack full-width; a handset has no
  // room for the portal's two-across rows.
  fieldCard: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: TONE.yolk.border,
    backgroundColor: TONE.yolk.wash,
  },
  fieldInput: {
    ...typography.body,
    color: colors.ink,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: TONE.yolk.border,
    backgroundColor: colors.surface,
  },

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

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  inset: {
    paddingHorizontal: spacing[3],
    paddingVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], paddingVertical: 7 },
  factLabel: { ...typography.caption, color: colors.textMuted, width: 92 },
  number: { ...typography.bodyStrong, color: colors.ink, letterSpacing: 0.5 },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  buttonLabel: { ...typography.label },

  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,40,0.55)' },
  sheet: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    top: '14%',
    padding: spacing[5],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: TONE.blue.border,
    backgroundColor: TONE.blue.wash,
    alignItems: 'center',
    gap: spacing[3],
  },
  readTo: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: TONE.blue.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sheetWho: { ...typography.h3, color: colors.ink, textAlign: 'center' },
  callLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    alignSelf: 'stretch',
    padding: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: TONE.yolk.border,
    backgroundColor: TONE.yolk.wash,
  },
  callText: { ...typography.label, color: TONE.yolk.text, flex: 1 },
  codeBox: {
    alignSelf: 'stretch',
    paddingVertical: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    alignItems: 'center',
  },
  code: {
    ...typography.display,
    fontSize: 40,
    lineHeight: 46,
    color: colors.surface,
    letterSpacing: 2,
  },
  expiry: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.ink },
  done: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 4,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  doneLabel: { ...typography.bodyStrong, color: colors.surface },

  reason: {
    alignSelf: 'stretch',
    ...typography.body,
    color: colors.ink,
    minHeight: 72,
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: TONE.red.border,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },
  spinner: { minHeight: MIN_TOUCH_TARGET },
});
