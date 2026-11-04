/**
 * Users & roles, for an admin — the portal's `users.html` (W11) on a handset.
 *
 * Office accounts only. A Mait is never created here: they are activated from their SAP record
 * on the Maits screen, so every field login traces back to a real person on the roster. Nobody
 * is deleted either — a deleted user takes the audit trail's actor with them — so the one thing
 * done *to* an account is switching its sign-in off and on again.
 *
 * The portal's nine-column table becomes one card per account, every column kept: the name
 * (which opens their details), the username (which opens their sign-in), the role, the pages
 * they open, how much of the network they see, when they last signed in, and whether they can.
 * As on the portal, the thing you want to change is the control — tapping the pages count opens
 * the pages, tapping the zones opens the zones — and the button at the foot is the one action.
 *
 * Four editors, one at a time, each opened from its own field and saving only that: pages, zone
 * and number, details, and sign-in. They are decided by different people on different days, so
 * sharing a save would make one an accident of another. Each sends only what moved — a number
 * nobody touched is never written back, because on a zonal manager it is their sign-in.
 *
 * Ticking accounts brings up the bulk bar: activate, deactivate, and the fixed login code on or
 * off, each counted and offered only when it would change something. There is no bulk endpoint,
 * so it fans out the same PATCH a row uses, four at a time, and every account leaves its own
 * audit entry. Your own account cannot be ticked — switching yourself off in a Select all is the
 * one change on this screen that this screen cannot undo.
 *
 * Colours: a deactivated account is red, one signing in with the fixed code is yellow (a bypass
 * should be seen and turned off), the rest green.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { Banner, EmptyState } from '@/components';
import { SkeletonRows } from '@/components/skeleton';
import { initials } from '@/components/frame';
import { useRevealOnFocus } from '@/features/aiFlow/components';
import {
  useAdminCreateUserMutation,
  useAdminListUsersQuery,
  useAdminListZonesQuery,
  useAdminPortalSectionsQuery,
  useAdminUpdateUserMutation,
} from '@api/endpoints';
import type { AdminUser, AdminUserCreate, AdminUserPatch, Zone } from '@api/types';
import { useAppSelector } from '@/store';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { Disc, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';
import { useDebounced } from './common';
import { ADMIN_SECTIONS, sectionName, type AdminSection } from './sections';

const LIMIT = 25;

/** Four in flight: forty at once is a load test against the office's own server. */
const BULK_PARALLEL = 4;

const ROLES = ['super_admin', 'admin', 'normal_user', 'mait'] as const;
type RoleFilter = '' | (typeof ROLES)[number];

/** The office roles whose access is a list of pages. A Super Admin reaches all of them by role. */
function sectionScoped(user: AdminUser): boolean {
  return user.role === 'admin' || user.role === 'normal_user';
}

const ROLE_TONE: Record<string, ToneName> = {
  super_admin: 'blue',
  admin: 'green',
  normal_user: 'slate',
  mait: 'slate',
};

/** Red for a login switched off, yellow for one signing in past the OTP, green otherwise. */
export function toneOfUser(user: AdminUser): ToneName {
  if (!user.is_active) {
    return 'red';
  }
  return user.fixed_otp_enabled ? 'yolk' : 'green';
}

/** A ten-digit Indian mobile number, starting 6 to 9 — what the server's own check is. */
export const MOBILE = /^[6-9]\d{9}$/;

/** Every message a refusal carries, field errors included, so the right box gets fixed. */
export function problemLines(error: unknown, fallback: string): string[] {
  const data = (error as { data?: unknown })?.data;
  const lines: string[] = [];
  if (data && typeof data === 'object') {
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        lines.push(...value.map(String));
      } else if (typeof value === 'string') {
        lines.push(value);
      }
    }
  }
  return lines.length ? lines : [fallback];
}

function stamp(t: TFunction, iso: string | null): string {
  if (!iso) {
    return t('admin.users.never');
  }
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `12 of 22`, or the two ends of it said in words. */
function countLabel(t: TFunction, chosen: number, total: number): string {
  if (!chosen) {
    return t('admin.users.countNone');
  }
  if (chosen >= total) {
    return t('admin.users.countAll', { total });
  }
  return t('admin.users.countOf', { n: chosen, total });
}

function roleLabel(t: TFunction, role: string, fallback?: string): string {
  return t(`admin.users.role_${role}`, { defaultValue: fallback ?? role });
}

/**
 * The sidebar, as a thing that can be handed out. Names and glyphs are the rail's own; the
 * server's catalogue decides which keys are real, so one it has never heard of is never offered.
 */
function useCatalogue(): AdminSection[] {
  const served = useAdminPortalSectionsQuery();
  return useMemo(() => {
    const known = new Set((served.data?.results ?? []).map(s => s.key));
    return known.size ? ADMIN_SECTIONS.filter(s => known.has(s.key)) : ADMIN_SECTIONS;
  }, [served.data]);
}

// --------------------------------------------------------------------------------------
// Small parts
// --------------------------------------------------------------------------------------

export function Tick({ on, tone = 'green' }: { on: boolean; tone?: ToneName }): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[
        styles.tick,
        on
          ? { backgroundColor: look.solid, borderColor: look.solid }
          : { backgroundColor: colors.surface, borderColor: ink[300] },
      ]}
    >
      {on && <Ionicons name="checkmark" size={14} color={look.onSolid} />}
    </View>
  );
}

/** One labelled line of an account card; a chevron when tapping it opens an editor. */
export function Fact({
  icon,
  label,
  children,
  onPress,
  testID,
}: {
  icon: string;
  label: string;
  children: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}): React.JSX.Element {
  const body = (
    <>
      <Ionicons name={icon as never} size={15} color={colors.textMuted} />
      <AppText style={styles.factLabel}>{label}</AppText>
      <View style={styles.factValue}>{children}</View>
      {onPress && <Ionicons name="chevron-forward" size={15} color={colors.info} />}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.fact} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.fact, pressed && styles.pressed]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  hintTone,
  children,
  hintTestID,
}: {
  label: string;
  hint?: string;
  hintTone?: ToneName;
  children: React.ReactNode;
  hintTestID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel}>{label}</AppText>
      {children}
      {!!hint && (
        <AppText
          style={[styles.hint, hintTone && { color: TONE[hintTone].text }]}
          testID={hintTestID}
        >
          {hint}
        </AppText>
      )}
    </View>
  );
}

export function Input(
  props: React.ComponentProps<typeof TextInput> & { onReveal?: () => void },
): React.JSX.Element {
  const { onReveal, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={colors.textDisabled}
      autoCorrect={false}
      autoCapitalize="none"
      onFocus={onReveal}
      {...rest}
      style={[styles.input, rest.style]}
    />
  );
}

