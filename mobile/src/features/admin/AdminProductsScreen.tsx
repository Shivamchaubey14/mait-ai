/**
 * Products, for an admin — the portal's catalogue screen (`products.html`) on a handset.
 *
 * Everything a Mait can ask for, in three kinds chosen by pill: consumables that run out,
 * equipment issued once and kept, and straws. The first two are one catalogue keyed by id;
 * straws are the breed list, keyed by breed and animal and carrying a Hindi label the others do
 * not. They share a screen because they are one question — what can be requested — and the
 * editor shows only the fields that apply to the kind on screen.
 *
 * This list is what names an indent: anything missing reaches the depot as "25 × Consumable".
 * So the code is set once and never changed, an unpriced row is called out rather than read as
 * free, and the three ways of changing a row carry three weights — save (green), retire (off the
 * request form, records untouched; yellow), and delete (only while nothing points at it; red).
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Sheet } from '@/components/BottomSheet';
import Glyph, { STRAW_GLYPH, type GlyphName } from '@/components/glyph';
import {
  useAdminCreateBreedMutation,
  useAdminCreateProductMutation,
  useAdminDeleteBreedMutation,
  useAdminDeleteProductMutation,
  useAdminListBreedsQuery,
  useAdminListProductsQuery,
  useAdminUpdateBreedMutation,
  useAdminUpdateProductMutation,
} from '@api/endpoints';
import type { AdminBreed, CatalogueWrite, ProductAdmin } from '@api/types';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';

type Kind = 'consumable' | 'asset' | 'straw';
const KINDS: Kind[] = ['consumable', 'asset', 'straw'];

/** Each kind in the tone and glyph the stock screens use for it. */
const KIND_LOOK: Record<Kind, { tone: ToneName; icon: GlyphName }> = {
  consumable: { tone: 'green', icon: 'flask-outline' },
  asset: { tone: 'blue', icon: 'construct-outline' },
  straw: { tone: 'yolk', icon: STRAW_GLYPH },
};

const UNITS = ['piece', 'pair', 'box', 'litre'];

/** One row on screen, whichever list it came from. */
interface Row {
  id: number;
  code: string;
  name: string;
  name_hi?: string;
  animal_type?: 'COW' | 'BUFF';
  category?: 'consumable' | 'asset';
  unit?: string;
  rate: string;
  display_order: number;
  is_active: boolean;
}

function priced(rate: string | number | null | undefined): boolean {
  return Number(rate || 0) > 0;
}

function rupees(rate: string | number): string {
  return `₹${Number(rate || 0).toFixed(2)}`;
}

/** The server's words for a refused change, or a fallback. */
function problemOf(error: unknown, fallback: string): string {
  const data = (error as { data?: unknown })?.data;
  if (typeof data === 'string' && data.trim() && !data.trim().startsWith('<')) {
    return data;
  }
  const body = (data ?? {}) as Record<string, unknown>;
  const said =
    (typeof body.detail === 'string' && body.detail) ||
    Object.values(body)
      .flat()
      .filter((v): v is string => typeof v === 'string')
      .join(' · ');
  return said || fallback;
}

// --------------------------------------------------------------------------------------
// The editor
// --------------------------------------------------------------------------------------

function Field({
  icon,
  label,
  hint,
  children,
}: {
  icon: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <View style={styles.fieldIcon}>
          <Ionicons name={icon as never} size={13} color={colors.info} />
        </View>
        <AppText style={styles.fieldLabel}>{label}</AppText>
      </View>
      {children}
      {!!hint && <AppText style={styles.hint}>{hint}</AppText>}
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

function Choice({
  label,
  hint,
  on,
  tone,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  hint?: string;
  on: boolean;
  tone: ToneName;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: on ? look.solid : colors.surface,
          borderColor: on ? look.solid : look.border,
        },
        disabled && !on && styles.off,
      ]}
      testID={testID}
    >
      <AppText style={[styles.choiceLabel, { color: on ? look.onSolid : colors.ink }]}>
        {label}
      </AppText>
      {!!hint && (
        <AppText style={[styles.choiceHint, { color: on ? look.onSolid : colors.textMuted }]}>
          {hint}
        </AppText>
      )}
    </Pressable>
  );
}

