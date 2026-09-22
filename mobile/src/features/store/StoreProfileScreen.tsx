/**
 * Profile, for a store keeper.
 *
 * Shorter than a Mait's, because a keeper has less to look up about themselves: which store
 * this account works, which BMC/MCCs send their Maits here, the language, and the way out.
 * The Mait's figures — inseminations, cash, PDs — mean nothing behind a counter, and a screen
 * of zeros under those headings would read as an account that is broken.
 *
 * What a keeper does have is a counter, so the counter's day leads: what is waiting, what the
 * shelf can hand over now, what went over today and what is still waiting on a code — the
 * same four figures the queue works from, here at a glance.
 *
 * **A colour and a glyph per card**, the way the zonal manager's profile draws them: blue for
 * the counter's day, green for the store, yolk for the places it serves, slate for the app's
 * own setting. The facts sit on the cards as pills and figures rather than as a grey line.
 */

import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useGetStoreHomeQuery, useLogoutMutation } from '@api/endpoints';
import { SignOutButton } from '@/components';
import { LanguageToggle } from '@/components/brand';
import PageHero from '@/components/hero';
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

import { storeStyles } from './parts';

type CardTone = 'info' | 'green' | 'warm' | 'slate';

/** The glyph's colour on each card's solid chip. Yolk takes Ink; white fails on it. */
const ON_CHIP: Record<CardTone, string> = {
  info: colors.surface,
  green: colors.surface,
  warm: colors.ink,
  slate: colors.surface,
};

/** A card with its glyph on a solid chip, its heading, and whatever it holds. */
function Card({
  title,
  icon,
  tone,
  right,
  badge,
  children,
  testID,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: CardTone;
  right?: React.ReactNode;
  /** A count beside the title — how many places, how many things. */
  badge?: number;
  children?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.card, styles[`card_${tone}`]]} testID={testID}>
      <View style={styles.cardHead}>
        <View style={[styles.chip, styles[`chip_${tone}`]]}>
          <Ionicons name={icon} size={18} color={ON_CHIP[tone]} />
        </View>
        <View style={styles.titleLine}>
          <Text style={[styles.cardTitle, styles[`cardTitle_${tone}`]]}>{title}</Text>
          {badge !== undefined && (
            <View style={styles.count}>
              <Text style={styles.countLabel}>{badge}</Text>
            </View>
          )}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

