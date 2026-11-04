/**
 * Zones, for an admin — the portal's `zones.html` (W20) on a handset.
 *
 * The dairy is run in zones — Bahraich, Pratapgarh — each covering several BMC/MCCs, and that
 * grouping exists nowhere in SAP. This is where it is decided. Two things make the screen what
 * it is. The chilling centres are **not typed in**: they arrive with the master data, so the
 * work is placing them, not naming them. And a centre belongs to **one** zone, so every tick box
 * says who already holds it rather than letting the save fail afterwards.
 *
 * Top to bottom, as the portal reads: the rule (blue), the four tiles, the zones themselves with
 * an editor to add, change or delete one, then the people — who runs each zone, the number that
 * opens their app, and what they have actually done there — and last, whatever chilling centre
 * is still in no zone, each one a tap away from a new zone with it already ticked.
 *
 * The one place it says more than the portal: a zone being edited can be switched off. The
 * server has always taken `is_active`, and its refusal to delete a zone somebody reads says
 * "make it inactive instead" — so the way to do that is beside the Delete that sends you there.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { Banner, EmptyState } from '@/components';
import { SkeletonFeed, SkeletonRows } from '@/components/skeleton';
import { initials } from '@/components/frame';
import { useRevealOnFocus } from '@/features/aiFlow/components';
import {
  useAdminCreateZoneMutation,
  useAdminDeleteZoneMutation,
  useAdminListZonesQuery,
  useAdminSetZoneManagerMobileMutation,
  useAdminUpdateZoneMutation,
  useAdminZoneActivityQuery,
  useAdminZoneManagersQuery,
  useAdminZonePlantsQuery,
} from '@api/endpoints';
import type { AuditEntry, Zone, ZoneManager, ZonePlantRow, ZoneWrite } from '@api/types';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { Disc, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';
import { Button, EditorFrame, Field, Input, MOBILE, Tick, problemLines } from './AdminUsersScreen';

const WINDOWS = [7, 30, 90] as const;
type Kind = 'decisions' | 'all';

function n(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('en-IN');
}

function stamp(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return t('admin.zones.never');
  }
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "just now", "12 min ago", "3 hours ago", "yesterday", "6 days ago". */
export function relative(t: TFunction, iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 90) {
    return t('admin.zones.justNow');
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return t('admin.zones.minAgo', { n: minutes });
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return t('admin.zones.hoursAgo', { count: hours });
  }
  const days = Math.round(hours / 24);
  return days === 1 ? t('admin.zones.yesterday') : t('admin.zones.daysAgo', { n: days });
}

/** The audit trail's tones, in this screen's colours. */
function toneOf(tone: string | null): ToneName {
  return tone === 'good'
    ? 'green'
    : tone === 'bad'
      ? 'red'
      : tone === 'warn'
        ? 'yolk'
        : tone === 'info'
          ? 'blue'
          : 'slate';
}

/** Where a manager stands with the handset app — and why not, since two people fix two reasons. */
export function appState(m: ZoneManager): { key: string; tone: ToneName } {
  if (!m.is_active) {
    return { key: 'deactivated', tone: 'red' };
  }
  if (m.app_access) {
    return { key: 'app', tone: 'green' };
  }
  if (!m.zone_names.length) {
    return { key: 'zoneOff', tone: 'yolk' };
  }
  return { key: 'portalOnly', tone: 'yolk' };
}

// --------------------------------------------------------------------------------------
// Small parts
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
      <View style={styles.row}>
        <View style={[styles.chip, { backgroundColor: look.solid }]}>
          <Ionicons name={icon as never} size={13} color={look.onSolid} />
        </View>
        <AppText style={[styles.tileLabel, { color: look.text }]}>{label}</AppText>
      </View>
      <AppText
        style={styles.tileValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        testID={`${testID}-value`}
      >
        {value}
      </AppText>
      <AppText
        style={[styles.hint, footTone && { color: TONE[footTone].text }]}
        testID={`${testID}-foot`}
      >
        {foot}
      </AppText>
    </View>
  );
}

function Chips({ names, tone = 'blue' }: { names: string[]; tone?: ToneName }): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View style={styles.wrap}>
      {names.map(name => (
        <View
          key={name}
          style={[styles.nameChip, { backgroundColor: look.wash, borderColor: look.border }]}
        >
          <AppText style={[styles.nameChipLabel, { color: look.text }]}>{name}</AppText>
        </View>
      ))}
    </View>
  );
}

function Stat({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.stat}>
      <AppText style={styles.statValue} testID={testID}>
        {value}
      </AppText>
      <AppText style={styles.hint}>{label}</AppText>
    </View>
  );
}

