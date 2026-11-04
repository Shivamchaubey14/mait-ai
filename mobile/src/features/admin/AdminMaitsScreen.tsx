/**
 * Maits, for an admin — the portal's Maits screen (`maits.html`), its editor and its activation
 * queue (`mait-activate.html`) on a handset.
 *
 * The roster as SAP has it, activated or not. Most Maits arrive from SAP with no mobile number
 * and cannot sign in at all, so this screen is mostly a backlog: a notice says how big it is
 * (yolk while Maits are stranded, green once none are, slate when SAP has not been uploaded),
 * three chips pull up the blocked and the waiting, and every card wears its state.
 *
 * Two writes, the portal's two:
 *
 * - **Edit** corrects one Mait after a phone call — name, mobile, and the complete list of MPPs
 *   they cover. The list is the set, not an addition: an MPP taken off it is unassigned, and
 *   saving asks first. Suggestions say who holds each MPP today, because adding one somebody
 *   else covers moves those members off them.
 * - **Activate pending** gives a Mait in the queue a login and the number their OTP goes to.
 *   The number is typed twice: it is the only way into the app, and one wrong digit sends the
 *   sign-in code to a stranger.
 *
 * The three views are one screen with its own back handler, so the Android gesture returns to
 * the roster before the rail or the app sees it.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { EmptyState } from '@/components';
import { SkeletonFeed, SkeletonRows } from '@/components/skeleton';
import { initials } from '@/components/frame';
import { useRevealOnFocus } from '@/features/aiFlow/components';
import {
  useAdminActivateMaitMutation,
  useAdminListMaitsQuery,
  useAdminPendingMaitsQuery,
  useAdminRecentMaitLoginsQuery,
  useAdminUpdateMaitMutation,
  useListMppsQuery,
} from '@api/endpoints';
import type { AdminMait, MPP, PendingMait } from '@api/types';
import {
  colors,
  green,
  ink,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

import { useDebounced } from './common';

const LIMIT = 25;
/** How many of the queue are drawn as rows before the admin is asked to search. */
const PENDING_SHOWN = 30;
const SUGGEST_LIMIT = 8;

function num(n: number): string {
  return n.toLocaleString('en-IN');
}

// --------------------------------------------------------------------------------------
// Tones
// --------------------------------------------------------------------------------------

export type ToneName = 'green' | 'yolk' | 'red' | 'blue' | 'slate';

/**
 * The coloured screen pattern's five tones (docs/DESIGN_SYSTEM.md): a wash with a matching
 * border on the card, the glyph or initials on a solid disc, ink on yolk because white fails
 * contrast there.
 */
export const TONE: Record<
  ToneName,
  { wash: string; border: string; solid: string; onSolid: string; text: string }
> = {
  green: {
    wash: colors.primaryWash,
    border: green[300],
    solid: colors.primary,
    onSolid: colors.surface,
    text: colors.primaryDark,
  },
  yolk: {
    wash: colors.secondaryWash,
    border: yolk[300],
    solid: yolk[400],
    onSolid: colors.ink,
    text: yolk[800],
  },
  red: {
    wash: colors.errorWash,
    border: colors.error,
    solid: colors.error,
    onSolid: colors.surface,
    text: colors.error,
  },
  blue: {
    wash: colors.infoWash,
    border: colors.info,
    solid: colors.info,
    onSolid: colors.surface,
    text: colors.info,
  },
  slate: {
    wash: ink[50],
    border: ink[200],
    solid: ink[500],
    onSolid: colors.surface,
    text: ink[700],
  },
};

type MaitState = 'inactiveSap' | 'needsMobile' | 'notActivated' | 'deactivated' | 'active';

/**
 * Where an account stands, in the portal's order. Deactivated is checked after Not activated:
 * a switched-off login is one that activated first, and only `account_active === false` says so.
 */
function stateOf(mait: AdminMait): MaitState {
  if (!mait.is_active) {
    return 'inactiveSap';
  }
  if (mait.needs_mobile) {
    return 'needsMobile';
  }
  if (!mait.activated) {
    return 'notActivated';
  }
  if (mait.account_active === false) {
    return 'deactivated';
  }
  return 'active';
}

const STATE_TONE: Record<MaitState, ToneName> = {
  inactiveSap: 'slate',
  needsMobile: 'red',
  notActivated: 'yolk',
  deactivated: 'red',
  active: 'green',
};

export function Pill({ label, tone }: { label: string; tone: ToneName }): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: look.solid }]}>
      <AppText style={[styles.pillLabel, { color: look.onSolid }]}>{label}</AppText>
    </View>
  );
}

export function Disc({
  tone,
  icon,
  text,
  size = 36,
}: {
  tone: ToneName;
  icon?: string;
  text?: string;
  size?: number;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: look.solid },
      ]}
    >
      {icon ? (
        <Ionicons name={icon as never} size={size * 0.5} color={look.onSolid} />
      ) : (
        <AppText style={[styles.discLabel, { color: look.onSolid }]}>{text}</AppText>
      )}
    </View>
  );
}

/** The Ink "← All Maits" button the portal's activation page starts with. */
export function BackButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      testID="admin-mait-back"
    >
      <Ionicons name="arrow-back" size={16} color={colors.surface} />
      <AppText style={styles.backLabel}>{t('admin.maits.allMaits')}</AppText>
    </Pressable>
  );
}

