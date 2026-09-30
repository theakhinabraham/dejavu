"""Validated inputs and outputs for a what-if comparison."""

from pydantic import BaseModel, Field


class Task(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    planned_hours: float = Field(ge=0, le=100)
    required_hours: float = Field(gt=0, le=200)
    pattern_factor: float = Field(default=0.82, ge=0.3, le=1.2)


class Scenario(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    tasks: list[Task] = Field(min_length=1, max_length=6)


class CompareRequest(BaseModel):
    question: str = Field(min_length=3, max_length=500)
    scenarios: list[Scenario] = Field(min_length=2, max_length=4)
    runs: int = Field(default=2000, ge=500, le=10000)
    seed: int = Field(default=42, ge=0, le=2**32 - 1)


class TaskOutcome(BaseModel):
    name: str
    planned_hours: float
    required_hours: float
    pattern_factor: float
    success_probability: float
    effective_hours_p10: float
    effective_hours_p90: float


class Consequence(BaseModel):
    task: str
    probability_change: float
    direction: str
    summary: str


class ScenarioOutcome(BaseModel):
    name: str
    score: float
    risk: str
    tasks: list[TaskOutcome]
    gains: list[Consequence]
    tradeoffs: list[Consequence]


class CompareResponse(BaseModel):
    answer: str
    recommendation: str
    scenarios: list[ScenarioOutcome]
    runs: int
    confidence: str


class DecisionCriterion(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    priority: int = Field(ge=1, le=5)


class ImpactEstimate(BaseModel):
    criterion: str = Field(min_length=1, max_length=80)
    impact: int = Field(ge=-2, le=2)


class DecisionOption(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    impacts: list[ImpactEstimate] = Field(min_length=1, max_length=5)


class DecisionRequest(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    criteria: list[DecisionCriterion] = Field(min_length=1, max_length=5)
    options: list[DecisionOption] = Field(min_length=2, max_length=4)
    confidence: int = Field(ge=1, le=5, default=3)
    runs: int = Field(default=2000, ge=500, le=10000)
    seed: int = Field(default=42, ge=0, le=2**32 - 1)


class CriterionOutcome(BaseModel):
    name: str
    priority: int
    expected_impact: float
    positive_impact_probability: float


class DecisionScenarioOutcome(BaseModel):
    name: str
    fit_score: float
    fit_p10: float
    fit_p90: float
    positive_fit_probability: float
    criteria: list[CriterionOutcome]
    gains: list[str]
    tradeoffs: list[str]


class DecisionResponse(BaseModel):
    answer: str
    recommendation: str
    scenarios: list[DecisionScenarioOutcome]
    runs: int
    confidence: str