function Editor({
  kind,
  item,
  onClose,
  onDone,
}: {
  kind: Kind;
  item: Row | null;
  onClose: () => void;
  onDone: (text: string, tone: ToneName) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const adding = !item;
  const straw = kind === 'straw';

  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [nameHi, setNameHi] = useState(item?.name_hi ?? '');
  const [animal, setAnimal] = useState<'COW' | 'BUFF'>(item?.animal_type ?? 'COW');
  const [category, setCategory] = useState<'consumable' | 'asset'>(
    item?.category ?? (kind === 'asset' ? 'asset' : 'consumable'),
  );
  const [unit, setUnit] = useState(item?.unit ?? 'piece');
  const [rate, setRate] = useState(item ? String(Number(item.rate || 0)) : '');
  const [order, setOrder] = useState(String(item?.display_order ?? 0));
  const [problem, setProblem] = useState<string | null>(null);

  const [createProduct, createProductState] = useAdminCreateProductMutation();
  const [updateProduct, updateProductState] = useAdminUpdateProductMutation();
  const [deleteProduct, deleteProductState] = useAdminDeleteProductMutation();
  const [createBreed, createBreedState] = useAdminCreateBreedMutation();
  const [updateBreed, updateBreedState] = useAdminUpdateBreedMutation();
  const [deleteBreed, deleteBreedState] = useAdminDeleteBreedMutation();
  const busy = [
    createProductState,
    updateProductState,
    deleteProductState,
    createBreedState,
    updateBreedState,
    deleteBreedState,
  ].some(s => s.isLoading);

  const create = (body: CatalogueWrite) =>
    (straw ? createBreed(body) : createProduct(body)).unwrap();
  const update = (id: number, body: CatalogueWrite) =>
    (straw ? updateBreed({ id, ...body }) : updateProduct({ id, ...body })).unwrap();
  const remove = (id: number) => (straw ? deleteBreed(id) : deleteProduct(id)).unwrap();

  // Two jobs from one sheet, so it says which by its colour: green brings something new onto
  // the list, blue corrects what is already on it.
  const look = adding ? TONE.green : TONE.blue;

  const save = async () => {
    const body: CatalogueWrite = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      rate: Number(rate || 0).toFixed(2),
      display_order: Number(order || 0),
    };
    if (!body.code || !body.name) {
      setProblem(t('admin.products.needCodeName'));
      return;
    }
    if (Number.isNaN(Number(rate || 0)) || Number(rate || 0) < 0) {
      setProblem(t('admin.products.badRate'));
      return;
    }
    if (straw) {
      body.name_hi = nameHi.trim();
      body.animal_type = animal;
    } else {
      body.category = category;
      body.unit = unit.trim() || 'piece';
    }
    setProblem(null);
    try {
      const saved = item ? await update(item.id, body) : await create(body);
      onDone(t('admin.products.saved', { name: saved?.name ?? body.name }), 'green');
    } catch (error) {
      setProblem(problemOf(error, t('admin.products.saveFailed')));
    }
  };

  const retire = () => {
    if (!item) {
      return;
    }
    Alert.alert(
      t('admin.products.retireTitle', { name: item.name }),
      t('admin.products.retireBody'),
      [
        { text: t('admin.products.cancel'), style: 'cancel' },
        {
          text: t('admin.products.retire'),
          style: 'destructive',
          onPress: async () => {
            try {
              await update(item.id, { is_active: false });
              onDone(t('admin.products.retired', { name: item.name }), 'yolk');
            } catch (error) {
              setProblem(problemOf(error, t('admin.products.saveFailed')));
            }
          },
        },
      ],
    );
  };

  const restore = async () => {
    if (!item) {
      return;
    }
    try {
      await update(item.id, { is_active: true });
      onDone(t('admin.products.restored', { name: item.name }), 'green');
    } catch (error) {
      setProblem(problemOf(error, t('admin.products.saveFailed')));
    }
  };

  const destroy = () => {
    if (!item) {
      return;
    }
    Alert.alert(
      t('admin.products.deleteTitle', { name: item.name }),
      t('admin.products.deleteBody'),
      [
        { text: t('admin.products.cancel'), style: 'cancel' },
        {
          text: t('admin.products.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await remove(item.id);
              onDone(t('admin.products.deleted', { name: item.name }), 'slate');
            } catch (error) {
              setProblem(problemOf(error, t('admin.products.deleteFailed')));
            }
          },
        },
      ],
    );
  };

  return (
    <Sheet
      visible
      title={
        adding
          ? t(straw ? 'admin.products.addBreed' : 'admin.products.addProduct')
          : t('admin.products.editTitle', { code: item.code })
      }
      subtitle={t('admin.products.editorMeta')}
      onClose={onClose}
      testID="admin-product-editor"
      footer={
        <View style={styles.sheetFoot}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={save}
            style={({ pressed }) => [
              styles.primary,
              styles.flex,
              busy && styles.off,
              pressed && styles.pressed,
            ]}
            testID="admin-product-save"
          >
            {busy ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Ionicons name="checkmark" size={18} color={colors.surface} />
            )}
            <AppText style={styles.primaryLabel}>{t('admin.products.save')}</AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            testID="admin-product-cancel"
          >
            <AppText style={styles.secondaryLabel}>{t('admin.products.cancel')}</AppText>
          </Pressable>
        </View>
      }
    >
      <View style={styles.sheetBody}>
        <View
          style={[styles.banner, { backgroundColor: look.wash, borderColor: look.border }]}
          testID="admin-product-banner"
        >
          <View style={[styles.bannerChip, { backgroundColor: look.solid }]}>
            <Ionicons name={adding ? 'add' : 'create'} size={16} color={look.onSolid} />
          </View>
          <AppText style={[styles.bannerText, { color: look.text }]}>
            {adding
              ? t('admin.products.addingNote')
              : t('admin.products.editingNote', { name: item.name })}
          </AppText>
        </View>

        <Field
          icon="barcode-outline"
          label={t('admin.products.code')}
          hint={
            adding
              ? t('admin.products.codeHintNew')
              : t(straw ? 'admin.products.codeHintBreed' : 'admin.products.codeHintProduct')
          }
        >
          <Input
            value={code}
            onChangeText={text => setCode(text.toUpperCase())}
            editable={adding}
            autoCapitalize="characters"
            maxLength={30}
            placeholder={straw ? 'SAHIWAL' : 'SHEATH'}
            testID="admin-product-code"
          />
        </Field>

        <Field
          icon="pricetag-outline"
          label={t('admin.products.name')}
          hint={t('admin.products.nameHint')}
        >
          <Input
            value={name}
            onChangeText={setName}
            maxLength={100}
            placeholder={straw ? 'Sahiwal' : 'AI sheaths'}
            testID="admin-product-name"
          />
        </Field>

        {/* A breed is not a catalogue row: no unit, no consumable/equipment split, and a
            second label. Fields that do not apply would only invite filling them. */}
        {straw ? (
          <>
            <Field
              icon="language-outline"
              label={t('admin.products.nameHi')}
              hint={t('admin.products.nameHiHint')}
            >
              <Input
                value={nameHi}
                onChangeText={setNameHi}
                maxLength={60}
                placeholder="साहीवाल"
                testID="admin-product-name-hi"
              />
            </Field>
            <Field
              icon="paw-outline"
              label={t('admin.products.animal')}
              hint={t('admin.products.animalHint')}
            >
              <View style={styles.choices}>
                {(['COW', 'BUFF'] as const).map(a => (
                  <Choice
                    key={a}
                    label={t(a === 'COW' ? 'admin.products.cow' : 'admin.products.buffalo')}
                    on={animal === a}
                    tone="yolk"
                    disabled={!adding}
                    onPress={() => setAnimal(a)}
                    testID={`admin-product-animal-${a}`}
                  />
                ))}
              </View>
            </Field>
          </>
        ) : (
          <>
            <Field
              icon="layers-outline"
              label={t('admin.products.kind')}
              hint={t('admin.products.kindHint')}
            >
              <View style={styles.choices}>
                <Choice
                  label={t('admin.products.kind_consumable')}
                  hint={t('admin.products.consumableHint')}
                  on={category === 'consumable'}
                  tone="green"
                  onPress={() => setCategory('consumable')}
                  testID="admin-product-category-consumable"
                />
                <Choice
                  label={t('admin.products.kind_asset')}
                  hint={t('admin.products.assetHint')}
                  on={category === 'asset'}
                  tone="blue"
                  onPress={() => setCategory('asset')}
                  testID="admin-product-category-asset"
                />
              </View>
            </Field>
            <Field
              icon="resize-outline"
              label={t('admin.products.unit')}
              hint={t('admin.products.unitHint')}
            >
              <Input
                value={unit}
                onChangeText={setUnit}
                maxLength={20}
                placeholder="piece"
                testID="admin-product-unit"
              />
              <View style={styles.units}>
                {UNITS.map(u => (
                  <Pressable
                    key={u}
                    accessibilityRole="button"
                    onPress={() => setUnit(u)}
                    style={[styles.unit, unit === u && styles.unitOn]}
                    testID={`admin-product-unit-${u}`}
                  >
                    <AppText style={[styles.unitLabel, unit === u && styles.unitLabelOn]}>
                      {u}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </Field>
          </>
        )}

        <View style={styles.pair}>
          <View style={styles.flex}>
            <Field
              icon="cash-outline"
              label={t('admin.products.rate')}
              hint={t('admin.products.rateHint')}
            >
              <Input
                value={rate}
                onChangeText={text => setRate(text.replace(/[^\d.]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                testID="admin-product-rate"
              />
            </Field>
          </View>
          <View style={styles.flex}>
            <Field
              icon="swap-vertical-outline"
              label={t('admin.products.order')}
              hint={t('admin.products.orderHint')}
            >
              <Input
                value={order}
                onChangeText={text => setOrder(text.replace(/[^\d]/g, ''))}
                keyboardType="number-pad"
                placeholder="0"
                testID="admin-product-order"
              />
            </Field>
          </View>
        </View>

        {!!problem && (
          <View style={styles.problem} testID="admin-product-problem">
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <AppText style={styles.problemText}>{problem}</AppText>
          </View>
        )}

        <AppText style={styles.hint}>
          {t(adding ? 'admin.products.hintAdd' : 'admin.products.hintEdit')}
        </AppText>

        {/* The other two decisions, each in its own weight. */}
        {!adding && (
          <View style={styles.others}>
            {item.is_active ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={retire}
                style={({ pressed }) => [styles.warnOutline, pressed && styles.pressed]}
                testID="admin-product-retire"
              >
                <Ionicons name="archive-outline" size={16} color={TONE.yolk.text} />
                <AppText style={[styles.outlineLabel, { color: TONE.yolk.text }]}>
                  {t('admin.products.retire')}
                </AppText>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={restore}
                style={({ pressed }) => [styles.goodOutline, pressed && styles.pressed]}
                testID="admin-product-restore"
              >
                <Ionicons name="refresh" size={16} color={TONE.green.text} />
                <AppText style={[styles.outlineLabel, { color: TONE.green.text }]}>
                  {t('admin.products.restore')}
                </AppText>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={destroy}
              style={({ pressed }) => [styles.dangerOutline, pressed && styles.pressed]}
              testID="admin-product-delete"
            >
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <AppText style={[styles.outlineLabel, { color: colors.error }]}>
                {t('admin.products.delete')}
              </AppText>
            </Pressable>
          </View>
        )}
      </View>
    </Sheet>
  );
}

// --------------------------------------------------------------------------------------
// The list
// --------------------------------------------------------------------------------------

function ProductCard({
  row,
  kind,
  onEdit,
}: {
  row: Row;
  kind: Kind;
  onEdit: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const kindLook = KIND_LOOK[kind];
  // A retired row is tinted red, the same as a blocked row on every other roster.
  const tone: ToneName = row.is_active ? kindLook.tone : 'red';
  const look = TONE[tone];
  const straw = kind === 'straw';
  const hasRate = priced(row.rate);

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-product-${row.code}`}
    >
      <View style={styles.cardTop}>
        <View style={[styles.disc, { backgroundColor: TONE[kindLook.tone].solid }]}>
          <Glyph name={kindLook.icon} size={18} color={TONE[kindLook.tone].onSolid} />
        </View>
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{row.name}</AppText>
          {/* The Hindi label is what a Mait actually reads with the toggle on. */}
          {straw && !!row.name_hi && <AppText style={styles.sub}>{row.name_hi}</AppText>}
          <View style={[styles.code, { borderColor: look.border }]}>
            <AppText style={[styles.codeLabel, { color: look.text }]}>{row.code}</AppText>
          </View>
        </View>
        <View style={styles.pills}>
          <Pill label={t(`admin.products.pill_${kind}`)} tone={kindLook.tone} />
          <Pill
            label={t(row.is_active ? 'admin.products.inUse' : 'admin.products.retiredPill')}
            tone={row.is_active ? 'green' : 'red'}
          />
        </View>
      </View>

      <View style={styles.inset}>
        <View style={[styles.factRow, styles.rule]}>
          <Ionicons name={straw ? 'paw-outline' : 'resize-outline'} size={14} color={colors.info} />
          <AppText style={styles.factLabel}>
            {t(straw ? 'admin.products.animal' : 'admin.products.unit')}
          </AppText>
          <AppText style={[styles.factValue, styles.flex]}>
            {straw
              ? t(row.animal_type === 'BUFF' ? 'admin.products.buffalo' : 'admin.products.cow')
              : row.unit || '—'}
          </AppText>
        </View>
        <View style={[styles.factRow, styles.rule]}>
          <Ionicons
            name="cash-outline"
            size={14}
            color={hasRate ? colors.primaryDark : TONE.yolk.text}
          />
          <AppText style={styles.factLabel}>{t('admin.products.rateShort')}</AppText>
          <View style={styles.flex}>
            {hasRate ? (
              <AppText style={styles.factValue} testID={`admin-product-rate-${row.code}`}>
                {rupees(row.rate)}
              </AppText>
            ) : (
              <View style={styles.unpriced} testID={`admin-product-rate-${row.code}`}>
                <AppText style={styles.unpricedLabel}>{t('admin.products.notPriced')}</AppText>
              </View>
            )}
          </View>
        </View>
        <View style={styles.factRow}>
          <Ionicons name="swap-vertical-outline" size={14} color={colors.textMuted} />
          <AppText style={styles.factLabel}>{t('admin.products.order')}</AppText>
          <AppText style={[styles.factValue, styles.flex]}>{row.display_order}</AppText>
        </View>
      </View>

      <View style={styles.cardFoot}>
        <Pressable
          accessibilityRole="button"
          onPress={onEdit}
          style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
          testID={`admin-product-edit-${row.code}`}
        >
          <Ionicons name="create-outline" size={15} color={colors.ink} />
          <AppText style={styles.editLabel}>{t('admin.products.edit')}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

export default function AdminProductsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>('consumable');
  const [term, setTerm] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: ToneName } | null>(null);

  const products = useAdminListProductsQuery();
  const breeds = useAdminListBreedsQuery();
  const source = kind === 'straw' ? breeds : products;

  const all: Row[] = useMemo(() => {
    if (kind === 'straw') {
      return (breeds.data ?? []) as AdminBreed[];
    }
    return ((products.data?.results ?? []) as ProductAdmin[]).filter(p => p.category === kind);
  }, [kind, breeds.data, products.data]);

  const counts: Record<Kind, number> = {
    consumable: (products.data?.results ?? []).filter(
      p => p.category === 'consumable' && (showRetired || p.is_active),
    ).length,
    asset: (products.data?.results ?? []).filter(
      p => p.category === 'asset' && (showRetired || p.is_active),
    ).length,
    straw: (breeds.data ?? []).filter(b => showRetired || b.is_active).length,
  };

  // Filtered on rows already fetched: both lists are a couple of dozen entries.
  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return all
      .filter(row => showRetired || row.is_active)
      .filter(
        row =>
          !needle ||
          row.code.toLowerCase().includes(needle) ||
          row.name.toLowerCase().includes(needle) ||
          (row.name_hi ?? '').includes(term.trim()),
      )
      .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name));
  }, [all, term, showRetired]);
  const unpriced = shown.filter(row => !priced(row.rate)).length;

  const pick = (next: Kind) => {
    setKind(next);
    setEditing(null);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={source.isFetching && !source.isLoading}
            onRefresh={() => source.refetch()}
          />
        }
        testID="admin-products"
      >
        <View style={styles.top}>
          <AppText style={styles.count} testID="admin-products-count">
            {source.data
              ? t('admin.products.shown', { n: shown.length }) +
                (unpriced ? ` · ${t('admin.products.unpricedCount', { n: unpriced })}` : '')
              : '—'}
          </AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setFlash(null);
              setEditing('new');
            }}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            testID="admin-products-add"
          >
            <Ionicons name="add" size={18} color={colors.surface} />
            <AppText style={styles.primaryLabel}>
              {t(kind === 'straw' ? 'admin.products.addBreed' : 'admin.products.addProduct')}
            </AppText>
          </Pressable>
        </View>

        {!!flash && (
          <Notice
            tone={flash.tone}
            icon={flash.tone === 'green' ? 'checkmark' : 'information'}
            title={flash.text}
            body=""
            testID="admin-products-flash"
          />
        )}

        {/* The three kinds, the pills the rest of the screen hangs from. */}
        <View style={styles.kinds} accessibilityRole="tablist">
          {KINDS.map(k => {
            const look = TONE[KIND_LOOK[k].tone];
            const on = k === kind;
            return (
              <Pressable
                key={k}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => pick(k)}
                style={[
                  styles.kind,
                  {
                    backgroundColor: on ? look.solid : look.wash,
                    borderColor: on ? look.solid : look.border,
                  },
                ]}
                testID={`admin-products-kind-${k}`}
              >
                <Glyph name={KIND_LOOK[k].icon} size={16} color={on ? look.onSolid : look.text} />
                <AppText style={[styles.kindLabel, { color: on ? look.onSolid : look.text }]}>
                  {t(`admin.products.kind_${k}`)}
                </AppText>
                <View
                  style={[styles.kindCount, { backgroundColor: on ? colors.surface : look.solid }]}
                >
                  <AppText
                    style={[styles.kindCountLabel, { color: on ? look.text : look.onSolid }]}
                  >
                    {counts[k]}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.info} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={setTerm}
            placeholder={t('admin.products.searchPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            testID="admin-products-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <View style={styles.filters}>
          <FilterChip
            label={t('admin.products.includeRetired')}
            icon="archive-outline"
            tone="slate"
            active={showRetired}
            onPress={() => setShowRetired(on => !on)}
            testID="admin-products-retired"
          />
        </View>

        {/* Why straws sit beside the rest, said where it matters. */}
        {kind === 'straw' && (
          <Notice
            tone="yolk"
            icon="information"
            title={t('admin.products.strawsTitle')}
            body={t('admin.products.strawsBody')}
            testID="admin-products-straws-note"
          />
        )}

        {source.isLoading ? (
          <SkeletonRows />
        ) : source.isError ? (
          <EmptyState message={t('admin.products.error')} />
        ) : shown.length === 0 ? (
          <EmptyState message={t(term.trim() ? 'admin.products.noMatch' : 'admin.products.none')} />
        ) : (
          shown.map(row => (
            <ProductCard
              key={`${kind}-${row.id}`}
              row={row}
              kind={kind}
              onEdit={() => {
                setFlash(null);
                setEditing(row);
              }}
            />
          ))
        )}
      </ScrollView>

      {editing !== null && (
        <Editor
          key={editing === 'new' ? `new-${kind}` : `${kind}-${editing.id}`}
          kind={kind}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(text, tone) => {
            setEditing(null);
            setFlash({ text, tone });
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  off: { opacity: 0.45 },
  sub: { ...typography.caption, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  rule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },

  top: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[3] },
  count: { ...typography.h3, color: colors.ink, flex: 1, minWidth: 140 },

  kinds: { flexDirection: 'row', gap: spacing[2] },
  kind: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing[2],
    paddingHorizontal: 4,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  kindLabel: { ...typography.label, textAlign: 'center' },
  kindCount: {
    minWidth: 24,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  kindCountLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },

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
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  disc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cardName: { ...typography.h3, color: colors.ink },
  code: {
    alignSelf: 'flex-start',
    marginTop: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  codeLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  pills: { alignItems: 'flex-end', gap: 4 },
  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 8 },
  factLabel: { ...typography.caption, color: colors.textMuted, width: 64 },
  factValue: { ...typography.label, color: colors.ink },
  unpriced: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: TONE.yolk.border,
    backgroundColor: TONE.yolk.wash,
  },
  unpricedLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: TONE.yolk.text,
  },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end' },
  // The portal's warn-toned Edit: a correction, not the screen's main act. Ink on yolk.
  edit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: TONE.yolk.solid,
  },
  editLabel: { ...typography.label, color: colors.ink },

  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 40,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryLabel: { ...typography.label, color: colors.surface },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  secondaryLabel: { ...typography.label, color: colors.ink },

  sheetBody: { gap: spacing[3] },
  sheetFoot: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  bannerChip: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerText: { ...typography.label, flex: 1 },
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
  choices: { flexDirection: 'row', gap: spacing[2] },
  choice: { flex: 1, gap: 2, padding: spacing[3], borderRadius: radius.md, borderWidth: 1.5 },
  choiceLabel: { ...typography.label },
  choiceHint: { ...typography.caption },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  unit: {
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  unitOn: { backgroundColor: colors.info },
  unitLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.info },
  unitLabelOn: { color: colors.surface },
  pair: { flexDirection: 'row', gap: spacing[3] },
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
  others: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  warnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: TONE.yolk.solid,
    backgroundColor: TONE.yolk.wash,
  },
  goodOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: TONE.green.wash,
  },
  dangerOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  outlineLabel: { ...typography.label },
});
