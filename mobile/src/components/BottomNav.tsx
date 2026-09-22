/**
 * The four places a Mait goes.
 *
 * Destinations only. The screen's action — "Start new AI", "Request stock" — used to float
 * above this bar as a pill; it now lives in the screen it belongs to, at the foot of that
 * screen's content. A control that changes its job depending on which tab is open, while
 * sitting in the furniture that never changes, is the one thing on screen that cannot be
 * learned once.
 *
 * The selected tab is a filled glyph and a green label; the rest are outlines in grey. The
 * shape carries it as well as the colour, because colour alone does not survive sunlight on a
 * cheap screen, which is where this is used.
 *
 * Hidden entirely during the capture flow: that flow is one task with one forward path, and a
 * tab bar under it is an invitation to leave halfway, with an animal served, a straw scanned
 * and nothing recorded.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

/**
 * The keys are the app's own names for these screens; the labels a Mait reads come from
 * `nav.*` in the translations — "stock" is shown as Inventory, "history" as AI events, and
 * "settings" as Profile.
 */
export type Tab = 'home' | 'stock' | 'requestStock' | 'history' | 'settings';

/**
 * A store keeper's three. Profile keeps the Mait's key, `settings`, because it is the same
 * place under the same name — who is signed in, the language, and the way out.
 */
export type StoreTab = 'toIssue' | 'storeStock' | 'storeHistory' | 'settings';

/**
 * A zonal manager's five.
 *
 * One more than the other two shells carry, and the extra one earns its place: a manager's
 * first question is *is my zone working* and their second is *what is waiting on me*, and
 * those are two screens, not one. Profile keeps the Mait's `settings` key again — it is the
 * same place under the same name, whoever is signed in.
 */
export type ZonalTab = 'zonalHome' | 'zonalIndents' | 'zoneStock' | 'zonalHistory' | 'settings';

export interface NavItem<T extends string> {
  key: T;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon: React.ComponentProps<typeof Ionicons>['name'];
}

const TABS: NavItem<Tab>[] = [
  { key: 'home', icon: 'home-outline', activeIcon: 'home' },
  { key: 'stock', icon: 'cube-outline', activeIcon: 'cube' },
  // Raising an indent is a tab of its own, beside the stock it restocks — it was a button at
  // the foot of Inventory, one screen deeper than the thing a Mait does every few days.
  { key: 'requestStock', icon: 'add-circle-outline', activeIcon: 'add-circle' },
  { key: 'history', icon: 'document-text-outline', activeIcon: 'document-text' },
  { key: 'settings', icon: 'person-outline', activeIcon: 'person' },
];

/** The box being handed over, the shopfront behind it, and the person at the counter. */
export const STORE_TABS: NavItem<StoreTab>[] = [
  { key: 'toIssue', icon: 'cube-outline', activeIcon: 'cube' },
  { key: 'storeStock', icon: 'storefront-outline', activeIcon: 'storefront' },
  // What went over the counter, and when. The same clock the Mait's AI events tab is not —
  // that one is a document — because this is a record of times, not of paperwork.
  { key: 'storeHistory', icon: 'time-outline', activeIcon: 'time' },
  { key: 'settings', icon: 'person-outline', activeIcon: 'person' },
];

/**
 * The zone, the paperwork, the goods, the record, and the person.
 *
 * *Indents* is a tray rather than a tick — the same glyph the Mait's own indent screens wear,
 * because it is the same object seen from the other side of the decision. The box beside it
 * is stock, which is where the goods actually are.
 */
