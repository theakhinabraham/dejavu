"""FastAPI entry point for DejaVu's scenario comparison chat."""

from fastapi import FastAPI, HTTPException

from app.models import CompareRequest, CompareResponse, DecisionRequest, DecisionResponse
from app.simulation import compare, compare_decisions
from app.nlu import InterpretRequest, InterpretResponse, interpret_turn

app = FastAPI(title="DejaVu", version="0.1.0")


@app.get("/api/health")
def health() -> dict[str, str]:
    """Confirm that the API process is running."""
    return {"status": "ok"}


@app.post("/api/chat/interpret", response_model=InterpretResponse)
def interpret_chat_turn(request: InterpretRequest) -> InterpretResponse:
    """Extract conversational planning details and ask before assuming missing values."""
    return interpret_turn(request)


@app.post("/api/compare", response_model=CompareResponse)
def compare_options(request: CompareRequest) -> CompareResponse:
    """Simulate options and return task-level gains and tradeoffs."""
    task_sets = [set(task.name.casefold() for task in scenario.tasks) for scenario in request.scenarios]
    if any(names != task_sets[0] for names in task_sets[1:]):
        raise HTTPException(status_code=422, detail="Every option must include the same task names")
    return compare(request)


@app.post("/api/decisions", response_model=DecisionResponse)
def compare_decisions_options(request: DecisionRequest) -> DecisionResponse:
    """Compare any user-defined options against the user's own priorities."""
    expected = {criterion.name.casefold() for criterion in request.criteria}
    for option in request.options:
        actual = {impact.criterion.casefold() for impact in option.impacts}
        if actual != expected:
            raise HTTPException(
                status_code=422,
                detail=f"{option.name} must include one estimate for each priority: {', '.join(item.name for item in request.criteria)}",
            )
    return compare_decisions(request)