/** One of the counter's figures, on a white inset with its glyph in its own colour. */
function Figure({
  icon,
  color,
  value,
  label,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  value: string;
  label: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.figure} testID={testID}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.figureValue, { color }]}>{value}</Text>
      <Text style={styles.figureLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

export default function StoreProfileScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector(state => state.auth.user);
  const refreshToken = useAppSelector(state => state.auth.refreshToken);
  const home = useGetStoreHomeQuery();
  const [logout] = useLogoutMutation();

  const store = home.data?.store;
  const plants = store?.plant_names ?? [];
  const figure = (value: number | undefined) => (value === undefined ? '—' : String(value));

  const signOut = () => {
    Alert.alert(t('store.signOutTitle'), t('store.signOutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.signOut'),
        style: 'destructive',
        onPress: async () => {
          try {
            if (refreshToken) {
              await logout(refreshToken).unwrap();
            }
          } catch {
            // The token is unreachable either way; a session left in storage is the worse outcome.
          }
          dispatch(loggedOut());
        },
      },
    ]);
  };

  return (
    <View style={storeStyles.root}>
      <PageHero
        title={user?.fullName ?? ''}
        subtitle={[t('store.profileRole'), user?.mobileNo].filter(Boolean).join(' · ')}
      />

      <ScrollView contentContainerStyle={storeStyles.body}>
        {/* The counter's day, first: the four figures the queue works from. */}
        <Card title={t('store.counterToday')} icon="today" tone="info" testID="profile-today">
          <View style={styles.figures}>
            <Figure
              icon="hourglass"
              color={yolk[800]}
              value={figure(home.data?.waiting)}
              label={t('store.figureWaiting')}
              testID="profile-waiting"
            />
            <Figure
              icon="checkmark-circle"
              color={colors.primaryDark}
              value={figure(home.data?.ready)}
              label={t('store.readyTile')}
              testID="profile-ready"
            />
            <Figure
              icon="arrow-up-circle"
              color={colors.info}
              value={figure(home.data?.issued_today)}
              label={t('store.issuedToday')}
              testID="profile-issued"
            />
            <Figure
              icon="key"
              color={yolk[800]}
              value={figure(home.data?.not_collected)}
              label={t('store.notCollected')}
              testID="profile-not-collected"
            />
          </View>
        </Card>

        {/* The store and the places it serves beside their headings, the way the language
            switch sits beside its own — one line each, not a heading with its answer dropped
            onto the next. The code and the zone ride with the name. */}
        <Card
          title={t('store.yourStore')}
          icon="storefront"
          tone="green"
          right={
            <View style={styles.aside}>
              <Text style={styles.storeName} numberOfLines={2}>
                {store?.name ?? user?.storeName ?? '—'}
              </Text>
              {!!store && (
                <View style={styles.pills}>
                  <View style={[styles.pill, styles.pillGreen]}>
                    <Ionicons name="barcode-outline" size={12} color={colors.surface} />
                    <Text style={styles.pillLabel}>{store.code}</Text>
                  </View>
                  {!!store.zone_name && (
                    <View style={[styles.pill, styles.pillInk]}>
                      <Ionicons name="map" size={12} color={colors.surface} />
                      <Text style={styles.pillLabel} numberOfLines={1}>
                        {store.zone_name}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          }
          testID="profile-store"
        />

        <Card
          title={t('store.serves')}
          icon="business"
          tone="warm"
          badge={plants.length}
          right={
            <View style={styles.aside}>
              {plants.length ? (
                <View style={styles.pills}>
                  {plants.map(name => (
                    <View key={name} style={[styles.pill, styles.pillYolk]}>
                      <Ionicons name="location" size={12} color={colors.ink} />
                      <Text style={[styles.pillLabel, styles.pillLabelInk]} numberOfLines={1}>
                        {name}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.quiet}>{t('store.servesNone')}</Text>
              )}
            </View>
          }
          testID="profile-serves"
        />

        <Card
          title={t('settings.language')}
          icon="language"
          tone="slate"
          right={<LanguageToggle variant="light" />}
          testID="profile-language"
        />

        <SignOutButton label={t('settings.signOut')} onPress={signOut} testID="profile-sign-out" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing[3],
  },
  card_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  card_green: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  card_warm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  card_slate: { backgroundColor: ink[50], borderColor: ink[200] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  chip: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip_info: { backgroundColor: colors.info },
  chip_green: { backgroundColor: colors.primary },
  chip_warm: { backgroundColor: yolk[500] },
  chip_slate: { backgroundColor: colors.ink },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexShrink: 0 },
  cardTitle: { ...typography.h3 },
  // The answer beside the heading, right-aligned. Most of the row, so a long store name or a
  // few centres get the room; wrapping onto a second line on the right only when they must.
  aside: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 4,
  },
  cardTitle_info: { color: colors.info },
  cardTitle_green: { color: colors.primaryDark },
  cardTitle_warm: { color: yolk[900] },
  cardTitle_slate: { color: colors.ink },

  // The counter's four figures, two by two on paper so each reads on its own.
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  figure: {
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  figureValue: { ...typography.h1 },
  figureLabel: { ...typography.caption, color: colors.ink, textAlign: 'center' },

  storeName: { ...typography.h3, color: colors.ink, textAlign: 'right' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  pillGreen: { backgroundColor: colors.primary },
  pillInk: { backgroundColor: colors.ink },
  // Ink on yolk, never white — yolk fails contrast under white text.
  pillYolk: { backgroundColor: yolk[400] },
  pillLabel: { ...typography.label, color: colors.surface, flexShrink: 1 },
  pillLabelInk: { color: colors.ink },

  count: {
    minWidth: 26,
    height: 24,
    paddingHorizontal: spacing[2],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: yolk[500],
  },
  countLabel: { ...typography.label, color: colors.ink },
  quiet: { ...typography.caption, color: yolk[800], textAlign: 'right' },
});
