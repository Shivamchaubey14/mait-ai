/**
 * Rates, for an admin — the portal's Rates screen (`rates.html`) on a handset: what one
 * insemination costs by breed, and what a pregnancy check costs.
 *
 * Two prices for the same service, because they are settled in different worlds: a member's is
 * deducted from a milk payment the dairy already owes her, a non-member's is cash handed to a
 * Mait in a yard. Green for the member and blue for everyone else, the SAP upload's convention.
 *
 * **A zero is not free, it is unpriced** — and its consequence lands on a Mait standing in a
 * yard with the straw already spent, told to ask an administrator. So the unpriced count is the
 * first tile and its own filter, every unpriced breed is red, and the pregnancy card is yellow
 * until both of its figures are set.
 *
 * Edited in place and saved together: pricing is a decision made across a list ("cows at 300,
 * buffaloes at 350"), and one Save covers the breeds and the pregnancy rate alike. A changed
 * card turns yellow and says Unsaved until it lands; a partial failure names what did not.
 *
 * The Mait payout scheme closes the screen, read-only — it is set on the portal.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import AppText from '@/components/AppText';
import { EmptyState } from '@/components';
import { SkeletonRows } from '@/components/skeleton';
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import { useRevealOnFocus } from '@/features/aiFlow/components';
import {
  useAdminListBreedsQuery,
  useAdminPayoutSchemeQuery,
  useAdminPregnancyRateQuery,
  useAdminUpdateBreedMutation,
  useAdminUpdatePregnancyRateMutation,
} from '@api/endpoints';
import type { AdminBreed } from '@api/types';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';

type Field = 'rate' | 'non_member_rate';
type Edit = Partial<Record<Field, string>>;
type Filter = 'COW' | 'BUFF' | 'unpriced';

function rupees(value: number | string | null | undefined): string {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function digits(text: string): string {
  return text.replace(/[^\d]/g, '');
}

/** A rupee box: the ₹ inside the field, because a bare number in a list reads as a quantity. */
function MoneyField({
  value,
  onChange,
  onFocus,
  tone,
  label,
  testID,
}: {
  value: string;
  onChange: (text: string) => void;
  onFocus?: () => void;
  tone: ToneName;
  label: string;
  testID: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View style={[styles.money, { borderColor: look.border }]}>
      <AppText style={[styles.moneyUnit, { color: look.text, backgroundColor: look.wash }]}>
        ₹
      </AppText>
      <TextInput
        style={styles.moneyInput}
        value={value}
        onChangeText={text => onChange(digits(text))}
        onFocus={onFocus}
        keyboardType="number-pad"
        maxLength={7}
        placeholder="0"
        placeholderTextColor={colors.textDisabled}
        accessibilityLabel={label}
        selectTextOnFocus
        testID={testID}
      />
    </View>
  );
}

function Tile({
  tone,
  icon,
  label,
  value,
  foot,
  testID,
}: {
  tone: ToneName;
  icon: string;
  label: string;
  value: string;
  foot: string;
  testID: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.tile, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.tileHead}>
        <View style={[styles.chip, { backgroundColor: look.solid }]}>
          <Ionicons name={icon as never} size={13} color={look.onSolid} />
        </View>
        <AppText style={[styles.tileLabel, { color: look.text }]}>{label}</AppText>
      </View>
      <AppText
        style={styles.tileValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        testID={`${testID}-value`}
      >
        {value}
      </AppText>
      <AppText style={styles.tileFoot}>{foot}</AppText>
    </View>
  );
}

