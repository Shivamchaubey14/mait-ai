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

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import {
  useListAiEventsQuery,
  useListIndentsQuery,
  useListPregnancyChecksQuery,
  useListMppsQuery,
  useLogoutMutation,
} from '@api/endpoints';
import { SignOutButton } from '@/components';
import { LanguageToggle } from '@/components/brand';
import { Tile, Tiles } from '@/components/frame';
import Glyph, { GlyphName } from '@/components/glyph';
import { fitTitleSize } from '@/components/hero';
import PullToRefresh from '@/components/pullToRefresh';
import { loggedOut } from '@/features/auth/authSlice';
import { useAppDispatch, useAppSelector } from '@/store';
import {
  colors,
  green,
  ink,
  MIN_TOUCH_TARGET,
  radius,
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
/**
 * A row's colour, by what it says: green all in order, yolk something waiting, blue a fact
 * about places, slate a setting or a note.
 */
type Tone = 'good' | 'warm' | 'info' | 'slate';

const SOLID: Record<Tone, string> = {
  good: colors.primary,
  warm: yolk[500],
  info: colors.info,
  slate: ink[500],
};

const WORD: Record<Tone, string> = {
  good: colors.primaryDark,
  warm: yolk[800],
  info: colors.info,
  slate: ink[600],
};

function onSolid(tone: Tone): string {
  return tone === 'warm' ? colors.ink : colors.surface;
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
  icon,
  tone,
  onPress,
  chevron,
  expanded,
  right,
  testID,
}: {
  title: string;
  /** The row's glyph, on a solid chip of its colour. */
  icon: GlyphName;
  tone: Tone;
  body?: string;
  onPress?: () => void;
  /** Defaults to "yes if it opens something". Set false for a tap that acts in place. */
  chevron?: boolean;
  /**
   * Set on a row that opens a list under itself rather than a screen: the arrow turns down
   * while it is open.
   */
  expanded?: boolean;
  right?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const showChevron = chevron ?? !!onPress;
  const content = (
    <>
      <View style={[styles.chip, { backgroundColor: SOLID[tone] }]}>
        <Glyph name={icon} size={20} color={onSolid(tone)} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!body && (
          <Text style={[styles.rowText, { color: WORD[tone] }]} numberOfLines={2}>
            {body}
          </Text>
        )}
      </View>
      {right}
      {showChevron && (
        <View style={[styles.go, { borderColor: SOLID[tone] }]}>
          {expanded === undefined ? (
            <Ionicons name="chevron-forward" size={16} color={WORD[tone]} />
          ) : (
            <TurningChevron open={expanded} color={WORD[tone]} />
          )}
        </View>
      )}
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.row, styles[`row_${tone}`]]} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        styles[`row_${tone}`],
        expanded && styles.rowOpen,
        pressed && styles.rowPressed,
      ]}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

/** How long a row takes to open or close. Quick enough not to wait on, slow enough to see. */
const OPEN_MS = 220;

/**
 * The arrow on a row that opens in place: right while shut, turned down while open, and
 * turning between the two — so the arrow says the list is *under* this row, not on another
 * screen.
 */
function TurningChevron({ open, color }: { open: boolean; color: string }): React.JSX.Element {
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }} testID="row-chevron">
      <Ionicons name="chevron-forward" size={16} color={color} />
    </Animated.View>
  );
}

/**
 * The part of the page a row opens in place — faded and slid down into view, and back up
 * again before it goes, rather than blinking in and out.
 */
