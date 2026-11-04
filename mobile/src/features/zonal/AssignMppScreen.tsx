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

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import AppText from '@/components/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import {
  useAssignZonalMppMutation,
  useListZonalMaitsQuery,
  useZonalLookupQuery,
} from '@api/endpoints';
import type { AssignResult, ZonalMait, ZonalMppHit } from '@api/types';
import { Banner, Button, EmptyState, ListRow, Loading, TextField } from '@/components';
import PageHero from '@/components/hero';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { zonalStyles } from './parts';
import { useLive } from './live';

/** How long after the last keystroke the zone is asked for matches. */
const SUGGEST_DELAY_MS = 150;

/** As many matches as fit above the keyboard without a scroll. */
const MAX_SUGGESTIONS = 8;

/** One line of what an assignment said, for one point. */
interface Outcome {
  code: string;
  tone: 'info' | 'warning' | 'error';
  text: string;
}

/** The value, once it has stopped changing for `delay` ms. */
function useDebounced(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

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
  /** What is being typed into the MPP box. */
  const [mppQuery, setMppQuery] = useState('');
  /** The points picked so far, each a chip with an × on it, assigned together. */
  const [picked, setPicked] = useState<ZonalMppHit[]>([]);
  /** What the last assignment said, one line per point. */
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const maits = useListZonalMaitsQuery({ search: search.trim() }, useLive());
  const [assign] = useAssignZonalMppMutation();

  /**
   * The zone's points matching what is typed, with whoever holds each — asked as the manager
   * types, a moment after they pause, so the list keeps up without a request per keystroke.
   * It used to be a code typed blind and assigned to find out whose it had been.
   */
  const typed = useDebounced(mppQuery.trim(), SUGGEST_DELAY_MS);
  const lookup = useZonalLookupQuery({ q: typed }, { skip: typed.length === 0 });
  const hits = typed
    ? (lookup.data?.mpps ?? [])
        .filter(hit => !picked.some(chosen => chosen.mpp_code === hit.mpp_code))
        .slice(0, MAX_SUGGESTIONS)
    : [];

  const rows = maits.data?.results ?? [];

  const startOver = () => {
    setMppQuery('');
    setPicked([]);
    setOutcomes([]);
    setCodeError(null);
  };

  const pickMait = (mait: ZonalMait) => {
    setSelected(mait);
    startOver();
  };

  const changeMait = () => {
    setSelected(null);
    startOver();
  };

  const pickMpp = (hit: ZonalMppHit) => {
    setPicked(current => [...current, hit]);
    setMppQuery('');
    setCodeError(null);
    setOutcomes([]);
  };

  const unpickMpp = (code: string) => {
    setPicked(current => current.filter(hit => hit.mpp_code !== code));
  };

  /** What one point's assignment said, in the words the manager reads. */
  const describe = (result: AssignResult): Outcome => ({
    code: result.mpp.mpp_code,
    tone: result.already_assigned ? 'warning' : 'info',
    text: result.already_assigned
      ? t('zonal.assignAlready', { name: result.mait.name, mpp: result.mpp.mpp_code })
      : [
          t('zonal.assignDone', { name: result.mait.name, mpp: result.mpp.mpp_code }),
          result.moved_from ? t('zonal.assignMovedFrom', { name: result.moved_from.name }) : null,
        ]
          .filter(Boolean)
          .join(' '),
  });

  /**
   * Hand every picked point to the chosen Mait, one after another.
   *
   * One at a time rather than at once: each move is absolute and names the Mait it came from,
   * and the server answers each on its own. What went is cleared from the chips; what did not
   * stays, with its reason, so it can be put right and sent again.
   */
  const submit = async () => {
    if (!selected) {
      return;
    }
    if (picked.length === 0) {
      setCodeError(t('zonal.assignEnterCode'));
      return;
    }
    setCodeError(null);
    setAssigning(true);
    const said: Outcome[] = [];
    const left: ZonalMppHit[] = [];
    let mait = selected;
    for (const hit of picked) {
      try {
        const result = await assign({
          sahayakVendorCode: selected.sahayak_vendor_code,
          mppCode: hit.mpp_code,
        }).unwrap();
        mait = result.mait;
        said.push(describe(result));
      } catch (error) {
        left.push(hit);
        said.push({
          code: hit.mpp_code,
          tone: 'error',
          text: `${hit.mpp_code}: ${messageOf(error, t('zonal.assignFailed'))}`,
        });
      }
    }
    // The Mait's coverage grew — show it against the fresh row.
    setSelected(mait);
    setPicked(left);
    setOutcomes(said);
    setAssigning(false);
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
                <AppText style={styles.chosenName} numberOfLines={1}>
                  {selected.name}
                </AppText>
                <AppText style={styles.chosenMeta} numberOfLines={1}>
                  {selected.sahayak_vendor_code} · {coverageLabel(selected)}
                </AppText>
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
              value={mppQuery}
              onChangeText={text => {
                setMppQuery(text);
                if (codeError) {
                  setCodeError(null);
                }
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              error={codeError}
              testID="assign-mpp-input"
            />

            {/* What matches, as it is typed, each saying whose round it is on now. */}
            {hits.length > 0 && (
              <View style={styles.suggestions} testID="assign-suggestions">
                {hits.map(hit => {
                  const theirs = hit.mait?.sahayak_vendor_code === selected.sahayak_vendor_code;
                  return (
                    <Pressable
                      key={hit.mpp_code}
                      accessibilityRole="button"
                      onPress={() => pickMpp(hit)}
                      style={({ pressed }) => [
                        styles.suggestion,
                        pressed && styles.suggestionPressed,
                      ]}
                      testID={`assign-suggestion-${hit.mpp_code}`}
                    >
                      <View style={styles.suggestionBody}>
                        <AppText style={styles.suggestionCode}>{hit.mpp_code}</AppText>
                        <AppText style={styles.suggestionName} numberOfLines={1}>
                          {hit.mpp_name}
                        </AppText>
                      </View>
                      <View
                        style={[
                          styles.holder,
                          theirs ? styles.holderTheirs : hit.mait ? styles.holderOther : null,
                        ]}
                        testID={`assign-holder-${hit.mpp_code}`}
                      >
                        <AppText style={styles.holderLabel} numberOfLines={1}>
                          {theirs
                            ? t('zonal.assignAlreadyTheirs')
                            : hit.mait
                              ? t('zonal.assignHeldBy', { name: hit.mait.name })
                              : t('zonal.assignFree')}
                        </AppText>
                      </View>
                      <Ionicons name="add-circle" size={22} color={colors.primary} />
                    </Pressable>
                  );
                })}
              </View>
            )}

            {!!typed && !lookup.isFetching && hits.length === 0 && picked.length === 0 && (
              <AppText style={styles.noMatch} testID="assign-no-match">
                {t('zonal.assignNoMatch', { query: typed })}
              </AppText>
            )}

            {/* The picked points, each with an × to take it back off, as on the portal. */}
            {picked.length > 0 && (
              <View style={styles.pickedWrap}>
                <AppText style={styles.pickedLabel}>{t('zonal.assignPickedLabel')}</AppText>
                <View style={styles.chips} testID="assign-chips">
                  {picked.map(hit => (
                    <View key={hit.mpp_code} style={styles.chip}>
                      <AppText style={styles.chipLabel}>{hit.mpp_code}</AppText>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('zonal.assignRemove', { mpp: hit.mpp_code })}
                        onPress={() => unpickMpp(hit.mpp_code)}
                        hitSlop={10}
                        style={styles.chipRemove}
                        testID={`assign-chip-remove-${hit.mpp_code}`}
                      >
                        <Ionicons name="close" size={14} color={colors.surface} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {outcomes.map(outcome => (
              <Banner
                key={`${outcome.code}-${outcome.tone}`}
                tone={outcome.tone}
                testID={`assign-result-${outcome.code}`}
                message={outcome.text}
              />
            ))}

            <Button
              label={
                assigning
                  ? t('zonal.assigning')
                  : picked.length > 0
                    ? t('zonal.assignButtonCount', { count: picked.length })
                    : t('zonal.assignButton')
              }
              onPress={submit}
              loading={assigning}
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

  suggestions: {
    marginTop: -spacing[2],
    marginBottom: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  suggestionPressed: { backgroundColor: colors.primaryWash },
  suggestionBody: { flex: 1 },
  suggestionCode: { ...typography.bodyStrong, color: colors.ink },
  suggestionName: { ...typography.caption, color: colors.textMuted },
  // Whose round the point is on now: free in grey, someone else's in yolk, theirs in green.
  holder: {
    maxWidth: '45%',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.disabledFill,
  },
  holderOther: { backgroundColor: colors.secondaryWash },
  holderTheirs: { backgroundColor: colors.primaryWash },
  holderLabel: { ...typography.caption, color: colors.ink },
  noMatch: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: -spacing[2],
    marginBottom: spacing[3],
  },

  pickedWrap: { marginBottom: spacing[3] },
  pickedLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingLeft: spacing[3],
    paddingRight: spacing[1],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  chipLabel: { ...typography.label, color: colors.surface },
  chipRemove: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  chosenName: { ...typography.h3, color: colors.primaryDark },
  chosenMeta: { ...typography.caption, color: colors.ink, marginTop: 2 },
});