function Head({
  icon,
  tone,
  title,
  count,
  testID,
}: {
  icon: string;
  tone: ToneName;
  title: string;
  count?: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.row, styles.head]}>
      <Disc tone={tone} icon={icon} size={32} />
      <AppText style={[styles.headTitle, styles.flex]}>{title}</AppText>
      {!!count && (
        <AppText style={styles.count} testID={testID}>
          {count}
        </AppText>
      )}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// The zone editor
// --------------------------------------------------------------------------------------

function ZoneEditor({
  zone,
  plants,
  preset,
  onDone,
  onClose,
}: {
  /** Null when adding. */
  zone: Zone | null;
  plants: ZonePlantRow[];
  /** Centres ticked to start with — an unplaced one, when the editor opens from that panel. */
  preset: string[];
  onDone: (message: string, tone: 'info' | 'warning') => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const scroll = useRevealOnFocus();
  const adding = !zone;
  const [create, creating] = useAdminCreateZoneMutation();
  const [update, updating] = useAdminUpdateZoneMutation();
  const [remove, removing] = useAdminDeleteZoneMutation();
  const [code, setCode] = useState(zone?.code ?? '');
  const [name, setName] = useState(zone?.name ?? '');
  const [note, setNote] = useState(zone?.description ?? '');
  const [active, setActive] = useState(zone?.is_active ?? true);
  const [chosen, setChosen] = useState<string[]>(zone ? (zone.plants ?? []) : preset);
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const refs = [
    useRef<View>(null),
    useRef<View>(null),
    useRef<View>(null),
    useRef<View>(null),
  ] as const;

  /** Who holds this centre, if anybody — the zone being edited does not count as taken. */
  const heldBy = (plant: ZonePlantRow): string | null =>
    plant.zone_code && plant.zone_code !== zone?.code ? plant.zone_name : null;

  const needle = term.trim().toLowerCase();
  const shown = plants.filter(
    p =>
      !needle ||
      p.plant_name.toLowerCase().includes(needle) ||
      p.plant_code.toLowerCase().includes(needle),
  );

  // Removals named rather than counted: taking a centre out shrinks somebody's dashboard.
  const before = zone?.plants ?? [];
  const nameOf = (c: string) => plants.find(p => p.plant_code === c)?.plant_name ?? c;
  const added = chosen.filter(c => !before.includes(c));
  const removed = before.filter(c => !chosen.includes(c));
  const parts: string[] = [];
  if (added.length) {
    parts.push(t('admin.zones.adding', { list: added.map(nameOf).join(', ') }));
  }
  if (removed.length) {
    parts.push(t('admin.zones.removing', { list: removed.map(nameOf).join(', ') }));
  }
  const diff = parts.length
    ? parts.join(' · ')
    : chosen.length
      ? t('admin.zones.noChange')
      : t('admin.zones.emptyZone');
  const warn = removed.length > 0 || !chosen.length;

  const save = async () => {
    setStatus(null);
    const body: ZoneWrite = { name: name.trim(), description: note.trim(), plants: chosen };
    if (!body.name) {
      setStatus(t('admin.zones.nameRequired'));
      return;
    }
    if (adding) {
      body.code = code.trim().toUpperCase();
      if (!body.code) {
        setStatus(t('admin.zones.codeRequired'));
        return;
      }
    } else if (active !== zone.is_active) {
      body.is_active = active;
    }
    try {
      const saved = adding
        ? await create(body).unwrap()
        : await update({ id: zone.id, body }).unwrap();
      onDone(
        adding
          ? t('admin.zones.created', { name: saved.name, count: (saved.plants ?? chosen).length })
          : t('admin.zones.saved', { name: saved.name }),
        'info',
      );
    } catch (error) {
      setStatus(problemLines(error, t('admin.zones.notSaved')).join(' · '));
    }
  };

  const confirmDelete = () => {
    if (!zone) {
      return;
    }
    // Named in the question, with what it costs: a dialog people read, not one they click through.
    Alert.alert(
      t('admin.zones.deleteTitle', { name: zone.name }),
      zone.user_count
        ? t('admin.zones.deleteHolders', { count: zone.user_count })
        : t('admin.zones.deleteBody'),
      [
        { text: t('admin.zones.cancel'), style: 'cancel' },
        {
          text: t('admin.zones.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await remove(zone.id).unwrap();
              onDone(t('admin.zones.deleted', { name: zone.name }), 'warning');
            } catch (error) {
              setStatus(problemLines(error, t('admin.zones.notSaved')).join(' · '));
            }
          },
        },
      ],
    );
  };

  return (
    <EditorFrame
      user={null}
      title={adding ? t('admin.zones.addZone') : zone.name}
      icon="map"
      tone="yolk"
      saveLabel="admin.zones.saveZone"
      saving={creating.isLoading || updating.isLoading || removing.isLoading}
      onSave={save}
      onClose={onClose}
      status={status}
      scroll={scroll}
      backLabel={t('admin.zones.allZones')}
      testID="admin-zone-editor"
      footer={
        !adding && (
          <Button
            label={t('admin.zones.delete')}
            icon="trash"
            tone="red"
            outline
            disabled={removing.isLoading}
            onPress={confirmDelete}
            testID="admin-zone-editor-delete"
          />
        )
      }
    >
      <View style={styles.who}>
        <View style={styles.flex}>
          <AppText style={styles.hint} testID="admin-zone-editor-meta">
            {adding
              ? t('admin.zones.addMeta')
              : t('admin.zones.editMeta', { code: zone.code, count: zone.user_count || 0 })}
          </AppText>
        </View>
        {!adding && (
          <Pill
            label={t(zone.is_active ? 'admin.zones.active' : 'admin.zones.inactive')}
            tone={zone.is_active ? 'green' : 'red'}
          />
        )}
      </View>

      <View ref={refs[0]} collapsable={false}>
        <Field
          label={t('admin.zones.code')}
          hint={t(adding ? 'admin.zones.codeHint' : 'admin.zones.codeFixed')}
        >
          <Input
            value={code}
            onChangeText={v => setCode(v.toUpperCase())}
            onReveal={() => scroll.api.reveal(refs[0].current)}
            editable={adding}
            autoCapitalize="characters"
            maxLength={20}
            placeholder="ZONE1"
            style={!adding && styles.readonly}
            testID="admin-zone-editor-code"
          />
        </Field>
      </View>
      <View ref={refs[1]} collapsable={false}>
        <Field label={t('admin.zones.name')} hint={t('admin.zones.nameHint')}>
          <Input
            value={name}
            onChangeText={setName}
            onReveal={() => scroll.api.reveal(refs[1].current)}
            autoCapitalize="words"
            maxLength={100}
            placeholder="Bahraich Zone"
            testID="admin-zone-editor-name"
          />
        </Field>
      </View>
      <View ref={refs[2]} collapsable={false}>
        <Field label={t('admin.zones.note')}>
          <Input
            value={note}
            onChangeText={setNote}
            onReveal={() => scroll.api.reveal(refs[2].current)}
            autoCapitalize="sentences"
            maxLength={255}
            placeholder={t('admin.zones.notePlaceholder')}
            testID="admin-zone-editor-note"
          />
        </Field>
      </View>

      {!adding && (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: active }}
          onPress={() => setActive(a => !a)}
          style={({ pressed }) => [
            styles.switch,
            active
              ? { backgroundColor: TONE.green.wash, borderColor: TONE.green.border }
              : { backgroundColor: TONE.red.wash, borderColor: TONE.red.border },
            pressed && styles.pressed,
          ]}
          testID="admin-zone-editor-active"
        >
          <Tick on={active} />
          <View style={styles.flex}>
            <AppText style={styles.fieldLabel}>{t('admin.zones.activeTitle')}</AppText>
            <AppText style={styles.hint}>{t('admin.zones.activeHint')}</AppText>
          </View>
        </Pressable>
      )}

      <View style={styles.row}>
        <AppText style={[styles.fieldLabel, styles.flex]}>{t('admin.zones.plantsInZone')}</AppText>
        <AppText style={styles.count} testID="admin-zone-editor-count">
          {chosen.length
            ? t('admin.zones.ticked', { n: chosen.length, total: plants.length })
            : t('admin.zones.noneTicked')}
        </AppText>
      </View>
      <View ref={refs[3]} collapsable={false} style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.info} />
        <TextInput
          style={styles.searchInput}
          value={term}
          onChangeText={setTerm}
          onFocus={() => scroll.api.reveal(refs[3].current)}
          placeholder={t('admin.zones.plantSearch')}
          placeholderTextColor={colors.textDisabled}
          autoCorrect={false}
          autoCapitalize="none"
          testID="admin-zone-editor-search"
        />
      </View>
      <View style={styles.row}>
        {/* "Select all" would be a lie here — most centres belong to somebody else. */}
        <Button
          label={t('admin.zones.tickFree')}
          icon="checkmark-done"
          tone="green"
          outline
          onPress={() =>
            setChosen(c => [
              ...c,
              ...shown.filter(p => !heldBy(p) && !c.includes(p.plant_code)).map(p => p.plant_code),
            ])
          }
          testID="admin-zone-editor-free"
        />
        <Button
          label={t('admin.zones.clear')}
          icon="remove-circle-outline"
          tone="ink"
          outline
          onPress={() => setChosen([])}
          testID="admin-zone-editor-clear"
        />
      </View>

      <View style={styles.grid}>
        {shown.length === 0 ? (
          <AppText style={styles.hint}>
            {plants.length ? t('admin.zones.noPlantMatch') : t('admin.zones.loadingPlants')}
          </AppText>
        ) : (
          shown.map(plant => {
            const taken = heldBy(plant);
            const on = chosen.includes(plant.plant_code);
            // Disabled with the holder's name rather than hidden: an operator hunting for
            // NANPARA gets the answer on the spot.
            return (
              <Pressable
                key={plant.plant_code}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !!taken }}
                disabled={!!taken}
                onPress={() =>
                  setChosen(c =>
                    c.includes(plant.plant_code)
                      ? c.filter(x => x !== plant.plant_code)
                      : [...c, plant.plant_code],
                  )
                }
                style={({ pressed }) => [
                  styles.gridItem,
                  on && { backgroundColor: TONE.green.wash, borderColor: TONE.green.border },
                  !!taken && styles.taken,
                  pressed && styles.pressed,
                ]}
                testID={`admin-zone-plant-${plant.plant_code}`}
              >
                <Ionicons
                  name={taken ? 'lock-closed' : 'business'}
                  size={15}
                  color={on ? TONE.green.text : ink[400]}
                />
                <View style={styles.flex}>
                  <AppText style={[styles.gridLabel, on && { color: TONE.green.text }]}>
                    {plant.plant_name}
                  </AppText>
                  <AppText style={styles.hint}>
                    {taken
                      ? t('admin.zones.inZone', { name: taken })
                      : t('admin.zones.plantMeta', {
                          mpps: n(plant.mpp_count),
                          members: n(plant.member_count),
                        })}
                  </AppText>
                </View>
                {!taken && <Tick on={on} />}
              </Pressable>
            );
          })
        )}
      </View>
      <AppText
        style={[styles.hint, warn && { color: TONE.yolk.text }]}
        testID="admin-zone-editor-diff"
      >
        {diff}
      </AppText>
      {adding && <AppText style={styles.hint}>{t('admin.zones.assignable')}</AppText>}
    </EditorFrame>
  );
}