function Unfold({
  open,
  children,
  testID,
}: {
  open: boolean;
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element | null {
  const [shown, setShown] = useState(open);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (open) {
      setShown(true);
    }
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) {
        setShown(false);
      }
    });
  }, [open, progress]);

  if (!shown) {
    return null;
  }
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });
  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateY }] }} testID={testID}>
      {children}
    </Animated.View>
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
  onOpenPd,
}: {
  pending: number;
  onSync: () => void;
  online: boolean;
  /** The clock time of the last successful drain, or null if nothing has gone up yet. */
  lastSyncAt: string | null;
  onOpenIndents: () => void;
  /** The pregnancy checks this Mait owes a visit. */
  onOpenPd: () => void;
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

  /**
   * Checks due this week, counted by the server.
   *
   * Read here rather than passed in so the row is right the moment Profile is opened, and
   * off the response's own count rather than the rows: the list, this row and the screen's
   * headline all have to show one number.
   */
  const pd = useListPregnancyChecksQuery({ window: 'due' });
  const pdDue = pd.data?.due_this_week ?? 0;

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
            <View style={styles.heroPills}>
              <View style={styles.heroPill} testID="profile-code">
                <Ionicons name="id-card" size={12} color={colors.surface} />
                <Text style={styles.heroMeta} numberOfLines={1}>
                  {meta}
                </Text>
              </View>
            </View>
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
              <Tiles>
                <Tile
                  tone="good"
                  icon="checkmark-done"
                  label={t('settings.thisMonth')}
                  value={month.isLoading ? '—' : String(month.data?.count ?? 0)}
                  note={t('settings.inseminations')}
                  testID="profile-month"
                />
                {/* Yolk: cash in a pocket is money waiting to be handed in. */}
                <Tile
                  tone={cash > 0 ? 'waiting' : 'info'}
                  icon="cash"
                  label={t('settings.cashOnHand')}
                  value={todays.isLoading ? '—' : `₹ ${Math.round(cash)}`}
                  note={t('settings.collectionsToday', { count: collections.length })}
                  testID="profile-cash"
                />
              </Tiles>
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
              icon="home"
              tone={assigned.length ? 'info' : 'slate'}
              onPress={assigned.length ? () => setMppsOpen(open => !open) : undefined}
              expanded={assigned.length ? mppsOpen : undefined}
              testID="profile-mpps"
            />

            {/* Blue, the colour of places, hung from the row that opened it: the row's bottom
                corners square off and the list carries on in the same wash. */}
            <Unfold open={mppsOpen}>
              <View style={styles.mppList} testID="profile-mpp-list">
                {assigned.map((mpp, index) => (
                  <View key={mpp.mpp_code} style={styles.mppRow}>
                    <View style={styles.mppChip}>
                      <Text style={styles.mppChipLabel}>{index + 1}</Text>
                    </View>
                    <View style={styles.mppBody}>
                      <Text style={styles.mppName} numberOfLines={1}>
                        {mpp.mpp_name}
                      </Text>
                      <View style={styles.mppPlace}>
                        {!!mpp.plant_name && (
                          <>
                            <Ionicons name="business" size={11} color={colors.info} />
                            <Text style={styles.mppPlaceLabel} numberOfLines={1}>
                              {mpp.plant_name}
                            </Text>
                          </>
                        )}
                        <Ionicons name="people" size={11} color={colors.info} />
                        <Text style={styles.mppPlaceLabel}>{mpp.member_count}</Text>
                      </View>
                    </View>
                    <View style={styles.mppCode}>
                      <Text style={styles.mppCodeLabel}>{mpp.mpp_code}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </Unfold>

            {/* Here rather than only under Inventory. Raising an indent is a stock job and belongs
            with the flask; chasing one is a "where is my order" question, and a Mait asks it
            from wherever they are standing. */}
            {/* Above the indents, because it is work in a yard rather than paperwork with the
                store — and because a check has a date on it that an indent does not. A Mait
                planning tomorrow reads this row first. */}
            <Row
              title={t('settings.upcomingPd')}
              body={
                pd.isLoading
                  ? t('common.loading')
                  : pdDue > 0
                    ? t('settings.upcomingPdMeta', { count: pdDue })
                    : t('settings.upcomingPdNone')
              }
              icon="calendar"
              tone={pdDue > 0 ? 'warm' : 'good'}
              onPress={onOpenPd}
              testID="profile-pd"
            />

            <Row
              title={t('settings.yourIndents')}
              body={
                indents.isLoading
                  ? t('common.loading')
                  : openIndents > 0
                    ? t('settings.indentsOpen', { count: openIndents })
                    : t('settings.indentsNone')
              }
              icon="document-text"
              tone={openIndents > 0 ? 'warm' : 'good'}
              onPress={onOpenIndents}
              testID="profile-indents"
            />

            <Row
              title={t('settings.language')}
              icon="language"
              tone="slate"
              right={<LanguageToggle variant="light" />}
              testID="profile-language"
            />

            <Row
              title={t('settings.sync')}
              body={syncBody}
              icon={pending > 0 ? 'cloud-upload' : 'cloud-done'}
              tone={pending > 0 ? 'warm' : 'good'}
              onPress={onSync}
              chevron={false}
              right={
                <View style={[styles.pill, online ? styles.pillOnline : styles.pillOffline]}>
                  <Ionicons
                    name={online ? 'wifi' : 'cloud-offline'}
                    size={12}
                    color={colors.surface}
                  />
                  <Text style={styles.pillLabel}>
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
              icon="help-buoy"
              tone="slate"
              testID="profile-help"
            />

            {confirming && (
              <View style={styles.warning} testID="signout-warning">
                <View style={[styles.chip, { backgroundColor: yolk[500] }]}>
                  <Ionicons name="warning" size={20} color={colors.ink} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.warningTitle}>
                    {t('settings.signOutWarnTitle', { count: pending })}
                  </Text>
                  <Text style={styles.warningText}>{t('settings.signOutWarnBody')}</Text>
                </View>
              </View>
            )}

            <SignOutButton
              label={confirming ? t('settings.signOutAnyway') : t('settings.signOut')}
              onPress={signOut}
              testID="sign-out"
            />

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
  heroMeta: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
    flexShrink: 1,
  },
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },

  // -- tiles -----------------------------------------------------------------------------
  body: { padding: spacing[4] },
  tiles: { marginBottom: spacing[3] },

  // -- rows ------------------------------------------------------------------------------
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  row_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  row_warm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  row_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  row_slate: { backgroundColor: ink[50], borderColor: ink[100] },
  rowPressed: { opacity: 0.85 },
  chip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.h3, color: colors.ink },
  rowText: { ...typography.caption, marginTop: 2 },
  go: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },

  // Joined to the row above it while open: the row's lower corners square off and the list
  // carries straight on beneath in the same blue, so the two read as one card that opened.
  rowOpen: {
    marginBottom: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  mppList: {
    marginBottom: spacing[3],
    padding: spacing[3],
    paddingTop: spacing[2],
    gap: spacing[2],
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.info,
  },
  mppRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  mppChip: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.info,
  },
  mppChipLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  mppBody: { flex: 1 },
  mppName: { ...typography.bodyStrong, color: colors.ink },
  mppPlace: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  mppPlaceLabel: { ...typography.caption, color: colors.info, flexShrink: 1 },
  mppCode: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
  },
  mppCodeLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  pillOnline: { backgroundColor: colors.primary },
  pillOffline: { backgroundColor: colors.error },
  pillLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  // -- sign out --------------------------------------------------------------------------
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: yolk[300],
  },
  warningTitle: { ...typography.bodyStrong, color: yolk[800] },
  warningText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  cancel: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { ...typography.bodyStrong, color: colors.primaryDark },
});
