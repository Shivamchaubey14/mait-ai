/**
 * OTP pipeline, for an admin — the portal's `otp-pipeline.html` (W23) on a handset.
 *
 * Did the code reach the phone — and was the office right to be asked for one? Every code the
 * platform sends (sign-in, the farmer check, her authorising a payment) is read back through the
 * four stations of its pipeline: made, accepted by the gateway, typed in, used. Beside them,
 * every Super OTP ask, judged on the SMS the same number was sent for the same step just before.
 *
 * **The gateway never says delivered.** It confirms it took a message, nothing more. So a code
 * is "arrived" only on proof — somebody typed into it — and one the gateway accepted that
 * expired untouched, and was not merely replaced by a resend, is "likely lost". The server
 * decides all of that once (`apps/dashboard/otp_pipeline.py`); this screen only draws it.
 *
 * **A verdict is for information.** "Asked early" or "already through" is a question for the
 * office to ask on the phone, never a reason to refuse — every ask card says so, and Super OTP
 * is one tap away.
 *
 * Colours are the trail's own: proof of arrival green, likely lost yellow, never left and used up
 * red, still in flight blue, history slate. Polled every thirty seconds, as the portal is.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { EmptyState } from '@/components';
import { SkeletonOverview } from '@/components/skeleton';
import { initials } from '@/components/frame';
import { useAdminOtpPipelineQuery } from '@api/endpoints';
import type { OtpPipeline, PipelineAsk, PipelineCode, PipelineStep } from '@api/types';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { auditTone } from './AdminAuditScreen';
import { Disc, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';
import { ago } from './AdminSuperOtpScreen';
import { Button } from './AdminUsersScreen';
import { useDebounced } from './common';

const PAGE = 25;
export const REFRESH_MS = 30000;
const WINDOWS = [1, 7, 30] as const;

function stamp(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function n(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('en-IN');
}

function share(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 100) : 0;
}

/** A station's colour by what happened there. */
const STEP_TONE: Record<PipelineStep['state'], ToneName> = {
  done: 'green',
  failed: 'red',
  waiting: 'yolk',
  skipped: 'slate',
};

// --------------------------------------------------------------------------------------
// Parts
// --------------------------------------------------------------------------------------

function Tile({
  tone,
  icon,
  label,
  value,
  foot,
  testID,
}: {
  tone: ToneName;
  icon: string;
  label: string;
  value: string;
  foot: string;
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
      <AppText style={styles.hint} testID={`${testID}-foot`}>
        {foot}
      </AppText>
    </View>
  );
}

function Bar({ percent, tone }: { percent: number; tone: ToneName }): React.JSX.Element {
  return (
    <View style={styles.bar}>
      <View
        style={[
          styles.barFill,
          { width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: TONE[tone].solid },
        ]}
      />
    </View>
  );
}

