/**
 * Step 5 of the AI capture flow — what did you use? (SRS §6.3 step 4, C7).
 *
 * **The straw is named by breed and by nothing else.** The flow used to ask for the number
 * printed on it, and that number can only be read by lifting the goblet clear of the liquid
 * nitrogen — which warms every straw in it, cumulatively and invisibly. The app was asking a
 * Mait to damage the semen in order to record it. So identity gives way to quantity: the Mait
 * says which breed and how many doses, the platform holds that many from their stock, and ten
 * straws still complete exactly ten doses.
 *
 * **Two doses is ordinary.** A difficult animal takes a second straw in the same visit, and it
 * comes off the same flask. The screen used to allow one, so the second went unrecorded and
 * the month ended with a flask that disagreed with the ledger.
 *
 * **So do the sheaths and the gloves.** Everything a visit consumes is stock the dairy issued
 * and will be asked to replace, and none of it was ever recorded. It is a second tab rather
 * than a second screen because it is one question — what came out of your bag — and because a
 * Mait who has to tap Continue twice to answer it will answer it once.
 *
 * The counts are the Mait's to correct. The dairy's rule of thumb is a sheath per dose, and
 * the screen suggests exactly that and no more: a rule of thumb is what a stock count must not
 * be built on, and a Mait who used one sheath for two doses has to be able to say so.
 *
 * This is therefore the step that commits. The event is created here, which is why the tab bar
 * disappears after it and not before: from here on there is a record on the server that walking
 * away would strand.
 *
 * Every configured breed for this species is listed, including the ones the flask is empty of.
 * They are shown blocked with the reason on the row, never hidden: a Mait who cannot find
 * Sahiwal in the list concludes the app is broken, where a greyed row with "None in your stock"
 * tells them to raise an indent.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { ErrorCode, errorCodeOf } from '@api/client';
import {
  useCreateAiEventMutation,
  useGetInventorySummaryQuery,
  useListBreedsQuery,
} from '@api/endpoints';
import type { AIEvent, AnimalTypeCode, BreedConfig, SuppliesLot } from '@api/types';
import { LOW_STRAWS_PER_BREED } from '@/config/env';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen, FlowSpacer, OptionCard } from './components';

/** Below this a consumable is called low, by catalogue code — the units are not comparable. */
const LOW_CONSUMABLE: Record<string, number> = { LN2: 3, SHEATH: 10, GLOVES: 5 };
const LOW_CONSUMABLE_FALLBACK = 5;

/** The most doses one visit can claim. Beyond this it is a typo, not an insemination. */
const MAX_DOSES = 5;

type Tab = 'straws' | 'consumables';

interface Props {
  /** The species of the animal chosen at the previous step — a cow is not served buffalo semen. */
  animalType: AnimalTypeCode;
  /**
   * The breed of the animal chosen at step 4, if her record carries one.
   *
   * Pre-selected here when the Mait is holding straws of it. Like breeds to like is the
   * ordinary case — a Sahiwal is served Sahiwal — so the step arrives already answered and a
   * Mait who agrees taps Continue once. It is a default, not a decision: every other breed is
   * one tap away, and changing it costs nothing.
   */
  suggestedBreed?: string | null;
  /** Everything the event needs, gathered by the previous four steps. */
  capture: {
    clientUuid: string;
    mppCode: string;
    memberCode?: string;
    nonMemberId?: number;
    animalId: number;
  };
  onCreated: (event: AIEvent) => void;
  onBack: () => void;
}

/**
 * Minus, the number, plus.
 *
 * A number a Mait types is a number they can typo into fifty; two big targets and a figure
 * between them cannot go wrong, and both are inside the row so the count belongs to the thing
 * it counts rather than to the screen.
 */
function Stepper({
  value,
  min = 0,
  max,
  onChange,
  testID,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (next: number) => void;
  testID: string;
}): React.JSX.Element {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="−"
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        style={({ pressed }) => [
          styles.step,
          value <= min && styles.stepInert,
          pressed && value > min && styles.stepPressed,
        ]}
        testID={`${testID}-less`}
      >
        <Ionicons name="remove" size={18} color={value <= min ? colors.textDisabled : colors.ink} />
      </Pressable>

      <Text style={styles.stepValue} testID={`${testID}-value`}>
        {value}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="+"
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        style={({ pressed }) => [
          styles.step,
          styles.stepAdd,
          value >= max && styles.stepAddInert,
          pressed && value < max && styles.stepAddPressed,
        ]}
        testID={`${testID}-more`}
      >
        <Ionicons
          name="add"
          size={18}
          color={value >= max ? colors.textDisabled : colors.surface}
        />
      </Pressable>
    </View>
  );
}

