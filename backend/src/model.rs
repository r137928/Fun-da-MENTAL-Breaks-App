use std::{
    collections::{BTreeMap, HashSet},
    sync::LazyLock,
};

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::ApiError;

macro_rules! string_enum {
    ($name:ident { $($variant:ident),+ }) => {
        #[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }
    }
}
string_enum!(Method {
    SelfDeclared,
    AppleAgeRange
});
string_enum!(Goal {
    Calm,
    Energy,
    Stress,
    Focus,
    Balance,
    LessSitting
});
string_enum!(Lane {
    Stillness,
    Movement
});
string_enum!(Comfort {
    Stillness,
    Movement,
    Balanced,
    Depends
});
string_enum!(Tag {
    NowOften,
    NowRare,
    Goal,
    NotForMe
});
string_enum!(Duration {
    OneTwo,
    Five,
    TenFifteen,
    TwentyFortyPlus
});
string_enum!(Window {
    Morning,
    Midday,
    Afternoon,
    Evening
});
string_enum!(Tone {
    Calm,
    Playful,
    Straightforward,
    Kind,
    Challenge
});
string_enum!(Nudge {
    OneAndDone,
    MaxThree,
    Snooze,
    Quiet,
    Depends
});
string_enum!(Support {
    ExtraSupport,
    Minimal
});
string_enum!(Visibility {
    Highlight,
    Track,
    Hide
});
string_enum!(BreakSource {
    Onboarding,
    Manual,
    Reminder,
    ManualLog
});

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Eligibility {
    pub eligible: bool,
    pub method: Method,
    pub policy_version: i32,
}
impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SelfDeclared => "self_declared",
            Self::AppleAgeRange => "apple_age_range",
        }
    }
}

