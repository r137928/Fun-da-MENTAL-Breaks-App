import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export function parse<T>(schema: z.ZodType<T>, data: unknown, code: string): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new ApiError(422, code);
  return result.data;
}

export const unauthorized = () => new ApiError(401, 'sign_in_required');
export const unavailable = () => new ApiError(503, 'provider_unavailable');

const int = (min: number, max = Number.MAX_SAFE_INTEGER) => z.number().int().min(min).max(max);
export const text = (max: number) => z.string().refine(
  value => value.trim().length > 0 && [...value].length <= max && !/\p{Cc}/u.test(value),
);
export const uuid = z.string()
  .regex(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i)
  .transform(value => value.toLowerCase());
const nonNilId = uuid.refine(value => value !== '00000000-0000-0000-0000-000000000000');
const hexColor = z.string().regex(/^#[\da-f]{6}$/i);
const mindScore = int(1, 10);
const presenceScore = int(0, 100);
const lane = z.enum(['stillness', 'movement']);
const goal = z.enum(['calm', 'energy', 'stress', 'focus', 'balance', 'less_sitting']);
const timeBucket = z.enum(['one_two', 'five', 'ten_fifteen', 'twenty_forty_plus']);
const windows = z.array(z.enum(['morning', 'midday', 'afternoon', 'evening']))
  .refine(unique);
const visibility = z.enum(['highlight', 'track', 'hide']);

const catalogItem = z.object({ id: text(80), name: text(100), lane });
export const catalogUrl = new URL('../../catalog/v1.json', import.meta.url);
const catalog = z.object({
  version: int(1),
  activities: z.array(catalogItem),
  bundles: z.array(catalogItem),
  trackers: z.array(z.string()),
  vibes: z.array(z.string()),
}).parse(JSON.parse(readFileSync(catalogUrl, 'utf8')));

const activities = new Map(catalog.activities.map(item => [item.id, item]));
const cards = new Set([...catalog.bundles.map(item => item.id), ...catalog.trackers]);

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

const choiceList = (values: [string, ...string[]]) =>
  z.array(z.enum(values)).refine(unique).default([]);

function normalizeTimestamp(value: string) {
  const instant = new Date(value).toISOString().slice(0, 19);
  const significant = (/\.(\d+)/.exec(value)?.[1] ?? '').replace(/0+$/, '');
  if (!significant) return instant + 'Z';
  const size = significant.length <= 3 ? 3 : significant.length <= 6 ? 6 : 9;
  return instant + '.' + significant.padEnd(size, '0') + 'Z';
}

const timestamp = z.iso.datetime({ offset: true, local: false })
  .refine(value => Number.isFinite(Date.parse(value)) && (/\.(\d+)/.exec(value)?.[1]?.length ?? 0) <= 9)
  .transform(normalizeTimestamp);

export const EligibilitySchema = z.strictObject({
  eligible: z.boolean(),
  method: z.enum(['apple_age_range', 'self_declared']),
  policy_version: int(1, 2147483647),
});
export type Eligibility = z.infer<typeof EligibilitySchema>;

const baseline = z.strictObject({
  color_hex: hexColor,
  mental_balance: mindScore,
  body_presence_pct: presenceScore,
  breaks_per_day: int(0, 10),
  duration: timeBucket,
});

const activity = z.strictObject({
  lane,
  activity_id: z.string().nullable().default(null),
  custom_name: text(60).nullable().default(null),
}).refine(value => value.activity_id === null
  ? value.custom_name !== null
  : value.custom_name === null && activities.get(value.activity_id)?.lane === value.lane);

type Activity = z.infer<typeof activity>;

function activityTitle(value: Activity): string {
  if (value.custom_name !== null) return value.custom_name;
  const item = value.activity_id === null ? undefined : activities.get(value.activity_id);
  if (!item) throw new ApiError(422, 'activity');
  return item.name;
}

const taggedActivity = z.strictObject({
  activity,
  tag: z.enum(['now_often', 'now_rare', 'goal', 'not_for_me']),
});

function hasUniqueActivities(values: Array<z.infer<typeof taggedActivity>>) {
  return unique(values.map(({ activity: item }) =>
    JSON.stringify([item.lane, item.activity_id, item.custom_name?.trim().toLowerCase()])));
}

const optional = z.strictObject({
  break_check_completed: z.boolean().default(false),
  fact_card_id_shown: z.literal('microbreaks_2022').nullable().default(null),
  familiarity: choiceList(['intentional', 'sometimes', 'mind_running', 'rarely', 'new', 'unsure', 'mind_nonstop']),
  barriers: choiceList(['busy', 'forget', 'screens', 'guilt', 'environment', 'unsure', 'caught_up',
    'varies', 'mind_running', 'tension', 'energy', 'scattered']),
  benefits: z.record(
    z.string().refine(key => ['clear', 'calm', 'energy', 'focus', 'mood', 'tension', 'presence',
      'quiet_mind', 'patience', 'unwind'].includes(key)),
    z.strictObject({ felt_it: z.boolean(), want_more: z.boolean() }),
  ).default({}),
  day_context: choiceList(['desk', 'commuting', 'active', 'people', 'quiet', 'variable']),
  cards: z.record(z.string().refine(key => cards.has(key)), visibility).default({}),
});

export const BlueprintSchema = z.strictObject({
  schema_version: z.literal(1),
  catalog_version: z.literal(catalog.version),
  nickname: text(40).nullable().default(null),
  goal,
  now: baseline,
  target: baseline,
  comfort: z.enum(['stillness', 'movement', 'balanced', 'depends']),
  activities: z.array(taggedActivity).max(40).refine(hasUniqueActivities),
  plan: z.strictObject({
    weekdays: z.array(int(0, 10)).length(7),
    windows,
    overrides: z.record(z.iso.date(), z.strictObject({ count: int(0, 10), windows }))
      .refine(entries => Object.keys(entries).length <= 366),
  }),
  buddy: z.strictObject({
    tone: z.enum(['calm', 'playful', 'straightforward', 'kind', 'challenge']),
    nudge: z.enum(['one_and_done', 'max_three', 'snooze', 'quiet', 'depends']),
    support: z.enum(['extra_support', 'minimal']),
  }),
  optional,
});
export type Blueprint = z.infer<typeof BlueprintSchema>;

export function applyCardDefaults(blueprint: Blueprint) {
  const preferred = (id: string) => blueprint.activities.some(({ activity, tag }) =>
    activity.activity_id === id && (tag === 'now_often' || tag === 'goal'));
  const still = blueprint.goal === 'focus' ? 'focus_mode' :
    blueprint.goal === 'stress' || preferred('breathing') ? 'breath_buddy' : 'calm_mind';
  const movement = blueprint.goal === 'less_sitting' ||
    (blueprint.goal !== 'energy' && preferred('stretch')) ? 'body_loosener' : 'energy_reset';

  for (const item of catalog.bundles) {
    blueprint.optional.cards[item.id] ??= item.id === still || item.id === movement ? 'highlight' : 'track';
  }
  for (const id of catalog.trackers) blueprint.optional.cards[id] ??= 'track';
}

export const BreakSchema = z.strictObject({
  title: text(100),
  break_type: text(40),
  duration: int(1, 86_400),
  icon: text(200).optional(),
});
export type Break = z.infer<typeof BreakSchema>;

export const CompletedBreakSchema = z.strictObject({
  id: nonNilId,
  completed_at: timestamp,
  time_zone: z.string().refine(value => {
    try {
      Intl.DateTimeFormat('en', { timeZone: value });
      return !/^[+-]/.test(value);
    } catch (error) {
      if (error instanceof RangeError) return false;
      throw error;
    }
  }),
  activity,
  duration_seconds: int(1, 86_400),
  time_bucket: timeBucket,
  vibe_words: z.array(z.string()).max(3)
    .refine(values => unique(values) && values.every(word => catalog.vibes.includes(word))),
  mind_before: mindScore.nullable().default(null),
  mind_after: mindScore,
  presence_pct: presenceScore,
  source: z.enum(['onboarding', 'manual', 'reminder', 'manual_log']),
  break: BreakSchema.optional(),
}).refine(value =>
  (value.source === 'manual_log' || (value.mind_before !== null && value.vibe_words.length > 0)) &&
  (!value.break || (value.break.break_type === value.activity.lane &&
    value.break.duration === value.duration_seconds)));
export type CompletedBreak = z.infer<typeof CompletedBreakSchema>;

export function toBreak(record: CompletedBreak): Break {
  return record.break ?? {
    title: record.activity.custom_name ?? activities.get(record.activity.activity_id ?? '')?.name ??
      record.activity.activity_id ?? record.activity.lane,
    break_type: record.activity.lane,
    duration: record.duration_seconds,
  };
}

export const SaveBlueprintSchema = z.strictObject({
  request_id: nonNilId,
  expected_revision: int(1).nullable().default(null),
  blueprint: BlueprintSchema,
  first_break: CompletedBreakSchema.nullable().default(null),
});
export type SaveBlueprint = z.infer<typeof SaveBlueprintSchema>;

export function validateNewBreak(record: CompletedBreak) {
  if (Date.parse(record.completed_at) > Date.now() + 5 * 60 * 1000) {
    throw new ApiError(422, 'completed_break');
  }
}

function sortKeys<T>(value: Record<string, T>) {
  return Object.fromEntries(Object.entries(value).sort(([first], [next]) =>
    first < next ? -1 : first > next ? 1 : 0));
}

// Match the Rust v1 struct order and its BTreeMap order for pre-port retry receipts.
export function legacyRequestHash(input: SaveBlueprint) {
  const blueprint = input.blueprint;
  const payload = {
    ...input,
    blueprint: {
      ...blueprint,
      plan: { ...blueprint.plan, overrides: sortKeys(blueprint.plan.overrides) },
      optional: {
        ...blueprint.optional,
        benefits: sortKeys(blueprint.optional.benefits),
        cards: sortKeys(blueprint.optional.cards),
      },
    },
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest();
}

export function emailAddress(value: string) {
  const email = value.trim().toLowerCase();
  const [local, domain, extra] = email.split('@');
  if (email.length > 254 || /[^\x21-\x7e]/.test(email) || !local || !domain ||
      extra !== undefined || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    throw new ApiError(422, 'email');
  }
  return email;
}

const profileFields = {
  email: text(254).optional(),
  phone: int(1).optional(),
  gender: text(80),
  name: text(120),
  nickname: text(40).optional(),
  age: int(1, 150),
  mind_score: mindScore,
  presence_score: presenceScore,
  break_pref: z.array(text(100)).max(40).optional(),
  goals: z.array(text(120)).max(40).optional(),
  color_palette: z.tuple([z.tuple([z.literal('now'), hexColor]), z.tuple([z.literal('goal'), hexColor])]).optional(),
};

export const ProfileInputSchema = z.strictObject(profileFields);
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export const UserSchema = z.strictObject({
  user_id: int(1),
  created_at: timestamp,
  ...profileFields,
  password: z.string().min(1),
  role: text(40),
});
export type User = z.infer<typeof UserSchema>;

export function publicUser({ password: _credential, ...user }: User) {
  return user;
}

export function profileFromBlueprint(profile: ProfileInput, blueprint: Blueprint): ProfileInput {
  return {
    ...profile,
    ...(profile.nickname || blueprint.nickname === null ? {} : { nickname: blueprint.nickname }),
    mind_score: blueprint.now.mental_balance,
    presence_score: blueprint.now.body_presence_pct,
    break_pref: profile.break_pref ?? blueprint.activities.filter(item => item.tag !== 'not_for_me')
      .map(item => activityTitle(item.activity)),
    goals: profile.goals ?? [blueprint.goal],
    color_palette: profile.color_palette ?? [['now', blueprint.now.color_hex], ['goal', blueprint.target.color_hex]],
  };
}
