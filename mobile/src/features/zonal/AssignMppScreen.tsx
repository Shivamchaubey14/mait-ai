/**
 * Assign MPPs, for a zonal manager (W19, the phone side).
 *
 * The portal does this two ways — a workbook for a reassignment season, one row for a phone
 * call about a single Sahayak. A handset is only ever the second: a manager standing in a
 * yard, giving one collection point to one Mait by the codes in front of them. So this screen
 * is that one row and nothing of the workbook.
 *
 * **Two steps, because the two questions are different.** First *who* — the Maits of this zone,
 * searchable by name or vendor code so a point can also be handed to a Mait who covers nothing
 * here yet. Then *which point* — the MPP (TR) code, typed, because a manager reads it off a
 * crate and a picker of three thousand points is slower than a keyboard.
 *
 * **The server owns the scope.** A code outside the manager's zone comes back "no such MPP in
 * your zone", the same answer a code that is pure fiction gets — the screen never has to know
 * the rule, only to show what the server said. And the move is absolute: the point leaves
 * whoever held it, which is why the answer names them, so a manager sees whose round changed.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAssignZonalMppMutation, useListZonalMaitsQuery } from '@api/endpoints';
import type { ZonalMait } from '@api/types';
import { Banner, Button, EmptyState, ListRow, Loading, TextField } from '@/components';
import PageHero from '@/components/hero';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { zonalStyles } from './parts';
import { useLive } from './live';

/** The first human-readable line out of a DRF field-error body, or a fallback. */
function messageOf(error: unknown, fallback: string): string {
  const data = (error as { data?: unknown })?.data;
  if (data && typeof data === 'object') {
    const body = data as Record<string, unknown>;
    if (typeof body.detail === 'string') {
      return body.detail;
    }
    for (const value of Object.values(body)) {
      if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
      }
      if (typeof value === 'string') {
        return value;
      }
    }
  }
  return fallback;
}

export default function AssignMppScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ZonalMait | null>(null);
  const [mppCode, setMppCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const maits = useListZonalMaitsQuery({ search: search.trim() }, useLive());
  const [assign, assignState] = useAssignZonalMppMutation();

  const rows = maits.data?.results ?? [];
  const result = assignState.data;

  const pickMait = (mait: ZonalMait) => {
    setSelected(mait);
    setMppCode('');
    setCodeError(null);
    assignState.reset();
  };

  const changeMait = () => {
    setSelected(null);
    assignState.reset();
  };

  const submit = async () => {
    const code = mppCode.trim();
    if (!code) {
      setCodeError(t('zonal.assignEnterCode'));
      return;
    }
    if (!selected) {
      return;
    }
    setCodeError(null);
    try {
      const outcome = await assign({
        sahayakVendorCode: selected.sahayak_vendor_code,
        mppCode: code,
      }).unwrap();
      // The Mait's coverage grew — show it against the fresh row, and clear the box for the
      // next point, because a manager settling a round assigns several in a sitting.
      setSelected(outcome.mait);
      setMppCode('');
    } catch {
      // The banner below reads the error off the mutation state; nothing to do here but stop.
    }
  };

  const coverageLabel = (mait: ZonalMait) =>
    mait.mpp_count
      ? t('zonal.assignCoverage', { count: mait.mpp_count })
      : t('zonal.assignNoCoverage');

  return (
    <View style={zonalStyles.root}>
      <PageHero title={t('zonal.assignTitle')} subtitle={t('zonal.assignSubtitle')} />

      <ScrollView contentContainerStyle={zonalStyles.body} keyboardShouldPersistTaps="handled">
        {selected ? (
          <>
            {/* The Mait this will land on, with a way back to the list. */}
            <View style={styles.chosen} testID="assign-chosen-mait">
              <View style={styles.chosenChip}>
                <Ionicons name="person" size={18} color={colors.surface} />
              </View>
              <View style={styles.chosenBody}>
                <Text style={styles.chosenName} numberOfLines={1}>
                  {selected.name}
                </Text>
                <Text style={styles.chosenMeta} numberOfLines={1}>
                  {selected.sahayak_vendor_code} · {coverageLabel(selected)}
                </Text>
              </View>
              <Button
                label={t('zonal.assignChangeMait')}
                variant="ghost"
                onPress={changeMait}
                testID="assign-change-mait"
              />
            </View>

            <TextField
              label={t('zonal.assignMppLabel')}
              placeholder={t('zonal.assignMppPlaceholder')}
              value={mppCode}
              onChangeText={text => {
                setMppCode(text);
                if (codeError) {
                  setCodeError(null);
                }
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              error={codeError}
              onSubmitEditing={submit}
              returnKeyType="done"
              testID="assign-mpp-input"
            />

            {result && !assignState.isLoading && (
              <Banner
                tone={result.already_assigned ? 'warning' : 'info'}
                testID="assign-result"
                message={
                  result.already_assigned
                    ? t('zonal.assignAlready', {
                        name: result.mait.name,
                        mpp: result.mpp.mpp_code,
                      })
                    : [
                        t('zonal.assignDone', {
                          name: result.mait.name,
                          mpp: result.mpp.mpp_code,
                        }),
                        result.moved_from
                          ? t('zonal.assignMovedFrom', { name: result.moved_from.name })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' ')
                }
              />
            )}

            {assignState.isError && (
              <Banner
                tone="error"
                testID="assign-error"
                message={messageOf(assignState.error, t('zonal.assignFailed'))}
              />
            )}

            <Button
              label={assignState.isLoading ? t('zonal.assigning') : t('zonal.assignButton')}
              onPress={submit}
              loading={assignState.isLoading}
              testID="assign-submit"
            />
          </>
        ) : (
          <>
            <TextField
              label={t('zonal.assignPickMait')}
              placeholder={t('zonal.assignSearchMaits')}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              hint={t('zonal.assignSearchHint')}
              testID="assign-search"
            />

            {maits.isLoading ? (
              <Loading />
            ) : rows.length === 0 ? (
              <EmptyState
                message={
                  search.trim()
                    ? t('zonal.assignNoMaitsFound', { query: search.trim() })
                    : t('zonal.assignNoMaits')
                }
              />
            ) : (
              <View style={styles.list}>
                {rows.map(mait => (
                  <ListRow
                    key={mait.id}
                    title={mait.name}
                    subtitle={mait.sahayak_vendor_code}
                    meta={coverageLabel(mait)}
                    onPress={() => pickMait(mait)}
                    testID={`assign-mait-${mait.sahayak_vendor_code}`}
                  />
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
  list: { gap: spacing[2] },
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.primaryWash,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  chosenChip: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  chosenBody: { flex: 1 },
  chosenName: { ...typography.h3, color: colors.primaryDark },
  chosenMeta: { ...typography.caption, color: colors.ink, marginTop: 2 },
});
