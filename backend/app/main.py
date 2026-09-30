import random

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.consent import apply_consent
from app.models import SimulationRequest

app = FastAPI(title="DejaVu", version="0.1.0")
app.add_middleware(
	CORSMiddleware,
	allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
	allow_methods=["*"],
	allow_headers=["*"],
)


def simulate_plan(plan, profile, simulations: int, rng: random.Random) -> dict:
	exam_passes = 0
	assignments_finished = 0
	overloads = 0
	exam_scores = []
	assignment_completions = []
	capacity = profile.weekly_available_hours

	for _ in range(simulations):
		daily_focus = max(0.55, min(1.45, rng.gauss(profile.focus_multiplier, 0.16)))
		execution = max(0.55, min(1.35, rng.gauss(profile.estimation_accuracy, 0.18)))
		fatigue = max(0.62, 1 - max(0, plan.total_hours - capacity) / max(capacity, 1) * 0.28)

		score = max(
			0,
			min(100, rng.gauss(profile.exam_readiness + plan.exam_hours * 1.85 * daily_focus * fatigue, 10)),
		)
		completion = min(
			120,
			profile.assignment_progress
			+ (plan.assignment_hours / profile.assignment_hours_remaining) * 100 * execution * daily_focus * fatigue,
		)
		exam_scores.append(score)
		assignment_completions.append(completion)
		exam_passes += score >= profile.exam_target
		assignments_finished += completion >= 100
		overloads += plan.total_hours > capacity or (plan.total_hours > capacity * 0.85 and rng.random() < 0.35)

	exam_probability = exam_passes / simulations
	assignment_probability = assignments_finished / simulations
	burnout_probability = overloads / simulations
	balanced_score = exam_probability * 0.42 + assignment_probability * 0.48 + (1 - burnout_probability) * 0.10
	return {
		"id": plan.id,
		"name": plan.name,
		"exam_hours": plan.exam_hours,
		"assignment_hours": plan.assignment_hours,
		"total_hours": plan.total_hours,
		"exam_success_probability": round(exam_probability * 100),
		"assignment_completion_probability": round(assignment_probability * 100),
		"burnout_risk": round(burnout_probability * 100),
		"expected_exam_score": round(sum(exam_scores) / simulations),
		"expected_assignment_completion": round(sum(assignment_completions) / simulations),
		"decision_score": round(balanced_score * 100),
	}


@app.get("/api/health")
def health():
	return {"status": "ok", "service": "DejaVu"}


@app.post("/api/simulate")
def simulate(request: SimulationRequest):
	profile, excluded_categories = apply_consent(request.profile, request.consent)
	rng = random.Random(request.seed)
	results = [simulate_plan(plan, profile, request.simulations, rng) for plan in request.plans]
	assignment_weight = 0.48 + (0.08 if profile.assignment_days_left <= 2 else 0)
	exam_weight = 0.42 + (0.08 if profile.exam_days_left <= 2 else 0)
	balance_weight = 0.10
	total_weight = assignment_weight + exam_weight + balance_weight
	assignment_weight /= total_weight
	exam_weight /= total_weight
	balance_weight /= total_weight
	for result in results:
		result["decision_score"] = round(
			result["exam_success_probability"] / 100 * exam_weight * 100
			+ result["assignment_completion_probability"] / 100 * assignment_weight * 100
			+ (1 - result["burnout_risk"] / 100) * balance_weight * 100
		)
	recommended = max(results, key=lambda result: result["decision_score"])
	alternative = next(result for result in results if result["id"] != recommended["id"])

	if recommended["decision_score"] == alternative["decision_score"]:
		explanation = "These plans are effectively tied in the simulation. Choose the one that feels more sustainable this week."
	else:
		differences = []
		if recommended["assignment_completion_probability"] > alternative["assignment_completion_probability"]:
			differences.append("protects your assignment deadline")
		if recommended["exam_success_probability"] > alternative["exam_success_probability"]:
			differences.append("gives the exam a stronger chance")
		if recommended["burnout_risk"] < alternative["burnout_risk"]:
			differences.append("keeps overload risk lower")
		explanation = "This option " + ", and ".join(differences) + "." if differences else "This option has the strongest overall balance across the outcomes you asked about."

	if excluded_categories:
		used_note = "Some personal context was left out because its consent is off."
	else:
		used_note = "All enabled context was included in this simulation."

	return {
		"results": results,
		"recommended_plan_id": recommended["id"],
		"recommendation": explanation,
		"simulations_run": request.simulations,
		"excluded_categories": excluded_categories,
		"context_note": used_note,
	}
