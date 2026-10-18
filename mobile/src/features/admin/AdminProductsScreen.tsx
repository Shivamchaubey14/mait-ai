/**
 * Products, for an admin — the consumables and equipment catalogue, with recovery rates.
 *
 * Read-only here: the catalogue is what indents, uploads and the app all key on, so editing a
 * code or a rate is a deliberate desk action that belongs on the portal and a later round. What
 * the handset answers is "what does the dairy issue, and what does it recover for each" — the
 * rate beside the name, an unpriced item called out rather than read as free.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminListProductsQuery } from '@api/endpoints';
import { EmptyState, Loading } from '@/components';
import { colors, ink, radius, spacing, typography } from '@theme/tokens';

import { adminStyles } from './common';

export default function AdminProductsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const data = useAdminListProductsQuery();
  const rows = [...(data.data?.results ?? [])].sort((a, b) => a.display_order - b.display_order);

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={adminStyles.body}>
        {data.isLoading ? (
          <Loading />
        ) : data.isError ? (
          <EmptyState message={t('admin.products.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.products.none')} />
        ) : (
          rows.map(product => {
            const priced = Number(product.rate) > 0;
            return (
              <View
                key={product.id}
                style={[adminStyles.row, !product.is_active && styles.inactive]}
                testID={`admin-product-${product.code}`}
              >
                <View style={adminStyles.rowChip}>
                  <Ionicons
                    name={product.category === 'asset' ? 'build' : 'cube'}
                    size={18}
                    color={colors.info}
                  />
                </View>
                <View style={adminStyles.rowBody}>
                  <Text style={adminStyles.rowName} numberOfLines={1}>
                    {product.name}
                    {!product.is_active ? ` · ${t('admin.products.inactive')}` : ''}
                  </Text>
                  <Text style={adminStyles.rowMeta} numberOfLines={1}>
                    {[product.code, product.unit].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={[styles.rate, priced ? styles.ratePriced : styles.rateUnpriced]}>
                  <Text style={[styles.rateLabel, { color: priced ? colors.primaryDark : ink[500] }]}>
                    {priced ? `₹ ${product.rate}` : t('admin.products.unpriced')}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  inactive: { opacity: 0.6 },
  rate: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  ratePriced: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  rateUnpriced: { backgroundColor: ink[50], borderColor: ink[200] },
  rateLabel: { ...typography.label },
});
