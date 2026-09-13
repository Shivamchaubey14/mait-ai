/**
 * Store stock — what is on the shelf, and a delivery onto it.
 *
 * Three numbers per item, because the shelf answers three different questions and the keeper
 * is asked all of them. *On hand* is what is physically there — what they count when somebody
 * from the office walks in. *Set aside* is issued to a Mait who has not typed their code yet:
 * still here, and not the keeper's to promise again. *Free to issue* is the difference, and it
 * is the only one the queue's *Ready* and *Short* are worked out from.
 *
 * Deliveries are recorded here, by the keeper, because they are the one who counts the boxes
 * off the van. It is the only way stock enters a store, and it goes through the same ledger
 * every handover comes out of, so the count on this screen is those rows added up.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { newClientUuid } from '@api/client';
import {
  useGetStoreCatalogueQuery,
  useGetStoreStockQuery,
  useReceiveStoreStockMutation,
} from '@api/endpoints';
import type { StoreStockLine } from '@api/types';
import { Sheet } from '@/components/BottomSheet';
import Problem, { useOnline } from '@/components/problem';
import { EmptyState, SkeletonList } from '@/components/states';
import { Toast } from '@/components/toast';
import { Segmented } from '@/features/aiFlow/components';
import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

import { itemLabel, StoreAction, StoreHero, storeStyles, Stepper } from './parts';

type Kind = 'straw' | 'consumable';

/**
 * Record what came off the van.
 *
 * A breed or a product, how many, and a note for the challan number. The key is minted when
 * the sheet opens rather than when *Add* is pressed, so a delivery recorded over a store's one
 * bar of signal — tapped twice because the first seemed to do nothing — is counted once.
 */
function ReceiveSheet({
  visible,
  onClose,
  onReceived,
}: {
  visible: boolean;
  onClose: () => void;
  onReceived: (message: string) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const catalogue = useGetStoreCatalogueQuery(undefined, { skip: !visible });
  const [receive, receiving] = useReceiveStoreStockMutation();

  const [kind, setKind] = useState<Kind>('straw');
  const [picked, setPicked] = useState<string | null>(null);
  const [qty, setQty] = useState(10);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [key, setKey] = useState(newClientUuid);

  const hindi = i18n.language.startsWith('hi');
  const options = useMemo(() => {
    if (kind === 'straw') {
      return (catalogue.data?.breeds ?? []).map(breed => ({
        value: breed.code,
        label: (hindi && breed.name_hi) || breed.name,
      }));
    }
    return (catalogue.data?.products ?? [])
      .filter(product => product.category === 'consumable')
      .map(product => ({ value: String(product.id), label: product.name }));
  }, [catalogue.data, kind, hindi]);

  const label = options.find(option => option.value === picked)?.label ?? '';

  const reset = () => {
    setPicked(null);
    setQty(10);
    setNote('');
    setProblem(null);
    setKey(newClientUuid());
  };

  const save = async () => {
    if (!picked) {
      return;
    }
    setProblem(null);
    try {
      await receive({
        client_uuid: key,
        product_type: kind,
        ...(kind === 'straw' ? { breed: picked } : { product_ref_id: Number(picked) }),
        qty,
        note: note.trim() || undefined,
      }).unwrap();
      onReceived(t('store.received', { qty, item: label }));
      reset();
      onClose();
    } catch (err) {
      const detail = (err as { data?: { detail?: string } })?.data?.detail;
      setProblem(detail && detail !== 'Validation failed' ? detail : t('store.receiveFailed'));
    }
  };

  return (
    <Sheet
      visible={visible}
      title={t('store.record')}
      onClose={onClose}
      testID="receive-sheet"
      footer={
        <View style={styles.sheetFooter}>
          {!!problem && <Text style={styles.sheetProblem}>{problem}</Text>}
          <StoreAction
            label={picked ? t('store.receiveCta', { qty }) : t('store.receiveCtaPick')}
            icon={picked ? 'add' : undefined}
            onPress={save}
            disabled={!picked || qty < 1}
            busy={receiving.isLoading}
            testID="receive-save"
          />
        </View>
      }
    >
      <Segmented<Kind>
        options={[
          { value: 'straw', label: t('store.straws') },
          { value: 'consumable', label: t('store.consumables') },
        ]}
        value={kind}
        onChange={next => {
          setKind(next);
          setPicked(null);
        }}
        testID="receive-kind"
      />

      <Text style={styles.sheetLabel}>
        {kind === 'straw' ? t('store.breed') : t('store.product')}
      </Text>
      <View style={styles.chips}>
        {catalogue.isLoading ? (
          <SkeletonList rows={1} />
        ) : (
          options.map(option => {
            const on = option.value === picked;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setPicked(option.value)}
                style={[styles.chip, on && styles.chipOn]}
                testID={`receive-item-${option.value}`}
              >
                <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{option.label}</Text>
              </Pressable>
            );
          })
        )}
      </View>

      <View style={styles.qtyRow}>
        <Text style={[styles.sheetLabel, styles.qtyLabel]}>{t('store.qtyArrived')}</Text>
        <Stepper value={qty} min={1} max={100000} onChange={setQty} testID="receive-qty" />
      </View>
      {/* Tens as well as ones, because deliveries come in canisters of fifty and a stepper
          that only counts in ones is fifty taps. */}
      <View style={styles.jumps}>
        {[10, 25, 50, 100].map(step => (
          <Pressable
            key={step}
            accessibilityRole="button"
            onPress={() => setQty(step)}
            style={[styles.jump, qty === step && styles.chipOn]}
            testID={`receive-qty-${step}`}
          >
            <Text style={[styles.chipLabel, qty === step && styles.chipLabelOn]}>{step}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sheetLabel}>{t('store.note')}</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t('store.notePlaceholder')}
        placeholderTextColor={colors.textMuted}
        maxLength={255}
        style={styles.noteInput}
        testID="receive-note"
      />
    </Sheet>
  );
}

