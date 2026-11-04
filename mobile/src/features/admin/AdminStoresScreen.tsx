/**
 * Stores, for an admin — the portal's Stores screen (`stores.html`) on a handset.
 *
 * A store is the counter an approved indent is collected from. Tick the BMC/MCCs it serves and
 * every Mait whose collection points report into them collects there; the zonal manager approves
 * on Indents, the keeper hands the stock over from the app and reads the Mait a code, and the
 * Mait's stock rises only when they type it in.
 *
 * - **The roster** — each store with the centres it serves, who keeps it, what is on its shelf
 *   and how many indents wait at its counter. An open store with no keeper is yellow: indents
 *   queue there and nobody can hand them over. A closed one is red.
 * - **Centres no store serves** — their Maits are still issued from the Indents screen, with no
 *   code read out. Tapping one opens a new store with it already ticked.
 * - **The editor** — code (set once), name, zone, open or closed, the centres it serves (a
 *   centre collects from one store, so another store's are locked), and its keepers, who can
 *   only be added once the store exists. Removals are named, because they send Maits elsewhere.
 * - **Stock** — the same shelf editor the Inventory screen opens: a delivery, or a count.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { EmptyState } from '@/components';
import { SkeletonRows } from '@/components/skeleton';
import Glyph, { STRAW_GLYPH, type GlyphName } from '@/components/glyph';
import { useRevealOnFocus } from '@/features/aiFlow/components';
import {
  useAdminAddStoreKeeperMutation,
  useAdminCreateStoreMutation,
  useAdminDeleteStoreMutation,
  useAdminListStoresQuery,
  useAdminListZonesQuery,
  useAdminRemoveStoreKeeperMutation,
  useAdminStorePlantsQuery,
  useAdminUpdateStoreMutation,
} from '@api/endpoints';
import type { StoreAdmin, StorePlantRow, StoreWrite, Zone } from '@api/types';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { StoreStock } from './AdminInventoryScreen';
import { Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}

function dateOf(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

function activeKeepers(store: StoreAdmin) {
  return (store.keepers ?? []).filter(k => k.is_active);
}

/**
 * Whether a store answers to what was typed: its name or code, zone, the centres it serves, and
 * each keeper's name and mobile — what an operator holds when a keeper rings. The mobile is
 * matched on digits alone, so "98765 00001" and "9876500001" find the same keeper.
 */
export function matchesStore(store: StoreAdmin, term: string): boolean {
  if (!term) {
    return true;
  }
  const needle = term.toLowerCase();
  const digits = term.replace(/\D/g, '');
  const words = [
    store.name,
    store.code,
    store.zone_name || '',
    store.description || '',
    ...(store.plant_names ?? []),
    ...(store.keepers ?? []).map(k => k.full_name),
  ];
  const byWord = words.some(word => String(word).toLowerCase().includes(needle));
  const byMobile =
    digits.length >= 3 && (store.keepers ?? []).some(k => String(k.mobile_no).includes(digits));
  return byWord || byMobile;
}

function storeTone(store: StoreAdmin): ToneName {
  if (!store.is_active) {
    return 'red';
  }
  return activeKeepers(store).length ? 'green' : 'yolk';
}

const SHELF_LOOK: Record<'straw' | 'consumable' | 'asset', { tone: ToneName; icon: GlyphName }> = {
  straw: { tone: 'blue', icon: STRAW_GLYPH },
  consumable: { tone: 'green', icon: 'flask-outline' },
  asset: { tone: 'yolk', icon: 'construct-outline' },
};

function problemOf(error: unknown, fallback: string): string {
  const data = (error as { data?: Record<string, unknown> })?.data;
  const said =
    (typeof data?.detail === 'string' && data.detail) ||
    Object.values(data ?? {})
      .flat()
      .filter((v): v is string => typeof v === 'string')
      .join(' · ');
  return said || fallback;
}

// --------------------------------------------------------------------------------------
// Shared pieces
// --------------------------------------------------------------------------------------

function Tile({
  tone,
  icon,
  label,
  value,
  foot,
  footTone,
  testID,
}: {
  tone: ToneName;
  icon: string;
  label: string;
  value: string;
  foot: string;
  footTone?: ToneName;
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
      <AppText style={styles.tileValue} numberOfLines={1} testID={`${testID}-value`}>
        {value}
      </AppText>
      <AppText
        style={[styles.tileFoot, footTone && { color: TONE[footTone].text }]}
        testID={`${testID}-foot`}
      >
        {foot}
      </AppText>
    </View>
  );
}