// --------------------------------------------------------------------------------------
// The number editor
// --------------------------------------------------------------------------------------

function ManagerEditor({
  manager,
  days,
  onDone,
  onClose,
}: {
  manager: ZoneManager;
  days: number;
  onDone: (message: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const scroll = useRevealOnFocus();
  const [save, saving] = useAdminSetZoneManagerMobileMutation();
  const [mobile, setMobile] = useState(manager.mobile_no ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const field = useRef<View>(null);
  const app = appState(manager);

  const numbered = mobile.trim().length > 0;
  const zoned = manager.zone_names.length > 0;
  // The sentence keeps up as they type: the field decides whether an app opens.
  const hint: { text: string; tone: ToneName } =
    numbered && zoned
      ? { text: t('admin.zones.codeWillSend'), tone: 'green' }
      : numbered
        ? { text: t('admin.zones.zoneSwitchedOff'), tone: 'yolk' }
        : { text: t('admin.zones.noNumberPortal'), tone: 'yolk' };

  const submit = async () => {
    setStatus(null);
    const number = mobile.trim();
    if (number && !MOBILE.test(number)) {
      setStatus(t('admin.zones.mobileInvalid'));
      return;
    }
    try {
      const updated = await save({ id: manager.id, mobile_no: number }).unwrap();
      onDone(
        updated.mobile_no
          ? t('admin.zones.appOn', { name: updated.full_name, number: updated.mobile_no })
          : t('admin.zones.appOff', { name: updated.full_name }),
      );
    } catch (error) {
      setStatus(problemLines(error, t('admin.zones.notSaved')).join(' · '));
    }
  };

  return (
    <EditorFrame
      user={null}
      title={t('admin.zones.numberTitle')}
      icon="phone-portrait"
      tone="blue"
      saveLabel="admin.zones.saveNumber"
      saving={saving.isLoading}
      onSave={submit}
      onClose={onClose}
      status={status}
      scroll={scroll}
      backLabel={t('admin.zones.allZones')}
      testID="admin-manager-editor"
    >
      <View style={styles.who}>
        <Disc tone={app.tone} text={initials(manager.full_name || manager.username)} />
        <View style={styles.flex}>
          <AppText style={styles.name}>{manager.full_name || manager.username}</AppText>
          <AppText style={styles.hint}>{manager.username}</AppText>
        </View>
        <Pill label={t(`admin.zones.app_${app.key}`)} tone={app.tone} />
      </View>

      <View ref={field} collapsable={false}>
        <Field
          label={t('admin.zones.mobile')}
          hint={hint.text}
          hintTone={hint.tone}
          hintTestID="admin-manager-editor-hint"
        >
          <Input
            value={mobile}
            onChangeText={v => setMobile(v.replace(/\D/g, '').slice(0, 10))}
            onReveal={() => scroll.api.reveal(field.current)}
            keyboardType="number-pad"
            maxLength={10}
            placeholder="9876543210"
            testID="admin-manager-editor-mobile"
          />
        </Field>
      </View>
      <Field label={t('admin.zones.zonesTheyRun')}>
        <AppText style={styles.value} testID="admin-manager-editor-zones">
          {manager.zone_names.length
            ? manager.zone_names.join(', ')
            : manager.inactive_zones.length
              ? t('admin.zones.switchedOff', { list: manager.inactive_zones.join(', ') })
              : t('admin.zones.noneShort')}
        </AppText>
      </Field>
      <AppText style={styles.hint}>{t('admin.zones.windowNote', { days })}</AppText>
    </EditorFrame>
  );
}

// --------------------------------------------------------------------------------------
// The cards
// --------------------------------------------------------------------------------------

function ZoneCard({ zone, onEdit }: { zone: Zone; onEdit: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const tone: ToneName = zone.is_active ? 'green' : 'red';
  const look = TONE[tone];
  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-zone-${zone.code}`}
    >
      <View style={styles.row}>
        <Disc tone={tone} icon="map" />
        <View style={styles.flex}>
          <AppText style={styles.name}>{zone.name}</AppText>
          <AppText style={styles.hint}>
            {[zone.code, zone.description].filter(Boolean).join(' · ')}
          </AppText>
        </View>
        <Pill
          label={t(zone.is_active ? 'admin.zones.active' : 'admin.zones.inactive')}
          tone={tone}
        />
      </View>
      <View style={styles.inset}>
        {zone.plant_names.length ? (
          <Chips names={zone.plant_names} />
        ) : (
          // Real and temporary — and the state that shows its holders an empty dashboard.
          <AppText
            style={[styles.hint, { color: TONE.yolk.text }]}
            testID={`admin-zone-empty-${zone.code}`}
          >
            {t('admin.zones.noPlantsYet')}
          </AppText>
        )}
        <View style={styles.stats}>
          <Stat label={t('admin.zones.mpps')} value={n(zone.mpp_count)} />
          <Stat label={t('admin.zones.members')} value={n(zone.member_count)} />
          <Stat
            label={t('admin.zones.accounts')}
            value={zone.user_count ? n(zone.user_count) : t('admin.zones.noneShort')}
            testID={`admin-zone-accounts-${zone.code}`}
          />
        </View>
      </View>
      <Button
        label={t('admin.zones.edit')}
        icon="create"
        tone="yolk"
        onPress={onEdit}
        testID={`admin-zone-edit-${zone.code}`}
      />
    </View>
  );
}

function ManagerCard({
  manager,
  days,
  onNumber,
}: {
  manager: ZoneManager;
  days: number;
  onNumber: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const app = appState(manager);
  const look = TONE[app.tone];
  const stats = manager.activity;
  const id = manager.id;

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-manager-${id}`}
    >
      <View style={styles.row}>
        <Disc tone={app.tone} text={initials(manager.full_name || manager.username)} />
        <View style={styles.flex}>
          <AppText style={styles.name}>{manager.full_name || manager.username}</AppText>
          <AppText style={styles.hint}>{manager.username}</AppText>
        </View>
        <View testID={`admin-manager-app-${id}`} style={styles.appCol}>
          <Pill label={t(`admin.zones.app_${app.key}`)} tone={app.tone} />
          {app.key === 'zoneOff' && !!manager.inactive_zones.length && (
            <AppText style={styles.hint}>{manager.inactive_zones.join(', ')}</AppText>
          )}
        </View>
      </View>

      <View style={styles.inset}>
        <View style={styles.fact}>
          <Ionicons name="map" size={15} color={colors.textMuted} />
          <AppText style={styles.factLabel}>{t('admin.zones.zone')}</AppText>
          <View style={[styles.flex, styles.gap]} testID={`admin-manager-zone-${id}`}>
            {manager.zone_names.length ? (
              <Chips names={manager.zone_names} />
            ) : (
              <AppText style={styles.hint}>{t('admin.zones.noLiveZone')}</AppText>
            )}
            {/* How big the patch is: the sentence somebody reads deciding whom to ring. */}
            <AppText style={styles.hint}>
              {manager.maits
                ? t('admin.zones.maitsN', { count: manager.maits })
                : t('admin.zones.noMaits')}
            </AppText>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onNumber}
          style={({ pressed }) => [styles.fact, pressed && styles.pressed]}
          testID={`admin-manager-mobile-${id}`}
        >
          <Ionicons name="phone-portrait" size={15} color={colors.textMuted} />
          <AppText style={styles.factLabel}>{t('admin.zones.mobile')}</AppText>
          <AppText
            style={[
              styles.flex,
              manager.mobile_no ? styles.number : [styles.hint, { color: TONE.yolk.text }],
            ]}
          >
            {manager.mobile_no || t('admin.zones.noNumber')}
          </AppText>
          <Ionicons name="chevron-forward" size={15} color={colors.info} />
        </Pressable>
        <View style={styles.fact}>
          <Ionicons name="time" size={15} color={colors.textMuted} />
          <AppText style={styles.factLabel}>{t('admin.zones.lastSignIn')}</AppText>
          <AppText style={[styles.hint, styles.flex]}>{stamp(t, manager.last_login_at)}</AppText>
        </View>
        <View style={styles.fact}>
          <Ionicons name="checkmark-done" size={15} color={colors.textMuted} />
          <AppText style={styles.factLabel}>{t('admin.zones.decisions')}</AppText>
          <View style={[styles.flex, styles.gap]} testID={`admin-manager-decisions-${id}`}>
            {!stats.actions ? (
              <AppText style={styles.hint}>{t('admin.zones.nothingIn', { days })}</AppText>
            ) : (
              <>
                <View style={styles.wrap}>
                  {!!stats.approved && (
                    <Pill label={t('admin.zones.approvedN', { n: stats.approved })} tone="green" />
                  )}
                  {!!stats.rejected && (
                    <Pill label={t('admin.zones.rejectedN', { n: stats.rejected })} tone="red" />
                  )}
                  {!stats.approved && !stats.rejected && (
                    <AppText style={styles.hint}>{t('admin.zones.noIndentDecisions')}</AppText>
                  )}
                </View>
                <AppText style={styles.hint}>
                  {t('admin.zones.actionsInAll', { count: stats.actions })}
                </AppText>
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function ActivityItem({ entry }: { entry: AuditEntry }): React.JSX.Element {
  const { t } = useTranslation();
  const tone = toneOf(entry.tone);
  return (
    <View style={styles.act} testID={`admin-zone-activity-${entry.id}`}>
      <Disc tone="slate" text={entry.actor.initials || initials(entry.actor.name)} size={32} />
      <View style={[styles.flex, styles.gap]}>
        <View style={styles.wrap}>
          <Pill label={entry.action_label} tone={tone} />
        </View>
        <AppText style={styles.value}>{entry.summary}</AppText>
        <AppText style={styles.hint}>
          {[entry.actor.name, stamp(t, entry.when), relative(t, entry.when)]
            .filter(Boolean)
            .join(' · ')}
        </AppText>
      </View>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// The screen
// --------------------------------------------------------------------------------------

type Editing =
  | { kind: 'zone'; zone: Zone | null; preset: string[] }
  | { kind: 'manager'; manager: ZoneManager }
  | null;

export default function AdminZonesScreen({
  onOpenSection,
}: {
  onOpenSection?: (key: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Editing>(null);
  const [flash, setFlash] = useState<{ text: string; tone: 'info' | 'warning' } | null>(null);
  const [days, setDays] = useState<number>(30);
  const [kind, setKind] = useState<Kind>('decisions');
  const [who, setWho] = useState<number | null>(null);

  const zonesQuery = useAdminListZonesQuery();
  const plantsQuery = useAdminZonePlantsQuery();
  const managersQuery = useAdminZoneManagersQuery({ days });
  const activityQuery = useAdminZoneActivityQuery({ days, kind, manager: who });

  const zones = useMemo(() => zonesQuery.data?.results ?? [], [zonesQuery.data]);
  const plants = useMemo(() => plantsQuery.data?.results ?? [], [plantsQuery.data]);
  const managers = useMemo(() => managersQuery.data?.results ?? [], [managersQuery.data]);
  const activity = activityQuery.data?.results ?? [];

  // A manager narrowed to who has since left the list is nobody to narrow to.
  useEffect(() => {
    if (who !== null && managersQuery.data && !managers.some(m => m.id === who)) {
      setWho(null);
    }
  }, [who, managers, managersQuery.data]);

  const placed = plants.filter(p => p.zone_code).length;
  const free = plants.filter(p => !p.zone_code);
  const members = zones.reduce((total, zone) => total + (zone.member_count || 0), 0);
  const inactive = zones.filter(zone => !zone.is_active).length;
  const missing = managers.filter(m => !m.mobile_no).length;
  const everyone = managers.reduce((total, m) => total + (m.activity?.actions || 0), 0);

  const refresh = () => {
    zonesQuery.refetch();
    plantsQuery.refetch();
    managersQuery.refetch();
    activityQuery.refetch();
  };

  if (editing?.kind === 'zone') {
    return (
      <ZoneEditor
        zone={editing.zone}
        plants={plants}
        preset={editing.preset}
        onClose={() => setEditing(null)}
        onDone={(text, tone) => {
          setEditing(null);
          setFlash({ text, tone });
        }}
      />
    );
  }
  if (editing?.kind === 'manager') {
    return (
      <ManagerEditor
        manager={editing.manager}
        days={days}
        onClose={() => setEditing(null)}
        onDone={text => {
          setEditing(null);
          setFlash({ text, tone: 'info' });
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={zonesQuery.isFetching && !zonesQuery.isLoading}
            onRefresh={refresh}
          />
        }
        testID="admin-zones"
      >
        <View style={styles.row}>
          <View style={styles.flex}>
            <AppText style={styles.title}>{t('admin.zones.title')}</AppText>
            <AppText style={styles.hint} testID="admin-zones-count">
              {t('admin.zones.zonesN', { count: zones.length })}
            </AppText>
          </View>
          <Button
            label={t('admin.zones.addZone')}
            icon="add-circle"
            tone="green"
            onPress={() => setEditing({ kind: 'zone', zone: null, preset: [] })}
            testID="admin-zones-add"
          />
        </View>

        {!!flash && <Banner tone={flash.tone} message={flash.text} testID="admin-zones-flash" />}

        <Notice
          tone="blue"
          icon="information-circle"
          title={t('admin.zones.ruleTitle')}
          body={t('admin.zones.ruleBody')}
          action={onOpenSection ? t('admin.zones.openUsers') : undefined}
          onAction={onOpenSection ? () => onOpenSection('users') : undefined}
          testID="admin-zones-rule"
        />

        {zonesQuery.isLoading ? (
          <SkeletonRows />
        ) : zonesQuery.isError ? (
          <EmptyState message={t('admin.zones.error')} />
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile
                tone="green"
                icon="map"
                label={t('admin.zones.tileZones')}
                value={n(zones.length)}
                foot={t('admin.zones.inactiveN', { n: inactive })}
                testID="admin-zones-tile-zones"
              />
              <Tile
                tone="blue"
                icon="business"
                label={t('admin.zones.tilePlaced')}
                value={t('admin.zones.placedOf', { n: placed, total: plants.length })}
                foot={
                  free.length
                    ? t('admin.zones.toPlace', { n: free.length })
                    : t('admin.zones.allPlaced')
                }
                footTone={free.length ? 'red' : 'green'}
                testID="admin-zones-tile-placed"
              />
            </View>
            <View style={styles.tiles}>
              <Tile
                tone="slate"
                icon="people"
                label={t('admin.zones.tileMembers')}
                value={n(members)}
                foot={t('admin.zones.acrossZones')}
                testID="admin-zones-tile-members"
              />
              <Tile
                tone="slate"
                icon="phone-portrait"
                label={t('admin.zones.tileManagers')}
                value={n(managers.length)}
                foot={
                  !managers.length
                    ? t('admin.zones.nobodyScoped')
                    : missing
                      ? t('admin.zones.missingNumber', { count: missing })
                      : t('admin.zones.allCanSignIn')
                }
                footTone={managers.length ? (missing ? 'red' : 'green') : undefined}
                testID="admin-zones-tile-managers"
              />
            </View>

            <Head icon="map" tone="green" title={t('admin.zones.title')} />
            {zones.length === 0 ? (
              <EmptyState message={t('admin.zones.none')} />
            ) : (
              zones.map(zone => (
                <ZoneCard
                  key={zone.id}
                  zone={zone}
                  onEdit={() => setEditing({ kind: 'zone', zone, preset: [] })}
                />
              ))
            )}
          </>
        )}

        <Head
          icon="people"
          tone="blue"
          title={t('admin.zones.whoRuns')}
          count={managersQuery.data ? t('admin.zones.accountsN', { count: managers.length }) : ''}
          testID="admin-zones-managers-count"
        />
        <Notice
          tone="blue"
          icon="phone-portrait"
          title={t('admin.zones.appRuleTitle')}
          body={t('admin.zones.appRuleBody')}
          testID="admin-zones-app-rule"
        />
        {managersQuery.isLoading ? (
          <SkeletonRows rows={3} />
        ) : managersQuery.isError ? (
          // Not a banner over the screen: the people are the second half of it.
          <EmptyState message={t('admin.zones.managersError')} />
        ) : managers.length === 0 ? (
          <EmptyState message={t('admin.zones.noManagers')} />
        ) : (
          managers.map(manager => (
            <ManagerCard
              key={manager.id}
              manager={manager}
              days={days}
              onNumber={() => setEditing({ kind: 'manager', manager })}
            />
          ))
        )}

        <Head
          icon="pulse"
          tone="slate"
          title={t('admin.zones.whatDone')}
          count={
            activityQuery.data
              ? activity.length
                ? t('admin.zones.actionsN', { count: activity.length })
                : t('admin.zones.nothingYet')
              : ''
          }
          testID="admin-zones-activity-count"
        />
        <View style={styles.wrap}>
          {WINDOWS.map(w => (
            <FilterChip
              key={w}
              label={t('admin.zones.lastDays', { n: w })}
              icon="calendar"
              tone="blue"
              active={days === w}
              onPress={() => setDays(w)}
              testID={`admin-zones-days-${w}`}
            />
          ))}
        </View>
        <View style={styles.wrap}>
          <FilterChip
            label={t('admin.zones.kindDecisions')}
            icon="checkmark-done"
            tone="green"
            active={kind === 'decisions'}
            onPress={() => setKind('decisions')}
            testID="admin-zones-kind-decisions"
          />
          <FilterChip
            label={t('admin.zones.kindAll')}
            icon="list"
            tone="slate"
            active={kind === 'all'}
            onPress={() => setKind('all')}
            testID="admin-zones-kind-all"
          />
        </View>
        {managers.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            <FilterChip
              label={t('admin.zones.everyone', { n: n(everyone) })}
              icon="people"
              tone="slate"
              active={who === null}
              onPress={() => setWho(null)}
              testID="admin-zones-who-all"
            />
            {managers.map(m => (
              <FilterChip
                key={m.id}
                label={`${m.full_name} ${n(m.activity?.actions)}`}
                icon="person"
                tone="blue"
                active={who === m.id}
                onPress={() => setWho(m.id)}
                testID={`admin-zones-who-${m.id}`}
              />
            ))}
          </ScrollView>
        )}
        <View style={styles.feed}>
          {activityQuery.isLoading ? (
            <SkeletonFeed />
          ) : activityQuery.isError ? (
            <AppText style={styles.hint}>{t('admin.zones.activityError')}</AppText>
          ) : activity.length === 0 ? (
            // A real answer: a manager who decided nothing in thirty days is what this is for.
            <AppText style={styles.hint} testID="admin-zones-activity-empty">
              {t(kind === 'decisions' ? 'admin.zones.emptyDecisions' : 'admin.zones.emptyAll', {
                days,
              })}
            </AppText>
          ) : (
            activity.map(entry => <ActivityItem key={entry.id} entry={entry} />)
          )}
        </View>

        {/* Until it is empty, the zone rows do not add up to the network total. */}
        {free.length > 0 && (
          <View style={styles.unplaced} testID="admin-zones-unplaced">
            <View style={styles.row}>
              <Disc tone="yolk" icon="warning" size={32} />
              <AppText style={[styles.headTitle, styles.flex]}>
                {t('admin.zones.unplacedTitle')}
              </AppText>
              <AppText
                style={[styles.count, { color: TONE.yolk.text }]}
                testID="admin-zones-unplaced-count"
              >
                {n(free.length)}
              </AppText>
            </View>
            <AppText style={styles.hint}>{t('admin.zones.unplacedBody')}</AppText>
            <View style={styles.wrap}>
              {free.map(plant => (
                <Pressable
                  key={plant.plant_code}
                  accessibilityRole="button"
                  onPress={() =>
                    setEditing({ kind: 'zone', zone: null, preset: [plant.plant_code] })
                  }
                  style={({ pressed }) => [styles.freeChip, pressed && styles.pressed]}
                  testID={`admin-zones-place-${plant.plant_code}`}
                >
                  <Ionicons name="add-circle" size={14} color={TONE.yolk.text} />
                  <AppText style={styles.freeLabel}>{plant.plant_name}</AppText>
                  <AppText style={styles.hint}>
                    {t('admin.zones.mppsN', { n: n(plant.mpp_count) })}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  gap: { gap: 4 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  title: { ...typography.h3, color: colors.ink },
  hint: { ...typography.caption, color: colors.textMuted },
  value: { ...typography.label, color: colors.ink },
  name: { ...typography.bodyStrong, color: colors.ink },
  number: { ...typography.bodyStrong, color: colors.ink, letterSpacing: 0.5 },
  count: { ...typography.label, color: colors.info },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chips: { gap: spacing[2], paddingRight: spacing[4] },
  head: { marginTop: spacing[2] },
  headTitle: { ...typography.h3, color: colors.ink },

  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: { flex: 1, padding: spacing[3], gap: 4, borderRadius: radius.md, borderWidth: 1 },
  chip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, flex: 1 },
  tileValue: { ...typography.h1, color: colors.ink },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  inset: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  nameChip: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  nameChipLabel: { ...typography.caption },
  stats: { flexDirection: 'row', gap: spacing[2] },
  stat: { flex: 1 },
  statValue: { ...typography.bodyStrong, color: colors.ink },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], paddingVertical: 4 },
  factLabel: { ...typography.caption, color: colors.textMuted, width: 84 },
  appCol: { alignItems: 'flex-end', gap: 2, maxWidth: '40%' },

  feed: {
    padding: spacing[3],
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: TONE.slate.border,
    backgroundColor: TONE.slate.wash,
  },
  act: {
    flexDirection: 'row',
    gap: spacing[2],
    padding: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },

  unplaced: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: TONE.yolk.border,
    backgroundColor: TONE.yolk.wash,
  },
  freeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: TONE.yolk.border,
    backgroundColor: colors.surface,
  },
  freeLabel: { ...typography.label, color: colors.ink },

  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  fieldLabel: { ...typography.label, color: colors.ink },
  readonly: { backgroundColor: ink[50], color: colors.textMuted },
  switch: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
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
  gridLabel: { ...typography.label, color: colors.ink },
  taken: { backgroundColor: ink[50], opacity: 0.75 },
});
