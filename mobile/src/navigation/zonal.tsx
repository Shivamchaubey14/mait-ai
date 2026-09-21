/**
 * The zonal manager's shell.
 *
 * A manager signs in on the same screen with the same OTP as a Mait and lands somewhere else
 * again: five tabs — *Zone*, *Indents*, *Stock*, *History*, *Profile* — and one journey
 * layered over the second, from a row in the queue to the decision and back. None of the
 * Mait's shell is mounted: no capture flow, no offline queue, no scope polling. A manager's
 * work is a decision taken against figures the server holds, and a decision queued on a
 * handset for an hour is a decision taken on figures that have since moved — which is the one
 * thing offline would be worse than useless for.
 *
 * **Zone leads, Indents follows**, because the first question somebody opens this app with is
 * whether their zone is working and the second is what is waiting on them. The second carries
 * a count on its tab, so it does not have to be the screen you land on to be noticed.
 *
 * Kept a sibling of the other two navigators rather than a mode of either, for the reason
 * `Shell` gives: a navigator is a pile of state, and none of the three should be one flag
 * away from another.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { useGetZonalHomeQuery } from '@api/endpoints';
import BottomNav, { ZONAL_TABS } from '@/components/BottomNav';
import type { ZonalTab } from '@/components/BottomNav';
import { RouteTransitionHost, useRouteTransition } from '@/components/routeTransition';
import AllEventsScreen from '@/features/zonal/AllEventsScreen';
import ApprovalScreen from '@/features/zonal/ApprovalScreen';
import DashboardScreen from '@/features/zonal/DashboardScreen';
import EventScreen from '@/features/zonal/EventScreen';
import HistoryScreen from '@/features/zonal/HistoryScreen';
import IndentsScreen from '@/features/zonal/IndentsScreen';
import ZonalProfileScreen from '@/features/zonal/ZonalProfileScreen';
import ZoneStockScreen from '@/features/zonal/ZoneStockScreen';
import { useLive, useRefreshOnForeground } from '@/features/zonal/live';
import type { IndentGroup } from '@/features/zonal/parts';
import type { RouteKey } from '@/navigation/routes';
import { useAppSelector } from '@/store';
import { colors } from '@theme/tokens';

/** The route each tab announces itself as. Profile is the Mait's `settings` key on the bar. */
const TAB_ROUTE: Record<ZonalTab, RouteKey> = {
  zonalHome: 'zonalHome',
  zonalIndents: 'zonalIndents',
  zoneStock: 'zoneStock',
  zonalHistory: 'zonalHistory',
  settings: 'zonalProfile',
};

export default function ZonalNavigator(): React.JSX.Element {
  const transition = useRouteTransition();
  const [tab, setTab] = useState<ZonalTab>('zonalHome');
  /** Over *Indents*: nothing, or one request — every item a Mait raised together — being decided. */
  const [open, setOpen] = useState<IndentGroup | null>(null);
  /**
   * Over *Zone*: one insemination, opened from the feed.
   *
   * Its own piece of state rather than a variant of `open`: they are layered over different
   * tabs and go back to different places, and one flag holding two journeys is how a back
   * press starts landing somewhere nobody asked for.
   */
  const [event, setEvent] = useState<number | null>(null);
  /**
   * Over *Profile*: the list of every event. An event opened from it lays over it in turn,
   * so back from the record lands on the list, and back again on Profile.
   */
  const [allEvents, setAllEvents] = useState(false);

  // The badge on Indents is live like every screen, and the whole app is marked stale the
  // moment it comes back to the front — see `features/zonal/live`.
  const home = useGetZonalHomeQuery(undefined, useLive());
  useRefreshOnForeground();
  // The zone from sign-in until the server's own answer lands, so the pill is never blank.
  const signedInAs = useAppSelector(state => state.auth.user?.zones ?? []);
  const zones = home.data?.manager.zones ?? signedInAs;
  // One line has room for one name. A manager holding several is rare and is better served by
  // a count than by a pill that truncates mid-word.
  const zoneName =
    zones.length === 1 ? (zones[0] ?? '') : zones.length ? `${zones.length} zones` : '';

  const pendingTab =
    (Object.keys(TAB_ROUTE) as ZonalTab[]).find(key => TAB_ROUTE[key] === transition.pending) ??
    null;

  /** Back closes whatever is layered, then returns to the first tab — then out of the app. */
  const goBack = useCallback((): boolean => {
    if (event !== null) {
      transition.back(() => setEvent(null));
      return true;
    }
    if (open) {
      transition.back(() => setOpen(null));
      return true;
    }
    if (allEvents) {
      transition.back(() => setAllEvents(false));
      return true;
    }
    if (tab !== 'zonalHome') {
      transition.back(() => setTab('zonalHome'));
      return true;
    }
    return false;
  }, [allEvents, event, open, tab, transition]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => subscription.remove();
  }, [goBack]);

  let screen: React.JSX.Element;
  if (event !== null) {
    screen = (
      <EventScreen
        // Keyed on the event so the next one opens with its own fetch and its own state.
        key={event}
        eventId={event}
        zoneName={zoneName}
      />
    );
  } else if (allEvents) {
    screen = (
      <AllEventsScreen
        zoneName={zoneName}
        onOpen={id => transition.go('zonalEvent', () => setEvent(id))}
      />
    );
  } else if (open) {
    screen = (
      <ApprovalScreen
        // Keyed on the request so the next one opens with its own state and its own refetch.
        key={open.key}
        group={open}
        zoneName={zoneName}
        onBack={() => transition.back(() => setOpen(null))}
        // Straight back to the queue. There is no *Decided* screen and there should not be:
        // a decision is the answer to the button just pressed, and the queue one row shorter
        // is the only confirmation worth showing somebody with three more to settle.
        onDecided={() => transition.back(() => setOpen(null))}
      />
    );
  } else if (tab === 'zonalIndents') {
    screen = (
      <IndentsScreen
        zoneName={zoneName}
        onOpen={group => transition.go('approval', () => setOpen(group))}
      />
    );
  } else if (tab === 'zoneStock') {
    screen = <ZoneStockScreen zoneName={zoneName} />;
  } else if (tab === 'zonalHistory') {
    screen = <HistoryScreen zoneName={zoneName} />;
  } else if (tab === 'settings') {
    screen = (
      <ZonalProfileScreen
        onOpenEvents={() => transition.go('zonalEvents', () => setAllEvents(true))}
      />
    );
  } else {
    screen = (
      <DashboardScreen
        zoneName={zoneName}
        onOpenEvent={id => transition.go('zonalEvent', () => setEvent(id))}
      />
    );
  }

  return (
    <View style={styles.flex}>
      <RouteTransitionHost transition={transition}>{screen}</RouteTransitionHost>
      <BottomNav<ZonalTab>
        tabs={ZONAL_TABS}
        badgeOn="zonalIndents"
        // What is waiting on this manager, on the tab it waits on.
        pending={home.data?.waiting ?? 0}
        active={pendingTab ?? tab}
        onChange={next => {
          if (next === tab && !open && event === null && !allEvents) {
            return;
          }
          transition.go(TAB_ROUTE[next], () => {
            setOpen(null);
            setEvent(null);
            setAllEvents(false);
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