function Choice({
  label,
  on,
  onPress,
  testID,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  testID?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, on && styles.choiceOn, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons
        name={on ? 'radio-button-on' : 'radio-button-off'}
        size={16}
        color={on ? colors.surface : colors.info}
      />
      <AppText style={[styles.choiceLabel, on && { color: colors.surface }]}>{label}</AppText>
    </Pressable>
  );
}

export function Button({
  label,
  icon,
  tone,
  outline,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  icon: string;
  tone: ToneName | 'ink';
  outline?: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}): React.JSX.Element {
  const solid = tone === 'ink' ? colors.ink : TONE[tone].solid;
  const onSolid = tone === 'ink' ? colors.surface : TONE[tone].onSolid;
  const text = tone === 'ink' ? colors.ink : TONE[tone].text;
  const fore = outline ? text : onSolid;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        outline
          ? {
              backgroundColor: tone === 'ink' ? colors.surface : TONE[tone].wash,
              borderColor: tone === 'ink' ? ink[300] : TONE[tone].border,
            }
          : { backgroundColor: solid, borderColor: solid },
        disabled && styles.off,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Ionicons name={icon as never} size={15} color={fore} />
      <AppText style={[styles.buttonLabel, { color: fore }]}>{label}</AppText>
    </Pressable>
  );
}

