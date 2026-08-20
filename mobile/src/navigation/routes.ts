/**
 * What each destination is called, and what it holds.
 *
 * One table, read by the route transition card and by nothing else that hardcodes a name. The
 * requirement this exists to meet is that the card's title is routing data rather than a
 * string typed at the call site: a card that announces "Inventory" and lands on AI events is
 * worse than no card, because a Mait who mistapped now has two things to disbelieve.
 *
 * The shell in `navigation/index.tsx` is a state machine of `if`s rather than a stack of named
 * routes, so there is no router to ask. This is the closest thing the app has to one, and the
 * `RouteKey` union is deliberately the same vocabulary that machine already uses — `stock` is
 * the tab key, not the word "Inventory" a Mait reads, which comes out of `nav.*` like every
 * other label in the app.
 */

import type Ionicons from '@expo/vector-icons/Ionicons';

/** Every place the shell can put a Mait that is a *page* rather than a step or a sheet. */
export type RouteKey =
  | 'home'
  | 'stock'
  | 'history'
  | 'settings'
  | 'indents'
  | 'indentDetail'
  | 'aiEventDetail'
  | 'capture'
  | 'requestStock'
  | 'queue'
  | 'unfinished';

export interface RouteMeta {
  /** Ionicons, because that is the set this app draws. The spec's Lucide is not installed. */
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** i18n key for the destination's name. */
  title: string;
  /** i18n key for the one line under it — what a Mait will find when they arrive. */
  context: string;
}

export const ROUTES: Record<RouteKey, RouteMeta> = {
  home: { icon: 'home', title: 'nav.home', context: 'route.homeContext' },
  stock: { icon: 'cube', title: 'nav.stock', context: 'route.stockContext' },
  history: { icon: 'document-text', title: 'nav.history', context: 'route.historyContext' },
  settings: { icon: 'person', title: 'nav.settings', context: 'route.settingsContext' },
  indents: { icon: 'file-tray-full', title: 'indents.title', context: 'route.indentsContext' },
  indentDetail: { icon: 'file-tray-full', title: 'route.indent', context: 'route.indentContext' },
  aiEventDetail: { icon: 'document-text', title: 'route.aiEvent', context: 'route.aiEventContext' },
  capture: { icon: 'add', title: 'nav.newAi', context: 'route.captureContext' },
  // These three carry `route.*` names of their own rather than borrowing a screen's heading.
  // `unfinished.title` reads "Nothing here is lost", which is a reassurance to somebody
  // already on that screen and not the name of a place to be sent to.
  requestStock: { icon: 'cube', title: 'route.requestStock', context: 'route.requestStockContext' },
  queue: { icon: 'time', title: 'route.queue', context: 'route.queueContext' },
  unfinished: { icon: 'create', title: 'route.unfinished', context: 'route.unfinishedContext' },
};

/**
 * The destinations that announce themselves with a card.
 *
 * Exactly the three the brief names — a tab change, entering the capture flow, and opening a
 * record from a list row. Everything else the shell can show reaches its screen instantly,
 * which is the point: the card is there because a slow handset leaves a Mait staring at the
 * screen they just left, and it is noise anywhere that is already immediate.
 *
 * `indents` is deliberately not here. It is a list opened from a row on Profile, not a record
 * opened from a list, and the brief does not name it. Say the word and it is one line.
 */
const ANNOUNCED: readonly RouteKey[] = [
  'home',
  'stock',
  'history',
  'settings',
  'capture',
  'aiEventDetail',
  'indentDetail',
];

export function announces(key: RouteKey): boolean {
  return ANNOUNCED.includes(key);
}
