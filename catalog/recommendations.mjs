export const RULE_VERSION = 1;

const lanes = ['stillness', 'movement'];
const timeLimits = { one_two: 120, five: 300, ten_fifteen: 900, twenty_forty_plus: 86_400 };
const targetSeconds = { one_two: 120, five: 300, ten_fifteen: 600, twenty_forty_plus: 1200 };
const preferenceScores = { now_often: 16, goal: 14, now_rare: 6 };
const longestDefault = 40 * 60;

export function breakTimeLimit(bucket, availableSeconds = longestDefault) {
  return Math.min(availableSeconds, timeLimits[bucket] ?? timeLimits.twenty_forty_plus);
}

function timeBudget(blueprint, context) {
  if (context.available_seconds !== undefined) {
    return breakTimeLimit(context.time_bucket, context.available_seconds);
  }
  const bucket = context.time_bucket ?? blueprint?.target?.duration ?? blueprint?.now?.duration ?? 'one_two';
  return breakTimeLimit(bucket);
}

function compareRank(first, second) {
  return second.score - first.score || first.catalogOrder - second.catalogOrder;
}

export function recommendBreak(catalog, blueprint, context) {
  const budget = timeBudget(blueprint, context);
  const vibes = new Set(context.vibe_words);
  const desiredSeconds = targetSeconds[blueprint?.target?.duration];
  const lowMind = context.mind_before !== undefined && context.mind_before <= 4;
  const favorsShortSeatedBreak = !context.setting && vibes.size <= 1 &&
    blueprint?.optional?.day_context?.some(entry => entry === 'desk' || entry === 'commuting');
  const preferences = new Map();
  for (const { activity, tag } of blueprint?.activities ?? []) {
    if (activity.activity_id && preferences.get(activity.activity_id) !== 'not_for_me') {
      preferences.set(activity.activity_id, tag);
    }
  }

  const ranked = { stillness: [], movement: [] };
  for (const [catalogOrder, { id, lane, recommendation }] of catalog.activities.entries()) {
    const tag = preferences.get(id);
    if (!recommendation || tag === 'not_for_me' || recommendation.min_seconds > budget) continue;
    if (context.setting ? !recommendation.settings.includes(context.setting) : recommendation.setting_required) continue;
    if (recommendation.effort === 'high' && (context.mind_before === undefined || lowMind)) continue;

    const vibeScore = recommendation.vibes.filter(vibe => vibes.has(vibe)).length * 26;
    const preferenceScore = preferenceScores[tag] ?? 0;
    const goalScore = recommendation.goals.includes(blueprint?.goal) ? 12 : 0;
    const comfortScore = blueprint?.comfort === lane ? 18 : 0;
    const gentleScore = lowMind && recommendation.effort === 'gentle' ? 10 : 0;
    const effortPenalty = lowMind && recommendation.effort === 'moderate' ? 12 : 0;
    const durationFits = desiredSeconds !== undefined && desiredSeconds <= budget &&
      desiredSeconds >= recommendation.min_seconds && desiredSeconds <= recommendation.max_seconds;
    const routineFits = favorsShortSeatedBreak && recommendation.effort === 'gentle' &&
      recommendation.default_seconds <= timeLimits.one_two && recommendation.settings.includes('seated');
    const durationScore = durationFits ? 8 : 0;
    const routineScore = routineFits ? 6 : 0;
    const shortStillness = lane === 'stillness' && id === 'breathing' && budget < timeLimits.five;
    const reason_code = shortStillness ? 'short_stillness'
      : vibeScore ? 'vibe_match'
      : gentleScore ? 'gentle_reset'
      : comfortScore ? 'comfort_match'
      : preferenceScore ? 'saved_preference'
      : goalScore ? 'goal_match'
      : context.lane === lane ? 'chosen_lane'
      : 'time_fit';

    ranked[lane].push({
      shortStillness,
      catalogOrder,
      score: vibeScore + preferenceScore + goalScore + comfortScore + gentleScore + durationScore + routineScore -
        effortPenalty,
      suggestion: {
        activity_id: id,
        lane,
        duration_seconds: Math.min(budget, recommendation.max_seconds,
          Math.max(recommendation.min_seconds, desiredSeconds ?? recommendation.default_seconds)),
        reason_code,
      },
    });
  }

  for (const lane of lanes) {
    ranked[lane].sort((first, second) => Number(second.shortStillness) - Number(first.shortStillness) ||
      compareRank(first, second));
  }
  const laneLeaders = lanes.map(lane => ranked[lane][0]).filter(Boolean);
  const best_fit = (context.lane ? ranked[context.lane][0] : laneLeaders.sort(compareRank)[0])?.suggestion ?? null;
  const alternatives = lane => ranked[lane].map(entry => entry.suggestion).filter(item => item !== best_fit).slice(0, 4);

  return {
    rule_version: RULE_VERSION,
    catalog_version: catalog.version,
    best_fit,
    alternatives: { stillness: alternatives('stillness'), movement: alternatives('movement') },
  };
}

export function resolveBreakDay(plan, localDate) {
  const date = new Date(localDate + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== localDate) {
    throw new RangeError('Expected a local date in YYYY-MM-DD form');
  }

  const override = plan.overrides[localDate];
  if (override) return { count: override.count, windows: [...override.windows] };

  const weekday = (date.getUTCDay() + 6) % 7;
  return { count: plan.weekdays[weekday], windows: [...plan.windows] };
}

export function buildWeeklyPlan(weeklyCount, chosenDays) {
  const days = [...new Set(chosenDays)].sort((first, second) => first - second);
  if (days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new RangeError('Choose days between Monday (0) and Sunday (6)');
  }
  if (!Number.isInteger(weeklyCount) || weeklyCount < 0 || weeklyCount > days.length * 10) {
    throw new RangeError('Weekly break count must fit within 10 breaks per selected day');
  }

  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  if (weeklyCount === 0) return weekdays;

  const perDay = Math.floor(weeklyCount / days.length);
  const remainder = weeklyCount % days.length;
  for (const [index, day] of days.entries()) {
    weekdays[day] = perDay + (index < remainder ? 1 : 0);
  }
  return weekdays;
}