function Field({
  icon,
  label,
  aside,
  hint,
  hintTone,
  children,
}: {
  icon: string;
  label: string;
  aside?: React.ReactNode;
  hint?: string;
  hintTone?: ToneName;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <View style={styles.fieldIcon}>
          <Ionicons name={icon as never} size={13} color={colors.info} />
        </View>
        <AppText style={[styles.fieldLabel, styles.flex]}>{label}</AppText>
        {aside}
      </View>
      {children}
      {!!hint && (
        <AppText style={[styles.hint, hintTone && { color: TONE[hintTone].text }]}>{hint}</AppText>
      )}
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>): React.JSX.Element {
  return (
    <TextInput
      placeholderTextColor={colors.textDisabled}
      autoCorrect={false}
      {...props}
      style={[styles.input, props.editable === false && styles.inputLocked, props.style]}
    />
  );
}

// --------------------------------------------------------------------------------------
// The editor
// --------------------------------------------------------------------------------------

function Editor({
  store,
  preset,
  plants,
  zones,
  onClose,
  onSaved,
  onFlash,
}: {
  store: StoreAdmin | null;
  /** Centres to start ticked — a new store opened from an unserved centre. */
  preset: string[];
  plants: StorePlantRow[];
  zones: Zone[];
  onClose: () => void;
  onSaved: (fresh: StoreAdmin | null, text: string, tone: ToneName, stayOpen: boolean) => void;
  onFlash: (text: string, tone: ToneName) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const adding = !store;
  const { scroller, content, overlap: keyboard, api } = useRevealOnFocus();
  const codeRef = useRef<View>(null);
  const nameRef = useRef<View>(null);
  const plantRef = useRef<View>(null);
  const keeperRef = useRef<View>(null);

  const [code, setCode] = useState(store?.code ?? '');
  const [name, setName] = useState(store?.name ?? '');
  const [zone, setZone] = useState<number | null>(store?.zone ?? null);
  const [active, setActive] = useState(store?.is_active ?? true);
  const [chosen, setChosen] = useState<string[]>(store ? [...(store.plants ?? [])] : preset);
  const [plantTerm, setPlantTerm] = useState('');
  const [keeperName, setKeeperName] = useState('');
  const [keeperMobile, setKeeperMobile] = useState('');
  const [plantNote, setPlantNote] = useState<string | null>(null);
  const [keeperHint, setKeeperHint] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [create, createState] = useAdminCreateStoreMutation();
  const [update, updateState] = useAdminUpdateStoreMutation();
  const [remove, removeState] = useAdminDeleteStoreMutation();
  const [addKeeper, addKeeperState] = useAdminAddStoreKeeperMutation();
  const [removeKeeper, removeKeeperState] = useAdminRemoveStoreKeeperMutation();
  const busy = [createState, updateState, removeState, addKeeperState, removeKeeperState].some(
    s => s.isLoading,
  );

  /** The store already serving this centre, unless it is the one being edited. */
  const heldBy = (plant: StorePlantRow): string | null =>
    plant.store_id && plant.store_id !== store?.id ? plant.store_name : null;

  const nameOf = (c: string) => plants.find(p => p.plant_code === c)?.plant_name ?? c;
  const needle = plantTerm.trim().toLowerCase();
  const shownPlants = needle
    ? plants.filter(
        p =>
          p.plant_name.toLowerCase().includes(needle) ||
          p.plant_code.toLowerCase().includes(needle),
      )
    : plants;

  const toggle = (c: string) => {
    setPlantNote(null);
    setChosen(now => (now.includes(c) ? now.filter(x => x !== c) : [...now, c]));
  };

  /** The store's zone is the usual shape of its catchment: tick its centres no store has. */
  const pickZone = () => {
    const picked = zones.find(z => z.id === zone);
    if (!picked) {
      setPlantNote(t('admin.stores.pickZoneFirst'));
      return;
    }
    setPlantNote(null);
    setChosen(now => {
      const next = [...now];
      (picked.plants ?? []).forEach(c => {
        const plant = plants.find(p => p.plant_code === c);
        if (plant && !heldBy(plant) && !next.includes(c)) {
          next.push(c);
        }
      });
      return next;
    });
  };

  // Removals by name: taking a centre off a store sends its Maits somewhere else to collect.
  const before = store?.plants ?? [];
  const added = chosen.filter(c => !before.includes(c));
  const removed = before.filter(c => !chosen.includes(c));
  const diffParts: string[] = [];
  if (added.length) {
    diffParts.push(t('admin.stores.adding', { names: added.map(nameOf).join(', ') }));
  }
  if (removed.length) {
    diffParts.push(t('admin.stores.removing', { names: removed.map(nameOf).join(', ') }));
  }
  const diff =
    plantNote ??
    (diffParts.length
      ? diffParts.join(' · ')
      : chosen.length
        ? t('admin.stores.noChange')
        : t('admin.stores.servesNone'));

  const save = async () => {
    const body: StoreWrite = {
      name: name.trim(),
      zone,
      is_active: active,
      plants: chosen,
    };
    if (!body.name) {
      setProblem(t('admin.stores.needName'));
      api.reveal(nameRef.current);
      return;
    }
    if (adding) {
      body.code = code.trim().toUpperCase();
      if (!body.code) {
        setProblem(t('admin.stores.needCode'));
        api.reveal(codeRef.current);
        return;
      }
    }
    setProblem(null);
    try {
      const saved = adding
        ? await create(body).unwrap()
        : await update({ id: store.id, ...body }).unwrap();
      // A new store stays open: the next thing to do is give it a keeper, which needs it to exist.
      onSaved(
        saved,
        t(adding ? 'admin.stores.created' : 'admin.stores.saved', { name: saved.name }),
        'green',
        adding,
      );
    } catch (error) {
      setProblem(problemOf(error, t('admin.stores.notSaved')));
    }
  };

  const destroy = () => {
    if (!store) {
      return;
    }
    Alert.alert(t('admin.stores.deleteTitle', { name: store.name }), t('admin.stores.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('admin.stores.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await remove(store.id).unwrap();
            onSaved(null, t('admin.stores.deleted', { name: store.name }), 'yolk', false);
          } catch (error) {
            setProblem(problemOf(error, t('admin.stores.notSaved')));
          }
        },
      },
    ]);
  };

  const doAddKeeper = async () => {
    if (!store) {
      return;
    }
    const full_name = keeperName.trim();
    const mobile_no = keeperMobile.replace(/\D/g, '');
    if (!full_name) {
      setKeeperHint(t('admin.stores.keeperNeedName'));
      return;
    }
    if (mobile_no.length !== 10) {
      setKeeperHint(t('admin.stores.keeperNeedMobile'));
      return;
    }
    setKeeperHint(null);
    try {
      await addKeeper({ id: store.id, full_name, mobile_no }).unwrap();
      setKeeperName('');
      setKeeperMobile('');
      onFlash(t('admin.stores.keeperAdded', { name: full_name, mobile: mobile_no }), 'green');
    } catch (error) {
      setKeeperHint(problemOf(error, t('admin.stores.notSaved')));
    }
  };

  const doRemoveKeeper = (userId: number, keeperFullName: string) => {
    if (!store) {
      return;
    }
    Alert.alert(
      t('admin.stores.takeOffTitle', { name: keeperFullName, store: store.name }),
      t('admin.stores.takeOffBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.stores.takeOff'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeKeeper({ id: store.id, userId }).unwrap();
              onFlash(t('admin.stores.keeperRemoved', { name: keeperFullName }), 'yolk');
            } catch (error) {
              setKeeperHint(problemOf(error, t('admin.stores.notSaved')));
            }
          },
        },
      ],
    );
  };

  const look = adding ? TONE.green : TONE.blue;
  const keepers = store?.keepers ?? [];
  const keepersOn = keepers.filter(k => k.is_active).length;

  return (
    <ScrollView
      ref={scroller}
      innerViewRef={content}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.body, !!keyboard && { paddingBottom: keyboard + spacing[4] }]}
      testID="admin-store-editor"
    >
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        testID="admin-store-back"
      >
        <Ionicons name="arrow-back" size={16} color={colors.surface} />
        <AppText style={styles.backLabel}>{t('admin.stores.allStores')}</AppText>
      </Pressable>

      {/* Green brings something new onto the list; blue corrects what is already on it. */}
      <View
        style={[styles.banner, { backgroundColor: look.wash, borderColor: look.border }]}
        testID="admin-store-banner"
      >
        <View style={[styles.bannerMark, { backgroundColor: look.solid }]}>
          <Ionicons name={adding ? 'add' : 'storefront'} size={20} color={look.onSolid} />
        </View>
        <View style={styles.flex}>
          <AppText style={styles.bannerTitle}>
            {adding ? t('admin.stores.addStore') : store.name}
          </AppText>
          <AppText style={styles.sub}>
            {adding
              ? t('admin.stores.addMeta')
              : t('admin.stores.editMeta', { code: store.code, n: num(store.mpp_count) })}
          </AppText>
        </View>
        {!adding && (
          <Pill
            label={t(store.is_active ? 'admin.stores.open' : 'admin.stores.closed')}
            tone={store.is_active ? 'green' : 'red'}
          />
        )}
      </View>

      <View ref={codeRef} collapsable={false}>
        <Field
          icon="barcode-outline"
          label={t('admin.stores.code')}
          hint={t(adding ? 'admin.stores.codeHintNew' : 'admin.stores.codeHintFixed')}
        >
          <Input
            value={code}
            onChangeText={text => setCode(text.toUpperCase())}
            onFocus={() => api.reveal(codeRef.current)}
            editable={adding}
            autoCapitalize="characters"
            maxLength={20}
            placeholder="BARSANA"
            testID="admin-store-code"
          />
        </Field>
      </View>

      <View ref={nameRef} collapsable={false}>
        <Field
          icon="pricetag-outline"
          label={t('admin.stores.name')}
          hint={t('admin.stores.nameHint')}
        >
          <Input
            value={name}
            onChangeText={setName}
            onFocus={() => api.reveal(nameRef.current)}
            maxLength={100}
            placeholder="Barsana depot"
            testID="admin-store-name"
          />
        </Field>
      </View>

      <Field icon="map-outline" label={t('admin.stores.zone')} hint={t('admin.stores.zoneHint')}>
        <View style={styles.chips}>
          {[{ id: 0, name: t('admin.stores.noZone') } as Pick<Zone, 'id' | 'name'>, ...zones].map(
            z => {
              const on = (zone ?? 0) === z.id;
              return (
                <Pressable
                  key={z.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setZone(z.id || null)}
                  style={[styles.zoneChip, on && styles.zoneChipOn]}
                  testID={`admin-store-zone-${z.id}`}
                >
                  <AppText style={[styles.zoneChipLabel, on && styles.zoneChipLabelOn]}>
                    {z.name}
                  </AppText>
                </Pressable>
              );
            },
          )}
        </View>
      </Field>

      <Field
        icon="power-outline"
        label={t('admin.stores.status')}
        hint={t('admin.stores.statusHint')}
      >
        <View style={styles.choices}>
          {([true, false] as const).map(open => {
            const on = active === open;
            const tone = open ? TONE.green : TONE.red;
            return (
              <Pressable
                key={String(open)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setActive(open)}
                style={[
                  styles.choice,
                  {
                    backgroundColor: on ? tone.solid : colors.surface,
                    borderColor: on ? tone.solid : tone.border,
                  },
                ]}
                testID={`admin-store-status-${open ? 'open' : 'closed'}`}
              >
                <AppText style={[styles.choiceLabel, { color: on ? tone.onSolid : colors.ink }]}>
                  {t(open ? 'admin.stores.open' : 'admin.stores.closed')}
                </AppText>
                <AppText
                  style={[styles.choiceHint, { color: on ? tone.onSolid : colors.textMuted }]}
                >
                  {t(open ? 'admin.stores.openHint' : 'admin.stores.closedHint')}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <View ref={plantRef} collapsable={false}>
        <Field
          icon="business-outline"
          label={t('admin.stores.serves')}
          aside={
            <AppText style={styles.sub} testID="admin-store-plant-count">
              {chosen.length
                ? t('admin.stores.ticked', { n: chosen.length, total: plants.length })
                : t('admin.stores.noneTicked')}
            </AppText>
          }
          hint={diff}
          hintTone={removed.length ? 'red' : plantNote ? 'yolk' : undefined}
        >
          <View style={styles.searchBar}>
            <Ionicons name="search" size={15} color={colors.info} />
            <TextInput
              style={styles.searchInput}
              value={plantTerm}
              onChangeText={setPlantTerm}
              onFocus={() => api.reveal(plantRef.current)}
              placeholder={t('admin.stores.plantSearch')}
              placeholderTextColor={colors.textDisabled}
              autoCorrect={false}
              testID="admin-store-plant-search"
            />
          </View>
          <View style={styles.quick}>
            <Pressable
              accessibilityRole="button"
              onPress={pickZone}
              style={({ pressed }) => [styles.goodOutline, pressed && styles.pressed]}
              testID="admin-store-pick-zone"
            >
              <Ionicons name="checkmark-done" size={15} color={colors.primaryDark} />
              <AppText style={styles.goodOutlineLabel}>{t('admin.stores.pickZone')}</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setPlantNote(null);
                setChosen([]);
              }}
              style={({ pressed }) => [styles.soft, pressed && styles.pressed]}
              testID="admin-store-pick-none"
            >
              <AppText style={styles.softLabel}>{t('admin.stores.clear')}</AppText>
            </Pressable>
          </View>
          <View style={styles.plants}>
            {shownPlants.length === 0 ? (
              <AppText style={[styles.hint, styles.plantEmpty]}>
                {t('admin.stores.noPlantMatch')}
              </AppText>
            ) : (
              shownPlants.map((plant, index) => {
                const taken = heldBy(plant);
                const on = chosen.includes(plant.plant_code);
                return (
                  <Pressable
                    key={plant.plant_code}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: !!taken }}
                    disabled={!!taken}
                    onPress={() => toggle(plant.plant_code)}
                    style={[
                      styles.plant,
                      index > 0 && styles.rule,
                      on && styles.plantOn,
                      !!taken && styles.plantTaken,
                    ]}
                    testID={`admin-store-plant-${plant.plant_code}`}
                  >
                    <Ionicons
                      name={taken ? 'lock-closed' : on ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={taken ? colors.textMuted : on ? colors.primary : colors.info}
                    />
                    <View style={styles.flex}>
                      <AppText style={[styles.plantName, !!taken && styles.muted]}>
                        {plant.plant_name}
                      </AppText>
                      <AppText style={styles.sub}>
                        {taken
                          ? t('admin.stores.servedBy', { store: taken })
                          : [t('admin.stores.mpps', { n: num(plant.mpp_count) }), plant.zone_name]
                              .filter(Boolean)
                              .join(' · ')}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </Field>
      </View>

      {/* Keepers only once the store exists, because an account has to belong to one. */}
      <View ref={keeperRef} collapsable={false}>
        <Field
          icon="people-outline"
          label={t('admin.stores.keepers')}
          aside={
            <AppText style={styles.sub} testID="admin-store-keeper-count">
              {adding
                ? t('admin.stores.afterSaving')
                : keepersOn
                  ? t('admin.stores.canSignIn', { n: keepersOn })
                  : t('admin.stores.noneYet')}
            </AppText>
          }
          hint={keeperHint ?? t(adding ? 'admin.stores.saveFirst' : 'admin.stores.keeperHint')}
          hintTone={keeperHint ? 'red' : undefined}
        >
          {!adding && keepers.length > 0 && (
            <View style={styles.keepers}>
              {keepers.map((keeper, index) => (
                <View
                  key={keeper.id ?? keeper.mobile_no}
                  style={[
                    styles.keeper,
                    index > 0 && styles.rule,
                    !keeper.is_active && styles.keeperOff,
                  ]}
                  testID={`admin-store-keeper-${keeper.mobile_no}`}
                >
                  <View
                    style={[
                      styles.keeperDisc,
                      { backgroundColor: keeper.is_active ? colors.primary : ink[200] },
                    ]}
                  >
                    <Ionicons name="person" size={14} color={colors.surface} />
                  </View>
                  <View style={styles.flex}>
                    <AppText style={styles.keeperName}>{keeper.full_name}</AppText>
                    <AppText style={styles.sub}>
                      {`${keeper.mobile_no} · ${
                        keeper.is_active
                          ? keeper.last_login_at
                            ? t('admin.stores.lastSignedIn', {
                                date: dateOf(t, keeper.last_login_at),
                              })
                            : t('admin.stores.notSignedIn')
                          : t('admin.stores.takenOff')
                      }`}
                    </AppText>
                  </View>
                  {keeper.is_active && keeper.id !== undefined && (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => doRemoveKeeper(keeper.id as number, keeper.full_name)}
                      style={({ pressed }) => [styles.dangerOutline, pressed && styles.pressed]}
                      testID={`admin-store-keeper-remove-${keeper.id}`}
                    >
                      <AppText style={styles.dangerLabel}>{t('admin.stores.takeOff')}</AppText>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          )}
          {!adding && (
            <View style={styles.keeperAdd}>
              <Input
                value={keeperName}
                onChangeText={text => {
                  setKeeperHint(null);
                  setKeeperName(text);
                }}
                onFocus={() => api.reveal(keeperRef.current)}
                maxLength={150}
                placeholder={t('admin.stores.keeperNamePlaceholder')}
                testID="admin-store-keeper-name"
              />
              <Input
                value={keeperMobile}
                onChangeText={text => {
                  setKeeperHint(null);
                  setKeeperMobile(text.replace(/\D/g, ''));
                }}
                onFocus={() => api.reveal(keeperRef.current)}
                keyboardType="phone-pad"
                maxLength={10}
                placeholder={t('admin.stores.keeperMobilePlaceholder')}
                testID="admin-store-keeper-mobile"
              />
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={doAddKeeper}
                style={({ pressed }) => [styles.goodOutline, pressed && styles.pressed]}
                testID="admin-store-keeper-add"
              >
                <Ionicons name="person-add-outline" size={15} color={colors.primaryDark} />
                <AppText style={styles.goodOutlineLabel}>{t('admin.stores.addKeeper')}</AppText>
              </Pressable>
            </View>
          )}
        </Field>
      </View>

      {!!problem && (
        <View style={styles.problem} testID="admin-store-problem">
          <Ionicons name="alert-circle" size={16} color={colors.error} />
          <AppText style={styles.problemText}>{problem}</AppText>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={save}
          style={({ pressed }) => [styles.primary, busy && styles.off, pressed && styles.pressed]}
          testID="admin-store-save"
        >
          {createState.isLoading || updateState.isLoading ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Ionicons name="checkmark" size={18} color={colors.surface} />
          )}
          <AppText style={styles.primaryLabel}>{t('admin.stores.saveStore')}</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.soft, pressed && styles.pressed]}
          testID="admin-store-cancel"
        >
          <AppText style={styles.softLabel}>{t('admin.stores.cancel')}</AppText>
        </Pressable>
        {!adding && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={destroy}
            style={({ pressed }) => [
              styles.dangerOutline,
              styles.dangerBig,
              pressed && styles.pressed,
            ]}
            testID="admin-store-delete"
          >
            <Ionicons name="trash-outline" size={15} color={colors.error} />
            <AppText style={styles.dangerLabel}>{t('admin.stores.delete')}</AppText>
          </Pressable>
        )}
      </View>
      <AppText style={styles.hint}>
        {t(adding ? 'admin.stores.keepersAfterSave' : 'admin.stores.closeRather')}
      </AppText>
    </ScrollView>
  );
}

// --------------------------------------------------------------------------------------
// The roster
// --------------------------------------------------------------------------------------

function StoreCard({
  store,
  onStock,
  onEdit,
}: {
  store: StoreAdmin;
  onStock: () => void;
  onEdit: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = storeTone(store);
  const look = TONE[tone];
  const keepers = activeKeepers(store);
  const shelf = store.stock ?? [];

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-store-${store.code}`}
    >
      <View style={styles.cardTop}>
        <View style={[styles.disc, { backgroundColor: look.solid }]}>
          <Ionicons name="storefront" size={17} color={look.onSolid} />
        </View>
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{store.name}</AppText>
          <AppText style={styles.sub}>
            {[store.code, store.zone_name].filter(Boolean).join(' · ')}
          </AppText>
        </View>
        <Pill
          label={t(store.is_active ? 'admin.stores.open' : 'admin.stores.closed')}
          tone={store.is_active ? 'green' : 'red'}
        />
      </View>

      <View style={styles.inset}>
        <View style={[styles.row, styles.ruleBottom]}>
          <AppText style={styles.rowLabel}>{t('admin.stores.servesShort')}</AppText>
          <View style={[styles.flex, styles.chips]}>
            {(store.plant_names ?? []).length ? (
              store.plant_names.map(plantName => (
                <View key={plantName} style={styles.serve}>
                  <AppText style={styles.serveLabel}>{plantName}</AppText>
                </View>
              ))
            ) : (
              <AppText style={styles.sub}>{t('admin.stores.noPlants')}</AppText>
            )}
          </View>
        </View>
        <View style={[styles.row, styles.ruleBottom]}>
          <AppText style={styles.rowLabel}>{t('admin.stores.keepers')}</AppText>
          <View style={styles.flex} testID={`admin-store-keepers-${store.code}`}>
            {keepers.length ? (
              keepers.map(keeper => (
                <AppText key={keeper.mobile_no} style={styles.rowValue}>
                  {keeper.full_name}
                  <AppText style={styles.sub}>{`  ${keeper.mobile_no}`}</AppText>
                </AppText>
              ))
            ) : (
              <AppText style={styles.warnText}>{t('admin.stores.noKeeper')}</AppText>
            )}
          </View>
        </View>
        <View style={[styles.row, styles.ruleBottom]}>
          <AppText style={styles.rowLabel}>{t('admin.stores.shelf')}</AppText>
          <View style={[styles.flex, styles.chips]}>
            {shelf.length ? (
              shelf.map((line, index) => {
                const qty = Number(line.on_hand) || 0;
                const kind = SHELF_LOOK[line.category] ?? SHELF_LOOK.straw;
                const chipLook = qty ? TONE[kind.tone] : TONE.yolk;
                return (
                  <View
                    key={`${line.item_name}-${index}`}
                    style={[
                      styles.shelfChip,
                      { backgroundColor: chipLook.wash, borderColor: chipLook.border },
                    ]}
                  >
                    <Glyph name={kind.icon} size={11} color={chipLook.text} />
                    <AppText style={styles.shelfItem}>{line.item_name}</AppText>
                    <AppText style={[styles.shelfQty, { color: chipLook.text }]}>
                      {num(qty)}
                    </AppText>
                  </View>
                );
              })
            ) : (
              <AppText style={styles.sub}>{t('admin.stores.nothingRecorded')}</AppText>
            )}
          </View>
        </View>
        <View style={styles.row}>
          <AppText style={styles.rowLabel}>{t('admin.stores.waiting')}</AppText>
          <AppText style={[styles.rowValue, styles.flex, !store.open_indents && styles.muted]}>
            {store.open_indents ? num(store.open_indents) : t('admin.stores.none_')}
          </AppText>
        </View>
      </View>

      <View style={styles.cardFoot}>
        <Pressable
          accessibilityRole="button"
          onPress={onStock}
          style={({ pressed }) => [styles.goodOutline, pressed && styles.pressed]}
          testID={`admin-store-stock-${store.code}`}
        >
          <Ionicons name="cube-outline" size={15} color={colors.primaryDark} />
          <AppText style={styles.goodOutlineLabel}>{t('admin.stores.stock')}</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onEdit}
          style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
          testID={`admin-store-edit-${store.code}`}
        >
          <Ionicons name="create-outline" size={15} color={colors.ink} />
          <AppText style={styles.editLabel}>{t('admin.stores.edit')}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

type View_ =
  | { kind: 'list' }
  | { kind: 'edit'; storeId: number | null; preset: string[]; fallback?: StoreAdmin }
  | { kind: 'stock'; store: StoreAdmin };

export default function AdminStoresScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const stores = useAdminListStoresQuery();
  const plants = useAdminStorePlantsQuery();
  const zones = useAdminListZonesQuery();
  const [term, setTerm] = useState('');
  const [view, setView] = useState<View_>({ kind: 'list' });
  const [flash, setFlash] = useState<{ text: string; tone: ToneName } | null>(null);

  const all = useMemo(() => stores.data?.results ?? [], [stores.data]);
  const plantRows = plants.data?.results ?? [];
  const activeZones = (zones.data?.results ?? []).filter(z => z.is_active);

  useEffect(() => {
    if (view.kind === 'list') {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setView({ kind: 'list' });
      return true;
    });
    return () => sub.remove();
  }, [view.kind]);

  if (view.kind === 'stock') {
    return (
      <View style={styles.root}>
        <StoreStock
          store={{
            id: view.store.id,
            name: view.store.name,
            code: view.store.code,
            zone_name: view.store.zone_name,
          }}
          onBack={() => setView({ kind: 'list' })}
        />
      </View>
    );
  }

  if (view.kind === 'edit') {
    // Read from the fresh list each render, so a keeper added shows up straight away.
    const editing =
      view.storeId === null
        ? null
        : (all.find(s => s.id === view.storeId) ?? view.fallback ?? null);
    return (
      <View style={styles.root}>
        {flash && (
          <View style={styles.editorFlash}>
            <Notice
              tone={flash.tone}
              icon={flash.tone === 'green' ? 'checkmark' : 'information'}
              title={flash.text}
              body=""
              testID="admin-stores-flash"
            />
          </View>
        )}
        <Editor
          key={view.storeId ?? `new-${view.preset.join(',')}`}
          store={editing}
          preset={view.preset}
          plants={plantRows}
          zones={activeZones}
          onClose={() => {
            setFlash(null);
            setView({ kind: 'list' });
          }}
          onFlash={(text, tone) => setFlash({ text, tone })}
          onSaved={(fresh, text, tone, stayOpen) => {
            setFlash({ text, tone });
            setView(
              stayOpen && fresh
                ? { kind: 'edit', storeId: fresh.id, preset: [], fallback: fresh }
                : { kind: 'list' },
            );
          }}
        />
      </View>
    );
  }

  const served = plantRows.filter(p => p.store_id);
  const free = plantRows.filter(p => !p.store_id);
  const waiting = all.reduce((sum, s) => sum + (s.open_indents || 0), 0);
  const keeperless = all.filter(s => s.is_active && !activeKeepers(s).length).length;
  const shown = all.filter(s => matchesStore(s, term.trim()));

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={stores.isFetching && !stores.isLoading}
            onRefresh={() => {
              stores.refetch();
              plants.refetch();
            }}
          />
        }
        testID="admin-stores"
      >
        <View style={styles.top}>
          <AppText style={styles.count} testID="admin-stores-count">
            {stores.data
              ? term.trim()
                ? t('admin.stores.countOf', { shown: shown.length, count: all.length })
                : t('admin.stores.count', { count: all.length })
              : '—'}
          </AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setFlash(null);
              setView({ kind: 'edit', storeId: null, preset: [] });
            }}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            testID="admin-stores-add"
          >
            <Ionicons name="add" size={18} color={colors.surface} />
            <AppText style={styles.primaryLabel}>{t('admin.stores.addStore')}</AppText>
          </Pressable>
        </View>

        {!!flash && (
          <Notice
            tone={flash.tone}
            icon={flash.tone === 'green' ? 'checkmark' : 'information'}
            title={flash.text}
            body=""
            testID="admin-stores-flash"
          />
        )}

        {/* Blue: the rule this screen runs on, not a backlog. */}
        <Notice
          tone="blue"
          icon="information"
          title={t('admin.stores.ruleTitle')}
          body={t('admin.stores.ruleBody')}
          testID="admin-stores-rule"
        />

        {stores.isLoading ? (
          <SkeletonRows />
        ) : stores.isError ? (
          <EmptyState message={t('admin.stores.error')} />
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile
                tone="green"
                icon="storefront"
                label={t('admin.stores.tileStores')}
                value={num(all.length)}
                foot={
                  keeperless
                    ? t('admin.stores.withNoKeeper', { n: keeperless })
                    : t('admin.stores.everyKeeper')
                }
                footTone={keeperless ? 'red' : 'green'}
                testID="admin-stores-tile-stores"
              />
              <Tile
                tone="blue"
                icon="business"
                label={t('admin.stores.tileServed')}
                value={t('admin.stores.servedOf', { n: served.length, total: plantRows.length })}
                foot={
                  free.length
                    ? t('admin.stores.stillPortal', { n: free.length })
                    : t('admin.stores.everyCentre')
                }
                footTone={free.length ? 'red' : 'green'}
                testID="admin-stores-tile-served"
              />
            </View>
            <Tile
              tone="slate"
              icon="time"
              label={t('admin.stores.tileWaiting')}
              value={num(waiting)}
              foot={t('admin.stores.waitingFoot')}
              testID="admin-stores-tile-waiting"
            />

            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.info} />
              <TextInput
                style={styles.searchInput}
                value={term}
                onChangeText={setTerm}
                placeholder={t('admin.stores.searchPlaceholder')}
                placeholderTextColor={colors.textDisabled}
                autoCorrect={false}
                testID="admin-stores-search"
              />
              {term.length > 0 && (
                <Pressable onPress={() => setTerm('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </Pressable>
              )}
            </View>

            {shown.length === 0 ? (
              <EmptyState
                message={
                  term.trim()
                    ? t('admin.stores.noMatch', { term: term.trim() })
                    : t('admin.stores.none')
                }
              />
            ) : (
              shown.map(store => (
                <StoreCard
                  key={store.id}
                  store={store}
                  onStock={() => {
                    setFlash(null);
                    setView({ kind: 'stock', store });
                  }}
                  onEdit={() => {
                    setFlash(null);
                    setView({ kind: 'edit', storeId: store.id, preset: [] });
                  }}
                />
              ))
            )}

            {/* Centres no store serves: tap one to build its store around it. */}
            {free.length > 0 && (
              <View
                style={[
                  styles.panel,
                  { backgroundColor: TONE.yolk.wash, borderColor: TONE.yolk.border },
                ]}
                testID="admin-stores-unserved"
              >
                <View style={styles.panelHead}>
                  <View style={[styles.chip, { backgroundColor: TONE.yolk.solid }]}>
                    <Ionicons name="alert" size={14} color={colors.ink} />
                  </View>
                  <AppText style={[styles.panelTitle, { color: TONE.yolk.text }]}>
                    {t('admin.stores.unservedTitle')}
                  </AppText>
                  <Pill label={num(free.length)} tone="yolk" />
                </View>
                <AppText style={styles.panelBody}>{t('admin.stores.unservedBody')}</AppText>
                <View style={styles.chips}>
                  {free.map(plant => (
                    <Pressable
                      key={plant.plant_code}
                      accessibilityRole="button"
                      onPress={() => {
                        setFlash(null);
                        setView({ kind: 'edit', storeId: null, preset: [plant.plant_code] });
                      }}
                      style={({ pressed }) => [styles.freeChip, pressed && styles.pressed]}
                      testID={`admin-stores-place-${plant.plant_code}`}
                    >
                      <AppText style={styles.freeChipLabel}>{plant.plant_name}</AppText>
                      <AppText style={styles.sub}>
                        {t('admin.stores.mpps', { n: num(plant.mpp_count) })}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  off: { opacity: 0.45 },
  muted: { color: colors.textMuted },
  sub: { ...typography.caption, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  warnText: { ...typography.label, color: yolk[800] },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  ruleBottom: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },

  top: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[3] },
  count: { ...typography.h3, color: colors.ink, flex: 1, minWidth: 120 },
  editorFlash: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },

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

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  disc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cardName: { ...typography.h3, color: colors.ink },
  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], paddingVertical: 8 },
  rowLabel: { ...typography.caption, color: colors.textMuted, width: 64 },
  rowValue: { ...typography.label, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  serve: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
  },
  serveLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  shelfChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  shelfItem: { ...typography.caption, color: colors.ink },
  shelfQty: { ...typography.caption, fontFamily: typography.label.fontFamily },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[2] },
  edit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: yolk[400],
  },
  editLabel: { ...typography.label, color: colors.ink },
  goodOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  goodOutlineLabel: { ...typography.label, color: colors.primaryDark },

  panel: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  panelTitle: { ...typography.h3, flex: 1 },
  panelBody: { ...typography.caption, color: colors.ink },
  freeChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: yolk[300],
    backgroundColor: colors.surface,
  },
  freeChipLabel: { ...typography.label, color: colors.ink },

  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  backLabel: { ...typography.label, color: colors.surface },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  bannerMark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: { ...typography.h3, color: colors.ink },

  field: { gap: 6 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  fieldIcon: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoWash,
  },
  fieldLabel: { ...typography.label, color: colors.ink },
  input: {
    ...typography.body,
    color: colors.ink,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  inputLocked: { borderColor: colors.border, backgroundColor: ink[50], color: colors.textMuted },
  zoneChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  zoneChipOn: { backgroundColor: colors.info },
  zoneChipLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.info,
  },
  zoneChipLabelOn: { color: colors.surface },
  choices: { flexDirection: 'row', gap: spacing[2] },
  choice: { flex: 1, gap: 2, padding: spacing[3], borderRadius: radius.md, borderWidth: 1.5 },
  choiceLabel: { ...typography.label },
  choiceHint: { ...typography.caption },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  soft: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  softLabel: { ...typography.label, color: colors.ink },
  plants: { borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden' },
  plant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: 48,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
  },
  plantOn: { backgroundColor: colors.primaryWash },
  plantTaken: { backgroundColor: ink[50] },
  plantName: { ...typography.label, color: colors.ink },
  plantEmpty: { padding: spacing[3] },

  keepers: { borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden' },
  keeper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  keeperOff: { opacity: 0.6 },
  keeperDisc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keeperName: { ...typography.label, color: colors.ink },
  keeperAdd: { gap: spacing[2] },

  problem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  problemText: { ...typography.label, color: colors.error, flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryLabel: { ...typography.label, color: colors.surface },
  dangerOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  dangerBig: { minHeight: 42, paddingHorizontal: spacing[3] },
  dangerLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.error,
  },
});