/** A section a page can be ticked for, with the rail's glyph beside its name. */
function AccessGrid({
  catalogue,
  chosen,
  onToggle,
  prefix,
}: {
  catalogue: AdminSection[];
  chosen: string[];
  onToggle: (key: string) => void;
  prefix: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.grid}>
      {catalogue.map(section => {
        const on = chosen.includes(section.key);
        return (
          <Pressable
            key={section.key}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => onToggle(section.key)}
            style={({ pressed }) => [
              styles.gridItem,
              on && { backgroundColor: TONE.green.wash, borderColor: TONE.green.border },
              pressed && styles.pressed,
            ]}
            testID={`${prefix}-${section.key}`}
          >
            <Ionicons name={section.icon} size={15} color={on ? TONE.green.text : ink[400]} />
            <AppText style={[styles.gridLabel, on && { color: TONE.green.text }]} numberOfLines={1}>
              {sectionName(t, section)}
            </AppText>
            <Tick on={on} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Ticked keys put back into sidebar order, whatever order they were tapped in. */
function inOrder(catalogue: AdminSection[], keys: string[]): string[] {
  return catalogue.map(s => s.key).filter(k => keys.includes(k));
}

function toggled(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key];
}

// --------------------------------------------------------------------------------------
// The editors
// --------------------------------------------------------------------------------------

/**
 * The frame every editor shares: whose account is open, the fields, and a save that says what
 * it is saving. Back, the hardware button and Cancel all close it without writing.
 */
export function EditorFrame({
  user,
  title,
  icon,
  tone,
  saveLabel,
  saving,
  onSave,
  onClose,
  status,
  children,
  scroll,
  backLabel,
  footer,
  testID = 'admin-user-editor',
}: {
  user: AdminUser | null;
  title: string;
  icon: string;
  tone: ToneName;
  saveLabel: string;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  status: string | null;
  children: React.ReactNode;
  scroll: ReturnType<typeof useRevealOnFocus>;
  /** What Back returns to. Defaults to the account list. */
  backLabel?: string;
  /** Below Save and Cancel — where a destructive action lives, apart from the save. */
  footer?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const look = TONE[tone];

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    <View style={styles.root} testID={testID}>
      <ScrollView
        ref={scroll.scroller}
        innerViewRef={scroll.content}
        contentContainerStyle={[
          styles.body,
          !!scroll.overlap && { paddingBottom: scroll.overlap + spacing[4] },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          testID={`${testID}-back`}
        >
          <Ionicons name="arrow-back" size={16} color={colors.surface} />
          <AppText style={styles.backLabel}>{backLabel ?? t('admin.users.allAccounts')}</AppText>
        </Pressable>

        <View style={[styles.editor, { backgroundColor: look.wash, borderColor: look.border }]}>
          <View style={styles.row}>
            <Disc tone={tone} icon={icon} size={34} />
            <AppText style={[styles.editorTitle, { color: look.text }]}>{title}</AppText>
          </View>

          {user && (
            <View style={styles.who}>
              <Disc tone={toneOfUser(user)} text={initials(user.full_name || user.username)} />
              <View style={styles.flex}>
                <AppText style={styles.name}>{user.full_name || user.username}</AppText>
                <AppText style={styles.hint}>{user.username}</AppText>
              </View>
              <Pill
                label={roleLabel(t, user.role, user.role_display)}
                tone={ROLE_TONE[user.role] ?? 'slate'}
              />
            </View>
          )}

          {children}

          {!!status && <Banner tone="error" message={status} testID={`${testID}-status`} />}

          <View style={styles.actions}>
            <View style={styles.flex}>
              <Button
                label={t(saving ? 'admin.users.saving' : saveLabel)}
                icon="checkmark"
                tone={tone === 'yolk' ? 'green' : tone}
                onPress={onSave}
                disabled={saving}
                testID={`${testID}-save`}
              />
            </View>
            <Button
              label={t('admin.users.cancel')}
              icon="close"
              tone="ink"
              outline
              onPress={onClose}
              testID={`${testID}-cancel`}
            />
          </View>
          {footer}
        </View>
      </ScrollView>
    </View>
  );
}

/** Which pages an Admin or Normal User opens — the whole sidebar they will see. */
function AccessEditor({
  user,
  catalogue,
  onSaved,
  onClose,
}: {
  user: AdminUser;
  catalogue: AdminSection[];
  onSaved: (user: AdminUser) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const scroll = useRevealOnFocus();
  const [update, saving] = useAdminUpdateUserMutation();
  const before = user.portal_sections ?? [];
  const [chosen, setChosen] = useState<string[]>(inOrder(catalogue, before));
  const [status, setStatus] = useState<string | null>(null);

  // Named rather than counted: "removing Rates" is a sentence somebody can check before saving.
  const added = catalogue.filter(s => !before.includes(s.key) && chosen.includes(s.key));
  const removed = catalogue.filter(s => before.includes(s.key) && !chosen.includes(s.key));
  const parts: string[] = [];
  if (added.length) {
    parts.push(t('admin.users.adding', { list: added.map(s => sectionName(t, s)).join(', ') }));
  }
  if (removed.length) {
    parts.push(t('admin.users.removing', { list: removed.map(s => sectionName(t, s)).join(', ') }));
  }
  if (!chosen.length) {
    parts.push(t('admin.users.emptySidebar'));
  }
  const warn = !chosen.length || removed.length > 0;

  const save = async () => {
    setStatus(null);
    try {
      const saved = await update({
        id: user.id,
        body: { portal_sections: inOrder(catalogue, chosen) },
      }).unwrap();
      onSaved(saved);
    } catch (error) {
      setStatus(problemLines(error, t('admin.users.saveFailed')).join(' · '));
    }
  };

  return (
    <EditorFrame
      user={user}
      title={t('admin.users.accessTitle')}
      icon="grid"
      tone="green"
      saveLabel="admin.users.saveAccess"
      saving={saving.isLoading}
      onSave={save}
      onClose={onClose}
      status={status}
      scroll={scroll}
    >
      <View style={styles.row}>
        <AppText style={[styles.fieldLabel, styles.flex]}>
          {t('admin.users.pagesInSidebar')}
        </AppText>
        <AppText style={styles.count} testID="admin-access-count">
          {countLabel(t, chosen.length, catalogue.length)}
        </AppText>
      </View>
      <View style={styles.row}>
        <Button
          label={t('admin.users.selectAll')}
          icon="checkmark-done"
          tone="green"
          outline
          onPress={() => setChosen(catalogue.map(s => s.key))}
          testID="admin-access-all"
        />
        <Button
          label={t('admin.users.clear')}
          icon="remove-circle-outline"
          tone="ink"
          outline
          onPress={() => setChosen([])}
          testID="admin-access-none"
        />
      </View>
      <AccessGrid
        catalogue={catalogue}
        chosen={chosen}
        onToggle={key => setChosen(c => toggled(c, key))}
        prefix="admin-access"
      />
      <AppText style={[styles.hint, warn && { color: TONE.yolk.text }]} testID="admin-access-diff">
        {parts.length ? parts.join(' · ') : t('admin.users.nothingChanged')}
      </AppText>
    </EditorFrame>
  );
}

/**
 * How much of the network an office account sees, and the number that opens the app for it.
 * Saved together because they are decided together: a zone makes somebody a zonal manager, and
 * a zonal manager signs in on their phone.
 */
function ZoneEditor({
  user,
  zones,
  onSaved,
  onClose,
}: {
  user: AdminUser;
  zones: Zone[];
  onSaved: (user: AdminUser) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const scroll = useRevealOnFocus();
  const [update, saving] = useAdminUpdateUserMutation();
  const [chosen, setChosen] = useState<string[]>(user.zones ?? []);
  const [mobile, setMobile] = useState(user.mobile_no ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const field = useRef<View>(null);

  const zoned = chosen.length > 0;
  const numbered = mobile.trim().length > 0;
  // Both are needed and neither is enough: a zone with no number is a manager nobody can send a
  // code to, and a number with no zone opens nothing.
  const app: { text: string; tone?: ToneName } =
    zoned && numbered
      ? { text: t('admin.users.appReady'), tone: 'green' }
      : zoned
        ? { text: t('admin.users.appNoNumber'), tone: 'yolk' }
        : numbered
          ? { text: t('admin.users.appNoZone') }
          : { text: t('admin.users.appNeither') };

  const save = async () => {
    setStatus(null);
    const number = mobile.trim();
    if (number && !MOBILE.test(number)) {
      setStatus(t('admin.users.mobileInvalid'));
      return;
    }
    // The number only when it moved: re-sending one nobody touched re-validates it, and the
    // panel is opened to move regions far more often than to hand out a phone.
    const body: AdminUserPatch = { zones: chosen };
    if (number !== (user.mobile_no ?? '')) {
      body.mobile_no = number;
    }
    try {
      onSaved(await update({ id: user.id, body }).unwrap());
    } catch (error) {
      setStatus(problemLines(error, t('admin.users.saveFailed')).join(' · '));
    }
  };

  return (
    <EditorFrame
      user={user}
      title={t('admin.users.zonesTitle')}
      icon="map"
      tone="blue"
      saveLabel="admin.users.saveZones"
      saving={saving.isLoading}
      onSave={save}
      onClose={onClose}
      status={status}
      scroll={scroll}
    >
      <View style={styles.row}>
        <AppText style={[styles.fieldLabel, styles.flex]}>{t('admin.users.zonesTheySee')}</AppText>
        <AppText style={styles.count} testID="admin-zone-count">
          {zoned ? t('admin.users.zonesN', { count: chosen.length }) : t('admin.users.noneWhole')}
        </AppText>
      </View>
      <View style={styles.row}>
        <Button
          label={t('admin.users.wholeNetwork')}
          icon="globe-outline"
          tone="ink"
          outline
          onPress={() => setChosen([])}
          testID="admin-zone-none"
        />
      </View>
      {zones.length === 0 ? (
        <AppText style={styles.hint}>{t('admin.users.noZones')}</AppText>
      ) : (
        <View style={styles.grid}>
          {zones.map(zone => {
            const on = chosen.includes(zone.code);
            return (
              <Pressable
                key={zone.code}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setChosen(c => toggled(c, zone.code))}
                style={({ pressed }) => [
                  styles.gridItem,
                  on && { backgroundColor: TONE.blue.wash, borderColor: TONE.blue.border },
                  pressed && styles.pressed,
                ]}
                testID={`admin-zone-${zone.code}`}
              >
                <Ionicons name="map" size={15} color={on ? TONE.blue.text : ink[400]} />
                <View style={styles.flex}>
                  <AppText style={[styles.gridLabel, on && { color: TONE.blue.text }]}>
                    {zone.name}
                  </AppText>
                  {/* What the tick actually decides: the chilling centres in it. */}
                  <AppText style={styles.hint}>
                    {zone.plant_names?.length
                      ? zone.plant_names.join(', ')
                      : t('admin.users.noPlants')}
                  </AppText>
                </View>
                <Tick on={on} tone="blue" />
              </Pressable>
            );
          })}
        </View>
      )}
      <AppText style={styles.hint} testID="admin-zone-diff">
        {t(zoned ? 'admin.users.zonesOnly' : 'admin.users.zonesWhole')}
      </AppText>

      <View ref={field} collapsable={false}>
        <Field
          label={t('admin.users.mobile')}
          hint={app.text}
          hintTone={app.tone}
          hintTestID="admin-zone-app"
        >
          <Input
            value={mobile}
            onChangeText={v => setMobile(v.replace(/\D/g, '').slice(0, 10))}
            onReveal={() => scroll.api.reveal(field.current)}
            keyboardType="number-pad"
            maxLength={10}
            placeholder="9876543210"
            testID="admin-zone-mobile"
          />
        </Field>
      </View>
    </EditorFrame>
  );
}

/** Who the person is: name, email, number, the Admin / Normal User switch, the fixed code. */
function DetailsEditor({
  user,
  onSaved,
  onClose,
}: {
  user: AdminUser;
  onSaved: (user: AdminUser) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const scroll = useRevealOnFocus();
  const [update, saving] = useAdminUpdateUserMutation();
  const [fullName, setFullName] = useState(user.full_name ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [mobile, setMobile] = useState(user.mobile_no ?? '');
  const [role, setRole] = useState(user.role);
  const [fixed, setFixed] = useState(!!user.fixed_otp_enabled);
  const [status, setStatus] = useState<string | null>(null);
  const refs = [useRef<View>(null), useRef<View>(null), useRef<View>(null)] as const;

  // Only between the two office roles that are one account with one capability apart. Promoting
  // to Super Admin, or crossing the field/office line, is not a casual edit.
  const switchable = sectionScoped(user);

  const save = async () => {
    setStatus(null);
    const name = fullName.trim();
    const mail = email.trim();
    const number = mobile.trim();
    if (!name) {
      setStatus(t('admin.users.nameRequired'));
      return;
    }
    if (number && !MOBILE.test(number)) {
      setStatus(t('admin.users.mobileInvalid'));
      return;
    }
    const body: AdminUserPatch = {};
    if (name !== (user.full_name ?? '')) {
      body.full_name = name;
    }
    if (mail !== (user.email ?? '')) {
      body.email = mail;
    }
    if (number !== (user.mobile_no ?? '')) {
      body.mobile_no = number;
    }
    if (fixed !== !!user.fixed_otp_enabled) {
      body.fixed_otp_enabled = fixed;
    }
    if (switchable && role !== user.role) {
      body.role = role;
    }
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    try {
      onSaved(await update({ id: user.id, body }).unwrap());
    } catch (error) {
      setStatus(problemLines(error, t('admin.users.saveFailed')).join(' · '));
    }
  };

  return (
    <EditorFrame
      user={user}
      title={t('admin.users.detailsTitle')}
      icon="person"
      tone="green"
      saveLabel="admin.users.saveDetails"
      saving={saving.isLoading}
      onSave={save}
      onClose={onClose}
      status={status}
      scroll={scroll}
    >
      <View ref={refs[0]} collapsable={false}>
        <Field label={t('admin.users.fullName')} hint={t('admin.users.fullNameHint')}>
          <Input
            value={fullName}
            onChangeText={setFullName}
            onReveal={() => scroll.api.reveal(refs[0].current)}
            autoCapitalize="words"
            maxLength={150}
            testID="admin-details-name"
          />
        </Field>
      </View>
      <View ref={refs[1]} collapsable={false}>
        <Field label={t('admin.users.email')} hint={t('admin.users.emailHint')}>
          <Input
            value={email}
            onChangeText={setEmail}
            onReveal={() => scroll.api.reveal(refs[1].current)}
            keyboardType="email-address"
            testID="admin-details-email"
          />
        </Field>
      </View>
      <View ref={refs[2]} collapsable={false}>
        <Field
          label={t('admin.users.mobile')}
          hint={t(user.zone_names?.length ? 'admin.users.mobileZoned' : 'admin.users.mobileOffice')}
          hintTestID="admin-details-mobile-hint"
        >
          <Input
            value={mobile}
            onChangeText={v => setMobile(v.replace(/\D/g, '').slice(0, 10))}
            onReveal={() => scroll.api.reveal(refs[2].current)}
            keyboardType="number-pad"
            maxLength={10}
            placeholder="9876543210"
            testID="admin-details-mobile"
          />
        </Field>
      </View>

      {switchable && (
        <Field label={t('admin.users.role')} hint={t('admin.users.roleSwitchHint')}>
          <View style={styles.row}>
            {(['admin', 'normal_user'] as const).map(r => (
              <Choice
                key={r}
                label={roleLabel(t, r)}
                on={role === r}
                onPress={() => setRole(r)}
                testID={`admin-details-role-${r}`}
              />
            ))}
          </View>
        </Field>
      )}

      {/* A sign-in bypass, not a contact detail — set apart, in yolk, so it reads as deliberate. */}
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: fixed }}
        onPress={() => setFixed(f => !f)}
        style={({ pressed }) => [styles.fixed, pressed && styles.pressed]}
        testID="admin-details-fixed"
      >
        <Tick on={fixed} tone="yolk" />
        <View style={styles.flex}>
          <AppText style={[styles.fieldLabel, { color: TONE.yolk.text }]}>
            {t('admin.users.fixedTitle')}
          </AppText>
          <AppText style={styles.hint}>{t('admin.users.fixedNote')}</AppText>
        </View>
      </Pressable>
    </EditorFrame>
  );
}

/**
 * How they sign in: the username and the password behind it. Apart from the details on purpose
 * — a password is the one secret on this screen, and resetting it is its own deliberate act.
 */
function CredentialsEditor({
  user,
  onSaved,
  onClose,
}: {
  user: AdminUser;
  onSaved: (user: AdminUser, message: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const scroll = useRevealOnFocus();
  const [update, saving] = useAdminUpdateUserMutation();
  const isMait = user.role === 'mait';
  const [username, setUsername] = useState(user.username);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const refs = [useRef<View>(null), useRef<View>(null), useRef<View>(null)] as const;

  const save = async () => {
    setStatus(null);
    const name = username.trim();
    if (!name) {
      setStatus(t('admin.users.usernameRequired'));
      return;
    }
    const body: AdminUserPatch = {};
    if (name !== user.username) {
      body.username = name;
    }
    if (!isMait && password) {
      if (password.length < 10) {
        setStatus(t('admin.users.passwordShort'));
        return;
      }
      if (password !== confirm) {
        setStatus(t('admin.users.passwordMismatch'));
        return;
      }
      body.password = password;
    }
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    try {
      const saved = await update({ id: user.id, body }).unwrap();
      const who = user.full_name || user.username;
      onSaved(
        saved,
        body.username
          ? t(body.password ? 'admin.users.usernameAndPassword' : 'admin.users.usernameUpdated', {
              name: who,
            })
          : t('admin.users.passwordReset', { name: who }),
      );
    } catch (error) {
      setStatus(problemLines(error, t('admin.users.saveFailed')).join(' · '));
    }
  };

  return (
    <EditorFrame
      user={user}
      title={t('admin.users.signInTitle')}
      icon="key"
      tone="yolk"
      saveLabel="admin.users.saveSignIn"
      saving={saving.isLoading}
      onSave={save}
      onClose={onClose}
      status={status}
      scroll={scroll}
    >
      <View ref={refs[0]} collapsable={false}>
        <Field label={t('admin.users.username')} hint={t('admin.users.usernameHint')}>
          <Input
            value={username}
            onChangeText={setUsername}
            onReveal={() => scroll.api.reveal(refs[0].current)}
            maxLength={64}
            testID="admin-cred-username"
          />
        </Field>
      </View>
      {isMait ? (
        <AppText style={styles.hint} testID="admin-cred-mait-note">
          {t('admin.users.maitNoPassword')}
        </AppText>
      ) : (
        <>
          <View ref={refs[1]} collapsable={false}>
            <Field label={t('admin.users.newPassword')} hint={t('admin.users.newPasswordHint')}>
              <Input
                value={password}
                onChangeText={setPassword}
                onReveal={() => scroll.api.reveal(refs[1].current)}
                secureTextEntry
                autoComplete="new-password"
                testID="admin-cred-password"
              />
            </Field>
          </View>
          <View ref={refs[2]} collapsable={false}>
            <Field label={t('admin.users.confirmPassword')} hint={t('admin.users.confirmHint')}>
              <Input
                value={confirm}
                onChangeText={setConfirm}
                onReveal={() => scroll.api.reveal(refs[2].current)}
                secureTextEntry
                autoComplete="new-password"
                testID="admin-cred-confirm"
              />
            </Field>
          </View>
        </>
      )}
    </EditorFrame>
  );
}

/** A new office account. Admin or Super Admin only — a Mait is activated, not created. */
function CreateForm({
  catalogue,
  onCreated,
  onClose,
}: {
  catalogue: AdminSection[];
  onCreated: (user: AdminUser) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const scroll = useRevealOnFocus();
  const [create, saving] = useAdminCreateUserMutation();
  const [form, setForm] = useState({
    username: '',
    full_name: '',
    email: '',
    mobile_no: '',
    password: '',
  });
  const [role, setRole] = useState<AdminUserCreate['role']>('admin');
  // Every page to start with: an account nobody thought about should open the portal it always
  // did, not an empty sidebar that reads as broken.
  const [pages, setPages] = useState<string[]>(catalogue.map(s => s.key));
  const [status, setStatus] = useState<string | null>(null);
  const refs = [
    useRef<View>(null),
    useRef<View>(null),
    useRef<View>(null),
    useRef<View>(null),
    useRef<View>(null),
  ] as const;

  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const save = async () => {
    setStatus(null);
    const body: AdminUserCreate = {
      username: form.username.trim(),
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      mobile_no: form.mobile_no.trim(),
      role,
      password: form.password,
      // A Super Admin reaches every page by role, so there is nothing to send for one.
      ...(role === 'super_admin' ? {} : { portal_sections: inOrder(catalogue, pages) }),
    };
    if (!body.username || !body.full_name || !body.password) {
      setStatus(t('admin.users.createRequired'));
      return;
    }
    if (body.mobile_no && !MOBILE.test(body.mobile_no)) {
      setStatus(t('admin.users.mobileInvalid'));
      return;
    }
    try {
      onCreated(await create(body).unwrap());
    } catch (error) {
      setStatus(problemLines(error, t('admin.users.createFailed')).join(' · '));
    }
  };

  const text = (
    i: 0 | 1 | 2 | 3 | 4,
    key: keyof typeof form,
    label: string,
    hint: string,
    extra: Partial<React.ComponentProps<typeof TextInput>> = {},
  ) => (
    <View ref={refs[i]} collapsable={false}>
      <Field label={label} hint={hint}>
        <Input
          value={form[key]}
          onChangeText={v =>
            set({ [key]: key === 'mobile_no' ? v.replace(/\D/g, '').slice(0, 10) : v })
          }
          onReveal={() => scroll.api.reveal(refs[i].current)}
          testID={`admin-create-${key}`}
          {...extra}
        />
      </Field>
    </View>
  );

  return (
    <EditorFrame
      user={null}
      title={t('admin.users.newAccount')}
      icon="person-add"
      tone="green"
      saveLabel="admin.users.createAccount"
      saving={saving.isLoading}
      onSave={save}
      onClose={onClose}
      status={status}
      scroll={scroll}
    >
      <AppText style={styles.hint}>{t('admin.users.newAccountHint')}</AppText>
      {text(0, 'username', t('admin.users.username'), t('admin.users.usernameHint'), {
        maxLength: 64,
      })}
      {text(1, 'full_name', t('admin.users.fullName'), t('admin.users.newNameHint'), {
        autoCapitalize: 'words',
        maxLength: 150,
      })}
      {text(2, 'email', t('admin.users.email'), t('admin.users.optional'), {
        keyboardType: 'email-address',
      })}
      {text(3, 'mobile_no', t('admin.users.mobile'), t('admin.users.newMobileHint'), {
        keyboardType: 'number-pad',
        maxLength: 10,
        placeholder: '9876543210',
      })}

      <Field label={t('admin.users.role')} hint={t('admin.users.newRoleHint')}>
        <View style={styles.wrap}>
          {(['admin', 'super_admin', 'normal_user'] as const).map(r => (
            <Choice
              key={r}
              label={roleLabel(t, r)}
              on={role === r}
              onPress={() => setRole(r)}
              testID={`admin-create-role-${r}`}
            />
          ))}
        </View>
      </Field>

      {text(4, 'password', t('admin.users.tempPassword'), t('admin.users.tempPasswordHint'), {
        secureTextEntry: true,
        autoComplete: 'new-password',
      })}

      {/* Hidden, not disabled, for a Super Admin: greyed ticks suggest a choice that is not there. */}
      {role !== 'super_admin' && (
        <View style={styles.field} testID="admin-create-access">
          <View style={styles.row}>
            <AppText style={[styles.fieldLabel, styles.flex]}>
              {t('admin.users.pagesTheyOpen')}
            </AppText>
            <AppText style={styles.count} testID="admin-create-access-count">
              {countLabel(t, pages.length, catalogue.length)}
            </AppText>
          </View>
          <View style={styles.row}>
            <Button
              label={t('admin.users.selectAll')}
              icon="checkmark-done"
              tone="green"
              outline
              onPress={() => setPages(catalogue.map(s => s.key))}
              testID="admin-create-access-all"
            />
            <Button
              label={t('admin.users.clear')}
              icon="remove-circle-outline"
              tone="ink"
              outline
              onPress={() => setPages([])}
              testID="admin-create-access-none"
            />
          </View>
          <AccessGrid
            catalogue={catalogue}
            chosen={pages}
            onToggle={key => setPages(p => toggled(p, key))}
            prefix="admin-create-access"
          />
          <AppText style={styles.hint}>{t('admin.users.pagesHint')}</AppText>
        </View>
      )}
    </EditorFrame>
  );
}

// --------------------------------------------------------------------------------------
// The roster
// --------------------------------------------------------------------------------------

function UserCard({
  user,
  me,
  picked,
  working,
  total,
  onPick,
  onDetails,
  onCredentials,
  onAccess,
  onZones,
  onToggle,
}: {
  user: AdminUser;
  me: boolean;
  picked: boolean;
  working: boolean;
  total: number;
  onPick: () => void;
  onDetails: () => void;
  onCredentials: () => void;
  onAccess: () => void;
  onZones: () => void;
  onToggle: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = toneOfUser(user);
  const look = TONE[tone];
  const u = user.username;
  const scoped = sectionScoped(user);
  const held = user.portal_sections ?? [];
  const of = user.portal_section_total || total;

  let pages: React.ReactNode;
  if (!scoped && user.role !== 'super_admin') {
    pages = <AppText style={styles.hint}>{t('admin.users.noPortal')}</AppText>;
  } else if (!held.length) {
    // Worth acting on rather than reading: this account signs in to nothing.
    pages = <Pill label={t('admin.users.noPages')} tone="red" />;
  } else {
    pages = (
      <AppText style={styles.code}>
        {held.length >= of
          ? t('admin.users.countAll', { total: of })
          : t('admin.users.countOf', { n: held.length, total: of })}
      </AppText>
    );
  }

  let scope: React.ReactNode;
  if (user.role === 'super_admin') {
    scope = <AppText style={styles.hint}>{t('admin.users.wholeNetwork')}</AppText>;
  } else if (scoped) {
    scope = user.zone_names?.length ? (
      <View style={styles.scope}>
        <View style={styles.wrap}>
          {user.zone_names.map(name => (
            <View key={name} style={styles.zoneChip}>
              <AppText style={styles.zoneLabel}>{name}</AppText>
            </View>
          ))}
        </View>
        {/* A zone makes the number a sign-in; missing, the account cannot open the app. */}
        <AppText style={[styles.hint, !user.mobile_no && { color: TONE.yolk.text }]}>
          {user.mobile_no
            ? t('admin.users.appOn', { number: user.mobile_no })
            : t('admin.users.noApp')}
        </AppText>
      </View>
    ) : (
      <AppText style={styles.hint}>{t('admin.users.wholeNetwork')}</AppText>
    );
  } else {
    scope = (
      <AppText style={styles.hint}>
        {user.assigned_mpp_count
          ? t('admin.users.mppsN', { count: user.assigned_mpp_count })
          : t('admin.users.noMpps')}
      </AppText>
    );
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: look.wash, borderColor: picked ? colors.info : look.border },
        picked && styles.cardPicked,
      ]}
      testID={`admin-user-${u}`}
    >
      <View style={styles.row}>
        {me ? (
          <View style={styles.pickSpace} />
        ) : (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: picked }}
            accessibilityLabel={t('admin.users.select', { name: user.full_name || u })}
            onPress={onPick}
            hitSlop={10}
            testID={`admin-user-pick-${u}`}
          >
            <Tick on={picked} tone="blue" />
          </Pressable>
        )}
        <Disc tone={tone} text={initials(user.full_name || u)} />
        <Pressable
          accessibilityRole="button"
          onPress={onDetails}
          style={({ pressed }) => [styles.flex, pressed && styles.pressed]}
          testID={`admin-user-name-${u}`}
        >
          <AppText style={[styles.name, styles.link]}>{user.full_name || u}</AppText>
          {!!user.email && <AppText style={styles.hint}>{user.email}</AppText>}
        </Pressable>
        <Pill
          label={roleLabel(t, user.role, user.role_display)}
          tone={ROLE_TONE[user.role] ?? 'slate'}
        />
      </View>

      <View style={styles.inset}>
        <Fact
          icon="key"
          label={t('admin.users.username')}
          onPress={onCredentials}
          testID={`admin-user-username-${u}`}
        >
          <AppText style={styles.code}>{u}</AppText>
        </Fact>
        <Fact
          icon="grid"
          label={t('admin.users.pages')}
          onPress={scoped && !me ? onAccess : undefined}
          testID={`admin-user-pages-${u}`}
        >
          {pages}
        </Fact>
        <Fact
          icon="map"
          label={t('admin.users.scope')}
          onPress={scoped && !me ? onZones : undefined}
          testID={`admin-user-scope-${u}`}
        >
          {scope}
        </Fact>
        <Fact icon="time" label={t('admin.users.lastSignIn')}>
          <AppText style={styles.hint}>{stamp(t, user.last_login_at)}</AppText>
        </Fact>
      </View>

      <View style={styles.row}>
        <View style={[styles.wrap, styles.flex]} testID={`admin-user-status-${u}`}>
          <Pill
            label={t(user.is_active ? 'admin.users.active' : 'admin.users.deactivated')}
            tone={user.is_active ? 'green' : 'red'}
          />
          {/* A sign-in bypass is never hidden. */}
          {user.fixed_otp_enabled && <Pill label={t('admin.users.code123456')} tone="yolk" />}
          {me && <Pill label={t('admin.users.you')} tone="blue" />}
        </View>
        {/* Named for what it will do, not for what the account is. */}
        <Button
          label={t(
            working
              ? 'admin.users.working'
              : user.is_active
                ? 'admin.users.deactivate'
                : 'admin.users.reactivate',
          )}
          icon={user.is_active ? 'ban' : 'refresh'}
          tone={user.is_active ? 'red' : 'green'}
          outline
          disabled={working}
          onPress={onToggle}
          testID={`admin-user-toggle-${u}`}
        />
      </View>
    </View>
  );
}

type Editing =
  | { kind: 'access' | 'zones' | 'details' | 'credentials'; user: AdminUser }
  | { kind: 'create' }
  | null;

type BulkAction = 'activate' | 'deactivate' | 'fixedOn' | 'fixedOff';

const BULK: Record<BulkAction, { field: 'is_active' | 'fixed_otp_enabled'; value: boolean }> = {
  activate: { field: 'is_active', value: true },
  deactivate: { field: 'is_active', value: false },
  fixedOn: { field: 'fixed_otp_enabled', value: true },
  fixedOff: { field: 'fixed_otp_enabled', value: false },
};

export default function AdminUsersScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const meId = useAppSelector(state => state.auth.user?.id ?? null);
  const catalogue = useCatalogue();
  const zonesQuery = useAdminListZonesQuery();
  // An inactive zone scopes nothing, so offering it would be a tick that does nothing.
  const zones = useMemo(
    () => (zonesQuery.data?.results ?? []).filter(zone => zone.is_active),
    [zonesQuery.data],
  );

  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [role, setRole] = useState<RoleFilter>('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [patched, setPatched] = useState<Record<number, AdminUser>>({});
  const [working, setWorking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [update] = useAdminUpdateUserMutation();

  // A new search or role starts from the first page.
  useEffect(() => setOffset(0), [search, role]);

  const list = useAdminListUsersQuery({
    ...(search ? { search } : {}),
    ...(role ? { role } : {}),
    ...(offset ? { offset } : {}),
  });

  // A fresh page replaces whatever was patched into the last one, and nothing on it is ticked.
  useEffect(() => {
    setPatched({});
    setPicked([]);
    setBulkStatus(null);
  }, [list.data]);

  const rows = useMemo(
    () => (list.data?.results ?? []).map(user => patched[user.id] ?? user),
    [list.data, patched],
  );
  const count = list.data?.count ?? 0;
  const off = rows.filter(user => !user.is_active).length;

  /** Put one saved account back into its row, rather than reloading the page around it. */
  const put = (user: AdminUser) => setPatched(p => ({ ...p, [user.id]: user }));
  const nameOf = (user: AdminUser | undefined, id: number) =>
    user?.full_name || user?.username || `#${id}`;

  const closeEditor = () => setEditing(null);
  const saved = (user: AdminUser, message?: string) => {
    put(user);
    setEditing(null);
    setProblem(null);
    setFlash(message ?? t('admin.users.saved', { name: nameOf(user, user.id) }));
  };

  const toggle = (user: AdminUser) => {
    const flip = async () => {
      setWorking(user.id);
      setProblem(null);
      setFlash(null);
      try {
        put(await update({ id: user.id, body: { is_active: !user.is_active } }).unwrap());
      } catch (error) {
        setProblem(problemLines(error, t('admin.users.saveFailed')).join(' · '));
      } finally {
        setWorking(null);
      }
    };
    // The one switch-off this screen cannot undo: the account that could put it back is yours.
    if (user.id === meId && user.is_active) {
      Alert.alert(t('admin.users.selfTitle'), t('admin.users.selfBody'), [
        { text: t('admin.users.cancel'), style: 'cancel' },
        { text: t('admin.users.deactivate'), style: 'destructive', onPress: flip },
      ]);
      return;
    }
    flip();
  };

  // --- bulk ----------------------------------------------------------------------------
  const pickable = rows.filter(user => user.id !== meId);
  const pickedRows = rows.filter(user => picked.includes(user.id));
  /** Of the ticked, those the action would actually change — so no button offers to do nothing. */
  const wouldChange = (action: BulkAction) =>
    pickedRows.filter(user => !!user[BULK[action].field] !== BULK[action].value);
  const allPicked = pickable.length > 0 && pickable.every(user => picked.includes(user.id));

  const runBulk = async (action: BulkAction) => {
    const targets = wouldChange(action);
    if (!targets.length) {
      return;
    }
    const { field, value } = BULK[action];
    const done: number[] = [];
    const failed: { who: string; why: string }[] = [];
    let next = 0;
    setBusy(true);
    setProblem(null);
    setFlash(null);
    setBulkStatus(t(`admin.users.bulkProgress_${action}`, { n: 0, total: targets.length }));

    // A refusal does not stop the rest; the ones that could not change are named at the end.
    const lane = async () => {
      while (next < targets.length) {
        const user = targets[next++]!;
        try {
          put(await update({ id: user.id, body: { [field]: value } }).unwrap());
          done.push(user.id);
        } catch (error) {
          failed.push({
            who: nameOf(user, user.id),
            why: problemLines(error, t('admin.users.saveFailed'))[0]!,
          });
        }
        setBulkStatus(
          t(`admin.users.bulkProgress_${action}`, {
            n: done.length + failed.length,
            total: targets.length,
          }),
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(BULK_PARALLEL, targets.length) }, lane));
    setBusy(false);

    if (!failed.length) {
      setBulkStatus(t(`admin.users.bulkDone_${action}`, { count: done.length }));
      return;
    }
    // Named, not counted: "3 failed" sends somebody back through forty rows looking for them.
    setBulkStatus(
      t('admin.users.bulkPartial', {
        done: done.length,
        failed: failed.length,
        names: failed.map(f => f.who).join(', '),
      }),
    );
    setProblem(failed.map(f => `${f.who} — ${f.why}`).join(' · '));
  };

  const confirmBulk = (action: 'deactivate' | 'fixedOn') => {
    const n = wouldChange(action).length;
    Alert.alert(
      t(`admin.users.confirmTitle_${action}`),
      t(`admin.users.confirmBody_${action}`, { count: n }),
      [
        { text: t('admin.users.cancel'), style: 'cancel' },
        {
          text: t(`admin.users.confirmGo_${action}`),
          style: action === 'deactivate' ? 'destructive' : 'default',
          onPress: () => {
            runBulk(action);
          },
        },
      ],
    );
  };

  // --- editors -------------------------------------------------------------------------
  if (editing?.kind === 'create') {
    return (
      <CreateForm
        catalogue={catalogue}
        onClose={closeEditor}
        onCreated={user => {
          setEditing(null);
          setProblem(null);
          setFlash(t('admin.users.created', { name: nameOf(user, user.id) }));
          if (offset) {
            setOffset(0);
          } else {
            list.refetch();
          }
        }}
      />
    );
  }
  if (editing?.kind === 'access') {
    return (
      <AccessEditor
        user={editing.user}
        catalogue={catalogue}
        onSaved={user => saved(user)}
        onClose={closeEditor}
      />
    );
  }
  if (editing?.kind === 'zones') {
    return (
      <ZoneEditor
        user={editing.user}
        zones={zones}
        onSaved={user => saved(user)}
        onClose={closeEditor}
      />
    );
  }
  if (editing?.kind === 'details') {
    return (
      <DetailsEditor user={editing.user} onSaved={user => saved(user)} onClose={closeEditor} />
    );
  }
  if (editing?.kind === 'credentials') {
    return <CredentialsEditor user={editing.user} onSaved={saved} onClose={closeEditor} />;
  }

  const filtered = !!search || !!role;
  const bulk = (['activate', 'deactivate', 'fixedOn', 'fixedOff'] as const).map(action => ({
    action,
    n: wouldChange(action).length,
  }));

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={list.isFetching && !list.isLoading}
            onRefresh={() => list.refetch()}
          />
        }
        testID="admin-users"
      >
        <View style={styles.row}>
          <View style={styles.flex}>
            <AppText style={styles.title}>{t('admin.users.title')}</AppText>
            <AppText style={styles.hint} testID="admin-users-count">
              {t('admin.users.accountsN', { count })}
            </AppText>
          </View>
          <Button
            label={t('admin.users.createUser')}
            icon="person-add"
            tone="green"
            onPress={() => setEditing({ kind: 'create' })}
            testID="admin-users-create"
          />
        </View>

        {!!problem && <Banner tone="error" message={problem} testID="admin-users-problem" />}
        {!!flash && <Banner tone="info" message={flash} testID="admin-users-flash" />}

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.info} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={setTerm}
            placeholder={t('admin.users.searchPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            autoCapitalize="none"
            testID="admin-users-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
        {/* Wrapped, not a sideways strip: five roles do not fit a handset's width, and a strip
            sliced the last pill in half at the screen edge. Every role stays in sight. */}
        <View style={styles.chips} testID="admin-users-roles">
          <FilterChip
            label={t('admin.users.roleAll')}
            icon="people"
            tone="slate"
            active={role === ''}
            onPress={() => setRole('')}
            testID="admin-users-role-all"
          />
          {ROLES.map(r => (
            <FilterChip
              key={r}
              label={roleLabel(t, r)}
              icon={r === 'mait' ? 'person' : 'shield-checkmark'}
              tone={ROLE_TONE[r] ?? 'slate'}
              active={role === r}
              onPress={() => setRole(r)}
              testID={`admin-users-role-${r}`}
            />
          ))}
        </View>

        <View style={styles.row}>
          <Disc tone="blue" icon="people" size={32} />
          <View style={styles.flex}>
            <AppText style={styles.name}>{t('admin.users.portalAccounts')}</AppText>
            {rows.length > 0 && (
              <AppText style={styles.hint} testID="admin-users-split">
                {off
                  ? t('admin.users.splitOff', { active: rows.length - off, off })
                  : t('admin.users.split', { active: rows.length })}
              </AppText>
            )}
          </View>
          {pickable.length > 0 && (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allPicked }}
              onPress={() => setPicked(allPicked ? [] : pickable.map(user => user.id))}
              disabled={busy}
              style={({ pressed }) => [styles.pickAll, pressed && styles.pressed]}
              testID="admin-users-pick-all"
            >
              <Tick on={allPicked} tone="blue" />
              <AppText style={styles.pickAllLabel}>{t('admin.users.selectPage')}</AppText>
            </Pressable>
          )}
        </View>

        {/* Only on screen once something is ticked, and each button counts what it will change. */}
        {picked.length > 0 && (
          <View style={styles.bulk} testID="admin-users-bulk">
            <AppText style={styles.bulkCount} testID="admin-users-bulk-count">
              {t('admin.users.selectedN', { count: picked.length })}
            </AppText>
            <View style={styles.wrap}>
              {bulk.map(({ action, n }) =>
                n ? (
                  <Button
                    key={action}
                    label={t(`admin.users.bulk_${action}`, { n })}
                    icon={
                      action === 'activate'
                        ? 'refresh'
                        : action === 'deactivate'
                          ? 'ban'
                          : action === 'fixedOn'
                            ? 'keypad'
                            : 'chatbubble-ellipses'
                    }
                    tone={
                      action === 'activate'
                        ? 'green'
                        : action === 'deactivate'
                          ? 'red'
                          : action === 'fixedOn'
                            ? 'yolk'
                            : 'slate'
                    }
                    outline
                    disabled={busy}
                    onPress={() =>
                      action === 'deactivate' || action === 'fixedOn'
                        ? confirmBulk(action)
                        : runBulk(action)
                    }
                    testID={`admin-users-bulk-${action}`}
                  />
                ) : null,
              )}
              <Button
                label={t('admin.users.clear')}
                icon="close"
                tone="ink"
                outline
                disabled={busy}
                onPress={() => {
                  setPicked([]);
                  setBulkStatus(null);
                }}
                testID="admin-users-bulk-clear"
              />
            </View>
            {!!bulkStatus && (
              <AppText style={styles.hint} testID="admin-users-bulk-status">
                {bulkStatus}
              </AppText>
            )}
          </View>
        )}

        {list.isLoading ? (
          <SkeletonRows />
        ) : list.isError ? (
          <EmptyState message={t('admin.users.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t(filtered ? 'admin.users.noMatch' : 'admin.users.none')} />
        ) : (
          rows.map(user => (
            <UserCard
              key={user.id}
              user={user}
              me={user.id === meId}
              picked={picked.includes(user.id)}
              working={working === user.id}
              total={catalogue.length}
              onPick={() =>
                !busy &&
                setPicked(p =>
                  p.includes(user.id) ? p.filter(id => id !== user.id) : [...p, user.id],
                )
              }
              onDetails={() => setEditing({ kind: 'details', user })}
              onCredentials={() => setEditing({ kind: 'credentials', user })}
              onAccess={() => setEditing({ kind: 'access', user })}
              onZones={() => setEditing({ kind: 'zones', user })}
              onToggle={() => toggle(user)}
            />
          ))
        )}

        {count > LIMIT && (
          <View style={styles.pager}>
            <Button
              label={t('admin.users.previous')}
              icon="chevron-back"
              tone="blue"
              outline
              disabled={offset === 0 || list.isFetching}
              onPress={() => setOffset(o => Math.max(0, o - LIMIT))}
              testID="admin-users-prev"
            />
            <AppText style={[styles.hint, styles.flex, styles.center]} testID="admin-users-page">
              {t('admin.users.pageOf', {
                from: offset + 1,
                to: Math.min(offset + LIMIT, count),
                count,
              })}
            </AppText>
            <Button
              label={t('admin.users.next')}
              icon="chevron-forward"
              tone="blue"
              outline
              disabled={offset + LIMIT >= count || list.isFetching}
              onPress={() => setOffset(o => o + LIMIT)}
              testID="admin-users-next"
            />
          </View>
        )}

        <Notice
          tone="blue"
          icon="information-circle"
          title={t('admin.users.noticeTitle')}
          body={t('admin.users.noticeBody')}
          testID="admin-users-notice"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  off: { opacity: 0.5 },
  hint: { ...typography.caption, color: colors.textMuted },
  title: { ...typography.h3, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  name: { ...typography.bodyStrong, color: colors.ink },
  link: { color: colors.info },
  code: { ...typography.label, color: colors.ink },
  count: { ...typography.label, color: colors.info },

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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },

  pickAll: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  pickAllLabel: { ...typography.caption, color: colors.info },
  pickSpace: { width: 22 },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  bulk: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  bulkCount: { ...typography.label, color: colors.info },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardPicked: { borderWidth: 2 },
  inset: {
    paddingHorizontal: spacing[3],
    paddingVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: 40,
    paddingVertical: 6,
  },
  factLabel: { ...typography.caption, color: colors.textMuted, width: 76 },
  factValue: { flex: 1, alignItems: 'flex-start' },
  scope: { gap: 4 },
  zoneChip: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderColor: colors.info,
  },
  zoneLabel: { ...typography.caption, color: colors.info },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  buttonLabel: { ...typography.label },

  pager: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },

  back: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  backLabel: { ...typography.label, color: colors.surface },
  editor: { padding: spacing[3], gap: spacing[3], borderRadius: radius.lg, borderWidth: 1 },
  editorTitle: { ...typography.h3, flex: 1 },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  actions: { flexDirection: 'row', gap: spacing[2] },

  field: { gap: 4 },
  fieldLabel: { ...typography.label, color: colors.ink },
  input: {
    ...typography.body,
    color: colors.ink,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  choiceOn: { backgroundColor: colors.info },
  choiceLabel: { ...typography.label, color: colors.info },

  grid: { gap: 6 },
  gridItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  gridLabel: { ...typography.label, color: colors.ink, flex: 1 },

  fixed: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: TONE.yolk.border,
    backgroundColor: TONE.yolk.wash,
  },
});
