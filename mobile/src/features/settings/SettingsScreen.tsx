/**
 * Profile (M21) — who is signed in, what they have done, and the four things they can do here.
 *
 * It used to be a settings page: a list of facts under two headings, most of them read-only.
 * That is what it *is*, but it is not what a Mait opens it for. They open it to check a number
 * they are about to be asked for — how many did I do this month, how much cash am I carrying,
 * which MPPs am I down for, has my work gone up, where is that indent — and a page of grey
 * label/value rows makes every one of those a search.
 *
 * So the two figures that get asked about are tiles at the top, and everything else is one row
 * each, in the order they come up. Nothing here is a setting except the language.
 *
 * The figures are read off the server rather than counted on the handset. `count` on a filtered
 * list answers "how many this month" without pulling two hundred records down a village
 * connection; the cash is today's own rows, which is a page at most.
 *
 * Sign-out still asks twice when work is unsent. The queue lives in this app's storage, so
 * those records can only be sent by that Mait on that handset — and the idempotency window
 * closes in a day.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import {
  useListAiEventsQuery,
  useListIndentsQuery,
  useListMppsQuery,
  useLogoutMutation,
} from '@api/endpoints';
import { LanguageToggle } from '@/components/brand';
import { fitTitleSize } from '@/components/hero';
import PullToRefresh from '@/components/pullToRefresh';
import { loggedOut } from '@/features/auth/authSlice';
import { useAppDispatch, useAppSelector } from '@/store';
import {
  colors,
  MIN_TOUCH_TARGET,
  radius,
  shadows,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

/** `YYYY-MM-DD`, which is what the API's date filters take. */
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** Initials for the avatar. Two at most — three letters in a circle stop being readable. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) {
    return '?';
  }
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return (first.charAt(0) + (last ? last.charAt(0) : '')).toUpperCase();
}

// --------------------------------------------------------------------------------------
// Pieces
// --------------------------------------------------------------------------------------
/** One of the two figures at the top: what it is, the number, and what the number counts. */
function Tile({
  label,
  value,
  foot,
  tone = 'plain',
  testID,
}: {
  label: string;
  value: string;
  foot: string;
  tone?: 'plain' | 'good';
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.tile, tone === 'good' && styles.tileGood]} testID={testID}>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileFoot} numberOfLines={1}>
        {foot}
      </Text>
    </View>
  );
}

/**
 * One row of the stack.
 *
 * A chevron means the tap opens something, and a row that only states a fact never wears one
 * — an arrow promising a screen that is not there is worse than no affordance at all. Sync
 * turns it off deliberately: tapping it pushes what is queued and stays put, so the arrow
 * would be pointing at a screen nobody is going to. The right-hand slot carries what those
 * rows have instead — the language toggle, the online pill.
 */