/** Four dots joined by lines — one per station, coloured by what happened there. */
export function Pipe({ steps, testID }: { steps: PipelineStep[]; testID?: string }) {
  return (
    <View style={styles.pipe} testID={testID}>
      {steps.map((step, index) => {
        const look = TONE[STEP_TONE[step.state]];
        return (
          <React.Fragment key={step.key}>
            {index > 0 && <View style={styles.pipeLine} />}
            <View style={styles.pipeStation}>
              <View
                style={[
                  styles.pipeDot,
                  step.state === 'done' || step.state === 'failed'
                    ? { backgroundColor: look.solid, borderColor: look.solid }
                    : { borderColor: step.state === 'waiting' ? look.solid : ink[300] },
                  step.state === 'skipped' && styles.pipeSkipped,
                ]}
                testID={testID ? `${testID}-${step.key}-${step.state}` : undefined}
              >
                {step.state === 'done' && (
                  <Ionicons name="checkmark" size={10} color={look.onSolid} />
                )}
                {step.state === 'failed' && (
                  <Ionicons name="close" size={10} color={look.onSolid} />
                )}
              </View>
              <AppText style={styles.pipeLabel} numberOfLines={2}>
                {step.label}
              </AppText>
            </View>
          </React.Fragment>
        );
      })}
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
// The sections
// --------------------------------------------------------------------------------------

function Gateway({ data }: { data: OtpPipeline }): React.JSX.Element {
  const { t } = useTranslation();
  const g = data.gateway;
  const tone: ToneName = g.checked ? auditTone(g.tone) : 'blue';
  const look = TONE[tone];
  return (
    <View
      style={[styles.gateway, { backgroundColor: look.wash, borderColor: look.border }]}
      testID="admin-pipeline-gateway"
    >
      <Disc
        tone={tone}
        icon={!g.checked ? 'radio-outline' : tone === 'green' ? 'checkmark-done' : 'cloud-offline'}
        size={34}
      />
      <View style={styles.flex}>
        <AppText style={[styles.name, { color: look.text }]}>
          {g.checked
            ? t('admin.pipeline.gatewayTitle', {
                provider: g.provider ? `(${g.provider}) ` : '',
                accepted: g.accepted,
                checked: g.checked,
              })
            : t('admin.pipeline.gatewayNone')}
        </AppText>
        <AppText style={styles.hint}>
          {!g.checked
            ? t('admin.pipeline.gatewayNoneBody')
            : g.accepted === g.checked
              ? t('admin.pipeline.gatewayAll')
              : g.accepted
                ? t('admin.pipeline.gatewaySome')
                : t('admin.pipeline.gatewayNoneLeft')}
          {g.last_accepted_at
            ? ` ${t('admin.pipeline.lastAccepted', { when: stamp(t, g.last_accepted_at) })}`
            : ''}
        </AppText>
      </View>
    </View>
  );
}

function Funnel({ data }: { data: OtpPipeline }): React.JSX.Element {
  const { t } = useTranslation();
  const f = data.summary.funnel;
  const stations: { key: string; label: string; value: number; tone: ToneName }[] = [
    { key: 'made', label: t('admin.pipeline.stMade'), value: f.made, tone: 'blue' },
    {
      key: 'accepted',
      label: t('admin.pipeline.stAccepted'),
      value: f.accepted,
      tone: f.accepted < f.made ? 'red' : 'blue',
    },
    { key: 'arrived', label: t('admin.pipeline.stArrived'), value: f.arrived, tone: 'green' },
    { key: 'verified', label: t('admin.pipeline.stVerified'), value: f.verified, tone: 'green' },
  ];
  return (
    <View style={styles.panel} testID="admin-pipeline-funnel">
      {stations.map((station, index) => (
        <View key={station.key} style={styles.station}>
          <View style={styles.row}>
            <AppText style={[styles.stationLabel, styles.flex]}>{station.label}</AppText>
            <AppText style={styles.stationValue} testID={`admin-pipeline-funnel-${station.key}`}>
              {n(station.value)}
              {index > 0 ? (
                <AppText style={styles.hint}>{` · ${share(station.value, f.made)}%`}</AppText>
              ) : null}
            </AppText>
          </View>
          <Bar percent={index ? share(station.value, f.made) : 100} tone={station.tone} />
        </View>
      ))}

      {data.by_purpose.length > 0 && (
        <View style={styles.inset}>
          {data.by_purpose.map(step => (
            <View key={step.key} style={styles.stepRow} testID={`admin-pipeline-step-${step.key}`}>
              <AppText style={[styles.value, styles.flex]}>{step.label}</AppText>
              <AppText style={styles.hint}>
                {t('admin.pipeline.stepLine', {
                  made: n(step.made),
                  arrived: n(step.arrived),
                  verified: n(step.verified),
                })}
              </AppText>
              <Pill
                label={
                  step.arrival_rate === null
                    ? t('admin.pipeline.notKnown')
                    : `${step.arrival_rate}%`
                }
                tone={
                  step.arrival_rate === null ? 'slate' : step.arrival_rate >= 80 ? 'green' : 'yolk'
                }
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function AskCard({ ask }: { ask: PipelineAsk }): React.JSX.Element {
  const { t } = useTranslation();
  const tone = auditTone(ask.verdict.tone);
  const look = TONE[tone];
  const sms = ask.sms;
  const name = ask.for_farmer ? ask.farmer_name || t('admin.pipeline.theFarmer') : ask.full_name;
  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-pipeline-ask-${ask.id}`}
    >
      <View style={styles.row}>
        <Disc tone={ask.for_farmer ? 'blue' : tone} text={initials(name)} size={34} />
        <View style={styles.flex}>
          <AppText style={styles.name}>{name}</AppText>
          <AppText style={styles.hint}>
            {ask.for_farmer
              ? [ask.context, t('admin.pipeline.askedBy', { name: ask.full_name })]
                  .filter(Boolean)
                  .join(' · ')
              : ask.mobile_no}
          </AppText>
        </View>
        <Pill label={ask.verdict.label} tone={tone} />
      </View>

      <View style={styles.inset}>
        <View style={styles.wrap}>
          <Pill label={ask.step} tone={ask.for_farmer ? 'blue' : 'slate'} />
          <Pill label={ask.status_display} tone={ask.state === 'waiting' ? 'yolk' : 'slate'} />
          {ask.for_farmer && <AppText style={styles.code}>{ask.mobile_no}</AppText>}
        </View>
        <AppText style={styles.hint} testID={`admin-pipeline-ask-asked-${ask.id}`}>
          {ask.phoned
            ? t('admin.pipeline.phoned')
            : `${t('admin.pipeline.asked', { when: ago(t, ask.asked_at) })}${
                ask.request_count > 1
                  ? ` · ${t('admin.pipeline.times', { n: ask.request_count })}`
                  : ''
              }`}
          {ask.reason ? ` · “${ask.reason}”` : ''}
        </AppText>
        <View style={styles.smsLine} testID={`admin-pipeline-ask-sms-${ask.id}`}>
          <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.textMuted} />
          <AppText style={[styles.hint, styles.flex]}>
            {!sms
              ? t('admin.pipeline.noSmsBefore')
              : [
                  sms.minutes_before < 1
                    ? t('admin.pipeline.underMinute')
                    : t('admin.pipeline.minBefore', { n: sms.minutes_before }),
                  t(sms.accepted ? 'admin.pipeline.accepted' : 'admin.pipeline.notAccepted'),
                  sms.by_office
                    ? t('admin.pipeline.closedByOffice')
                    : sms.verified
                      ? t('admin.pipeline.used')
                      : sms.attempt_count
                        ? t('admin.pipeline.typedN', { n: sms.attempt_count })
                        : t('admin.pipeline.nothingTyped'),
                ].join(' · ')}
          </AppText>
        </View>
        <AppText style={styles.value} testID={`admin-pipeline-ask-detail-${ask.id}`}>
          {ask.verdict.detail}
        </AppText>
        {ask.through_by_sms_after && (
          <AppText style={[styles.hint, { color: TONE.green.text }]}>
            {t('admin.pipeline.throughAfter')}
          </AppText>
        )}
        {/* Said on every card: a verdict is the kind of thing that hardens into a rule. */}
        <AppText style={styles.note}>{t('admin.pipeline.forInfo')}</AppText>
      </View>
    </View>
  );
}

function CodeCard({
  code,
  open,
  onToggle,
}: {
  code: PipelineCode;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = auditTone(code.tone);
  const look = TONE[tone];
  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-pipeline-code-${code.id}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.gap, pressed && styles.pressed]}
        testID={`admin-pipeline-code-toggle-${code.id}`}
      >
        <View style={styles.row}>
          <Disc tone={tone} text={initials(code.who.name)} size={34} />
          <View style={styles.flex}>
            <AppText style={styles.name}>{code.who.name}</AppText>
            <AppText style={styles.hint} numberOfLines={1}>
              {[code.step, code.mobile_no].join(' · ')}
            </AppText>
          </View>
          <View style={styles.whenCol}>
            <AppText style={styles.when}>{stamp(t, code.sent_at)}</AppText>
            <AppText style={styles.hint}>{ago(t, code.sent_at)}</AppText>
          </View>
        </View>
        <View style={styles.inset}>
          <Pipe steps={code.steps} testID={`admin-pipeline-pipe-${code.id}`} />
        </View>
        <View style={styles.row}>
          <Pill label={code.stage_display} tone={tone} />
          <AppText
            style={[
              styles.hint,
              styles.flex,
              code.arrived === 'yes' && { color: TONE.green.text },
              code.arrived === 'no' && { color: TONE.red.text },
            ]}
            testID={`admin-pipeline-arrived-${code.id}`}
          >
            {t(`admin.pipeline.arrived_${code.arrived}`)}
          </AppText>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </View>
      </Pressable>

      {open && (
        <View style={styles.inset} testID={`admin-pipeline-code-detail-${code.id}`}>
          <AppText style={styles.value}>{code.guidance}</AppText>
          {!!code.who.detail && <Fact label={t('admin.pipeline.whose')} value={code.who.detail} />}
          <Fact
            label={t('admin.pipeline.tries')}
            value={t('admin.pipeline.triesOf', { n: code.attempt_count, max: code.max_attempts })}
          />
          <Fact label={t('admin.pipeline.sentAt')} value={stamp(t, code.sent_at)} />
          <Fact label={t('admin.pipeline.expiresAt')} value={stamp(t, code.expires_at)} />
          {!!code.verified_at && (
            <Fact label={t('admin.pipeline.verifiedAt')} value={stamp(t, code.verified_at)} />
          )}
          <Fact label={t('admin.pipeline.sentVia')} value={code.sent_via || '—'} />
          <Fact label={t('admin.pipeline.gatewayRef')} value={code.gateway_message_id || '—'} />
          {code.blocking && (
            <Fact
              label={t('admin.pipeline.holdingUp')}
              value={t('admin.pipeline.aiEvent', {
                id: code.blocking.ai_event_id,
                amount: Math.round(Number(code.blocking.amount)).toLocaleString('en-IN'),
                mode: code.blocking.mode,
              })}
            />
          )}
        </View>
      )}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.fact}>
      <AppText style={styles.factLabel}>{label}</AppText>
      <AppText style={styles.factValue}>{value}</AppText>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// The screen
// --------------------------------------------------------------------------------------

export default function AdminOtpPipelineScreen({
  onOpenSection,
}: {
  onOpenSection?: (key: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const scroller = useRef<ScrollView>(null);
  const [days, setDays] = useState<number>(7);
  const [purpose, setPurpose] = useState('');
  const [stage, setStage] = useState('');
  const [verdict, setVerdict] = useState('');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim(), 300);
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);

  // Any change to what is asked starts from the first page.
  const asked = useMemo(() => ({ days, purpose, stage, search }), [days, purpose, stage, search]);
  const [last, setLast] = useState(asked);
  if (last !== asked) {
    setLast(asked);
    setOffset(0);
    setOpenId(null);
  }

  const pipeline = useAdminOtpPipelineQuery(
    { ...asked, verdict, offset },
    { pollingInterval: REFRESH_MS },
  );
  const data = pipeline.data;

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={pipeline.isFetching && !pipeline.isLoading}
            onRefresh={() => pipeline.refetch()}
          />
        }
        testID="admin-pipeline"
      >
        <View style={styles.row}>
          <Disc tone="blue" icon="git-commit" size={36} />
          <View style={styles.flex}>
            <AppText style={styles.title}>{t('admin.pipeline.title')}</AppText>
            <AppText style={styles.hint}>{t('admin.pipeline.subtitle')}</AppText>
          </View>
        </View>

        {/* Blue: what the screen can know. It stops "accepted" being read as "delivered". */}
        <Notice
          tone="blue"
          icon="information-circle"
          title={t('admin.pipeline.ruleTitle')}
          body={t('admin.pipeline.ruleBody')}
          testID="admin-pipeline-rule"
        />

        <View style={styles.wrap}>
          {WINDOWS.map(w => (
            <FilterChip
              key={w}
              label={t(w === 1 ? 'admin.pipeline.last24' : 'admin.pipeline.lastDays', { n: w })}
              icon="calendar"
              tone="blue"
              active={days === w}
              onPress={() => setDays(w)}
              testID={`admin-pipeline-days-${w}`}
            />
          ))}
        </View>

        {pipeline.isLoading ? (
          <SkeletonOverview />
        ) : pipeline.isError || !data ? (
          <EmptyState message={t('admin.pipeline.error')} />
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile
                tone="blue"
                icon="paper-plane"
                label={t('admin.pipeline.tileSent')}
                value={n(data.summary.funnel.made)}
                foot={t('admin.pipeline.tileSentFoot', { n: n(data.summary.funnel.accepted) })}
                testID="admin-pipeline-tile-sent"
              />
              <Tile
                tone="green"
                icon="phone-portrait"
                label={t('admin.pipeline.tileArrived')}
                value={data.summary.arrival_rate === null ? '—' : `${data.summary.arrival_rate}%`}
                foot={t('admin.pipeline.tileArrivedFoot', {
                  n: n(data.summary.funnel.arrived),
                })}
                testID="admin-pipeline-tile-arrived"
              />
            </View>
            <View style={styles.tiles}>
              <Tile
                tone="yolk"
                icon="help-buoy"
                label={t('admin.pipeline.tileLost')}
                value={n(data.summary.likely_lost)}
                foot={t('admin.pipeline.tileLostFoot')}
                testID="admin-pipeline-tile-lost"
              />
              <Tile
                tone="red"
                icon="cloud-offline"
                label={t('admin.pipeline.tileNever')}
                value={n(data.summary.never_left)}
                foot={t('admin.pipeline.tileNeverFoot')}
                testID="admin-pipeline-tile-never"
              />
            </View>

            <Gateway data={data} />

            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.info} />
              <TextInput
                style={styles.searchInput}
                value={term}
                onChangeText={setTerm}
                placeholder={t('admin.pipeline.searchPlaceholder')}
                placeholderTextColor={colors.textDisabled}
                autoCorrect={false}
                autoCapitalize="none"
                testID="admin-pipeline-search"
              />
              {term.length > 0 && (
                <Pressable onPress={() => setTerm('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </Pressable>
              )}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              <FilterChip
                label={t('admin.pipeline.everyStep')}
                icon="layers"
                tone="slate"
                active={purpose === ''}
                onPress={() => setPurpose('')}
                testID="admin-pipeline-purpose-all"
              />
              {data.steps.map(step => (
                <FilterChip
                  key={step.key}
                  label={step.label}
                  icon={step.key === 'login' ? 'log-in' : 'person'}
                  tone="blue"
                  active={purpose === step.key}
                  onPress={() => setPurpose(step.key)}
                  testID={`admin-pipeline-purpose-${step.key}`}
                />
              ))}
            </ScrollView>

            <Head
              icon="git-commit"
              tone="blue"
              title={t('admin.pipeline.thePipeline')}
              count={t(days === 1 ? 'admin.pipeline.last24' : 'admin.pipeline.lastDays', {
                n: days,
              })}
            />
            <Funnel data={data} />

            <Head
              icon="key"
              tone="yolk"
              title={t('admin.pipeline.asksTitle')}
              count={t('admin.pipeline.asksN', { count: data.asks_count })}
              testID="admin-pipeline-asks-count"
            />
            <AppText style={styles.hint}>{t('admin.pipeline.asksNote')}</AppText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              <FilterChip
                label={t('admin.pipeline.everyAsk')}
                icon="list"
                tone="slate"
                active={verdict === ''}
                onPress={() => setVerdict('')}
                testID="admin-pipeline-verdict-all"
              />
              {data.verdicts.map(v => (
                <FilterChip
                  key={v.key}
                  label={`${v.label} ${n(v.count)}`}
                  icon="ellipse"
                  tone={auditTone(v.tone)}
                  active={verdict === v.key}
                  onPress={() => setVerdict(v.key)}
                  testID={`admin-pipeline-verdict-${v.key}`}
                />
              ))}
            </ScrollView>
            {data.asks.length === 0 ? (
              <EmptyState
                message={t(verdict ? 'admin.pipeline.noAskMatch' : 'admin.pipeline.noAsks')}
              />
            ) : (
              data.asks.map(ask => <AskCard key={ask.id} ask={ask} />)
            )}
            {onOpenSection && (
              <Button
                label={t('admin.pipeline.openSuperOtp')}
                icon="key"
                tone="ink"
                outline
                onPress={() => onOpenSection('super-otp')}
                testID="admin-pipeline-open-superotp"
              />
            )}

            <Head
              icon="list"
              tone="slate"
              title={t('admin.pipeline.everyCodeTitle')}
              count={t('admin.pipeline.codesN', { count: data.count })}
              testID="admin-pipeline-codes-count"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              <FilterChip
                label={t('admin.pipeline.everyCode')}
                icon="list"
                tone="slate"
                active={stage === ''}
                onPress={() => setStage('')}
                testID="admin-pipeline-stage-all"
              />
              {data.stages.map(s => (
                <FilterChip
                  key={s.key}
                  label={`${s.label} ${n(s.count)}`}
                  icon="ellipse"
                  tone={auditTone(s.tone)}
                  active={stage === s.key}
                  onPress={() => setStage(s.key)}
                  testID={`admin-pipeline-stage-${s.key}`}
                />
              ))}
            </ScrollView>
            {data.results.length === 0 ? (
              <EmptyState
                message={t(
                  stage || search || purpose
                    ? 'admin.pipeline.noCodeMatch'
                    : 'admin.pipeline.noCodes',
                )}
              />
            ) : (
              data.results.map(code => (
                <CodeCard
                  key={code.id}
                  code={code}
                  open={openId === code.id}
                  onToggle={() => setOpenId(o => (o === code.id ? null : code.id))}
                />
              ))
            )}

            {data.count > PAGE && (
              <View style={styles.row}>
                <Button
                  label={t('admin.pipeline.previous')}
                  icon="chevron-back"
                  tone="blue"
                  outline
                  disabled={offset === 0 || pipeline.isFetching}
                  onPress={() => {
                    setOffset(o => Math.max(0, o - PAGE));
                    scroller.current?.scrollTo({ y: 0, animated: true });
                  }}
                  testID="admin-pipeline-prev"
                />
                <AppText
                  style={[styles.hint, styles.flex, styles.center]}
                  testID="admin-pipeline-page"
                >
                  {t('admin.pipeline.pageOf', {
                    from: offset + 1,
                    to: Math.min(offset + PAGE, data.count),
                    count: data.count,
                  })}
                </AppText>
                <Button
                  label={t('admin.pipeline.next')}
                  icon="chevron-forward"
                  tone="blue"
                  outline
                  disabled={offset + PAGE >= data.count || pipeline.isFetching}
                  onPress={() => {
                    setOffset(o => o + PAGE);
                    scroller.current?.scrollTo({ y: 0, animated: true });
                  }}
                  testID="admin-pipeline-next"
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  gap: { gap: spacing[2] },
  center: { textAlign: 'center' },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chips: { gap: spacing[2], paddingRight: spacing[4] },
  title: { ...typography.h3, color: colors.ink },
  head: { marginTop: spacing[2] },
  headTitle: { ...typography.h3, color: colors.ink },
  hint: { ...typography.caption, color: colors.textMuted },
  note: { ...typography.caption, color: colors.info, fontStyle: 'italic' },
  value: { ...typography.label, color: colors.ink },
  name: { ...typography.bodyStrong, color: colors.ink },
  count: { ...typography.label, color: colors.info },
  code: { ...typography.caption, color: colors.ink, fontVariant: ['tabular-nums'] },

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

  gateway: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.lg,
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

  panel: {
    padding: spacing[3],
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: TONE.blue.border,
    backgroundColor: TONE.blue.wash,
  },
  station: { gap: 6 },
  stationLabel: { ...typography.label, color: colors.ink },
  stationValue: { ...typography.h3, color: colors.ink },
  bar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 4 },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  inset: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  smsLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  whenCol: { alignItems: 'flex-end' },
  when: { ...typography.caption, color: colors.ink, fontFamily: typography.label.fontFamily },

  pipe: { flexDirection: 'row', alignItems: 'flex-start' },
  pipeStation: { alignItems: 'center', width: 64, gap: 4 },
  pipeDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  pipeSkipped: { borderStyle: 'dashed' },
  pipeLine: { flex: 1, height: 2, marginTop: 9, backgroundColor: ink[200] },
  pipeLabel: { ...typography.caption, fontSize: 10, color: colors.textMuted, textAlign: 'center' },

  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] },
  factLabel: { ...typography.caption, color: colors.textMuted },
  factValue: { ...typography.label, color: colors.ink, flexShrink: 1, textAlign: 'right' },
});
