"""Small, rule-based NLU for conversational study and fitness planning.

The interpreter is deliberately separate from the simulation models. It keeps
only short-lived in-process session state and returns normalized slots with
confidence and provenance so the chat can clarify before comparing anything.

Examples handled:
    "I've got a week off and I'm torn between gym and assignments"
        -> 7 days, gym/assignment decision topic
    "maybe a couple weeks; an hour and a half a day"
        -> 14 days (lower confidence), 1.5 hours/day
    "I usually do okay but not always"
        -> consistency score 4/5
    "I said 2 hours a day but maybe 5 hours"
        -> update hours/day to the later correction, recording the old value.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

from pydantic import BaseModel, Field


class InterpretRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=2000)


class ExtractedValue(BaseModel):
    value: str | int | float
    confidence: float = Field(ge=0, le=1)
    source: str
    assumed: bool = False


class PlanningFields(BaseModel):
    decision_topic: ExtractedValue | None = None
    time_horizon_days: ExtractedValue | None = None
    hours_per_day: ExtractedValue | None = None
    assignment_load: ExtractedValue | None = None
    workout_duration_hours: ExtractedValue | None = None
    gym_goal: ExtractedValue | None = None
    consistency_pattern: ExtractedValue | None = None


class InterpretResponse(BaseModel):
    session_id: str
    active: bool
    fields: PlanningFields
    unresolved: list[str]
    assumptions: list[str]
    corrections: list[str]
    needs_confirmation: bool
    ready: bool
    summary: str | None = None
    assistant_message: str | None = None


FIELD_QUESTIONS = {
    "time_horizon_days": "Roughly how long is the break—days or weeks?",
    "hours_per_day": "About how many hours a day could you realistically use for these plans?",
    "assignment_load": "How much work is waiting for you: a specific assignment, several tasks, or just generally behind?",
    "workout_duration_hours": "When you do go to the gym, about how long would a session be?",
    "gym_goal": "What would you most like the gym time to do for you? Getting fitter, building strength, feeling better, or something else?",
    "consistency_pattern": "Thinking about similar plans, how often do you tend to follow through—rarely, sometimes, usually, or nearly always?",
}

FIELD_ORDER = [
    "time_horizon_days", "hours_per_day", "assignment_load",
    "workout_duration_hours", "gym_goal", "consistency_pattern",
]

_NUMBER_WORDS = {
    "a": 1.0, "an": 1.0, "one": 1.0, "half": 0.5,
    "couple": 2.0, "two": 2.0, "three": 3.0, "four": 4.0,
    "five": 5.0, "six": 6.0, "seven": 7.0, "eight": 8.0,
    "nine": 9.0, "ten": 10.0, "few": 3.0,
}


def _number(token: str) -> float | None:
    token = token.lower().strip()
    try:
        return float(token)
    except ValueError:
        return _NUMBER_WORDS.get(token)


def _confidence(text: str, base: float = 0.92) -> float:
    if re.search(r"\b(?:maybe|perhaps|not sure|i think|about|around|roughly|approximately|ish|a bit)\b", text, re.I):
        return min(base, 0.72)
    return base


def _normalize_typos(text: str) -> str:
    """Fix a few high-confidence domain typos before running slot patterns."""
    for misspelling, correction in {
        "assignemnt": "assignment", "assigment": "assignment",
        "workuot": "workout", "excersize": "exercise", "wrok": "work",
    }.items():
        text = re.sub(rf"\b{misspelling}\b", correction, text, flags=re.I)
    return text


def _hours(text: str) -> list[tuple[float, str, int]]:
    found: list[tuple[float, str, int]] = []
    half_hour = re.compile(r"\b(?:an?|one)\s+hour\s+and\s+a\s+half\b", re.I)
    for match in half_hour.finditer(text):
        found.append((1.5, match.group(), match.start()))
    patterns = [
        re.compile(r"\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s*(?:hours?|hrs?|h)\b", re.I),
        re.compile(r"\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s+and\s+a\s+half\s+hours?\b", re.I),
    ]
    for pattern in patterns:
        for match in pattern.finditer(text):
            if any(start == match.start() for _, _, start in found):
                continue
            value = _number(match.group(1))
            if value is not None:
                if "and a half" in match.group().lower():
                    value += 0.5
                found.append((value, match.group(), match.start()))
    minutes = re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b", re.I)
    for match in minutes.finditer(text):
        found.append((float(match.group(1)) / 60, match.group(), match.start()))
    return sorted(found, key=lambda item: item[2])


def _extract(text: str, prompted_field: str | None = None) -> dict[str, tuple[str | int | float, float, str]]:
    text = _normalize_typos(text)
    lower = text.lower()
    result: dict[str, tuple[str | int | float, float, str]] = {}

    has_fitness = bool(re.search(r"\b(?:gym|workout|exercise|fitness|fit|shape)\b", lower))
    has_work = bool(re.search(r"\b(?:assignments?|coursework|exam|study|work)\b", lower))
    has_decision_cue = bool(re.search(r"\b(?:torn between|deciding between|choose between|choosing between|week off|time off|vacation|holiday)\b", lower))
    if (has_fitness and has_work) or ((has_fitness or has_work) and has_decision_cue):
        options = re.search(r"\b(?:torn between|deciding between|choose between|choosing between)\s+(.+?)(?:[,;.!?]|$)", text, re.I)
        if options:
            topic = f"using time off for {options.group(1).strip()}"
        elif has_fitness and has_work:
            topic = "balancing a fitness goal with work or assignments"
        else:
            topic = re.sub(r"\s+", " ", text).strip()
        result["decision_topic"] = (topic, 0.85, text)

    day_matches: list[tuple[int, str, int]] = []
    for match in re.finditer(r"\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s*(days?|weeks?|fortnights?)\b", lower):
        count = _number(match.group(1))
        if count is None:
            continue
        unit = match.group(2)
        days = count * (14 if unit.startswith("fortnight") else 7 if unit.startswith("week") else 1)
        day_matches.append((round(days), match.group(), match.start()))
    if re.search(r"\b(?:a|one)\s+week\s+off\b", lower) and not day_matches:
        day_matches.append((7, "a week off", lower.index("week")))
    if day_matches:
        value, source, _ = day_matches[-1]
        result["time_horizon_days"] = (value, _confidence(text), source)

    hours = _hours(text)
    for value, source, position in hours:
        context = lower[max(0, position - 24):min(len(lower), position + len(source) + 32)]
        daily = bool(re.search(r"\b(?:a|per)\s+day|daily|each day|every day\b", context))
        if daily:
            target = "hours_per_day"
        elif re.search(r"\b(?:gym|workout|exercise|session)\b", context):
            target = "workout_duration_hours"
        elif re.search(r"\b(?:assignment|coursework|work|study)\b", context):
            target = "assignment_load"
        elif prompted_field in {"hours_per_day", "workout_duration_hours"}:
            target = prompted_field
        else:
            continue
        normalized: str | int | float = f"{value:g} hours" if target == "assignment_load" else value
        result[target] = (normalized, _confidence(text), source)

    # A textual follow-through pattern also gives a normalized 1–5 score.
    consistency_patterns = [
        (r"\b(?:rarely|almost never|hardly ever|not often)\b", 1),
        (r"\b(?:sometimes|some of the time|occasionally)\b", 2),
        (r"\b(?:usually|most of the time|more often than not)\b", 4),
        (r"\b(?:almost always|nearly always|always)\b", 5),
    ]
    consistency_hits = [
        (match.start(), score, match.group())
        for pattern, score in consistency_patterns
        for match in re.finditer(pattern, lower)
        if not (score == 5 and re.search(r"\bnot\s+$", lower[max(0, match.start() - 5):match.start()]))
    ]
    if consistency_hits:
        _, score, source = max(consistency_hits)
        result["consistency_pattern"] = (score, _confidence(text, 0.86), source)

    assignment = re.search(r"\b(?:(?:a bit|a little|quite|very|really)\s+)?behind on\s+(?:my\s+)?(?:work|assignments?|coursework|tasks?)\b|\bcatching up on\s+(?:my\s+)?(?:work|assignments?|coursework|tasks?)\b|\b(?:not much|a little|some|a lot of|several|multiple|one|two|three|\d+)\s+(?:my\s+)?(?:work|assignments?|coursework|tasks?)\b|\b(?:work|assignments?|coursework)\s+(?:is|are)\s+(?:piling up|overdue|unfinished)\b", text, re.I)
    if assignment is None and prompted_field == "assignment_load":
        assignment = re.search(r"\b(?:not much|a little|a bit|some|quite a bit|a lot|one|two|three|\d+)\b", text, re.I)
    if assignment:
        phrase = re.sub(r"\s+", " ", assignment.group()).strip()
        result["assignment_load"] = (phrase, _confidence(text, 0.88), assignment.group())
    goal = re.search(r"\b(?:want|hope|trying|looking)\s+(?:to\s+)?(?:get|be|feel|build|improve|become)\s+(.{2,70}?)(?:[,.;!?]|\bbut\b|\bwhile\b|$)", text, re.I)
    if goal and re.search(r"\b(?:fit|shape|strong|muscle|health|fitness|energy|weight|exercise|gym)\b", goal.group(1), re.I):
        action = re.search(r"\b(?:get|be|feel|build|improve|become)\b", goal.group(), re.I)
        goal_value = f"{action.group().lower()} {goal.group(1).strip()}" if action else goal.group(1).strip()
        result["gym_goal"] = (goal_value, _confidence(text, 0.82), goal.group())
    elif re.search(r"\b(?:get in shape|build muscle|get fitter|improve my fitness|feel healthier|lose weight)\b", lower):
        match = re.search(r"\b(?:get in shape|build muscle|get fitter|improve my fitness|feel healthier|lose weight)\b", text, re.I)
        result["gym_goal"] = (match.group().lower(), 0.9, match.group())

    return result


@dataclass
class _Session:
    fields: dict[str, ExtractedValue] = field(default_factory=dict)
    unresolved: list[str] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    corrections: list[str] = field(default_factory=list)
    turns: int = 0
    awaiting_confirmation: bool = False
    confirming_field: str | None = None
    prompted_field: str | None = None
    last_seen: float = field(default_factory=time.monotonic)


_SESSIONS: dict[str, _Session] = {}
_SESSION_TTL_SECONDS = 60 * 60 * 12
_MAX_SESSIONS = 1000


def reset_sessions() -> None:
    """Clear volatile state; useful for tests and local development."""
    _SESSIONS.clear()


def _summary(fields: dict[str, ExtractedValue]) -> str:
    parts: list[str] = []
    if "decision_topic" in fields:
        parts.append(f"you’re weighing {fields['decision_topic'].value}")
    if "time_horizon_days" in fields:
        parts.append(f"you have about {fields['time_horizon_days'].value} days")
    if "hours_per_day" in fields:
        parts.append(f"around {fields['hours_per_day'].value:g} hours a day")
    if "assignment_load" in fields:
        parts.append(f"your work load is {fields['assignment_load'].value}")
    if "workout_duration_hours" in fields:
        parts.append(f"gym sessions would be about {fields['workout_duration_hours'].value:g} hours")
    if "gym_goal" in fields:
        parts.append(f"your gym goal is {fields['gym_goal'].value}")
    if "consistency_pattern" in fields:
        labels = {1: "rarely", 2: "sometimes", 3: "about half the time", 4: "usually", 5: "nearly always"}
        parts.append(f"you follow through {labels[int(fields['consistency_pattern'].value)]}")
    return "I’ve got it: " + "; ".join(parts) + ". Does that sound right?"


def _typed_fields(fields: dict[str, ExtractedValue]) -> PlanningFields:
    return PlanningFields(**fields)


def interpret_turn(request: InterpretRequest) -> InterpretResponse:
    now = time.monotonic()
    for key, state in list(_SESSIONS.items()):
        if now - state.last_seen > _SESSION_TTL_SECONDS:
            del _SESSIONS[key]
    if request.session_id not in _SESSIONS and len(_SESSIONS) >= _MAX_SESSIONS:
        oldest = min(_SESSIONS, key=lambda key: _SESSIONS[key].last_seen)
        del _SESSIONS[oldest]
    state = _SESSIONS.setdefault(request.session_id, _Session())
    state.last_seen = now
    state.turns += 1

    extracted = _extract(request.text, state.prompted_field)
    lower_text = request.text.lower()
    relevant = bool(state.fields) or (
        bool(re.search(r"\b(?:gym|workout|exercise|fitness|fit|shape)\b", lower_text))
        and bool(re.search(r"\b(?:assignments?|coursework|exam|study|work)\b", lower_text))
    )
    if not relevant and not state.fields:
        return InterpretResponse(session_id=request.session_id, active=False, fields=PlanningFields(), unresolved=[], assumptions=[], corrections=[], needs_confirmation=False, ready=False)

    for name, (value, confidence, source) in extracted.items():
        old = state.fields.get(name)
        if old is not None and old.value != value:
            state.corrections.append(f"{name}: updated from {old.value!r} to {value!r} based on your latest message")
        state.fields[name] = ExtractedValue(value=value, confidence=confidence, source=source)
        if name == state.confirming_field:
            state.confirming_field = None
            state.prompted_field = None

    # Capture self-corrections made within a single message too (e.g. "2 hours,
    # actually maybe 5"), while using the last mentioned value as the update.
    hour_mentions = _hours(request.text)
    if len(hour_mentions) > 1 and re.search(r"\b(?:but|actually|rather|wait|maybe)\b", request.text, re.I):
        state.corrections.append(
            f"hours: treated {hour_mentions[-1][0]:g} as the corrected value after also seeing {hour_mentions[0][0]:g}"
        )

    # A direct yes confirms the displayed summary; a correction takes precedence
    # because extracted fields are merged above before this check.
    affirmative = re.fullmatch(r"\s*(?:yes|yeah|yep|correct|that's right|that is right|sounds right|exactly|right)(?:[, ]+(?:that sounds right|sounds right|that's right|that is right))?\s*[.!]?\s*", request.text, re.I)
    negative = re.fullmatch(r"\s*(?:no|nope|not quite|that's wrong|that is wrong)\s*[.!]?\s*", request.text, re.I)
    if state.confirming_field and affirmative and not extracted:
        field_name = state.confirming_field
        state.fields[field_name] = state.fields[field_name].model_copy(update={"confidence": 0.9})
        state.confirming_field = None
        state.prompted_field = None
    elif state.confirming_field and negative and not extracted:
        field_name = state.confirming_field
        state.confirming_field = None
        state.prompted_field = field_name
        return InterpretResponse(session_id=request.session_id, active=True, fields=_typed_fields(state.fields), unresolved=[field_name], assumptions=state.assumptions, corrections=state.corrections, needs_confirmation=False, ready=False, summary=_summary(state.fields), assistant_message=f"No problem. {FIELD_QUESTIONS[field_name]}")
    elif state.awaiting_confirmation and affirmative and not extracted:
        state.awaiting_confirmation = False
        return InterpretResponse(session_id=request.session_id, active=True, fields=_typed_fields(state.fields), unresolved=[], assumptions=state.assumptions, corrections=state.corrections, needs_confirmation=False, ready=True, summary=_summary(state.fields), assistant_message="Great, I’ll use that. Let’s compare the two plans.")
    if state.awaiting_confirmation and negative and not extracted:
        state.awaiting_confirmation = False
        return InterpretResponse(session_id=request.session_id, active=True, fields=_typed_fields(state.fields), unresolved=["correction"], assumptions=state.assumptions, corrections=state.corrections, needs_confirmation=False, ready=False, summary=_summary(state.fields), assistant_message="No problem. What did I get wrong? You can just correct that part.")

    missing = [name for name in FIELD_ORDER if name not in state.fields]
    low_confidence = [name for name in FIELD_ORDER if name in state.fields and state.fields[name].confidence < 0.75]
    state.unresolved = missing + low_confidence
    if missing:
        field_name = missing[0]
        message = FIELD_QUESTIONS[field_name]
        state.prompted_field = field_name
        summary_so_far = _summary(state.fields).removesuffix(" Does that sound right?")
        message = f"{summary_so_far} Does that sound right so far? {message}"
        return InterpretResponse(session_id=request.session_id, active=True, fields=_typed_fields(state.fields), unresolved=state.unresolved, assumptions=state.assumptions, corrections=state.corrections, needs_confirmation=False, ready=False, assistant_message=message)
    if low_confidence:
        name = low_confidence[0]
        value = state.fields[name].value
        state.confirming_field = name
        state.prompted_field = name
        if name == "time_horizon_days":
            clarification = f"I took “{state.fields[name].source}” to mean about {value} days. Did you mean roughly {value} days?"
        elif name == "hours_per_day":
            clarification = f"I heard about {value} hours a day. Does that sound right?"
        else:
            clarification = f"I heard {value}. Does that sound right, or would you put it another way?"
        return InterpretResponse(session_id=request.session_id, active=True, fields=_typed_fields(state.fields), unresolved=low_confidence, assumptions=state.assumptions, corrections=state.corrections, needs_confirmation=True, ready=False, summary=_summary(state.fields), assistant_message=clarification)

    state.awaiting_confirmation = True
    return InterpretResponse(session_id=request.session_id, active=True, fields=_typed_fields(state.fields), unresolved=[], assumptions=state.assumptions, corrections=state.corrections, needs_confirmation=True, ready=False, summary=_summary(state.fields), assistant_message=_summary(state.fields))
