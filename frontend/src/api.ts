export type TaskInput = {
  name: string;
  planned_hours: number;
  required_hours: number;
  pattern_factor: number;
};

export type ScenarioInput = { name: string; tasks: TaskInput[] };

export type Consequence = {
  task: string;
  probability_change: number;
  direction: 'gain' | 'tradeoff';
  summary: string;
};

export type TaskOutcome = TaskInput & {
  success_probability: number;
  effective_hours_p10: number;
  effective_hours_p90: number;
};

export type ScenarioOutcome = {
  name: string;
  score: number;
  risk: 'low' | 'medium' | 'high';
  tasks: TaskOutcome[];
  gains: Consequence[];
  tradeoffs: Consequence[];
};

export type CompareResponse = {
  answer: string;
  recommendation: string;
  scenarios: ScenarioOutcome[];
  runs: number;
  confidence: string;
};

export type DecisionCriterionInput = { name: string; priority: number };
export type DecisionEstimateInput = { criterion: string; impact: number };
export type DecisionOptionInput = { name: string; impacts: DecisionEstimateInput[] };
export type DecisionScenarioOutcome = {
  name: string;
  fit_score: number;
  fit_p10: number;
  fit_p90: number;
  positive_fit_probability: number;
  criteria: { name: string; priority: number; expected_impact: number; positive_impact_probability: number }[];
  gains: string[];
  tradeoffs: string[];
};
export type DecisionResponse = {
  answer: string;
  recommendation: string;
  scenarios: DecisionScenarioOutcome[];
  runs: number;
  confidence: string;
};

export type InterpretedValue = { value: string | number; confidence: number; source: string; assumed: boolean };
export type PlanningFields = {
  decision_topic: InterpretedValue | null;
  time_horizon_days: InterpretedValue | null;
  hours_per_day: InterpretedValue | null;
  assignment_load: InterpretedValue | null;
  workout_duration_hours: InterpretedValue | null;
  gym_goal: InterpretedValue | null;
  consistency_pattern: InterpretedValue | null;
};
export type InterpretResponse = {
  session_id: string;
  session_state: {
    fields: Record<string, InterpretedValue>;
    unresolved: string[];
    assumptions: string[];
    corrections: string[];
    turns: number;
    awaiting_confirmation: boolean;
    confirming_field: string | null;
    prompted_field: string | null;
  };
  active: boolean;
  fields: PlanningFields;
  unresolved: string[];
  assumptions: string[];
  corrections: string[];
  needs_confirmation: boolean;
  ready: boolean;
  summary?: string | null;
  assistant_message?: string | null;
};

// Keep API calls same-origin: Vercel routes /api/* to the backend service,
// while the local Vite dev server proxies the same paths to FastAPI.
const API_BASE = '';

export async function interpretChatTurn(
  sessionId: string,
  text: string,
  sessionState: InterpretResponse['session_state'] | null,
): Promise<InterpretResponse> {
  const response = await fetch(`${API_BASE}/api/chat/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, text, session_state: sessionState }),
    signal: AbortSignal.timeout(12_000),
  }).catch(() => { throw new Error('Could not reach the conversation interpreter. Check that the backend is running on port 8000.'); });
  if (!response.ok) throw new Error(`The conversation interpreter returned HTTP ${response.status}. Please try again.`);
  return response.json() as Promise<InterpretResponse>;
}

export async function compareOptions(
  question: string,
  scenarios: ScenarioInput[],
): Promise<CompareResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, scenarios }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('The DejaVu API took too long to respond. Start it in a second terminal with: cd backend && uvicorn app.main:app --reload --port 8000');
    }
    throw new Error('Could not reach the DejaVu API. Start it in a second terminal with: cd backend && uvicorn app.main:app --reload --port 8000');
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    let detail = '';
    try {
      const body = JSON.parse(bodyText);
      if (typeof body?.detail === 'string') detail = body.detail;
      else if (Array.isArray(body?.detail)) {
        detail = body.detail.map((issue: { loc?: (string | number)[]; msg?: string }) => {
          const field = issue.loc?.slice(1).join('.');
          return field ? `${field}: ${issue.msg ?? 'invalid value'}` : issue.msg ?? '';
        }).filter(Boolean).join('; ');
      }
    } catch {
      detail = bodyText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
    }
    if (!detail) {
      detail = response.status >= 500
        ? 'The planner API is unavailable. Start it in a second terminal with: cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000'
        : `The planner returned HTTP ${response.status}. Please try again.`;
    }
    throw new Error(detail);
  }
  return response.json() as Promise<CompareResponse>;
}

export async function compareDecisions(
  question: string,
  criteria: DecisionCriterionInput[],
  options: DecisionOptionInput[],
  confidence: number,
): Promise<DecisionResponse> {
  const response = await fetch(`${API_BASE}/api/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, criteria, options, confidence }),
    signal: AbortSignal.timeout(12_000),
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('The planner API took too long to respond. Please try again.');
    }
    throw new Error('Could not reach the planner API. Check that the backend is running on port 8000.');
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    let detail = '';
    try {
      const body = JSON.parse(bodyText);
      if (typeof body?.detail === 'string') detail = body.detail;
      else if (Array.isArray(body?.detail)) detail = body.detail.map((issue: { loc?: (string | number)[]; msg?: string }) => `${issue.loc?.slice(1).join('.') ?? ''}: ${issue.msg ?? 'invalid value'}`).join('; ');
    } catch {
      detail = bodyText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
    }
    throw new Error(detail || `The planner returned HTTP ${response.status}. Please try again.`);
  }
  return response.json() as Promise<DecisionResponse>;
}
