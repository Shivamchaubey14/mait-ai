/**
 * The admin app's sections — the portal's sidebar, on a handset.
 *
 * The same list, in the same order, as the browser's aside (`admin-web/assets/js/shell.js`):
 * an admin who knows the portal should find the drawer reads the same way. Labels are kept in
 * English here as they are there — the portal is an English surface and these are the words an
 * office account already navigates by, so they are not translated like the Mait-facing screens.
 *
 * `built` marks the sections that have a screen on the handset yet. The rest are shown in the
 * drawer so the whole surface is visible and findable, and open a short "coming soon" note —
 * they arrive in later rounds (AI events and Members are the first).
 */

import type { ComponentProps } from 'react';
import type Ionicons from '@expo/vector-icons/Ionicons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export interface AdminSection {
  key: string;
  label: string;
  icon: IoniconName;
  /** A handset screen exists for it. Unbuilt sections open a placeholder. */
  built?: boolean;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'speedometer' },
  { key: 'uploads', label: 'SAP upload', icon: 'cloud-upload' },
  { key: 'ai-events', label: 'AI events', icon: 'document-text', built: true },
  { key: 'maits', label: 'Maits', icon: 'people', built: true },
  { key: 'mpps', label: 'MPPs', icon: 'location', built: true },
  { key: 'assignments', label: 'Assignment', icon: 'git-branch' },
  { key: 'members', label: 'Members', icon: 'person', built: true },
  { key: 'non-members', label: 'Non-members', icon: 'person-add', built: true },
  { key: 'inventory', label: 'Inventory', icon: 'cube', built: true },
  { key: 'products', label: 'Products', icon: 'pricetags', built: true },
  { key: 'rates', label: 'Rates', icon: 'cash' },
  { key: 'indents', label: 'Indents', icon: 'clipboard', built: true },
  { key: 'stores', label: 'Stores', icon: 'storefront', built: true },
  { key: 'leaderboard', label: 'Leaderboard', icon: 'trophy' },
  { key: 'pregnancy', label: 'Pregnancy', icon: 'heart' },
  { key: 'exceptions', label: 'Exceptions', icon: 'alert-circle' },
  { key: 'reports', label: 'Reports', icon: 'bar-chart' },
  { key: 'mait-payment', label: 'Mait payment', icon: 'wallet' },
  { key: 'users', label: 'Users & roles', icon: 'shield-checkmark' },
  { key: 'super-otp', label: 'Super OTP', icon: 'key' },
  { key: 'zones', label: 'Zones', icon: 'map' },
  { key: 'logs', label: 'Audit log', icon: 'list' },
];

/** The section the admin app opens on. AI events is the first built screen (Round 2). */
export const ADMIN_HOME = 'ai-events';

const FALLBACK: AdminSection = { key: 'ai-events', label: 'AI events', icon: 'document-text', built: true };

export function sectionFor(key: string): AdminSection {
  return ADMIN_SECTIONS.find(section => section.key === key) ?? ADMIN_SECTIONS[0] ?? FALLBACK;
}