#[derive(Deserialize)]
struct CatalogItem {
    id: String,
    lane: Lane,
}
#[derive(Deserialize)]
struct Catalog {
    version: u32,
    activities: Vec<CatalogItem>,
    bundles: Vec<CatalogItem>,
    trackers: Vec<String>,
    vibes: Vec<String>,
}
static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../catalog/v1.json")).expect("valid bundled catalog")
});

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Baseline {
    pub color_hex: String,
    pub mental_balance: u8,
    pub body_presence_pct: u8,
    pub breaks_per_day: u8,
    pub duration: Duration,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Activity {
    pub lane: Lane,
    pub activity_id: Option<String>,
    pub custom_name: Option<String>,
}

impl Activity {
    fn validate(&self) -> Result<(), ApiError> {
        match (&self.activity_id, &self.custom_name) {
            (Some(id), None)
                if CATALOG
                    .activities
                    .iter()
                    .any(|item| &item.id == id && item.lane == self.lane) =>
            {
                Ok(())
            }
            (None, Some(name)) if valid_text(name, 60) => Ok(()),
            _ => Err(ApiError::invalid("activity")),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preference {
    pub activity: Activity,
    pub tag: Tag,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DayOverride {
    pub count: u8,
    pub windows: Vec<Window>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub weekdays: [u8; 7],
    pub windows: Vec<Window>,
    pub overrides: BTreeMap<NaiveDate, DayOverride>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Buddy {
    pub tone: Tone,
    pub nudge: Nudge,
    pub support: Support,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct OptionalPreferences {
    pub break_check_completed: bool,
    pub fact_card_id_shown: Option<String>,
    pub familiarity: Vec<String>,
    pub barriers: Vec<String>,
    pub benefits: BTreeMap<String, Benefit>,
    pub day_context: Vec<String>,
    pub cards: BTreeMap<String, Visibility>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Benefit {
    pub felt_it: bool,
    pub want_more: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Blueprint {
    pub schema_version: u32,
    pub catalog_version: u32,
    pub nickname: Option<String>,
    pub goal: Goal,
    pub now: Baseline,
    pub target: Baseline,
    pub comfort: Comfort,
    pub activities: Vec<Preference>,
    pub plan: Plan,
    pub buddy: Buddy,
    pub optional: OptionalPreferences,
}

impl Blueprint {
    pub fn validate(&self) -> Result<(), ApiError> {
        if self.schema_version != 1 || self.catalog_version != CATALOG.version {
            return Err(ApiError::invalid("version"));
        }
        if self.nickname.as_ref().is_some_and(|s| !valid_text(s, 40)) {
            return Err(ApiError::invalid("nickname"));
        }
        for baseline in [&self.now, &self.target] {
            let color = baseline.color_hex.as_bytes();
            if color.len() != 7 || color[0] != b'#' || !color[1..].iter().all(u8::is_ascii_hexdigit)
            {
                return Err(ApiError::invalid("color_hex"));
            }
            if !(1..=10).contains(&baseline.mental_balance)
                || baseline.body_presence_pct > 100
                || baseline.breaks_per_day > 10
            {
                return Err(ApiError::invalid("baseline"));
            }
        }
        if self.activities.len() > 40 {
            return Err(ApiError::invalid("activities"));
        }
        let mut seen = HashSet::new();
        for preference in &self.activities {
            let activity = &preference.activity;
            activity.validate()?;
            let key = (
                activity.lane,
                &activity.activity_id,
                activity
                    .custom_name
                    .as_ref()
                    .map(|name| name.trim().to_lowercase()),
            );
            if !seen.insert(key) {
                return Err(ApiError::invalid("duplicate_activity"));
            }
        }
        if self.plan.weekdays.iter().any(|count| *count > 10)
            || !unique(&self.plan.windows)
            || self.plan.overrides.len() > 366
            || self
                .plan
                .overrides
                .values()
                .any(|day| day.count > 10 || !unique(&day.windows))
        {
            return Err(ApiError::invalid("plan"));
        }
        self.optional.validate()
    }

    pub fn apply_card_defaults(&mut self) {
        let preferred = match self.goal {
            Goal::Focus => "focus_mode",
            Goal::Energy => "energy_reset",
            Goal::LessSitting => "body_loosener",
            Goal::Stress => "breath_buddy",
            Goal::Calm | Goal::Balance => "calm_mind",
        };
        let stillness = match preferred {
            "focus_mode" | "breath_buddy" => preferred,
            _ if self.activities.iter().any(|p| {
                p.activity.activity_id.as_deref() == Some("breathing")
                    && matches!(p.tag, Tag::NowOften | Tag::Goal)
            }) =>
            {
                "breath_buddy"
            }
            _ => "calm_mind",
        };
        let movement = match preferred {
            "body_loosener" | "energy_reset" => preferred,
            _ if self.activities.iter().any(|p| {
                p.activity.activity_id.as_deref() == Some("stretch")
                    && matches!(p.tag, Tag::NowOften | Tag::Goal)
            }) =>
            {
                "body_loosener"
            }
            _ => "energy_reset",
        };
        for bundle in &CATALOG.bundles {
            self.optional.cards.entry(bundle.id.clone()).or_insert(
                if bundle.id == stillness || bundle.id == movement {
                    Visibility::Highlight
                } else {
                    Visibility::Track
                },
            );
        }
        for tracker in &CATALOG.trackers {
            self.optional
                .cards
                .entry(tracker.clone())
                .or_insert(Visibility::Track);
        }
    }
}

impl OptionalPreferences {
    fn validate(&self) -> Result<(), ApiError> {
        if self
            .fact_card_id_shown
            .as_deref()
            .is_some_and(|id| id != "microbreaks_2022")
            || !valid_codes(
                &self.familiarity,
                &[
                    "intentional",
                    "sometimes",
                    "mind_running",
                    "rarely",
                    "new",
                    "unsure",
                    "mind_nonstop",
                ],
            )
            || !valid_codes(
                &self.barriers,
                &[
                    "busy",
                    "forget",
                    "screens",
                    "guilt",
                    "environment",
                    "unsure",
                    "caught_up",
                    "varies",
                    "mind_running",
                    "tension",
                    "energy",
                    "scattered",
                ],
            )
            || !valid_codes(
                &self.day_context,
                &["desk", "commuting", "active", "people", "quiet", "variable"],
            )
            || !self.benefits.keys().all(|key| {
                [
                    "clear",
                    "calm",
                    "energy",
                    "focus",
                    "mood",
                    "tension",
                    "presence",
                    "quiet_mind",
                    "patience",
                    "unwind",
                ]
                .contains(&key.as_str())
            })
            || !self.cards.keys().all(|key| {
                CATALOG.trackers.contains(key)
                    || CATALOG.bundles.iter().any(|bundle| &bundle.id == key)
            })
        {
            return Err(ApiError::invalid("optional_preferences"));
        }
        Ok(())
    }
}

fn valid_text(text: &str, max: usize) -> bool {
    !text.trim().is_empty() && text.chars().count() <= max && !text.chars().any(char::is_control)
}

fn unique<T: Eq + std::hash::Hash>(items: &[T]) -> bool {
    items.iter().collect::<HashSet<_>>().len() == items.len()
}

fn valid_codes(values: &[String], choices: &[&str]) -> bool {
    values.len() <= choices.len()
        && unique(values)
        && values.iter().all(|value| choices.contains(&value.as_str()))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletedBreak {
    pub id: Uuid,
    pub completed_at: DateTime<Utc>,
    pub time_zone: String,
    pub activity: Activity,
    pub duration_seconds: u32,
    pub time_bucket: Duration,
    pub vibe_words: Vec<String>,
    pub mind_before: Option<u8>,
    pub mind_after: u8,
    pub presence_pct: u8,
    pub source: BreakSource,
}

impl CompletedBreak {
    pub fn validate(&self) -> Result<(), ApiError> {
        self.activity.validate()?;
        let manual_log = self.source == BreakSource::ManualLog;
        if self.id.is_nil()
            || self.completed_at > Utc::now() + chrono::Duration::minutes(5)
            || self.time_zone.parse::<chrono_tz::Tz>().is_err()
            || self.duration_seconds == 0
            || self.duration_seconds > 86_400
            || !manual_log && (self.mind_before.is_none() || self.vibe_words.is_empty())
            || self.mind_before.is_some_and(|n| !(1..=10).contains(&n))
            || !(1..=10).contains(&self.mind_after)
            || self.presence_pct > 100
            || self.vibe_words.len() > 3
            || !unique(&self.vibe_words)
            || !self
                .vibe_words
                .iter()
                .all(|word| CATALOG.vibes.contains(word))
        {
            return Err(ApiError::invalid("completed_break"));
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveBlueprint {
    pub request_id: Uuid,
    pub expected_revision: Option<i64>,
    pub blueprint: Blueprint,
    pub first_break: Option<CompletedBreak>,
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
pub struct Saved {
    pub revision: i64,
    pub break_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct Me {
    pub user_id: Uuid,
    pub setup_complete: bool,
    pub blueprint: Option<Blueprint>,
    pub revision: Option<i64>,
    pub recent_breaks: Vec<CompletedBreak>,
}
