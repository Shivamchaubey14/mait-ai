/**
 * Super OTP — the portal's Login codes screen (W22), on a handset.
 *
 * When the SMS gateway is not delivering, every step that sends a code stops: signing in, the
 * farmer check, and her authorising a payment. At each, the field app offers to ask the office;
 * the ask lands here with the step it is for. An admin generates a one-time code and reads it
 * out on the phone — to the account holder for sign-in, and to *the farmer* for her steps,
 * never to the Mait who asked.
 *
 * The one write screen outside Indents, and it is built around the one way it can go wrong:
 * somebody who is not the account holder ringing the office. So the number on the row is the
 * number *on file*, the reveal says to call it, and the code is shown once and then gone from
 * the screen — never stored anywhere it could be read back.
 *
 * Writes refetch the list by hand rather than through a cache tag, the way Indents does: a
 * decision's effect should be immediate on the one screen it changes, without a tag web.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import {
  useAdminSuperOtpListQuery,
  useAdminIssueSuperOtpMutation,
  useAdminIssueSuperOtpForNumberMutation,
  useAdminDeclineSuperOtpMutation,
} from '@api/endpoints';
import type { SuperOtpRow, SuperOtpIssued } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, green, ink, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { SearchBar, adminStyles, useDebounced } from './common';

type Scope = 'open' | 'all';

const STATE_LOOK: Record<string, { wash: string; tint: string }> = {
  waiting: { wash: colors.secondaryWash, tint: yolk[800] },
  issued: { wash: colors.infoWash, tint: colors.info },
  used: { wash: colors.primaryWash, tint: colors.primaryDark },
  locked: { wash: colors.errorWash, tint: colors.error },
};

function look(state: string): { wash: string; tint: string } {
  return STATE_LOOK[state] ?? { wash: ink[50], tint: ink[500] };
}

/** "4 min ago", "2 h ago", then a date — how long somebody has been waiting. */
function ago(iso: string | null): string {
  if (!iso) {return '—';}
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) {return 'just now';}
  if (minutes < 60) {return `${minutes} min ago`;}
  if (minutes < 24 * 60) {return `${Math.round(minutes / 60)} h ago`;}
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function secondsLeft(expiresAt: string | null): number {
  if (!expiresAt) {return 0;}
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

/**
 * The code, shown once.
 *
 * Gone from the page on dismiss and when it expires — the plaintext is not kept anywhere it
 * could be read back, so a counter ticks it down and closes the sheet itself when it lapses.
 */
function Reveal({ issued, onClose }: { issued: SuperOtpIssued; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const [left, setLeft] = useState(() => secondsLeft(issued.expires_at));

  useEffect(() => {
    const id = setInterval(() => {
      const s = secondsLeft(issued.expires_at);
      setLeft(s);
      if (s <= 0) {onClose();}
    }, 1000);
    return () => clearInterval(id);
  }, [issued.expires_at, onClose]);

  const who = issued.for_farmer
    ? `${issued.farmer_name || t('admin.superOtp.theFarmer')} · ${issued.step}`
    : `${issued.full_name} · ${issued.who}`;
  const call = issued.for_farmer
    ? t('admin.superOtp.callHer', { number: issued.number_on_file, name: issued.full_name })
    : t('admin.superOtp.callOnFile', { number: issued.number_on_file });
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet} testID="admin-superotp-reveal">
        <View style={styles.sheetMark}>
          <Ionicons name="key" size={22} color={colors.info} />
        </View>
        <Text style={styles.sheetWho} numberOfLines={2}>
          {who}
        </Text>
        <Text style={styles.sheetCall} numberOfLines={3}>
          {call}
        </Text>
        <View style={styles.codeBox}>
          <Text style={styles.code} testID="admin-superotp-code">
            {issued.code.split('').join(' ')}
          </Text>
        </View>
        <Text style={[styles.sheetExpiry, left === 0 && styles.sheetExpiryGone]}>
          {left > 0 ? t('admin.superOtp.worksFor', { time: `${mm}:${ss}` }) : t('admin.superOtp.expired')}
        </Text>
        <Pressable onPress={onClose} style={styles.sheetDone} testID="admin-superotp-reveal-close">
          <Text style={styles.sheetDoneLabel}>{t('admin.superOtp.doneReading')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** A reason box for declining an ask — Android has no Alert.prompt, so this is a sheet. */
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
      <Pressable style={styles.sheetBackdrop} onPress={onCancel} />
      <View style={styles.sheet} testID="admin-superotp-decline-sheet">
        <Text style={styles.sheetWho}>{t('admin.superOtp.declineTitle', { name: row.full_name })}</Text>
        <Text style={styles.sheetCall}>{t('admin.superOtp.declineHint')}</Text>
        <TextInput
          style={styles.reasonInput}
          value={reason}
          onChangeText={setReason}
          placeholder={t('admin.superOtp.declinePlaceholder')}
          placeholderTextColor={colors.textDisabled}
          multiline
          testID="admin-superotp-decline-reason"
        />
        <View style={styles.sheetActions}>
          <Pressable onPress={onCancel} style={styles.sheetCancel} testID="admin-superotp-decline-cancel">
            <Text style={styles.sheetCancelLabel}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            onPress={() => onConfirm(reason.trim())}
            disabled={busy}
            style={({ pressed }) => [styles.declineConfirm, pressed && styles.pressed, busy && styles.disabled]}
            testID="admin-superotp-decline-confirm"
          >
            {busy ? (
              <ActivityIndicator color={colors.error} />
            ) : (
              <Text style={styles.declineConfirmLabel}>{t('admin.superOtp.decline')}</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Row({
  row,
  onGenerate,
  onDecline,
  onNewCode,
}: {
  row: SuperOtpRow;
  onGenerate: (row: SuperOtpRow) => void;
  onDecline: (row: SuperOtpRow) => void;
  onNewCode: (row: SuperOtpRow) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const l = look(row.state);
  const name = row.for_farmer ? row.farmer_name || t('admin.superOtp.theFarmer') : row.full_name;
  const sub = row.for_farmer ? `${row.step} · ${t('admin.superOtp.askedBy', { name: row.full_name })}` : row.who;
  const canNewCode =
    !row.for_farmer && (row.state === 'issued' || row.state === 'expired' || row.state === 'locked');

  return (
    <View style={[adminStyles.row, styles.rowTop]} testID={`admin-superotp-${row.id}`}>
      <View style={[adminStyles.rowChip, { backgroundColor: row.for_farmer ? colors.infoWash : l.wash }]}>
        <Ionicons name={row.for_farmer ? 'person' : 'key'} size={18} color={row.for_farmer ? colors.info : l.tint} />
      </View>
      <View style={adminStyles.rowBody}>
        <Text style={adminStyles.rowName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={adminStyles.rowMeta} numberOfLines={2}>
          {sub}
        </Text>
        <Text style={styles.number}>{row.number_on_file}</Text>
        <View style={styles.pills}>
          <View style={[styles.pill, { backgroundColor: l.wash }]}>
            <Text style={[styles.pillLabel, { color: l.tint }]}>{row.status_display}</Text>
          </View>
          {row.state === 'waiting' && (
            <Text style={styles.waited}>{ago(row.requested_at)}</Text>
          )}
          {row.sms && (
            <Text style={row.sms.delivered ? styles.smsGood : styles.smsBad} numberOfLines={1}>
              {row.sms.delivered ? t('admin.superOtp.smsDelivered') : t('admin.superOtp.smsFailed')}
            </Text>
          )}
        </View>

        {row.state === 'waiting' && (
          <View style={styles.actions}>
            <Pressable
              onPress={() => onGenerate(row)}
              style={({ pressed }) => [styles.generate, pressed && styles.pressed]}
              testID={`admin-superotp-generate-${row.id}`}
            >
              <Ionicons name="key" size={15} color={colors.surface} />
              <Text style={styles.generateLabel}>{t('admin.superOtp.generate')}</Text>
            </Pressable>
            <Pressable
              onPress={() => onDecline(row)}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              testID={`admin-superotp-decline-${row.id}`}
            >
              <Text style={styles.secondaryLabel}>{t('admin.superOtp.decline')}</Text>
            </Pressable>
          </View>
        )}
        {canNewCode && (
          <View style={styles.actions}>
            <Pressable
              onPress={() => onNewCode(row)}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              testID={`admin-superotp-newcode-${row.id}`}
            >
              <Ionicons name="refresh" size={15} color={colors.ink} />
              <Text style={styles.secondaryLabel}>{t('admin.superOtp.newCode')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

export default function AdminSuperOtpScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>('open');
  const [term, setTerm] = useState('');
  const [phone, setPhone] = useState('');
  const [revealed, setRevealed] = useState<SuperOtpIssued | null>(null);
  const [declining, setDeclining] = useState<SuperOtpRow | null>(null);
  const search = useDebounced(term.trim().toLowerCase());

  const list = useAdminSuperOtpListQuery({ state: scope });
  const [issue, issueState] = useAdminIssueSuperOtpMutation();
  const [issueForNumber, forNumberState] = useAdminIssueSuperOtpForNumberMutation();
  const [decline, declineState] = useAdminDeclineSuperOtpMutation();

  const rows = useMemo(() => {
    const all = list.data ?? [];
    if (!search) {return all;}
    const digits = search.replace(/\D/g, '');
    return all.filter(r => {
      const words = [r.full_name, r.who, r.farmer_name, r.context, r.step].join(' ').toLowerCase();
      const numbers = [r.number_on_file, r.mobile_no].join(' ');
      return words.includes(search) || (digits.length >= 3 && numbers.includes(digits));
    });
  }, [list.data, search]);

  const waiting = (list.data ?? []).filter(r => r.state === 'waiting').length;
  const busy = issueState.isLoading || forNumberState.isLoading;

  const fail = () => Alert.alert(t('admin.superOtp.failedTitle'), t('admin.superOtp.failedBody'));

  const doGenerate = (row: SuperOtpRow) => {
    Alert.alert(
      t('admin.superOtp.generate'),
      row.for_farmer
        ? t('admin.superOtp.confirmFarmer', {
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
              const res = await issue(row.id).unwrap();
              setRevealed(res);
              list.refetch();
            } catch {
              fail();
            }
          },
        },
      ],
    );
  };

  const doNewCode = (row: SuperOtpRow) => {
    Alert.alert(t('admin.superOtp.newCode'), t('admin.superOtp.confirmNew', { number: row.number_on_file }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('admin.superOtp.newCode'),
        onPress: async () => {
          try {
            const res = await issueForNumber({ mobileNo: row.number_on_file.replace(/\D/g, '') }).unwrap();
            setRevealed(res);
            list.refetch();
          } catch {
            fail();
          }
        },
      },
    ]);
  };

  const doDecline = async (reason: string) => {
    if (!declining) {return;}
    try {
      await decline({ id: declining.id, reason }).unwrap();
      setDeclining(null);
      list.refetch();
    } catch {
      fail();
    }
  };

  const doPhoneIssue = () => {
    const mobile = phone.replace(/\D/g, '');
    if (mobile.length !== 10) {
      Alert.alert(t('admin.superOtp.badNumberTitle'), t('admin.superOtp.badNumberBody'));
      return;
    }
    Alert.alert(t('admin.superOtp.generate'), t('admin.superOtp.confirmPhone', { number: mobile }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('admin.superOtp.generate'),
        onPress: async () => {
          try {
            const res = await issueForNumber({ mobileNo: mobile }).unwrap();
            setPhone('');
            setRevealed(res);
            list.refetch();
          } catch {
            fail();
          }
        },
      },
    ]);
  };

  return (
    <View style={adminStyles.root}>
      <View style={styles.toggle}>
        {(['open', 'all'] as Scope[]).map(s => {
          const active = scope === s;
          return (
            <Pressable
              key={s}
              onPress={() => setScope(s)}
              style={[styles.toggleChip, active && styles.toggleChipActive]}
              testID={`admin-superotp-scope-${s}`}
            >
              <Text style={[styles.toggleLabel, active && styles.toggleLabelActive]}>
                {t(`admin.superOtp.scope_${s}`)}
              </Text>
            </Pressable>
          );
        })}
        <Text style={styles.waitingCount}>
          {waiting > 0 ? t('admin.superOtp.waitingCount', { count: waiting }) : t('admin.superOtp.nobodyWaiting')}
        </Text>
      </View>

      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder={t('admin.superOtp.searchPlaceholder')}
        testID="admin-superotp-search"
      />

      <ScrollView contentContainerStyle={adminStyles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.phoneBox}>
          <Text style={styles.phoneLabel}>{t('admin.superOtp.phonedIn')}</Text>
          <View style={styles.phoneRow}>
            <TextInput
              style={styles.phoneInput}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('admin.superOtp.phonePlaceholder')}
              placeholderTextColor={colors.textDisabled}
              keyboardType="number-pad"
              maxLength={10}
              testID="admin-superotp-phone"
            />
            <Pressable
              onPress={doPhoneIssue}
              disabled={busy}
              style={({ pressed }) => [styles.phoneBtn, pressed && styles.pressed, busy && styles.disabled]}
              testID="admin-superotp-phone-issue"
            >
              <Text style={styles.phoneBtnLabel}>{t('admin.superOtp.generate')}</Text>
            </Pressable>
          </View>
        </View>

        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <EmptyState message={t('admin.superOtp.error')} />
        ) : rows.length === 0 ? (
          <EmptyState
            message={
              search
                ? t('admin.superOtp.noneFound', { query: term.trim() })
                : scope === 'open'
                  ? t('admin.superOtp.noneOpen')
                  : t('admin.superOtp.noneAll')
            }
          />
        ) : (
          rows.map(row => (
            <Row key={row.id} row={row} onGenerate={doGenerate} onDecline={setDeclining} onNewCode={doNewCode} />
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
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  toggleChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  toggleChipActive: { backgroundColor: colors.info },
  toggleLabel: { ...typography.label, color: colors.info },
  toggleLabelActive: { color: colors.surface },
  waitingCount: { ...typography.caption, color: colors.textMuted, flex: 1, textAlign: 'right' },

  phoneBox: {
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[2],
  },
  phoneLabel: { ...typography.caption, color: colors.textMuted },
  phoneRow: { flexDirection: 'row', gap: spacing[2] },
  phoneInput: {
    flex: 1,
    ...typography.body,
    color: colors.ink,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  phoneBtn: {
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  phoneBtnLabel: { ...typography.bodyStrong, color: colors.surface },

  rowTop: { alignItems: 'flex-start' },
  number: { ...typography.bodyStrong, color: colors.ink, marginTop: 2, letterSpacing: 0.5 },
  pills: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[1] },
  pill: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radius.pill },
  pillLabel: { ...typography.caption, fontSize: 11, fontFamily: typography.label.fontFamily },
  waited: { ...typography.caption, color: colors.textMuted },
  smsGood: { ...typography.caption, color: colors.primaryDark },
  smsBad: { ...typography.caption, color: colors.error },

  actions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  generate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[4],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  generateLabel: { ...typography.bodyStrong, color: colors.surface },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[4],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  secondaryLabel: { ...typography.bodyStrong, color: colors.ink },

  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,30,40,0.55)' },
  sheet: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    top: '18%',
    padding: spacing[5],
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    gap: spacing[3],
  },
  sheetMark: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoWash,
  },
  sheetWho: { ...typography.h3, color: colors.ink, textAlign: 'center' },
  sheetCall: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  codeBox: {
    alignSelf: 'stretch',
    paddingVertical: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: green[300],
    backgroundColor: colors.primaryWash,
    alignItems: 'center',
  },
  code: { ...typography.display, fontSize: 40, lineHeight: 46, color: colors.primaryDark, letterSpacing: 2 },
  sheetExpiry: { ...typography.caption, color: colors.textMuted },
  sheetExpiryGone: { color: colors.error },
  sheetDone: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET + 4,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  sheetDoneLabel: { ...typography.bodyStrong, color: colors.surface },

  reasonInput: {
    alignSelf: 'stretch',
    ...typography.body,
    color: colors.ink,
    minHeight: 72,
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    textAlignVertical: 'top',
  },
  sheetActions: { flexDirection: 'row', gap: spacing[2], alignSelf: 'stretch' },
  sheetCancel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  sheetCancelLabel: { ...typography.bodyStrong, color: colors.textMuted },
  declineConfirm: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  declineConfirmLabel: { ...typography.bodyStrong, color: colors.error },
});