function Row({
  title,
  body,
  onPress,
  chevron,
  right,
  testID,
}: {
  title: string;
  body?: string;
  onPress?: () => void;
  /** Defaults to "yes if it opens something". Set false for a tap that acts in place. */
  chevron?: boolean;
  right?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const showChevron = chevron ?? !!onPress;
  const content = (
    <>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!body && (
          <Text style={styles.rowText} numberOfLines={2}>
            {body}
          </Text>
        )}
      </View>
      {right}
      {showChevron && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
    </>
  );

  if (!onPress) {
    return (
      <View style={styles.row} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

// --------------------------------------------------------------------------------------
// Screen
// --------------------------------------------------------------------------------------
export default function SettingsScreen({
  pending,
  onSync,
  online,
  lastSyncAt,
  onOpenIndents,
}: {
  pending: number;
  onSync: () => void;
  online: boolean;
  /** The clock time of the last successful drain, or null if nothing has gone up yet. */
  lastSyncAt: string | null;
  onOpenIndents: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const user = useAppSelector(state => state.auth.user);
  const refreshToken = useAppSelector(state => state.auth.refreshToken);

  const [logout] = useLogoutMutation();
  const [confirming, setConfirming] = useState(false);
  const [mppsOpen, setMppsOpen] = useState(false);

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  // Only `count` is read off this one, so the rows it carries are never rendered.
  const month = useListAiEventsQuery({ status: 'completed', dateFrom: isoDate(monthStart) });
  const todays = useListAiEventsQuery({ dateFrom: isoDate(today), dateTo: isoDate(today) });
  const mpps = useListMppsQuery();
  const indents = useListIndentsQuery();

  /**
   * What the Mait is carrying, which is not what has been charged.
   *
   * Cash only, and only where her code confirmed it. A member never hands anything over — the
   * dairy deducts her rate from her milk payment — and UPI goes to the dairy's account, not
   * into a pocket. Counting either here would tell a Mait they are holding money they have
   * never touched, which is the one number on this screen somebody might be asked to produce.
   */
  const collections = (todays.data?.results ?? []).filter(
    event => event.payment?.mode === 'COD' && event.payment.is_verified,
  );
  const cash = collections.reduce((sum, event) => sum + Number(event.payment?.amount ?? 0), 0);

  const assigned = mpps.data?.results ?? [];
  const openIndents = (indents.data?.results ?? []).filter(
    indent => indent.status === 'requested' || indent.status === 'approved',
  ).length;

  /**
   * The Sahayak vendor code, and nothing else.
   *
   * It is what a Mait is known by on their paperwork, in the portal and in SAP — never the
   * row id, which matches nothing outside this database. The MPPs have their own row below,
   * so naming their dairy up here as well was the same fact said twice on the one line that
   * has to survive a long name wrapping into it.
   */
  const meta = user?.sahayakVendorCode ? t('home.maitCode', { code: user.sahayakVendorCode }) : '';

  const version = Constants.expoConfig?.version ?? '0.1.0';

  const signOut = async () => {
    if (pending > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    try {
      if (refreshToken) {
        await logout(refreshToken).unwrap();
      }
    } catch {
      // The token is unreachable either way; a session left in storage is the worse outcome.
    }
    dispatch(loggedOut());
  };

  /**
   * What is left for the name after the avatar has taken its share.
   *
   * `AVATAR_ROW` is the 52pt circle plus the 16pt gap beside it; the gutters are the hero's
   * own 24pt each side. Kept as arithmetic rather than measured on layout because a name that
   * resizes itself after the first paint is a name that visibly jumps.
   */
  const nameSize = fitTitleSize(user?.fullName ?? '', width - spacing[5] * 2 - AVATAR_ROW);

  const syncBody =
    pending > 0
      ? lastSyncAt
        ? t('settings.syncWaiting', { count: pending, time: lastSyncAt })
        : t('settings.syncWaitingPlain', { count: pending })
      : lastSyncAt
        ? t('settings.syncAllSent', { time: lastSyncAt })
        : t('settings.syncAllSentPlain');

  return (
    <View style={styles.root}>
      {/* The person, not the product. Every other tab wears the mark up here; this screen is
          the one place the app is answering "who am I signed in as", and a card saying MAIT AI
          above a name saying Sunil Kumar is the mark competing with its own answer. */}
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLabel}>{initialsOf(user?.fullName ?? '')}</Text>
        </View>
        <View style={styles.heroBody}>
          {/* One line, set to whatever size makes it fit.

              It used to wrap to two, on the reasoning that a name clipped to "Shivam Kumar
              Chaub…" is worse than a name that wraps — which was true of the only two choices
              then on the table. Measuring it is the third: nothing is clipped, nothing is
              broken across lines, and the card stops changing height depending on whose phone
              it is. The same rule Home's hero uses, through the same function, with the avatar
              and its gap taken off the width first. */}
          <Text
            style={[
              styles.heroTitle,
              { fontSize: nameSize, lineHeight: Math.round(nameSize * 1.25) },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {user?.fullName ?? ''}
          </Text>
          {!!meta && (
            <Text style={styles.heroMeta} numberOfLines={1}>
              {meta}
            </Text>
          )}
        </View>
      </View>

      <PullToRefresh
        onRefresh={async () => {
          // The queue goes too, the way it does on every other screen that pulls. Profile is
          // where a Mait checks the month's count and the cash they are carrying, and both are
          // wrong while today's work is still sitting on the handset.
          onSync();
          await Promise.all([month.refetch(), todays.refetch(), indents.refetch()]);
        }}
        label={t('pull.figures')}
        testID="profile-pull"
      >
        {scrollProps => (
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            {...scrollProps}
          >
            <View style={styles.tiles}>
              <Tile
                tone="good"
                label={t('settings.thisMonth')}
                value={month.isLoading ? '—' : String(month.data?.count ?? 0)}
                foot={t('settings.inseminations')}
                testID="profile-month"
              />
              <Tile
                label={t('settings.cashOnHand')}
                value={todays.isLoading ? '—' : `₹ ${Math.round(cash)}`}
                foot={t('settings.collectionsToday', { count: collections.length })}
                testID="profile-cash"
              />
            </View>

            {/* Tapping opens the names rather than a screen: a Mait asked which MPPs they cover
            needs the list read out, and that is the whole of the answer. */}
            <Row
              title={
                assigned.length
                  ? t('settings.mppsAssigned', { count: assigned.length })
                  : t('settings.noMpps')
              }
              body={
                assigned.length
                  ? assigned
                      .map(mpp => mpp.mpp_name)
                      .slice(0, 3)
                      .join(' · ')
                  : undefined
              }
              onPress={assigned.length ? () => setMppsOpen(open => !open) : undefined}
              testID="profile-mpps"
            />

            {mppsOpen && (
              <View style={styles.mppList} testID="profile-mpp-list">
                {assigned.map(mpp => (
                  <View key={mpp.mpp_code} style={styles.mppRow}>
                    <Text style={styles.mppName} numberOfLines={1}>
                      {mpp.mpp_name}
                    </Text>
                    <Text style={styles.mppCode}>{mpp.mpp_code}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Here rather than only under Inventory. Raising an indent is a stock job and belongs
            with the flask; chasing one is a "where is my order" question, and a Mait asks it
            from wherever they are standing. */}
            <Row
              title={t('settings.yourIndents')}
              body={
                indents.isLoading
                  ? t('common.loading')
                  : openIndents > 0
                    ? t('settings.indentsOpen', { count: openIndents })
                    : t('settings.indentsNone')
              }
              onPress={onOpenIndents}
              testID="profile-indents"
            />

            <Row
              title={t('settings.language')}
              right={<LanguageToggle variant="light" />}
              testID="profile-language"
            />

            <Row
              title={t('settings.sync')}
              body={syncBody}
              onPress={onSync}
              chevron={false}
              right={
                <View style={[styles.pill, online ? styles.pillOnline : styles.pillOffline]}>
                  <Text style={[styles.pillLabel, online ? styles.pillLabelOnline : undefined]}>
                    {online ? t('settings.online') : t('settings.offline')}
                  </Text>
                </View>
              }
              testID="profile-sync"
            />

            {/* A statement, not a door. There is no supervisor number on the record for the app to
            dial, so a chevron here would open nothing; the version rides along because it is
            the first thing support asks for. */}
            <Row
              title={t('settings.help')}
              body={t('settings.helpFoot', { version })}
              testID="profile-help"
            />

            {confirming && (
              <View style={styles.warning} testID="signout-warning">
                <Ionicons name="warning-outline" size={18} color={colors.secondaryPressed} />
                <View style={styles.rowBody}>
                  <Text style={styles.warningTitle}>
                    {t('settings.signOutWarnTitle', { count: pending })}
                  </Text>
                  <Text style={styles.warningText}>{t('settings.signOutWarnBody')}</Text>
                </View>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={signOut}
              style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
              testID="sign-out"
            >
              <Text style={styles.signOutLabel}>
                {confirming ? t('settings.signOutAnyway') : t('settings.signOut')}
              </Text>
            </Pressable>

            {confirming && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirming(false)}
                style={styles.cancel}
                testID="signout-cancel"
              >
                <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </PullToRefresh>
    </View>
  );
}

/** The 52pt avatar plus the 16pt gap beside it — what the name in the hero does not get. */
const AVATAR_ROW = 52 + spacing[4];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // -- hero ------------------------------------------------------------------------------
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[4],
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: { ...typography.h2, color: colors.surface },
  heroBody: { flex: 1 },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroMeta: { ...typography.caption, color: colors.surface, opacity: 0.72, marginTop: 2 },

  // -- tiles -----------------------------------------------------------------------------
  body: { padding: spacing[4] },
  tiles: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] },
  tile: {
    flex: 1,
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  tileGood: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  tileLabel: { ...typography.caption, color: colors.textMuted },
  tileValue: { ...typography.display, fontSize: 30, lineHeight: 38, color: colors.ink },
  tileFoot: { ...typography.caption, color: colors.textMuted },

  // -- rows ------------------------------------------------------------------------------
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  rowPressed: { backgroundColor: colors.background },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.h3, color: colors.ink },
  rowText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  // The expanded MPP list sits under its row rather than inside it, so the row keeps one
  // height whether it is open or closed.
  mppList: {
    marginTop: -spacing[2],
    marginBottom: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mppRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET - 12,
  },
  mppName: { ...typography.body, color: colors.ink, flexShrink: 1 },
  mppCode: { ...typography.caption, color: colors.textMuted },

  pill: { paddingHorizontal: spacing[3], paddingVertical: 3, borderRadius: radius.pill },
  pillOnline: { backgroundColor: colors.primaryWash },
  pillOffline: { backgroundColor: colors.background },
  pillLabel: { ...typography.caption, color: colors.textMuted },
  pillLabelOnline: { color: colors.primaryDark },

  // -- sign out --------------------------------------------------------------------------
  warning: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  warningTitle: { ...typography.bodyStrong, color: yolk[800] },
  warningText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  // Outlined rather than filled. It is the one destructive thing on the screen and it should
  // read as a way out, not as the action the page is for.
  signOut: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.error,
  },
  signOutPressed: { backgroundColor: colors.errorWash },
  signOutLabel: { ...typography.bodyStrong, color: colors.error },

  cancel: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { ...typography.bodyStrong, color: colors.primaryDark },
});
