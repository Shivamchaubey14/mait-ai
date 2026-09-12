/**
 * The store keeper's shell.
 *
 * A keeper signs in on the same screen with the same OTP as a Mait and lands somewhere else
 * entirely: three tabs — *To issue*, *Store stock*, *Profile* — and one journey layered over
 * the first of them, from a row in the queue to the issue screen to the code. None of the
 * Mait's shell is mounted: no capture flow, no offline queue, no scope polling. A keeper's
 * work happens at a counter with a signal and is refused by the server if it is not theirs,
 * so there is nothing for a queue to hold and nothing for a scope to narrow.
 *
 * Kept a sibling of the Mait's navigator rather than a mode of it, for the reason `Shell`
 * gives for keeping login beside both: a navigator is a pile of state, and the keeper's must
 * not be one flag away from the Mait's.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { useGetStoreHomeQuery, useListStoreIndentsQuery } from '@api/endpoints';
import type { StoreHandover } from '@api/types';
import BottomNav, { STORE_TABS } from '@/components/BottomNav';
import type { StoreTab } from '@/components/BottomNav';
import { RouteTransitionHost, useRouteTransition } from '@/components/routeTransition';
import IssueScreen from '@/features/store/IssueScreen';
import IssuedScreen from '@/features/store/IssuedScreen';
import StoreHistoryScreen from '@/features/store/StoreHistoryScreen';
import type { HistoryWindow } from '@/features/store/StoreHistoryScreen';
import StoreProfileScreen from '@/features/store/StoreProfileScreen';
import StoreStockScreen from '@/features/store/StoreStockScreen';
import ToIssueScreen from '@/features/store/ToIssueScreen';
import type { RouteKey } from '@/navigation/routes';
import { useAppSelector } from '@/store';
import { colors } from '@theme/tokens';

/** The route each tab announces itself as. Profile is the Mait's `settings` key on the bar. */
const TAB_ROUTE: Record<StoreTab, RouteKey> = {
  toIssue: 'toIssue',
  storeStock: 'storeStock',
  storeHistory: 'storeHistory',
  settings: 'storeProfile',
};

/** Over the *To issue* tab: nothing, an indent being issued, or the handover just made. */
type Layer =
  | { kind: 'issue'; indentId: number }
  | { kind: 'issued'; handoverId: number; indentId: number; initial?: StoreHandover };

export default function StoreNavigator(): React.JSX.Element {
  const transition = useRouteTransition();
  const [tab, setTab] = useState<StoreTab>('toIssue');
  const [layer, setLayer] = useState<Layer | null>(null);
  /** Which window History opens on — today when reached from the *Issued today* tile. */
  const [historySpan, setHistorySpan] = useState<HistoryWindow>('week');

  const home = useGetStoreHomeQuery();
  const queue = useListStoreIndentsQuery();
  // The name from sign-in until the store's own answer lands, so the pill is never blank.
  const signedInAs = useAppSelector(state => state.auth.user?.storeName);
  const storeName = home.data?.store.name ?? signedInAs ?? '';

  const pendingTab =
    (Object.keys(TAB_ROUTE) as StoreTab[]).find(key => TAB_ROUTE[key] === transition.pending) ??
    null;

  /** Back always goes one layer down, and from a tab to *To issue* — then out of the app. */
  const goBack = useCallback((): boolean => {
    if (layer) {
      transition.back(() => setLayer(null));
      return true;
    }
    if (tab !== 'toIssue') {
      transition.back(() => setTab('toIssue'));
      return true;
    }
    return false;
  }, [layer, tab, transition]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => subscription.remove();
  }, [goBack]);

  /**
   * The next indent the shelf can do something about.
   *
   * *Next indent* on the handover screen is the keeper turning to the next Mait in the line,
   * so it opens the next one that can actually be handed over rather than the next in the list
   * — an indent the store has nothing for would be a screen with a dead button on it.
   */
  const openNext = (afterIndentId: number) => {
    const next = (queue.data ?? []).find(
      indent => indent.id !== afterIndentId && indent.readiness !== 'waiting',
    );
    if (next) {
      transition.go('storeIssue', () => {
        // The next Mait in the line is a *To issue* job, wherever the code was reopened from.
        setTab('toIssue');
        setLayer({ kind: 'issue', indentId: next.id });
      });
    } else {
      transition.back(() => setLayer(null));
    }
  };

  let screen: React.JSX.Element;
  if (layer?.kind === 'issued') {
    screen = (
      <IssuedScreen
        // Keyed on the handover so the next one opens with its own poll and its own state.
        key={layer.handoverId}
        handoverId={layer.handoverId}
        initial={layer.initial}
        storeName={storeName}
        onNext={() => openNext(layer.indentId)}
      />
    );
  } else if (layer?.kind === 'issue') {
    screen = (
      <IssueScreen
        key={layer.indentId}
        indentId={layer.indentId}
        onBack={() => transition.back(() => setLayer(null))}
        onIssued={handover =>
          setLayer({
            kind: 'issued',
            handoverId: handover.id,
            indentId: handover.indent_id,
            initial: handover,
          })
        }
        // A batch issued earlier and still waiting on the Mait's code, opened to read it out.
        onOpenHandover={handoverId =>
          transition.go('storeIssued', () =>
            setLayer({ kind: 'issued', handoverId, indentId: layer.indentId }),
          )
        }
      />
    );
  } else if (tab === 'storeStock') {
    screen = <StoreStockScreen storeName={storeName} />;
  } else if (tab === 'storeHistory') {
    screen = (
      <StoreHistoryScreen
        key={historySpan}
        storeName={storeName}
        initialWindow={historySpan}
        onOpenHandover={handover =>
          transition.go('storeIssued', () =>
            setLayer({
              kind: 'issued',
              handoverId: handover.id,
              indentId: handover.indent_id,
              initial: handover,
            }),
          )
        }
      />
    );
  } else if (tab === 'settings') {
    screen = <StoreProfileScreen />;
  } else {
    screen = (
      <ToIssueScreen
        storeName={storeName}
        onOpenHistory={() =>
          transition.go('storeHistory', () => {
            setHistorySpan('today');
            setTab('storeHistory');
          })
        }
        onOpenIndent={indent =>
          transition.go('storeIssue', () => setLayer({ kind: 'issue', indentId: indent.id }))
        }
        onOpenHandover={handover =>
          transition.go('storeIssued', () =>
            setLayer({
              kind: 'issued',
              handoverId: handover.id,
              indentId: handover.indent_id,
              initial: handover,
            }),
          )
        }
      />
    );
  }

  return (
    <View style={styles.flex}>
      <RouteTransitionHost transition={transition}>{screen}</RouteTransitionHost>
      <BottomNav<StoreTab>
        tabs={STORE_TABS}
        badgeOn="toIssue"
        // The queue's length, on the tab it lives on — what is waiting at the counter.
        pending={home.data?.waiting ?? 0}
        active={pendingTab ?? tab}
        onChange={next => {
          if (next === tab && !layer) {
            return;
          }
          transition.go(TAB_ROUTE[next], () => {
            if (next === 'storeHistory') {
              setHistorySpan('week');
            }
            setLayer(null);
            setTab(next);
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
});
