export type Profile = {
	weekly_available_hours: number
	exam_days_left: number
	assignment_days_left: number
	exam_readiness: number
	assignment_progress: number
	assignment_hours_remaining: number
	exam_target: number
	focus_multiplier: number
	estimation_accuracy: number
}

export type Consent = {
	schedule: boolean
	history: boolean
	goals: boolean
	habits: boolean
}

export type Plan = {
	id: string
	name: string
	exam_hours: number
	assignment_hours: number
}

export type PlanResult = Plan & {
	total_hours: number
	exam_success_probability: number
	assignment_completion_probability: number
	burnout_risk: number
	expected_exam_score: number
	expected_assignment_completion: number
	decision_score: number
}

export type SimulationResult = {
	results: PlanResult[]
	recommended_plan_id: string
	recommendation: string
	simulations_run: number
	excluded_categories: string[]
	context_note: string
}

export async function simulate(plans: Plan[], profile: Profile, consent: Consent): Promise<SimulationResult> {
	const response = await fetch('/api/simulate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ plans, profile, consent, simulations: 5000 }),
	})

	if (!response.ok) {
		throw new Error(`Simulation failed (${response.status}). Check that the API is running.`)
	}
	return response.json() as Promise<SimulationResult>
}