export default function SelectBreedScreen({
  animalType,
  suggestedBreed,
  capture,
  onCreated,
  onBack,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('straws');
  const [code, setCode] = useState<string | null>(null);
  const [doses, setDoses] = useState(1);
  /** Catalogue code → how many of it this visit took. Absent means none. */
  const [used, setUsed] = useState<Record<string, number>>({});
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const [sheathsSuggested, setSheathsSuggested] = useState(false);
  const [rejection, setRejection] = useState<'out_of_stock' | 'generic' | null>(null);

  const [createAiEvent, { isLoading: creating }] = useCreateAiEventMutation();

  const { data: breeds = [], isLoading: breedsLoading } = useListBreedsQuery(animalType);
  const {
    data: stock,
    isLoading: stockLoading,
    isFetching,
    refetch,
  } = useGetInventorySummaryQuery();

  const hindi = i18n.language.startsWith('hi');
  const label = (breed: BreedConfig) => (hindi && breed.name_hi) || breed.name;

  /**
   * What the Mait is actually carrying, most first.
   *
   * The configured order is the administrator's, and it is the right one for a catalogue. In a
   * flask it is not: the breed there are eighteen of is the likely answer and the breed there
   * are none of is the last thing worth reading.
   */
  const rows = useMemo(() => {
    const counted = breeds.map(breed => ({
      breed,
      straws: stock?.by_breed?.[breed.code] ?? 0,
    }));
    return counted.sort((a, b) => b.straws - a.straws);
  }, [breeds, stock]);

  const supplies: SuppliesLot[] = useMemo(() => stock?.consumables ?? [], [stock]);

  const carrying = rows.some(row => row.straws > 0);
  const chosen = rows.find(row => row.breed.code === code && row.straws > 0);
  const loading = breedsLoading || stockLoading;

  /** Never more doses than the flask holds of that breed. */
  const maxDoses = Math.min(MAX_DOSES, chosen?.straws ?? 1);

  /**
   * Answer the step with her own breed, once the flask is known.
   *
   * It has to wait for both the catalogue and the stock: a breed the Mait is not carrying
   * cannot be pre-selected, and until the stock lands every breed looks like one they have
   * none of. Applied once, and never again — a Mait who has changed the answer must not have
   * it changed back under them by a refresh.
   */
  useEffect(() => {
    if (suggestionApplied || loading || rows.length === 0) {
      return;
    }
    setSuggestionApplied(true);
    const match = rows.find(row => row.breed.code === suggestedBreed && row.straws > 0);
    if (match) {
      setCode(match.breed.code);
    }
  }, [suggestionApplied, loading, rows, suggestedBreed]);

  /**
   * One sheath, offered once.
   *
   * Every insemination takes one and forgetting it is the commonest way this count drifts, so
   * the screen starts with it already there. Once only, and never re-applied: a Mait who
   * removed it meant to remove it.
   */
  useEffect(() => {
    if (sheathsSuggested || loading) {
      return;
    }
    setSheathsSuggested(true);
    const sheath = supplies.find(item => item.code === 'SHEATH' && item.qty > 0);
    if (sheath) {
      setUsed(current => ({ [sheath.code]: 1, ...current }));
    }
  }, [sheathsSuggested, loading, supplies]);

  const consumableCount = Object.values(used).reduce((sum, qty) => sum + qty, 0);

  const setQty = (item: SuppliesLot, qty: number) =>
    setUsed(current => {
      const next = { ...current };
      if (qty <= 0) {
        delete next[item.code];
      } else {
        next[item.code] = qty;
      }
      return next;
    });

  /**
   * Open the event against the straws and the supplies this visit used.
   *
   * The server holds them from the Mait's stock and deducts nothing yet — an abandoned capture
   * costs them nothing, because no insemination happened. It can still refuse: the screen's
   * counts are a moment old, and another event may have taken the last one.
   */
  const commit = async () => {
    if (!chosen) {
      return;
    }
    setRejection(null);
    try {
      const event = await createAiEvent({
        client_uuid: capture.clientUuid,
        mpp_code: capture.mppCode,
        ...(capture.memberCode
          ? { member_code: capture.memberCode }
          : { non_member_id: capture.nonMemberId }),
        animal_id: capture.animalId,
        semen_breed: chosen.breed.code,
        doses,
        consumables: Object.entries(used).map(([itemCode, qty]) => ({ code: itemCode, qty })),
      }).unwrap();
      onCreated(event);
    } catch (err) {
      setRejection(errorCodeOf(err) === ErrorCode.INSUFFICIENT_STOCK ? 'out_of_stock' : 'generic');
      refetch();
    }
  };

  const tabs: { key: Tab; label: string; badge: number }[] = [
    { key: 'straws', label: t('aiFlow.strawsTab'), badge: chosen ? doses : 0 },
    { key: 'consumables', label: t('aiFlow.consumablesTab'), badge: consumableCount },
  ];

  return (
    <FlowScreen
      step={4}
      title={t('aiFlow.whatDidYouUse')}
      subtitle={t('aiFlow.whatDidYouUseSubtitle')}
      onBack={onBack}
      refresh={{ refreshing: isFetching && !loading, onRefresh: refetch }}
      // Read back above the button, because by the time a Mait reaches it the rows that say
      // what they picked have scrolled away — and this is the tally the flask is checked
      // against tonight.
      footerNote={
        chosen ? (
          <View style={styles.tally} testID="use-tally">
            <Ionicons name="checkmark" size={16} color={colors.primaryDark} />
            <Text style={styles.tallyLabel} numberOfLines={1}>
              {t('aiFlow.usedTally', {
                doses: t('aiFlow.doseCount', { count: doses, breed: label(chosen.breed) }),
                consumables: t('aiFlow.consumableCount', { count: consumableCount }),
              })}
            </Text>
          </View>
        ) : undefined
      }
      cta={{
        label: t('common.continue'),
        onPress: commit,
        disabled: !chosen,
        busy: creating,
        testID: 'breed-continue',
      }}
      stickyTop={
        <View style={styles.tabs}>
          {tabs.map(({ key, label: name, badge }) => {
            const active = key === tab;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(key)}
                style={[styles.tab, active && styles.tabActive]}
                testID={`use-tab-${key}`}
              >
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                  {name}
                </Text>
                <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
                  <Text
                    style={[styles.tabBadgeLabel, active && styles.tabBadgeLabelActive]}
                    testID={`use-tab-${key}-count`}
                  >
                    {badge}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      }
    >
      {rejection === 'out_of_stock' && (
        <FlowNotice
          tone="error"
          title={t('aiFlow.strawNotInStockTitle')}
          body={t('aiFlow.raiseIndentSoon')}
          testID="breed-rejected"
        />
      )}
      {rejection === 'generic' && (
        <FlowNotice
          tone="error"
          title={t('errors.generic')}
          body={t('aiFlow.tryAgainInAMoment')}
          testID="breed-rejected"
        />
      )}

      {loading && <FlowNotice tone="info" title={t('common.loading')} />}

      {!loading && tab === 'straws' && breeds.length === 0 && (
        <FlowNotice
          tone="info"
          title={t('aiFlow.noBreeds')}
          body={t('aiFlow.noBreedsBody')}
          testID="breed-none-configured"
        />
      )}

      {/* An empty flask is not a wrong tap to correct on this screen. It is a round that
          cannot go ahead, and the only useful thing to say is what to do about it. */}
      {!loading && tab === 'straws' && breeds.length > 0 && !carrying && (
        <FlowNotice
          tone="error"
          title={t('aiFlow.noStrawsAtAll')}
          body={t('aiFlow.raiseIndentSoon')}
          testID="breed-no-stock"
        />
      )}

      {tab === 'straws' &&
        rows.map(({ breed, straws }) => {
          const picked = code === breed.code && straws > 0;
          return (
            <OptionCard
              key={breed.code}
              // No swatch: a breed is a word, and a coloured tile beside each of eleven of
              // them is eleven blocks of nothing.
              swatch={false}
              size="roomy"
              title={label(breed)}
              subtitle={t('aiFlow.strawsWithSpecies', {
                species: t(`aiFlow.animalType.${breed.animal_type}`),
                count: straws,
              })}
              blockedReason={straws === 0 ? t('aiFlow.noneInStock') : undefined}
              pill={
                straws === 0
                  ? t('aiFlow.blocked')
                  : straws <= LOW_STRAWS_PER_BREED
                    ? t('aiFlow.low')
                    : undefined
              }
              pillTone="accent"
              // The stepper replaces the tick on the chosen row: what a Mait needs there is
              // not "yes, this one" but "yes, this one, twice".
              trailing={
                picked ? (
                  <Stepper
                    value={doses}
                    min={1}
                    max={maxDoses}
                    onChange={setDoses}
                    testID={`doses-${breed.code}`}
                  />
                ) : undefined
              }
              check={!picked}
              selected={picked}
              onPress={() => {
                setCode(breed.code);
                setDoses(current => Math.min(current, Math.min(MAX_DOSES, straws) || 1));
              }}
              testID={`breed-${breed.code}`}
            />
          );
        })}

      {tab === 'consumables' && (
        <>
          {/* Said where the count is made, not afterwards. The dairy's rule of thumb is one
              sheath per dose; a Mait who used one for both has to be able to say so, and a
              Mait who used two and left it at one has emptied a bag nobody will refill. */}
          {doses > 1 && (
            <FlowNotice
              tone="info"
              body={t('aiFlow.twoDosesTwoSheaths')}
              testID="use-sheath-hint"
            />
          )}

          {!loading && supplies.length === 0 && (
            <FlowNotice
              tone="info"
              title={t('aiFlow.noConsumables')}
              body={t('aiFlow.noConsumablesBody')}
              testID="use-no-consumables"
            />
          )}

          {supplies.map(item => {
            const qty = used[item.code] ?? 0;
            const low = item.qty <= (LOW_CONSUMABLE[item.code] ?? LOW_CONSUMABLE_FALLBACK);
            return (
              <OptionCard
                key={item.code}
                swatch={false}
                size="roomy"
                title={item.name}
                subtitle={t('aiFlow.suppliesWithYou', {
                  code: item.code,
                  count: item.qty,
                  unit: item.unit,
                })}
                blockedReason={item.qty === 0 ? t('aiFlow.noneInStock') : undefined}
                pill={item.qty === 0 ? t('aiFlow.blocked') : low ? t('aiFlow.low') : undefined}
                pillTone="accent"
                trailing={
                  qty > 0 ? (
                    <Stepper
                      value={qty}
                      max={item.qty}
                      onChange={next => setQty(item, next)}
                      testID={`supply-${item.code}`}
                    />
                  ) : undefined
                }
                selected={qty > 0}
                onPress={() => setQty(item, qty > 0 ? 0 : 1)}
                testID={`supply-${item.code}`}
              />
            );
          })}
        </>
      )}

      <FlowSpacer />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  // One control, two answers, pinned under the hero: the question is one question and the tabs
  // are how a Mait moves between its halves without losing what they answered in the other.
  tabs: { flexDirection: 'row', gap: spacing[2], paddingBottom: spacing[2] },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET - 4,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabLabel: { ...typography.bodyStrong, color: colors.text },
  tabLabelActive: { color: colors.surface },
  tabBadge: {
    minWidth: 22,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.28)' },
  tabBadgeLabel: { ...typography.caption, color: colors.textMuted },
  tabBadgeLabelActive: { color: colors.surface },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  step: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepPressed: { backgroundColor: colors.background },
  stepInert: { opacity: 0.5 },
  // The one that adds is the green one: taking a second dose is the decision this row exists
  // to let a Mait make.
  stepAdd: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepAddPressed: { backgroundColor: colors.primaryPressed },
  stepAddInert: { backgroundColor: colors.disabledFill, borderColor: colors.disabledFill },
  stepValue: { ...typography.h3, color: colors.ink, minWidth: 20, textAlign: 'center' },

  tally: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingBottom: spacing[3],
  },
  tallyLabel: { ...typography.label, color: colors.primaryDark, flex: 1 },
});