function StockRow({ line }: { line: StoreStockLine }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const key = line.breed || String(line.product_ref_id);
  return (
    <View style={styles.row} testID={`stock-line-${key}`}>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{itemLabel(line, i18n.language)}</Text>
        <Text style={styles.rowMeta}>
          {line.set_aside > 0
            ? `${t('store.setAside', { count: line.set_aside })} · ${t('store.freeToIssue', {
                count: line.available,
              })}`
            : t('store.freeToIssue', { count: line.available })}
        </Text>
      </View>
      <View style={styles.rowFigure}>
        <Text style={styles.rowValue}>{line.on_hand}</Text>
        <Text style={styles.rowUnit}>{t('store.onHand')}</Text>
      </View>
    </View>
  );
}

export default function StoreStockScreen({ storeName }: { storeName: string }): React.JSX.Element {
  const { t } = useTranslation();
  const online = useOnline();
  const stock = useGetStoreStockQuery();
  const [receiving, setReceiving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const lines = stock.data ?? [];

  return (
    <View style={storeStyles.root}>
      <Toast message={notice} tone="info" onDismiss={() => setNotice(null)} testID="stock-notice" />
      <StoreHero
        eyebrow={t('store.stockEyebrow')}
        title={storeName}
        subtitle={
          lines.length
            ? t('store.stockSubtitle', { count: lines.length })
            : t('store.stockEmptySubtitle')
        }
        testID="stock-hero"
      />

      <ScrollView
        contentContainerStyle={storeStyles.body}
        refreshControl={
          <RefreshControl
            refreshing={stock.isFetching && !stock.isLoading}
            onRefresh={stock.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {stock.isLoading ? (
          <SkeletonList rows={4} />
        ) : stock.isError ? (
          <Problem
            kind={online ? 'server' : 'offline'}
            onRetry={() => stock.refetch()}
            busy={stock.isFetching}
            testID="stock-error"
          />
        ) : lines.length ? (
          lines.map(line => (
            <StockRow
              key={`${line.product_type}-${line.breed}-${line.product_ref_id}`}
              line={line}
            />
          ))
        ) : (
          <EmptyState title={t('store.stockEmptyTitle')} body={t('store.stockEmptyBody')} />
        )}
      </ScrollView>

      <View style={storeStyles.footer}>
        <StoreAction
          label={t('store.record')}
          icon="add"
          onPress={() => setReceiving(true)}
          testID="stock-record"
        />
      </View>

      <ReceiveSheet
        visible={receiving}
        onClose={() => setReceiving(false)}
        onReceived={setNotice}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.h3, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowFigure: { alignItems: 'flex-end' },
  rowValue: { ...typography.h1, color: colors.ink },
  rowUnit: { ...typography.caption, color: colors.textMuted },

  sheetLabel: {
    ...typography.label,
    color: colors.text,
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    minHeight: MIN_TOUCH_TARGET - 8,
    paddingHorizontal: spacing[4],
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  chipLabel: { ...typography.label, color: colors.textMuted },
  chipLabelOn: { color: colors.primaryDark },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[2] },
  qtyLabel: { flex: 1, marginTop: 0, marginBottom: 0 },
  jumps: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] },
  jump: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  noteInput: {
    ...typography.body,
    color: colors.ink,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sheetFooter: { paddingHorizontal: spacing[5], paddingTop: spacing[3], gap: spacing[2] },
  sheetProblem: { ...typography.caption, color: colors.error },
});
