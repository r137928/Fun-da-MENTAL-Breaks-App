export const RULE_VERSION: 1;

export type Lane = 'stillness' | 'movement';
export type Goal = 'calm' | 'energy' | 'stress' | 'focus' | 'balance' | 'less_sitting';
export type TimeBucket = 'one_two' | 'five' | 'ten_fifteen' | 'twenty_forty_plus';
export type Setting = 'seated' | 'indoors' | 'outdoors';
export type ReasonCode = 'short_stillness' | 'gentle_reset' | 'vibe_match' | 'saved_preference' |
  'goal_match' | 'comfort_match' | 'chosen_lane' | 'time_fit';

export interface RecommendationMetadata {
  min_seconds: number;
  default_seconds: number;
  max_seconds: number;
  effort: 'gentle' | 'moderate' | 'high';
  settings: readonly Setting[];
  setting_required?: boolean;
  vibes: readonly string[];
  goals: readonly Goal[];
}

export interface RecommendationCatalog {
  version: number;
  activities: readonly { id: string; lane: Lane; recommendation?: RecommendationMetadata }[];
}

export interface RecommendationBlueprint {
  goal?: Goal;
  comfort?: Lane | 'balanced' | 'depends';
  now?: { duration: TimeBucket };
  target?: { duration: TimeBucket };
  optional?: { day_context?: readonly string[] };
  activities?: readonly {
    activity: { activity_id?: string | null };
    tag: 'now_often' | 'now_rare' | 'goal' | 'not_for_me';
  }[];
}

export interface RecommendationContext {
  mind_before?: number;
  time_bucket?: TimeBucket;
  available_seconds?: number;
  vibe_words?: readonly string[];
  lane?: Lane;
  setting?: Setting;
}

export interface Suggestion {
  activity_id: string;
  lane: Lane;
  duration_seconds: number;
  reason_code: ReasonCode;
}

export interface Recommendation {
  rule_version: typeof RULE_VERSION;
  catalog_version: number;
  best_fit: Suggestion | null;
  alternatives: Record<Lane, Suggestion[]>;
}

export interface BreakDay<Window extends string> {
  count: number;
  windows: readonly Window[];
}

export interface BreakPlan<Window extends string> {
  weekdays: readonly number[];
  windows: readonly Window[];
  overrides: Readonly<Record<string, BreakDay<Window>>>;
}

export function recommendBreak(
  catalog: RecommendationCatalog,
  blueprint: RecommendationBlueprint | null,
  context: RecommendationContext,
): Recommendation;

export function breakTimeLimit(bucket?: TimeBucket, availableSeconds?: number): number;
export function resolveBreakDay<Window extends string>(plan: BreakPlan<Window>, localDate: string): BreakDay<Window>;
export function buildWeeklyPlan(weeklyCount: number, chosenDays: readonly number[]): number[];
