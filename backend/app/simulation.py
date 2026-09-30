"""Monte Carlo outcomes and explicit scenario tradeoffs."""

import random

from app.models import (
    CompareRequest,
    CompareResponse,
    Consequence,
    DecisionRequest,
    DecisionResponse,
    DecisionScenarioOutcome,
    CriterionOutcome,
    ScenarioOutcome,
    TaskOutcome,
)


def _risk(probability: float) -> str:
    if probability >= 0.75:
        return "low"
    if probability >= 0.4:
        return "medium"
    return "high"


def _percentile(values: list[float], percentile: float) -> float:
    """Return a linearly interpolated percentile, matching NumPy's default method."""
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile / 100
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def compare(request: CompareRequest) -> CompareResponse:
    """Estimate task completion chances and compare each option with alternatives."""
    raw: list[dict] = []
    for index, scenario in enumerate(request.scenarios):
        rng = random.Random(request.seed + index)
        tasks = []
        for task in scenario.tasks:
            effective_hours = [
                task.planned_hours * min(1.2, max(0.3, rng.gauss(task.pattern_factor, 0.18)))
                for _ in range(request.runs)
            ]
            completed = 0
            for effective_time in effective_hours:
                needed = rng.triangular(
                    task.required_hours * 0.8,
                    task.required_hours * 1.6,
                    task.required_hours * 1.2,
                )
                completed += effective_time >= needed
            tasks.append({
                "name": task.name,
                "planned_hours": task.planned_hours,
                "required_hours": task.required_hours,
                "pattern_factor": task.pattern_factor,
                "success_probability": completed / request.runs,
                "effective_hours_p10": _percentile(effective_hours, 10),
                "effective_hours_p90": _percentile(effective_hours, 90),
            })
        raw.append({"name": scenario.name, "tasks": tasks})

    outcomes: list[ScenarioOutcome] = []
    for index, scenario_data in enumerate(raw):
        task_outcomes = [TaskOutcome(**task) for task in scenario_data["tasks"]]
        chances = [task.success_probability for task in task_outcomes]
        gains: list[Consequence] = []
        tradeoffs: list[Consequence] = []
        for task in task_outcomes:
            other_chances = [
                other_task["success_probability"]
                for other_index, other_scenario in enumerate(raw)
                if other_index != index
                for other_task in other_scenario["tasks"]
                if other_task["name"] == task.name
            ]
            if not other_chances:
                continue
            change = task.success_probability - max(other_chances)
            if abs(change) < 0.01:
                continue
            points = round(abs(change) * 100)
            item = Consequence(
                task=task.name,
                probability_change=round(change * 100, 1),
                direction="gain" if change > 0 else "tradeoff",
                summary=f"{points} percentage points {'more' if change > 0 else 'less'} chance of finishing {task.name.lower()} than the alternative.",
            )
            (gains if change > 0 else tradeoffs).append(item)
        outcomes.append(ScenarioOutcome(
            name=scenario_data["name"],
            score=round(sum(chances) / len(chances) * 100, 1),
            risk=_risk(min(chances)),
            tasks=task_outcomes,
            gains=gains,
            tradeoffs=tradeoffs,
        ))

    ordered = sorted(outcomes, key=lambda item: item.score, reverse=True)
    if len(ordered) > 1 and abs(ordered[0].score - ordered[1].score) < 2:
        recommendation = (
            f"{ordered[0].name} has a slightly higher estimated completion score, but the options are close. "
            "Choose based on which task matters most to you."
        )
    else:
        recommendation = (
            f"{ordered[0].name} has the highest average chance of completing the listed tasks "
            f"({ordered[0].score:.0f}%). Check its tradeoffs before deciding."
        )

    return CompareResponse(
        answer=(
            f"For “{request.question}”, I compared {len(outcomes)} options over {request.runs:,} simulated weeks each. "
            "The estimates show likely task completion, and the gains and tradeoffs compare each option with the alternatives."
        ),
        recommendation=recommendation,
        scenarios=outcomes,
        runs=request.runs,
        confidence="illustrative",
    )


def compare_decisions(request: DecisionRequest) -> DecisionResponse:
    """Simulate personalized fit for user-defined options and priorities."""
    weight_total = sum(criterion.priority for criterion in request.criteria)
    uncertainty = {1: 1.35, 2: 1.0, 3: 0.7, 4: 0.45, 5: 0.25}[request.confidence]
    scenarios: list[DecisionScenarioOutcome] = []

    for option_index, option in enumerate(request.options):
        rng = random.Random(request.seed + option_index)
        estimate_by_name = {item.criterion.casefold(): item.impact for item in option.impacts}
        sampled_by_criterion: dict[str, list[float]] = {}
        fit_scores: list[float] = []
        positive_fits = 0

        for _ in range(request.runs):
            weighted_impact = 0.0
            for criterion in request.criteria:
                estimate = estimate_by_name[criterion.name.casefold()]
                sampled = min(2.0, max(-2.0, rng.gauss(estimate, uncertainty)))
                sampled_by_criterion.setdefault(criterion.name, []).append(sampled)
                weighted_impact += sampled * criterion.priority
            weighted_impact /= weight_total
            fit_scores.append(min(100.0, max(0.0, 50 + weighted_impact * 25)))
            positive_fits += weighted_impact > 0

        criteria_outcomes: list[CriterionOutcome] = []
        for criterion in request.criteria:
            samples = sampled_by_criterion[criterion.name]
            expected_impact = sum(samples) / len(samples)
            criteria_outcomes.append(CriterionOutcome(
                name=criterion.name,
                priority=criterion.priority,
                expected_impact=round(expected_impact, 2),
                positive_impact_probability=sum(sample > 0 for sample in samples) / len(samples),
            ))

        criteria_outcomes.sort(key=lambda item: item.priority, reverse=True)
        scenarios.append(DecisionScenarioOutcome(
            name=option.name,
            fit_score=round(sum(fit_scores) / len(fit_scores), 1),
            fit_p10=round(_percentile(fit_scores, 10), 1),
            fit_p90=round(_percentile(fit_scores, 90), 1),
            positive_fit_probability=positive_fits / request.runs,
            criteria=criteria_outcomes,
            gains=[item.name for item in criteria_outcomes if item.expected_impact >= 0.35],
            tradeoffs=[item.name for item in criteria_outcomes if item.expected_impact <= -0.35],
        ))

    ranked = sorted(scenarios, key=lambda item: item.fit_score, reverse=True)
    if len(ranked) > 1 and ranked[0].fit_score - ranked[1].fit_score < 3:
        recommendation = (
            f"{ranked[0].name} comes out slightly ahead, but the estimates overlap. "
            "The choice may hinge on which priority you feel least willing to compromise."
        )
    else:
        recommendation = (
            f"Based on the priorities and impact estimates you gave, {ranked[0].name} has the strongest overall fit "
            f"({ranked[0].fit_score:.0f}/100). Review its tradeoffs before deciding."
        )

    return DecisionResponse(
        answer=f"I compared {len(scenarios)} options against {len(request.criteria)} priorities you named, with uncertainty based on how sure you feel about your estimates.",
        recommendation=recommendation,
        scenarios=scenarios,
        runs=request.runs,
        confidence="based on your estimates",
    )
