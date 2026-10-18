/**
 * Search, for a zonal manager (W19's read-only sibling).
 *
 * A manager stands at a crate with a code in front of them and two questions that are really
 * one: *whose points are these* and *who holds this point*. The assign screen answers neither —
 * it is a write, and it only ever showed a coverage count, not the points themselves. So this
 * is the lookup beside it: one box, two answers.
 *
 * **Both halves off one query.** Type a Mait's name or vendor code and the Maits section fills
 * with them and every collection point they hold — its TR code and its name, the thing a
 * manager reads back. Type an MPP's TR code (or part of its name) and the Points section fills
 * with it and the Mait it is assigned to, or says it is held by nobody.
 *
 * Read-only on purpose. Moving a point is a decision with farmers on the end of it, and it has
 * its own screen; this one is for the manager working out what the situation *is* before they
 * change it. Scoped by the server to the manager's own zones for points, and across every
 * active Mait for people — a manager may want to read back the coverage of one who holds
 * nothing here yet.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useZonalLookupQuery } from '@api/endpoints';
import type { ZonalMait, ZonalMppHit } from '@api/types';
import { EmptyState, Loading, TextField } from '@/components';
import PageHero from '@/components/hero';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { zonalStyles, rowStyles } from './parts';
import { useLive } from './live';

/** Wait for the typing to settle before asking the server — a lookup per keystroke is a lookup per keystroke. */
function useDebounced(value: string, ms = 300): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** One Mait, with every point they hold under them. */
function MaitCard({ mait }: { mait: ZonalMait }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.card} testID={`search-mait-${mait.sahayak_vendor_code}`}>
      <View style={styles.cardHead}>
        <View style={[styles.chip, styles.chipMait]}>
          <Ionicons name="person" size={16} color={colors.surface} />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {mait.name}
          </Text>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {[mait.sahayak_vendor_code, mait.mobile_no].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>

      {mait.mpps.length ? (
        <View style={styles.points}>
          {mait.mpps.map(point => (
            <View key={point.mpp_code} style={styles.point} testID={`search-mait-point-${point.mpp_code}`}>
              <Ionicons name="location" size={13} color={colors.primary} />
              <Text style={styles.pointName} numberOfLines={1}>
                {point.mpp_name}
              </Text>
              <Text style={styles.pointCode}>{point.mpp_code}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.quiet}>{t('zonal.searchMaitNoPoints')}</Text>
      )}
    </View>
  );
}

/** One collection point, with the Mait that holds it. */
function PointCard({ point }: { point: ZonalMppHit }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.card} testID={`search-point-${point.mpp_code}`}>
      <View style={styles.cardHead}>
        <View style={[styles.chip, styles.chipPoint]}>
          <Ionicons name="location" size={16} color={colors.surface} />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {point.mpp_name}
          </Text>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {[t('zonal.trCode', { code: point.mpp_code }), point.plant_name]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>

      {point.mait ? (
        <View style={styles.holder} testID={`search-point-holder-${point.mpp_code}`}>
          <Ionicons name="person" size={13} color={colors.info} />
          <Text style={styles.holderName} numberOfLines={1}>
            {point.mait.name}
          </Text>
          <Text style={styles.holderCode}>{point.mait.sahayak_vendor_code}</Text>
        </View>
      ) : (
        <View style={[styles.holder, styles.holderNone]} testID={`search-point-unassigned-${point.mpp_code}`}>
          <Ionicons name="alert-circle" size={13} color={colors.textMuted} />
          <Text style={styles.quiet}>{t('zonal.searchUnassigned')}</Text>
        </View>
      )}
    </View>
  );
}

export default function SearchScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const query = useDebounced(term.trim());

  const lookup = useZonalLookupQuery({ q: query }, { ...useLive(), skip: query.length < 1 });
  const maits = lookup.data?.maits ?? [];
  const points = lookup.data?.mpps ?? [];
  const nothing = query.length >= 1 && !lookup.isFetching && !maits.length && !points.length;

  return (
    <View style={zonalStyles.root}>
      <PageHero title={t('zonal.searchTitle')} subtitle={t('zonal.searchSubtitle')} />

      <ScrollView contentContainerStyle={zonalStyles.body} keyboardShouldPersistTaps="handled">
        <TextField
          label={t('zonal.searchLabel')}
          placeholder={t('zonal.searchPlaceholder')}
          value={term}
          onChangeText={setTerm}
          autoCorrect={false}
          autoCapitalize="characters"
          hint={t('zonal.searchHint')}
          testID="zonal-search-input"
        />

        {query.length < 1 ? (
          <EmptyState message={t('zonal.searchStart')} />
        ) : lookup.isFetching && !lookup.data ? (
          <Loading />
        ) : nothing ? (
          <EmptyState message={t('zonal.searchNoResults', { query })} />
        ) : (
          <>
            {maits.length > 0 && (
              <View style={styles.section}>
                <Text style={rowStyles.section}>{t('zonal.searchMaitsSection')}</Text>
                {maits.map(mait => (
                  <MaitCard key={mait.id} mait={mait} />
                ))}
              </View>
            )}
            {points.length > 0 && (
              <View style={styles.section}>
                <Text style={rowStyles.section}>{t('zonal.searchPointsSection')}</Text>
                {points.map(point => (
                  <PointCard key={point.mpp_code} point={point} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing[3] },

  card: {
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing[3],
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  chip: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipMait: { backgroundColor: colors.primary },
  chipPoint: { backgroundColor: colors.info },
  cardBody: { flex: 1 },
  cardTitle: { ...typography.h3, color: colors.ink },
  cardMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  // The points under a Mait, each a quiet inset row so the card reads as "them, and their round".
  points: { gap: spacing[1] },
  point: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.primaryWash,
  },
  pointName: { ...typography.body, color: colors.ink, flex: 1 },
  pointCode: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.primaryDark },

  holder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.infoWash,
  },
  holderNone: { backgroundColor: colors.background },
  holderName: { ...typography.body, color: colors.ink, flex: 1 },
  holderCode: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.info },

  quiet: { ...typography.caption, color: colors.textMuted },
});