/** A labelled, glyphed field on a tinted step card. */
function StepCard({
  step,
  tone,
  icon,
  title,
  aside,
  children,
  testID,
}: {
  step?: number;
  tone: ToneName;
  icon: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.step, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.stepHead}>
        <View style={[styles.stepChip, { backgroundColor: look.solid }]}>
          {step ? (
            <AppText style={[styles.stepNumber, { color: look.onSolid }]}>{step}</AppText>
          ) : (
            <Ionicons name={icon as never} size={15} color={look.onSolid} />
          )}
        </View>
        <AppText style={[styles.stepTitle, { color: look.text }]}>{title}</AppText>
        {aside}
      </View>
      {children}
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>): React.JSX.Element {
  return (
    <TextInput
      placeholderTextColor={colors.textDisabled}
      autoCorrect={false}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

function Hint({ text, tone }: { text: string; tone?: ToneName }): React.JSX.Element {
  return <AppText style={[styles.hint, tone ? { color: TONE[tone].text } : null]}>{text}</AppText>;
}

/** A notice, in the result's own colour — the screen's answer to "how big is the backlog". */
export function Notice({
  tone,
  icon,
  title,
  body,
  action,
  onAction,
  testID,
}: {
  tone: ToneName;
  icon: string;
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
  testID?: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.notice, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.noticeHead}>
        <Disc tone={tone} icon={icon} size={32} />
        <View style={styles.flex}>
          <AppText style={[styles.noticeTitle, { color: look.text }]}>{title}</AppText>
          {!!body && <AppText style={styles.noticeBody}>{body}</AppText>}
        </View>
      </View>
      {!!action && !!onAction && (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.inkButton, pressed && styles.pressed]}
          testID={testID ? `${testID}-action` : undefined}
        >
          <AppText style={styles.inkButtonLabel}>{action}</AppText>
          <Ionicons name="arrow-forward" size={15} color={colors.surface} />
        </Pressable>
      )}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// The editor
// --------------------------------------------------------------------------------------

/**
 * Split whatever was typed or pasted into MPP codes — a comma list, lines out of a spreadsheet
 * column, or space-separated. Making somebody reformat a paste is making them retype codes.
 */
export function parseCodes(text: string): string[] {
  return (text || '')
    .split(/[\s,;]+/)
    .map(code => code.trim())
    .filter(Boolean);
}

type Held = 'added' | 'unassigned' | 'theirs' | 'assigned';

const HELD_TONE: Record<Held, ToneName> = {
  added: 'blue',
  unassigned: 'yolk',
  theirs: 'green',
  assigned: 'red',
};

export function Editor({
  mait,
  onDone,
}: {
  mait: AdminMait;
  onDone: (saved: AdminMait | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState(mait.name);
  const [mobile, setMobile] = useState(mait.mobile_no);
  const [codes, setCodes] = useState<string[]>(mait.mpp_codes);
  const [adding, setAdding] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [save, saveState] = useAdminUpdateMaitMutation();

  // The field being typed into is scrolled above the keyboard — the capture flow's own answer,
  // since the rail's screen does not shrink for the keyboard and the MPP box sits last.
  const { scroller, content, overlap: keyboard, api } = useRevealOnFocus();
  const reveal = api.reveal;
  const nameRef = useRef<View>(null);
  const mobileRef = useRef<View>(null);
  const addRef = useRef<View>(null);

  // A list of suggestions arriving grows the card under the field; bring the field back to the
  // top so the list opens into the space above the keyboard rather than behind it.
  const showing = adding.trim().length >= 2;
  useEffect(() => {
    if (showing && keyboard) {
      reveal(addRef.current);
    }
  }, [showing, keyboard, reveal]);

  // A code says nothing about which village it is, and the admin on the phone is working from a
  // name — so typing asks the server what matches, and every row says who holds it today.
  const term = useDebounced(adding.trim(), 220);
  const lookup = useListMppsQuery(term.length >= 2 ? { search: term } : undefined, {
    skip: term.length < 2,
  });
  const suggestions = term.length >= 2 ? (lookup.data?.results ?? []).slice(0, SUGGEST_LIMIT) : [];

  const before = mait.mpp_codes;
  const added = codes.filter(code => !before.includes(code));
  const removed = before.filter(code => !codes.includes(code));
  const state = stateOf(mait);

  const heldOf = (mpp: MPP): Held => {
    if (codes.includes(mpp.mpp_code)) {
      return 'added';
    }
    if (!mpp.mait_code && !mpp.mait_name) {
      return 'unassigned';
    }
    if (mpp.mait_code === mait.sahayak_vendor_code) {
      return 'theirs';
    }
    return 'assigned';
  };

  const addCodes = (text: string) => {
    const fresh = parseCodes(text).filter(code => !codes.includes(code));
    if (fresh.length) {
      setCodes(current => [...current, ...fresh.filter(code => !current.includes(code))]);
    }
    setAdding('');
  };

  const commit = async () => {
    setProblem(null);
    try {
      const saved = await save({
        code: mait.sahayak_vendor_code,
        name: name.trim(),
        mobile_no: mobile.replace(/\D/g, ''),
        mpp_codes: codes,
      }).unwrap();
      onDone({ ...mait, ...saved, name: saved.name || mait.name });
    } catch (error) {
      // The server owns every rule that matters — a duplicate number, an MPP that does not
      // exist. Show what it said rather than guessing here.
      const data = (error as { data?: Record<string, unknown> })?.data;
      const said =
        (typeof data?.detail === 'string' && data.detail) ||
        Object.values(data ?? {})
          .flat()
          .filter((v): v is string => typeof v === 'string')
          .join(' · ');
      setProblem(said || t('admin.maits.saveFailed'));
    }
  };

  const confirmSave = () => {
    if (!removed.length) {
      commit();
      return;
    }
    // Taking an MPP away is the direction that stops a Mait working somewhere, so it asks.
    Alert.alert(
      t('admin.maits.unassignTitle', { codes: removed.join(', ') }),
      t('admin.maits.unassignBody', { name: mait.name }),
      [
        { text: t('admin.maits.cancel'), style: 'cancel' },
        { text: t('admin.maits.unassign'), style: 'destructive', onPress: commit },
      ],
    );
  };

  const changes = [
    added.length ? t('admin.maits.adding', { codes: added.join(', ') }) : null,
    removed.length ? t('admin.maits.unassigning', { codes: removed.join(', ') }) : null,
  ].filter(Boolean);

  return (
    <ScrollView
      ref={scroller}
      innerViewRef={content}
      // A keyboard's worth of room under the content while one is open: without it the MPP box,
      // the last field on the screen, could not scroll any higher than the content's own end,
      // which is not high enough to clear the keyboard.
      contentContainerStyle={[styles.body, !!keyboard && { paddingBottom: keyboard + spacing[4] }]}
      keyboardShouldPersistTaps="handled"
      testID="admin-mait-editor"
    >
      <BackButton onPress={() => onDone(null)} />

      {/* Whose record this is, before a single field — three white boxes look alike, and the
          one thing that must never be in doubt is who is being changed. */}
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Disc tone="yolk" text={initials(mait.name)} size={44} />
          <View style={styles.flex}>
            <AppText style={styles.heroEyebrow}>{t('admin.maits.editTitle')}</AppText>
            <AppText style={styles.heroTitle}>{mait.name || '—'}</AppText>
            <AppText style={styles.heroCode}>{mait.sahayak_vendor_code}</AppText>
          </View>
        </View>
        <View style={styles.heroPill}>
          <Pill label={t(`admin.maits.state_${state}`)} tone={STATE_TONE[state]} />
        </View>
      </View>

      <StepCard tone="yolk" icon="person" title={t('admin.maits.nameLabel')}>
        <View ref={nameRef} collapsable={false}>
          <Input
            value={name}
            onChangeText={setName}
            onFocus={() => reveal(nameRef.current)}
            maxLength={150}
            testID="admin-mait-name"
          />
        </View>
        <Hint text={t('admin.maits.nameHint')} />
      </StepCard>

      <StepCard tone="blue" icon="phone-portrait-outline" title={t('admin.maits.mobileLabel')}>
        <View ref={mobileRef} collapsable={false}>
          <Input
            onFocus={() => reveal(mobileRef.current)}
            value={mobile}
            onChangeText={text => setMobile(text.replace(/[^\d ]/g, ''))}
            keyboardType="phone-pad"
            maxLength={14}
            placeholder="98765 43210"
            testID="admin-mait-mobile"
          />
        </View>
        <Hint text={t('admin.maits.mobileHint')} />
      </StepCard>

      <StepCard
        tone="green"
        icon="location"
        title={t('admin.maits.mppsLabel')}
        aside={
          <View style={styles.bubble}>
            <AppText style={styles.bubbleLabel} testID="admin-mait-mpp-count">
              {codes.length}
            </AppText>
          </View>
        }
        testID="admin-mait-mpps"
      >
        {/* Chips rather than a wall of text: removing one village should not mean finding it
            inside a paragraph and deleting the right comma. A chip just added is solid green. */}
        <View style={styles.chips}>
          {codes.length ? (
            codes.map(code => {
              const isNew = !before.includes(code);
              return (
                <View
                  key={code}
                  style={[styles.chip, isNew && styles.chipNew]}
                  testID={`admin-mait-chip-${code}`}
                >
                  <AppText style={[styles.chipLabel, isNew && styles.chipLabelNew]}>{code}</AppText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('admin.maits.remove', { code })}
                    hitSlop={8}
                    onPress={() => setCodes(current => current.filter(kept => kept !== code))}
                    testID={`admin-mait-chip-remove-${code}`}
                  >
                    <Ionicons
                      name="close-circle"
                      size={16}
                      color={isNew ? colors.surface : colors.textMuted}
                    />
                  </Pressable>
                </View>
              );
            })
          ) : (
            <AppText style={styles.chipsEmpty}>{t('admin.maits.noMpps')}</AppText>
          )}
        </View>

        {/* Brought to the top of what the keyboard leaves visible, so the suggestions under it
            have the rest of that space to open into. */}
        <View ref={addRef} collapsable={false} style={styles.addRow}>
          <Input
            style={styles.flex}
            value={adding}
            onChangeText={setAdding}
            onFocus={() => reveal(addRef.current)}
            onSubmitEditing={() => addCodes(suggestions[0]?.mpp_code ?? adding)}
            // Kept open after a code goes in, so the next one can be typed straight away.
            submitBehavior="submit"
            placeholder={t('admin.maits.addPlaceholder')}
            autoCapitalize="characters"
            returnKeyType="done"
            testID="admin-mait-add"
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => addCodes(adding)}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
            testID="admin-mait-add-go"
          >
            <Ionicons name="add" size={16} color={colors.primaryDark} />
            <AppText style={styles.addLabel}>{t('admin.maits.add')}</AppText>
          </Pressable>
        </View>

        {term.length >= 2 && (
          <View style={styles.suggest} testID="admin-mait-suggest">
            {lookup.isFetching && !suggestions.length ? (
              <ActivityIndicator color={colors.info} style={styles.suggestBusy} />
            ) : suggestions.length ? (
              suggestions.map(mpp => {
                const held = heldOf(mpp);
                const taken = held === 'added';
                return (
                  <Pressable
                    key={mpp.mpp_code}
                    accessibilityRole="button"
                    disabled={taken}
                    onPress={() => addCodes(mpp.mpp_code)}
                    style={({ pressed }) => [
                      styles.suggestRow,
                      taken && styles.suggestTaken,
                      pressed && styles.pressed,
                    ]}
                    testID={`admin-mait-suggest-${mpp.mpp_code}`}
                  >
                    <View style={styles.suggestTop}>
                      <View style={styles.suggestCode}>
                        <AppText style={styles.suggestCodeLabel}>{mpp.mpp_code}</AppText>
                      </View>
                      <View style={styles.flex} />
                      <Pill label={t(`admin.maits.held_${held}`)} tone={HELD_TONE[held]} />
                    </View>
                    <AppText style={styles.suggestName}>
                      {mpp.mpp_name || '—'}
                      {mpp.is_active ? '' : ` · ${t('admin.maits.retired')}`}
                    </AppText>
                    <AppText style={styles.suggestMeta}>
                      {[
                        mpp.village_code,
                        mpp.tehsil_code,
                        t('admin.maits.members', {
                          count: mpp.member_count ?? 0,
                          n: num(mpp.member_count ?? 0),
                        }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </AppText>
                    {/* The one that costs something: adding it takes it off the Mait named here. */}
                    {held === 'assigned' && (
                      <AppText style={styles.suggestHolder}>
                        {t('admin.maits.heldBy', {
                          name: mpp.mait_name || '—',
                          code: mpp.mait_code || '—',
                        })}
                      </AppText>
                    )}
                  </Pressable>
                );
              })
            ) : (
              <AppText style={styles.hint}>{t('admin.maits.noMatch')}</AppText>
            )}
          </View>
        )}

        <Hint
          text={changes.length ? changes.join(' · ') : t('admin.maits.completeList')}
          tone={removed.length ? 'red' : added.length ? 'green' : undefined}
        />
      </StepCard>

      {!!problem && (
        <View style={styles.problem} testID="admin-mait-problem">
          <Ionicons name="alert-circle" size={16} color={colors.error} />
          <AppText style={styles.problemText}>{problem}</AppText>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={confirmSave}
          disabled={saveState.isLoading}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          testID="admin-mait-save"
        >
          {saveState.isLoading ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Ionicons name="checkmark" size={18} color={colors.surface} />
          )}
          <AppText style={styles.primaryLabel}>{t('admin.maits.save')}</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onDone(null)}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          testID="admin-mait-cancel"
        >
          <Ionicons name="close" size={18} color={colors.ink} />
          <AppText style={styles.secondaryLabel}>{t('admin.maits.cancel')}</AppText>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// --------------------------------------------------------------------------------------
// The activation queue
// --------------------------------------------------------------------------------------

function digits(value: string): string {
  return (value || '').replace(/\D/g, '').slice(0, 10);
}

function isValidMobile(value: string): boolean {
  return /^[6-9]\d{9}$/.test(value);
}

function stamp(t: TFunction, iso: string | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Activate({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim(), 250);
  const pending = useAdminPendingMaitsQuery(search ? { search } : undefined);
  const recent = useAdminRecentMaitLoginsQuery();
  const [activate, activateState] = useAdminActivateMaitMutation();

  const [chosen, setChosen] = useState<PendingMait | null>(null);
  const [mobile, setMobile] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The number is typed near the bottom of the screen; the field in use comes up above the
  // keyboard, the same way the editor's do.
  const { scroller, content, overlap: keyboard, api } = useRevealOnFocus();
  const searchRef = useRef<View>(null);
  const numberRef = useRef<View>(null);
  const confirmRef = useRef<View>(null);

  // Narrowed on the handset the moment a key is pressed, then by the server's own search once
  // typing stops — so the list is both instant and the whole backlog, not the first page.
  const rows = useMemo(() => {
    const all = pending.data?.results ?? [];
    const needle = term.trim().toLowerCase();
    return all
      .filter(
        m =>
          !needle ||
          m.name.toLowerCase().includes(needle) ||
          m.sahayak_vendor_code.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pending.data, term]);
  const summary = pending.data?.summary;

  const valid = isValidMobile(mobile);
  const matches = mobile.length === 10 && mobile === confirm;
  const ready = !!chosen && valid && matches && !activateState.isLoading;

  const submit = async () => {
    if (!chosen || !ready) {
      return;
    }
    setProblem(null);
    setDone(null);
    try {
      await activate({
        sahayak_vendor_code: chosen.sahayak_vendor_code,
        mobile_no: mobile,
      }).unwrap();
      setDone(t('admin.maits.activated', { name: chosen.name }));
      setChosen(null);
      setMobile('');
      setConfirm('');
    } catch (error) {
      // The server is the authority on the number being unique across the roster.
      const data = (error as { data?: Record<string, unknown> })?.data;
      const said =
        (typeof data?.detail === 'string' && data.detail) ||
        Object.values(data ?? {})
          .flat()
          .filter((v): v is string => typeof v === 'string')
          .join(' · ');
      setProblem(said || t('admin.maits.activateFailed'));
    }
  };

  return (
    <ScrollView
      ref={scroller}
      innerViewRef={content}
      contentContainerStyle={[styles.body, !!keyboard && { paddingBottom: keyboard + spacing[4] }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={pending.isFetching && !pending.isLoading}
          onRefresh={() => {
            pending.refetch();
            recent.refetch();
          }}
        />
      }
      testID="admin-mait-activate"
    >
      <BackButton onPress={onBack} />

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Disc tone="green" icon="key" size={44} />
          <View style={styles.flex}>
            <AppText style={styles.heroTitle}>{t('admin.maits.activateTitle')}</AppText>
            <AppText style={styles.heroLede}>{t('admin.maits.activateLede')}</AppText>
          </View>
        </View>
      </View>

      {!!done && (
        <Notice
          tone="green"
          icon="checkmark"
          title={done}
          body={t('admin.maits.outcomeHint')}
          testID="admin-mait-activated"
        />
      )}
      {!!problem && (
        <View style={styles.problem} testID="admin-mait-activate-problem">
          <Ionicons name="alert-circle" size={16} color={colors.error} />
          <AppText style={styles.problemText}>{problem}</AppText>
        </View>
      )}

      {/* 1 — who. The queue runs to hundreds, and scrolling a dropdown by eye is how the wrong
          person gets activated: typing a name or a code narrows it first. */}
      <StepCard step={1} tone="yolk" icon="people" title={t('admin.maits.pendingLabel')}>
        <View ref={searchRef} collapsable={false}>
          <Input
            value={term}
            onChangeText={setTerm}
            onFocus={() => api.reveal(searchRef.current)}
            placeholder={t('admin.maits.pendingSearch')}
            testID="admin-mait-pending-search"
          />
        </View>
        <Hint
          text={t('admin.maits.pendingHint', {
            pending: num(summary?.pending_total ?? 0),
            without: num(summary?.without_mobile ?? 0),
          })}
          tone="yolk"
        />
        <View style={styles.pending}>
          {pending.isLoading ? (
            <SkeletonFeed />
          ) : !rows.length ? (
            <AppText style={styles.chipsEmpty}>
              {(pending.data?.results ?? []).length || term
                ? t('admin.maits.noPendingMatch')
                : t('admin.maits.nobodyWaiting')}
            </AppText>
          ) : (
            rows.slice(0, PENDING_SHOWN).map(m => {
              const on = chosen?.sahayak_vendor_code === m.sahayak_vendor_code;
              return (
                <Pressable
                  key={m.sahayak_vendor_code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setChosen(m);
                    setDone(null);
                  }}
                  style={({ pressed }) => [
                    styles.pendingRow,
                    on && styles.pendingRowOn,
                    pressed && styles.pressed,
                  ]}
                  testID={`admin-mait-pending-${m.sahayak_vendor_code}`}
                >
                  <Disc tone={on ? 'green' : 'yolk'} text={initials(m.name)} size={32} />
                  <View style={styles.flex}>
                    <AppText style={styles.pendingName}>{m.name}</AppText>
                    <AppText style={styles.pendingMeta}>
                      {[
                        m.sahayak_vendor_code,
                        m.needs_mobile ? t('admin.maits.state_needsMobile') : m.mobile_no,
                      ].join(' · ')}
                    </AppText>
                  </View>
                  <Ionicons
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={on ? colors.primary : yolk[400]}
                  />
                </Pressable>
              );
            })
          )}
          {rows.length > PENDING_SHOWN && (
            <Hint text={t('admin.maits.showingFirst', { n: PENDING_SHOWN })} />
          )}
        </View>
      </StepCard>

      {/* 2 — where. Read-only on purpose: the assignment is SAP's, and retyping it here would
          put the Mait somewhere SAP disagrees with. */}
      <StepCard step={2} tone="blue" icon="location" title={t('admin.maits.mppLabel')}>
        <View style={styles.readonly} testID="admin-mait-activate-mpp">
          <AppText style={[styles.readonlyText, !chosen && styles.muted]}>
            {chosen
              ? chosen.mpp_count
                ? t('admin.maits.mppAssigned', { count: chosen.mpp_count })
                : t('admin.maits.mppNone')
              : t('admin.maits.chooseFirst')}
          </AppText>
        </View>
        <Hint text={t('admin.maits.mppHint')} />
      </StepCard>

      {/* 3 — the number, twice. It is the only channel into the app. */}
      <StepCard
        step={3}
        tone={matches && valid ? 'green' : 'blue'}
        icon="phone-portrait-outline"
        title={t('admin.maits.mobileLabel')}
      >
        <View ref={numberRef} collapsable={false}>
          <Input
            value={mobile}
            onChangeText={text => setMobile(digits(text))}
            onFocus={() => api.reveal(numberRef.current)}
            keyboardType="number-pad"
            maxLength={10}
            placeholder="90876 55412"
            testID="admin-mait-activate-mobile"
          />
        </View>
        <Hint
          text={
            mobile.length === 10 && !valid
              ? t('admin.maits.mobileBad')
              : t('admin.maits.mobileCheck')
          }
          tone={mobile.length === 10 && !valid ? 'red' : undefined}
        />
        <AppText style={styles.subLabel}>{t('admin.maits.confirmLabel')}</AppText>
        {/* Revealing the first number box keeps both boxes and their hints in view. */}
        <View ref={confirmRef} collapsable={false}>
          <Input
            value={confirm}
            onChangeText={text => setConfirm(digits(text))}
            onFocus={() => api.reveal(numberRef.current ?? confirmRef.current)}
            keyboardType="number-pad"
            maxLength={10}
            placeholder="90876 55412"
            testID="admin-mait-activate-confirm"
          />
        </View>
        <Hint
          text={
            matches
              ? t('admin.maits.confirmOk')
              : confirm.length === 10
                ? t('admin.maits.confirmBad')
                : t('admin.maits.confirmMust')
          }
          tone={matches ? 'green' : confirm.length === 10 ? 'red' : undefined}
        />
      </StepCard>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        onPress={submit}
        disabled={!ready}
        style={({ pressed }) => [
          styles.primary,
          styles.primaryWide,
          !ready && styles.primaryOff,
          pressed && styles.pressed,
        ]}
        testID="admin-mait-activate-submit"
      >
        {activateState.isLoading ? (
          <ActivityIndicator color={colors.surface} />
        ) : (
          <Ionicons name="key" size={18} color={colors.surface} />
        )}
        <AppText style={styles.primaryLabel}>
          {t(activateState.isLoading ? 'admin.maits.activating' : 'admin.maits.activate')}
        </AppText>
      </Pressable>
      <Hint text={t('admin.maits.outcomeHint')} />

      {/* Who already holds a login, newest first — the fastest way to spot a number typed into
          the wrong person. */}
      <StepCard tone="slate" icon="time-outline" title={t('admin.maits.recentTitle')}>
        {recent.isLoading ? (
          <SkeletonFeed />
        ) : !(recent.data?.results ?? []).length ? (
          <AppText style={styles.chipsEmpty}>{t('admin.maits.recentNone')}</AppText>
        ) : (
          (recent.data?.results ?? []).map(user => (
            <View key={user.id} style={styles.recentRow} testID={`admin-mait-recent-${user.id}`}>
              <Disc tone="green" text={initials(user.mait_name || user.full_name)} size={30} />
              <View style={styles.flex}>
                <AppText style={styles.pendingName}>{user.mait_name || user.full_name}</AppText>
                <AppText style={styles.pendingMeta}>
                  {[user.sahayak_vendor_code, user.mobile_no].filter(Boolean).join(' · ')}
                </AppText>
                <AppText style={styles.recentWhen}>{stamp(t, user.created_at)}</AppText>
              </View>
            </View>
          ))
        )}
      </StepCard>
    </ScrollView>
  );
}

// --------------------------------------------------------------------------------------
// The roster
// --------------------------------------------------------------------------------------

export function FilterChip({
  label,
  icon,
  tone,
  active,
  onPress,
  testID,
}: {
  label: string;
  icon: string;
  tone: ToneName;
  active: boolean;
  onPress: () => void;
  testID?: string;
}): React.JSX.Element {
  const look = TONE[tone];
  const fore = active ? look.onSolid : look.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filter,
        {
          backgroundColor: active ? look.solid : look.wash,
          borderColor: active ? look.solid : look.border,
        },
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Ionicons name={icon as never} size={14} color={fore} />
      <AppText style={[styles.filterLabel, { color: fore }]}>{label}</AppText>
    </Pressable>
  );
}

function MaitCard({ mait, onEdit }: { mait: AdminMait; onEdit: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const state = stateOf(mait);
  const tone = STATE_TONE[state];
  const look = TONE[tone];
  const shown = mait.mpp_codes.slice(0, 3).join(', ');

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-mait-${mait.sahayak_vendor_code}`}
    >
      <View style={styles.cardTop}>
        <Disc tone={tone} text={initials(mait.name)} />
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{mait.name}</AppText>
          <View style={[styles.code, { borderColor: look.border }]}>
            <AppText style={[styles.codeLabel, { color: look.text }]}>
              {mait.sahayak_vendor_code}
            </AppText>
          </View>
        </View>
      </View>

      {/* White is paper, only inside a tinted card. */}
      <View style={styles.inset}>
        <View style={[styles.factRow, styles.factRule]}>
          <Ionicons name="location-outline" size={14} color={colors.primaryDark} />
          <AppText style={styles.factLabel}>{t('admin.maits.factMpps')}</AppText>
          <View style={styles.flex}>
            {mait.mpp_count ? (
              <AppText style={styles.factValue}>
                {shown}
                {mait.mpp_count > 3 && (
                  <AppText style={styles.factMore}>
                    {`  ${t('admin.maits.more', { n: mait.mpp_count - 3 })}`}
                  </AppText>
                )}
              </AppText>
            ) : (
              <AppText style={[styles.factValue, styles.muted]}>
                {t('admin.maits.noneAssigned')}
              </AppText>
            )}
          </View>
        </View>
        <View style={styles.factRow}>
          <Ionicons
            name="phone-portrait-outline"
            size={14}
            color={mait.mobile_no ? colors.info : colors.error}
          />
          <AppText style={styles.factLabel}>{t('admin.maits.factMobile')}</AppText>
          <AppText style={[styles.factValue, styles.flex, !mait.mobile_no && styles.factMissing]}>
            {mait.mobile_no || t('admin.maits.notSet')}
          </AppText>
        </View>
      </View>

      <View style={styles.cardFoot}>
        <Pill label={t(`admin.maits.state_${state}`)} tone={tone} />
        <Pressable
          accessibilityRole="button"
          onPress={onEdit}
          style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
          testID={`admin-mait-edit-${mait.sahayak_vendor_code}`}
        >
          <Ionicons name="create-outline" size={15} color={colors.ink} />
          <AppText style={styles.editLabel}>{t('admin.maits.edit')}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

type Mode = { kind: 'list' } | { kind: 'edit'; mait: AdminMait } | { kind: 'activate' };

export default function AdminMaitsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [needsMobile, setNeedsMobile] = useState(false);
  const [notActivated, setNotActivated] = useState(false);
  const [deactivated, setDeactivated] = useState(false);
  const [offset, setOffset] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ search, needsMobile, notActivated, deactivated }),
    [search, needsMobile, notActivated, deactivated],
  );
  const list = useAdminListMaitsQuery({ ...filters, offset });

  // A new search or filter starts the page over.
  useEffect(() => {
    setOffset(0);
  }, [filters]);

  // The roster's own back: the editor and the queue return here first.
  useEffect(() => {
    if (mode.kind === 'list') {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setMode({ kind: 'list' });
      return true;
    });
    return () => sub.remove();
  }, [mode.kind]);

  if (mode.kind === 'edit') {
    return (
      <View style={styles.root}>
        <Editor
          mait={mode.mait}
          onDone={saved => {
            setMode({ kind: 'list' });
            if (saved) {
              setFlash(t('admin.maits.saved', { name: saved.name }));
            }
          }}
        />
      </View>
    );
  }

  if (mode.kind === 'activate') {
    return (
      <View style={styles.root}>
        <Activate onBack={() => setMode({ kind: 'list' })} />
      </View>
    );
  }

  const rows = list.data?.results ?? [];
  const summary = list.data?.summary;
  const total = summary?.total ?? list.data?.count ?? 0;
  const stranded = summary?.without_mobile ?? 0;
  const activated = summary?.activated ?? 0;
  const count = list.data?.count ?? 0;
  const anyFilter = !!(search || needsMobile || notActivated || deactivated);
  const openQueue = () => setMode({ kind: 'activate' });

  // Worded to scale: "1,099 of 1,183" is a rollout problem, "One Mait" is a phone call.
  const backlogTitle =
    stranded === 1
      ? t('admin.maits.backlogOne')
      : t('admin.maits.backlog', {
          stranded: num(stranded),
          total: num(total),
          percent: total ? Math.round((stranded / total) * 100) : 0,
        });
  const waiting = total - activated;
  const clearBody =
    waiting === 0
      ? t('admin.maits.allClearAll', { total: num(total) })
      : waiting === 1
        ? t('admin.maits.allClearOne', { total: num(total) })
        : t('admin.maits.allClearSome', { total: num(total), waiting: num(waiting) });

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
        testID="admin-maits"
      >
        <View style={styles.top}>
          <AppText style={styles.count} testID="admin-maits-count">
            {list.data ? t('admin.maits.onRoster', { count: total, n: num(total) }) : '—'}
          </AppText>
          <Pressable
            accessibilityRole="button"
            onPress={openQueue}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            testID="admin-maits-activate"
          >
            <Ionicons name="key" size={16} color={colors.surface} />
            <AppText style={styles.primaryLabel}>{t('admin.maits.activatePending')}</AppText>
            <Ionicons name="arrow-forward" size={15} color={colors.surface} />
          </Pressable>
        </View>

        {!!flash && (
          <Notice tone="green" icon="checkmark" title={flash} body="" testID="admin-maits-flash" />
        )}

        {/* Three states, one shown at a time: stranded Maits, an empty backlog, or no roster
            at all — the last is a different problem, fixed on the SAP upload screen. */}
        {!!list.data &&
          (!total ? (
            <Notice
              tone="slate"
              icon="cloud-upload-outline"
              title={t('admin.maits.emptyTitle')}
              body={t('admin.maits.emptyBody')}
              testID="admin-maits-empty"
            />
          ) : stranded ? (
            <Notice
              tone="yolk"
              icon="call"
              title={backlogTitle}
              body={t('admin.maits.backlogBody')}
              action={t('admin.maits.openQueue')}
              onAction={openQueue}
              testID="admin-maits-backlog"
            />
          ) : (
            <Notice
              tone="green"
              icon="checkmark"
              title={t('admin.maits.allClearTitle')}
              body={clearBody}
              action={t('admin.maits.queue')}
              onAction={openQueue}
              testID="admin-maits-all-clear"
            />
          ))}

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.info} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={text => {
              setFlash(null);
              setTerm(text);
            }}
            placeholder={t('admin.maits.searchPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            testID="admin-maits-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Toned to what they select: these pull up blocked and waiting work. */}
        <View style={styles.filters}>
          <FilterChip
            label={t('admin.maits.filterNeedsMobile')}
            icon="call-outline"
            tone="red"
            active={needsMobile}
            onPress={() => setNeedsMobile(on => !on)}
            testID="admin-maits-filter-needs-mobile"
          />
          <FilterChip
            label={t('admin.maits.filterNotActivated')}
            icon="time-outline"
            tone="yolk"
            active={notActivated}
            onPress={() => setNotActivated(on => !on)}
            testID="admin-maits-filter-not-activated"
          />
          <FilterChip
            label={t('admin.maits.filterDeactivated')}
            icon="ban-outline"
            tone="red"
            active={deactivated}
            onPress={() => setDeactivated(on => !on)}
            testID="admin-maits-filter-deactivated"
          />
        </View>

        {list.isLoading ? (
          <SkeletonRows />
        ) : list.isError ? (
          <EmptyState message={t('admin.maits.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={anyFilter ? t('admin.maits.noneMatch') : t('admin.maits.none')} />
        ) : (
          rows.map(mait => (
            <MaitCard
              key={mait.id}
              mait={mait}
              onEdit={() => {
                setFlash(null);
                setMode({ kind: 'edit', mait });
              }}
            />
          ))
        )}

        {count > LIMIT && (
          <View style={styles.pager} testID="admin-maits-pager">
            <Pressable
              accessibilityRole="button"
              disabled={offset === 0 || list.isFetching}
              onPress={() => setOffset(o => Math.max(0, o - LIMIT))}
              style={[styles.pageStep, offset === 0 && styles.pageStepOff]}
              testID="admin-maits-prev"
            >
              <Ionicons name="chevron-back" size={16} color={colors.info} />
              <AppText style={styles.pageStepLabel}>{t('admin.maits.prev')}</AppText>
            </Pressable>
            <AppText style={styles.pageOf}>
              {t('admin.maits.pageOf', {
                from: num(offset + 1),
                to: num(Math.min(count, offset + rows.length)),
                total: num(count),
              })}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={offset + LIMIT >= count || list.isFetching}
              onPress={() => setOffset(o => o + LIMIT)}
              style={[styles.pageStep, offset + LIMIT >= count && styles.pageStepOff]}
              testID="admin-maits-next"
            >
              <AppText style={styles.pageStepLabel}>{t('admin.maits.next')}</AppText>
              <Ionicons name="chevron-forward" size={16} color={colors.info} />
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  muted: { color: colors.textMuted },

  top: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[3] },
  count: { ...typography.h3, color: colors.ink, flex: 1, minWidth: 120 },

  // Sized for the whole glyph, not the bare text box: at 11pt with 2pt of padding Android
  // clipped the label's top and tail, and the audit trail's action pills read half cut.
  pill: {
    alignSelf: 'flex-start',
    flexShrink: 0,
    maxWidth: '100%',
    minHeight: 22,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  pillLabel: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: typography.label.fontFamily,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  disc: { alignItems: 'center', justifyContent: 'center' },
  discLabel: { ...typography.label, fontFamily: typography.h3.fontFamily },

  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  backLabel: { ...typography.label, color: colors.surface },

  notice: { padding: spacing[3], gap: spacing[3], borderRadius: radius.lg, borderWidth: 1 },
  noticeHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  noticeTitle: { ...typography.bodyStrong },
  noticeBody: { ...typography.caption, color: colors.ink, marginTop: 2 },
  inkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 40,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  inkButtonLabel: { ...typography.label, color: colors.surface },

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
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  filterLabel: { ...typography.label },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  cardName: { ...typography.h3, color: colors.ink },
  code: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  codeLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], paddingVertical: 7 },
  factRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  factLabel: { ...typography.caption, color: colors.textMuted, width: 52 },
  factValue: { ...typography.label, color: colors.ink },
  factMore: { ...typography.caption, color: colors.textMuted },
  factMissing: { color: colors.error },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  // The portal's Edit is warn-toned: a correction, not the screen's main act.
  edit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: yolk[400],
  },
  editLabel: { ...typography.label, color: colors.ink },

  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  pageStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  pageStepOff: { opacity: 0.4 },
  pageStepLabel: { ...typography.label, color: colors.info },
  pageOf: { ...typography.caption, color: colors.textMuted, textAlign: 'center', flexShrink: 1 },

  hero: {
    padding: spacing[4],
    gap: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroEyebrow: { ...typography.caption, color: colors.surface, opacity: 0.7 },
  heroTitle: { ...typography.h2, color: colors.surface },
  heroCode: { ...typography.label, color: yolk[300] },
  heroLede: { ...typography.caption, color: colors.surface, opacity: 0.8 },
  heroPill: { flexDirection: 'row' },

  step: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  stepChip: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: { ...typography.label, fontFamily: typography.h3.fontFamily },
  stepTitle: { ...typography.h3, flex: 1 },
  input: {
    ...typography.body,
    color: colors.ink,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  hint: { ...typography.caption, color: colors.textMuted },
  subLabel: { ...typography.label, color: colors.ink, marginTop: spacing[1] },
  bubble: {
    minWidth: 26,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  bubbleLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    padding: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: spacing[3],
    paddingRight: spacing[2],
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: green[300],
    backgroundColor: colors.primaryWash,
  },
  chipNew: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { ...typography.label, color: colors.primaryDark },
  chipLabelNew: { color: colors.surface },
  chipsEmpty: { ...typography.caption, color: colors.textMuted, padding: spacing[1] },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  addLabel: { ...typography.label, color: colors.primaryDark },

  suggest: {
    gap: spacing[2],
    padding: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  suggestBusy: { padding: spacing[2] },
  suggestRow: {
    gap: 2,
    padding: spacing[2],
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  suggestTaken: { opacity: 0.55 },
  suggestTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  suggestCode: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
  },
  suggestCodeLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  suggestName: { ...typography.label, color: colors.ink },
  suggestMeta: { ...typography.caption, color: colors.textMuted },
  suggestHolder: { ...typography.caption, color: colors.error },

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

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 42,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryWide: { minHeight: MIN_TOUCH_TARGET + 4 },
  primaryOff: { backgroundColor: ink[200] },
  primaryLabel: { ...typography.label, color: colors.surface },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 42,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  secondaryLabel: { ...typography.label, color: colors.ink },

  pending: { gap: spacing[2] },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: yolk[200],
    backgroundColor: colors.surface,
  },
  pendingRowOn: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primaryWash,
  },
  pendingName: { ...typography.label, color: colors.ink },
  pendingMeta: { ...typography.caption, color: colors.textMuted },
  readonly: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  readonlyText: { ...typography.bodyStrong, color: colors.ink },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  recentWhen: { ...typography.caption, color: colors.textMuted },
});