function BreedCard({
  breed,
  edit,
  onEdit,
  onFocus,
}: {
  breed: AdminBreed;
  edit: Edit | undefined;
  onEdit: (field: Field, text: string) => void;
  onFocus: (field: View | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const ref = useRef<View>(null);
  const member = edit?.rate ?? String(Math.round(Number(breed.rate) || 0));
  const other = edit?.non_member_rate ?? String(Math.round(Number(breed.non_member_rate) || 0));
  const dirty =
    (edit?.rate !== undefined && Number(edit.rate) !== Number(breed.rate)) ||
    (edit?.non_member_rate !== undefined &&
      Number(edit.non_member_rate) !== Number(breed.non_member_rate));
  const unpriced = !Number(member) || !Number(other);
  // Unsaved is said first: it is the state that goes away on Save.
  const tone: ToneName = dirty ? 'yolk' : unpriced ? 'red' : 'green';
  const look = TONE[tone];

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-rate-${breed.code}`}
    >
      <View style={styles.cardTop}>
        <View style={[styles.disc, { backgroundColor: look.solid }]}>
          <Glyph name={STRAW_GLYPH} size={16} color={look.onSolid} />
        </View>
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{breed.name}</AppText>
          <AppText style={styles.sub}>
            {[
              breed.code,
              t(breed.animal_type === 'BUFF' ? 'admin.rates.buffalo' : 'admin.rates.cow'),
              breed.is_active ? '' : t('admin.rates.retired'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
        </View>
        <Pill
          label={t(
            dirty
              ? 'admin.rates.unsaved'
              : unpriced
                ? 'admin.rates.notPriced'
                : 'admin.rates.priced',
          )}
          tone={tone}
        />
      </View>
      <View style={styles.inset}>
        <View style={styles.pair}>
          <View style={styles.flex}>
            <AppText style={[styles.fieldLabel, { color: TONE.green.text }]}>
              {t('admin.rates.memberPays')}
            </AppText>
            <MoneyField
              value={member}
              onChange={text => onEdit('rate', text)}
              onFocus={() => onFocus(ref.current)}
              tone="green"
              label={t('admin.rates.memberLabel', { name: breed.name })}
              testID={`admin-rate-${breed.code}-member`}
            />
          </View>
          <View style={styles.flex}>
            <AppText style={[styles.fieldLabel, { color: TONE.blue.text }]}>
              {t('admin.rates.nonMemberPays')}
            </AppText>
            <MoneyField
              value={other}
              onChange={text => onEdit('non_member_rate', text)}
              onFocus={() => onFocus(ref.current)}
              tone="blue"
              label={t('admin.rates.nonMemberLabel', { name: breed.name })}
              testID={`admin-rate-${breed.code}-non-member`}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

export default function AdminRatesScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const breedsQuery = useAdminListBreedsQuery();
  const pdQuery = useAdminPregnancyRateQuery();
  const scheme = useAdminPayoutSchemeQuery();
  const [updateBreed] = useAdminUpdateBreedMutation();
  const [updatePd] = useAdminUpdatePregnancyRateMutation();
  const { scroller, content, overlap: keyboard, api } = useRevealOnFocus();
  const pdRef = useRef<View>(null);

  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [filter, setFilter] = useState<Filter>('COW');
  const [term, setTerm] = useState('');
  const [pdMember, setPdMember] = useState<string | null>(null);
  const [pdOther, setPdOther] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ text: string; tone: ToneName } | null>(null);

  const breeds = useMemo(() => breedsQuery.data ?? [], [breedsQuery.data]);
  const pd = pdQuery.data;

  // The boxes take the saved figures when they arrive, and again after a save lands — but
  // never over something typed. `Number` so a stored "100.00" does not read as an edit.
  useEffect(() => {
    if (pd) {
      setPdMember(String(Math.round(Number(pd.member_rate) || 0)));
      setPdOther(String(Math.round(Number(pd.non_member_rate) || 0)));
    }
  }, [pd]);

  const rateOf = (breed: AdminBreed, field: Field): number =>
    Number(edits[breed.id]?.[field] ?? breed[field] ?? 0);
  const unpriced = (breed: AdminBreed) =>
    !rateOf(breed, 'rate') || !rateOf(breed, 'non_member_rate');
  const dirty = (breed: AdminBreed) => {
    const edit = edits[breed.id];
    return (
      !!edit &&
      (['rate', 'non_member_rate'] as Field[]).some(
        field => edit[field] !== undefined && Number(edit[field]) !== Number(breed[field] ?? 0),
      )
    );
  };

  const pdDirty =
    !!pd &&
    pdMember !== null &&
    pdOther !== null &&
    (Number(pdMember || 0) !== Number(pd.member_rate) ||
      Number(pdOther || 0) !== Number(pd.non_member_rate));
  const pdMissing = !Number(pdMember || 0) || !Number(pdOther || 0);
  // Grey until the figures have loaded: a card that flashed green before the request landed
  // would be reassuring about something it had not read.
  const pdTone: ToneName = !pd ? 'slate' : pdMissing ? 'yolk' : 'green';

  const changed = breeds.filter(dirty);
  const pending = changed.length + (pdDirty ? 1 : 0);
  const unpricedCount = breeds.filter(unpriced).length;
  const priced = breeds.filter(b => !unpriced(b));
  const range = (field: Field): string => {
    if (!priced.length) {
      return '—';
    }
    const values = priced.map(b => rateOf(b, field));
    const low = Math.min(...values);
    const high = Math.max(...values);
    return low === high ? rupees(low) : `${rupees(low)}–${rupees(high)}`;
  };

  const needle = term.trim().toLowerCase();
  const shown = breeds.filter(breed => {
    if (filter === 'unpriced' ? !unpriced(breed) : breed.animal_type !== filter) {
      return false;
    }
    return (
      !needle ||
      breed.name.toLowerCase().includes(needle) ||
      breed.code.toLowerCase().includes(needle)
    );
  });
  const countOf = (f: Filter) =>
    f === 'unpriced' ? unpricedCount : breeds.filter(b => b.animal_type === f).length;

  const edit = (id: number, field: Field, text: string) => {
    setFlash(null);
    setEdits(all => ({ ...all, [id]: { ...all[id], [field]: text } }));
  };

  /**
   * Every changed breed, and the pregnancy rate if it changed — nothing else. One request each,
   * reported together: a Mait cannot use half a price list, so a partial failure names the rows
   * that did not land, and those keep their typed figures to try again.
   */
  const saveAll = async () => {
    if (saving) {
      return;
    }
    if (!pending) {
      setFlash({ text: t('admin.rates.nothingChanged'), tone: 'green' });
      return;
    }
    setSaving(true);
    setFlash(null);
    const failures: string[] = [];
    const landed: number[] = [];
    await Promise.all([
      ...changed.map(async breed => {
        try {
          await updateBreed({
            id: breed.id,
            rate: rateOf(breed, 'rate') || 0,
            non_member_rate: rateOf(breed, 'non_member_rate') || 0,
          }).unwrap();
          landed.push(breed.id);
        } catch {
          failures.push(breed.name || breed.code);
        }
      }),
      ...(pdDirty
        ? [
            (async () => {
              try {
                await updatePd({
                  member_rate: Number(pdMember || 0),
                  non_member_rate: Number(pdOther || 0),
                }).unwrap();
              } catch {
                failures.push(t('admin.rates.pdTitle'));
              }
            })(),
          ]
        : []),
    ]);
    setEdits(all => {
      const next = { ...all };
      landed.forEach(id => delete next[id]);
      return next;
    });
    setSaving(false);
    setFlash(
      failures.length
        ? { text: t('admin.rates.couldNotSave', { names: failures.join(', ') }), tone: 'red' }
        : {
            text: t('admin.rates.saved', { count: pending - failures.length }),
            tone: 'green',
          },
    );
  };

  const loading = breedsQuery.isLoading;

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroller}
        innerViewRef={content}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.body,
          { paddingBottom: (keyboard || 0) + (pending ? 96 : spacing[7]) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={breedsQuery.isFetching && !breedsQuery.isLoading}
            onRefresh={() => {
              breedsQuery.refetch();
              pdQuery.refetch();
              scheme.refetch();
            }}
          />
        }
        testID="admin-rates"
      >
        <View style={styles.top}>
          <AppText style={styles.lede}>{t('admin.rates.lede')}</AppText>
          <Pressable
            accessibilityRole="button"
            onPress={saveAll}
            disabled={saving}
            style={({ pressed }) => [
              styles.primary,
              saving && styles.off,
              pressed && styles.pressed,
            ]}
            testID="admin-rates-save"
          >
            {saving ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Ionicons name="checkmark" size={18} color={colors.surface} />
            )}
            <AppText style={styles.primaryLabel}>
              {t(saving ? 'admin.rates.saving' : 'admin.rates.saveChanges')}
            </AppText>
          </Pressable>
        </View>

        {!!flash && (
          <Notice
            tone={flash.tone}
            icon={flash.tone === 'green' ? 'checkmark' : 'alert'}
            title={flash.text}
            body=""
            testID="admin-rates-flash"
          />
        )}

        {loading ? (
          <SkeletonRows pill={false} />
        ) : breedsQuery.isError ? (
          <EmptyState message={t('admin.rates.error')} />
        ) : (
          <>
            {/* The count that matters is the unpriced one, so it comes first. */}
            <Tile
              tone={unpricedCount ? 'yolk' : 'green'}
              icon={unpricedCount ? 'alert' : 'checkmark'}
              label={t('admin.rates.notPricedYet')}
              value={String(unpricedCount)}
              foot={t(unpricedCount ? 'admin.rates.cannotClose' : 'admin.rates.allPriced')}
              testID="admin-rates-tile-unpriced"
            />
            <View style={styles.tiles}>
              <Tile
                tone="green"
                icon="person"
                label={t('admin.rates.memberRate')}
                value={range('rate')}
                foot={t('admin.rates.memberFoot')}
                testID="admin-rates-tile-member"
              />
              <Tile
                tone="blue"
                icon="people"
                label={t('admin.rates.nonMemberRate')}
                value={range('non_member_rate')}
                foot={t('admin.rates.nonMemberFoot')}
                testID="admin-rates-tile-non-member"
              />
            </View>

            {/* Priced once, not per breed: a pregnancy check is the same work whatever animal
                it is. The card's colour is its own state — yellow while either figure is zero. */}
            <View
              ref={pdRef}
              collapsable={false}
              style={[
                styles.panel,
                { backgroundColor: TONE[pdTone].wash, borderColor: TONE[pdTone].border },
              ]}
              testID="admin-rates-pd"
            >
              <View style={styles.panelHead}>
                <View style={[styles.chip, { backgroundColor: TONE[pdTone].solid }]}>
                  <Ionicons name="medkit" size={14} color={TONE[pdTone].onSolid} />
                </View>
                <AppText style={[styles.panelTitle, { color: TONE[pdTone].text }]}>
                  {t('admin.rates.pdTitle')}
                </AppText>
                {pdQuery.isError ? (
                  <Pill label={t('admin.rates.couldNotLoad')} tone="red" />
                ) : pd ? (
                  <Pill
                    label={
                      pdDirty
                        ? t('admin.rates.unsaved')
                        : pdMissing
                          ? t('admin.rates.notPriced')
                          : `${rupees(pdMember)} / ${rupees(pdOther)}`
                    }
                    tone={pdDirty ? 'yolk' : pdTone}
                  />
                ) : (
                  <AppText style={styles.sub}>—</AppText>
                )}
              </View>
              <View style={styles.inset}>
                <View style={styles.pdField}>
                  <AppText style={[styles.fieldLabel, { color: TONE.green.text }]}>
                    {t('admin.rates.memberPays')}
                  </AppText>
                  <MoneyField
                    value={pdMember ?? ''}
                    onChange={text => {
                      setFlash(null);
                      setPdMember(text);
                    }}
                    onFocus={() => api.reveal(pdRef.current)}
                    tone="green"
                    label={t('admin.rates.pdMemberLabel')}
                    testID="admin-rates-pd-member"
                  />
                  <AppText style={styles.hint}>{t('admin.rates.pdMemberHint')}</AppText>
                </View>
                <View style={[styles.pdField, styles.rule]}>
                  <AppText style={[styles.fieldLabel, { color: TONE.blue.text }]}>
                    {t('admin.rates.nonMemberPays')}
                  </AppText>
                  <MoneyField
                    value={pdOther ?? ''}
                    onChange={text => {
                      setFlash(null);
                      setPdOther(text);
                    }}
                    onFocus={() => api.reveal(pdRef.current)}
                    tone="blue"
                    label={t('admin.rates.pdNonMemberLabel')}
                    testID="admin-rates-pd-non-member"
                  />
                  <AppText style={styles.hint}>{t('admin.rates.pdNonMemberHint')}</AppText>
                </View>
              </View>
            </View>

            <AppText style={styles.section}>{t('admin.rates.byBreed')}</AppText>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.info} />
              <TextInput
                style={styles.searchInput}
                value={term}
                onChangeText={setTerm}
                placeholder={t('admin.rates.searchPlaceholder')}
                placeholderTextColor={colors.textDisabled}
                autoCorrect={false}
                testID="admin-rates-search"
              />
              {term.length > 0 && (
                <Pressable onPress={() => setTerm('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </Pressable>
              )}
            </View>
            <View style={styles.filters}>
              {(
                [
                  ['COW', 'admin.rates.cow', 'blue', 'paw-outline'],
                  ['BUFF', 'admin.rates.buffalo', 'blue', 'paw'],
                  ['unpriced', 'admin.rates.notPriced', 'red', 'alert-circle-outline'],
                ] as [Filter, string, ToneName, string][]
              ).map(([key, label, tone, icon]) => (
                <FilterChip
                  key={key}
                  label={`${t(label)} · ${countOf(key)}`}
                  icon={icon}
                  tone={tone}
                  active={filter === key}
                  onPress={() => setFilter(key)}
                  testID={`admin-rates-filter-${key}`}
                />
              ))}
            </View>

            {shown.length === 0 ? (
              <EmptyState
                message={t(
                  filter === 'unpriced' && !needle
                    ? 'admin.rates.noneUnpriced'
                    : 'admin.rates.noMatch',
                )}
              />
            ) : (
              shown.map(breed => (
                <BreedCard
                  key={breed.id}
                  breed={breed}
                  edit={edits[breed.id]}
                  onEdit={(field, text) => edit(breed.id, field, text)}
                  onFocus={api.reveal}
                />
              ))
            )}

            {/* Said on the screen, because the consequence of a zero is invisible from here. */}
            <Notice
              tone="yolk"
              icon="alert"
              title={t('admin.rates.zeroTitle')}
              body={`${t('admin.rates.zeroBody')}\n\n${t('admin.rates.refusedBody')}`}
              testID="admin-rates-zero-note"
            />

            {scheme.data && (
              <View
                style={[
                  styles.panel,
                  { backgroundColor: TONE.slate.wash, borderColor: TONE.slate.border },
                ]}
                testID="admin-rates-scheme"
              >
                <View style={styles.panelHead}>
                  <View style={[styles.chip, { backgroundColor: TONE.slate.solid }]}>
                    <Ionicons name="cash" size={14} color={colors.surface} />
                  </View>
                  <AppText style={[styles.panelTitle, { color: TONE.slate.text }]}>
                    {t('admin.rates.scheme')}
                  </AppText>
                  <Pill label={t('admin.rates.readOnly')} tone="slate" />
                </View>
                <View style={styles.inset}>
                  <Line
                    label={t('admin.rates.commission')}
                    value={`${rupees(scheme.data.commission_per_ai)} ${t('admin.rates.perAi')}`}
                  />
                  <Line
                    label={t('admin.rates.retainer')}
                    value={
                      scheme.data.fixed_min_ai
                        ? `${rupees(scheme.data.monthly_fixed_amount)} · ${t('admin.rates.minAi', {
                            count: scheme.data.fixed_min_ai,
                          })}`
                        : t('admin.rates.noRetainer')
                    }
                    last={!scheme.data.straw_rate}
                  />
                  {scheme.data.straw_rate ? (
                    <Line
                      label={t('admin.rates.straw')}
                      value={`${rupees(scheme.data.straw_rate)} ${t('admin.rates.perPiece')}`}
                      last
                    />
                  ) : null}
                </View>
                <AppText style={styles.hint}>{t('admin.rates.schemeNote')}</AppText>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* While anything is unsaved, the count and the Save stay in reach of the thumb. */}
      {pending > 0 && !keyboard && (
        <View style={styles.bar} testID="admin-rates-bar">
          <View style={styles.flex}>
            <AppText style={styles.barTitle}>
              {t('admin.rates.unsavedCount', { count: pending })}
            </AppText>
            <AppText style={styles.barSub}>{t('admin.rates.reachHandsets')}</AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={saveAll}
            disabled={saving}
            style={({ pressed }) => [
              styles.primary,
              saving && styles.off,
              pressed && styles.pressed,
            ]}
            testID="admin-rates-bar-save"
          >
            {saving ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Ionicons name="checkmark" size={18} color={colors.surface} />
            )}
            <AppText style={styles.primaryLabel}>{t('admin.rates.saveChanges')}</AppText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Line({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.line, !last && styles.ruleBottom]}>
      <AppText style={styles.lineLabel}>{label}</AppText>
      <AppText style={styles.lineValue}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3] },
  pressed: { opacity: 0.85 },
  off: { opacity: 0.45 },
  sub: { ...typography.caption, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  ruleBottom: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },

  top: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[3] },
  lede: { ...typography.label, color: colors.ink, flex: 1, minWidth: 160 },
  section: { ...typography.h3, color: colors.ink, marginTop: spacing[1] },

  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: { flex: 1, padding: spacing[3], gap: 4, borderRadius: radius.md, borderWidth: 1 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, flex: 1 },
  tileValue: { ...typography.h1, color: colors.ink },
  tileFoot: { ...typography.caption, color: colors.ink },

  panel: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  panelTitle: { ...typography.h3, flex: 1 },
  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  pdField: { gap: 4, paddingVertical: spacing[3] },
  fieldLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },

  money: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  moneyUnit: {
    ...typography.bodyStrong,
    paddingHorizontal: spacing[3],
    textAlignVertical: 'center',
    paddingTop: spacing[3],
  },
  moneyInput: {
    flex: 1,
    ...typography.h3,
    color: colors.ink,
    paddingHorizontal: spacing[3],
    textAlign: 'right',
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  disc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cardName: { ...typography.h3, color: colors.ink },
  pair: { flexDirection: 'row', gap: spacing[3], paddingVertical: spacing[3] },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: 10,
  },
  lineLabel: { ...typography.caption, color: colors.textMuted },
  lineValue: { ...typography.label, color: colors.ink, flexShrink: 1, textAlign: 'right' },

  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 42,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryLabel: { ...typography.label, color: colors.surface },

  bar: {
    position: 'absolute',
    left: spacing[3],
    right: spacing[3],
    bottom: spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
  },
  barTitle: { ...typography.label, color: colors.surface },
  barSub: { ...typography.caption, color: TONE.yolk.border },
});
