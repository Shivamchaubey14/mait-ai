/**
 * Profile, for a zonal manager.
 *
 * The same shape as the store keeper's and for the same reason: a manager has less to look up
 * about themselves than a Mait does. Which zone this account runs, how big that patch is, the
 * number the sign-in code came to, the language, and the way out. The Mait's figures —
 * inseminations, cash, PDs — are somebody else's work, and a screen of zeros under those
 * headings would read as an account that is broken.
 *
 * The number is here because it is the one fact about this account a manager might have to
 * read out: it is what they sign in with, it is set for them by the office on the Zones
 * screen, and when the app stops opening it is the first thing anybody will ask them for.
 *
 * **A colour and a glyph per card**, the way every other zonal screen draws its cards: blue
 * for the door to the zone's events, green for the zone itself, yolk for the people in it,
 * slate for the app's own setting. The facts sit on the card as chips and figures rather than
 * as a grey line under a heading, so the screen reads at a glance like the rest of the app.
 */

import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useGetZonalHomeQuery, useLogoutMutation } from '@api/endpoints';
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

import { zonalStyles } from './parts';
import { useLive } from './live';

type CardTone = 'green' | 'warm' | 'slate';

const CHIP_ICON: Record<CardTone, string> = {
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
  children,
  testID,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: CardTone;
  right?: React.ReactNode;
  children?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.card, styles[`card_${tone}`]]} testID={testID}>
      <View style={styles.cardHead}>
        <View style={[styles.cardChip, styles[`cardChip_${tone}`]]}>
          <Ionicons name={icon} size={18} color={CHIP_ICON[tone]} />
        </View>
        <Text style={[styles.cardTitle, styles[`cardTitle_${tone}`]]}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/** One figure on a white inset: a glyph, the number, and what it counts. */
function Figure({
  icon,
  value,
  label,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  value: string;
  label: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.figure} testID={testID}>
      <Ionicons name={icon} size={16} color={yolk[800]} />
      <Text style={styles.figureValue}>{value}</Text>
      <Text style={styles.figureLabel}>{label}</Text>
    </View>
  );
}

export default function ZonalProfileScreen({
  onOpenEvents,
}: {
  /** The list of every insemination in the zone, by date. */
  onOpenEvents: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector(state => state.auth.user);
  const refreshToken = useAppSelector(state => state.auth.refreshToken);
  const home = useGetZonalHomeQuery(undefined, useLive());
  const [logout] = useLogoutMutation();

  // The server's answer where it has landed, the session's where it has not — so the screen
  // is never blank on a slow connection.
  const zones = home.data?.manager.zones ?? user?.zones ?? [];

  const signOut = () => {
    Alert.alert(t('zonal.signOutTitle'), t('zonal.signOutBody'), [
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
            // The token is unreachable either way; a session left in storage is the worse
            // outcome.
          }
          dispatch(loggedOut());
        },
      },
    ]);
  };

  return (
    <View style={zonalStyles.root}>
      <PageHero
        title={user?.fullName ?? ''}
        subtitle={[t('zonal.profileRole'), user?.mobileNo].filter(Boolean).join(' · ')}
      />

      <ScrollView contentContainerStyle={zonalStyles.body}>
        {/* The one door on this screen, so the one card in colour: the zone's inseminations,
            every one of them, a page at a time and by date. */}
        <Pressable
          accessibilityRole="button"
          onPress={onOpenEvents}
          style={({ pressed }) => [styles.door, pressed && styles.doorPressed]}
          testID="zonal-profile-all-events"
        >
          <View style={styles.doorChip}>
            <Ionicons name="list" size={20} color={colors.surface} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.doorTitle}>{t('zonal.allEventsTitle')}</Text>
            <Text style={styles.doorText}>{t('zonal.allEventsBody')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.info} />
        </Pressable>

        {/* The zone beside its heading, where the language switch sits on its own card — one
            line, not a heading with its answer dropped onto the next. */}
        <Card
          title={t('zonal.yourZone')}
          icon="map"
          tone="green"
          right={
            zones.length ? (
              <View style={styles.zones}>
                {zones.map(zone => (
                  <View key={zone} style={styles.zone}>
                    <Ionicons name="location" size={14} color={colors.surface} />
                    <Text style={styles.zoneLabel} numberOfLines={1}>
                      {zone}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.quiet}>{t('zonal.noZone')}</Text>
            )
          }
          testID="zonal-profile-zone"
        />

        <Card title={t('zonal.yourPatch')} icon="people" tone="warm" testID="zonal-profile-patch">
          <View style={styles.figures}>
            <Figure
              icon="person"
              value={home.data ? String(home.data.maits) : '—'}
              label={t('zonal.patchMaits', { count: home.data?.maits ?? 0 })}
              testID="zonal-profile-maits"
            />
            <Figure
              icon="storefront"
              value={home.data ? String(home.data.stores) : '—'}
              label={t('zonal.patchDepots', { count: home.data?.stores ?? 0 })}
              testID="zonal-profile-depots"
            />
          </View>
        </Card>

        <Card
          title={t('settings.language')}
          icon="language"
          tone="slate"
          right={<LanguageToggle variant="light" />}
          testID="zonal-profile-language"
        />

        <SignOutButton
          label={t('settings.signOut')}
          onPress={signOut}
          testID="zonal-profile-sign-out"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rowBody: { flex: 1 },

  // -- the cards ---------------------------------------------------------------------------
  card: {
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing[3],
  },
  card_green: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  card_warm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  card_slate: { backgroundColor: ink[50], borderColor: ink[200] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  cardChip: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardChip_green: { backgroundColor: colors.primary },
  cardChip_warm: { backgroundColor: yolk[500] },
  cardChip_slate: { backgroundColor: colors.ink },
  cardTitle: { ...typography.h3, flex: 1 },
  cardTitle_green: { color: colors.primaryDark },
  cardTitle_warm: { color: yolk[900] },
  cardTitle_slate: { color: colors.ink },

  // Right-aligned beside the heading. Allowed most of the row, so a long zone name gets the
  // room, and wrapping onto a second line of pills only when a manager holds several.
  zones: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing[1],
    flexShrink: 1,
    maxWidth: '62%',
  },
  zone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  zoneLabel: { ...typography.label, color: colors.surface, flexShrink: 1 },
  quiet: { ...typography.body, color: colors.textMuted, flexShrink: 1, textAlign: 'right' },

  figures: { flexDirection: 'row', gap: spacing[2] },
  figure: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  figureValue: { ...typography.h1, color: colors.ink },
  figureLabel: { ...typography.caption, color: yolk[800] },
  door: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[4],
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.infoWash,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.info,
  },
  doorPressed: { opacity: 0.85 },
  doorChip: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.info,
  },
  doorTitle: { ...typography.h3, color: colors.info },
  doorText: { ...typography.caption, color: colors.ink, marginTop: 2 },
});