export const ZONAL_TABS: NavItem<ZonalTab>[] = [
  { key: 'zonalHome', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { key: 'zonalIndents', icon: 'file-tray-full-outline', activeIcon: 'file-tray-full' },
  { key: 'zoneStock', icon: 'cube-outline', activeIcon: 'cube' },
  { key: 'zonalHistory', icon: 'time-outline', activeIcon: 'time' },
  { key: 'settings', icon: 'person-outline', activeIcon: 'person' },
];

export default function BottomNav<T extends string = Tab>({
  active,
  onChange,
  /** Unsent records. Rides on AI events, which is where they are waiting. */
  pending = 0,
  tabs = TABS as unknown as NavItem<T>[],
  /** Which tab carries the count. AI events for a Mait; *To issue* for a store keeper. */
  badgeOn = 'history' as T,
}: {
  active: T;
  onChange: (tab: T) => void;
  pending?: number;
  tabs?: NavItem<T>[];
  badgeOn?: T;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    // Floated clear of the screen's own edge rather than welded to it. Android draws its
    // back and home controls along the bottom on most of these handsets, and a bar sitting
    // flush under them puts the app's Home tab a few pixels from the system's — which on a
    // phone held one-handed in a yard is a mis-tap that leaves the capture flow.
    //
    // The inset is the gap, not padding inside the bar: the system reserves that space for
    // its own controls, so honouring it as a margin is what actually keeps the two apart.
    <View
      style={[
        styles.wrap,
        {
          // The extra unit is so there is still a lift on a handset with hardware keys below
          // the screen, where the inset is zero and the bar would otherwise sit flush again.
          paddingBottom: insets.bottom + spacing[3],
          // Added to the side gutter, not in place of it: a per-side padding overrides
          // `paddingHorizontal`, and in portrait these insets are zero, which welded the bar
          // to both edges of the screen.
          paddingLeft: insets.left + spacing[4],
          paddingRight: insets.right + spacing[4],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        {tabs.map(({ key, icon, activeIcon }) => {
          const isActive = key === active;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={t(`nav.${key}`)}
              onPress={() => onChange(key)}
              style={styles.tab}
              testID={`tab-${key}`}
            >
              <View>
                <Ionicons
                  name={isActive ? activeIcon : icon}
                  size={22}
                  color={isActive ? colors.primary : colors.textMuted}
                />

                {/* On AI events rather than Home: the count is of records waiting to sync, and
                  that is the screen a Mait goes to when they want to look at them. */}
                {key === badgeOn && pending > 0 && (
                  <View style={styles.badge} testID="nav-pending">
                    <Text style={styles.badgeLabel}>{pending > 9 ? '9+' : pending}</Text>
                  </View>
                )}
              </View>

              <Text
                style={[styles.label, isActive && styles.labelActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {t(`nav.${key}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Holds the gap. Transparent and `box-none`, so the space it reserves under the bar is the
  // system's to draw in and taps pass straight through it. Its side gutter — set inline, with
  // the insets — is the page body's, so the bar lines up with the search box and cards.
  wrap: {
    backgroundColor: 'transparent',
  },
  // A card now, not a band welded to the bottom edge: rounded on all four corners, with the
  // border all the way round rather than a rule across the top, so it reads as an object
  // floating over the page the way every other surface in this app does.
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    paddingHorizontal: spacing[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    // `card`, not `raised`. Raised is an 18pt drop built for a sheet rising over a page; on a
    // bar already sitting near the bottom edge it throws its shadow off the screen and reads
    // as a smudge. This is the same lift every other card in the app has.
    ...shadows.card,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: spacing[1],
    minHeight: MIN_TOUCH_TARGET,
  },
  // Two lines at most, and shrinking rather than truncating: with five tabs a Hindi label
  // like "स्वीकृतियाँ" has less room than its English twin, and an ellipsis in a tab bar is
  // a label that has stopped naming anything.
  label: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  labelActive: {
    color: colors.primary,
    fontFamily: typography.bodyStrong.fontFamily,
  },

  badge: {
    position: 'absolute',
    top: -6,
    left: 12,
    minWidth: 18,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.secondary,
    alignItems: 'center',
  },
  badgeLabel: { ...typography.caption, fontSize: 10, color: colors.ink },
});
