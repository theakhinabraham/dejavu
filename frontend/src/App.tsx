import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
	Activity,
	ArrowRight,
	BookOpenCheck,
	BrainCircuit,
	CalendarDays,
	Check,
	ChevronRight,
	CircleHelp,
	Clock3,
	Compass,
	FlaskConical,
	LockKeyhole,
	RotateCcw,
	ShieldCheck,
	SlidersHorizontal,
	Sparkles,
	Target,
	TriangleAlert,
} from 'lucide-react'
import { simulate, type Consent, type Plan, type PlanResult, type Profile, type SimulationResult } from './api/client'

type View = 'twin' | 'patterns' | 'privacy'
type SavedState = { profile: Profile; consent: Consent; plans: Plan[] }

const initialState: SavedState = {
	profile: {
		weekly_available_hours: 24,
		exam_days_left: 5,
		assignment_days_left: 3,
		exam_readiness: 48,
		assignment_progress: 28,
		assignment_hours_remaining: 12,
		exam_target: 72,
		focus_multiplier: 1.08,
		estimation_accuracy: 0.88,
	},
	consent: { schedule: true, history: true, goals: true, habits: true },
	plans: [
		{ id: 'balanced', name: 'Balanced week', exam_hours: 9, assignment_hours: 8 },
		{ id: 'exam-focus', name: 'Exam sprint', exam_hours: 14, assignment_hours: 3 },
	],
}

const storageKey = 'dejavu-profile-v1'
const legacyStorageKey = 'humantwin-profile-v1'
const categories: { key: keyof Consent; title: string; description: string }[] = [
	{ key: 'schedule', title: 'Schedule & deadlines', description: 'Available study time and days until each deadline.' },
	{ key: 'history', title: 'Study history', description: 'Your current exam readiness and assignment progress.' },
	{ key: 'goals', title: 'Personal goals', description: 'Your target score for the exam.' },
	{ key: 'habits', title: 'Study habits', description: 'Focus consistency and how accurately you estimate tasks.' },
]

function readSavedState(): SavedState {
	try {
		const stored = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey)
		return stored ? { ...initialState, ...JSON.parse(stored) } : initialState
	} catch {
		return initialState
	}
}

function RangeControl({
	id,
	label,
	value,
	min,
	max,
	step = 1,
	unit,
	onChange,
}: {
	id: string
	label: string
	value: number
	min: number
	max: number
	step?: number
	unit: string
	onChange: (value: number) => void
}) {
	return (
		<label className="range-control" htmlFor={id}>
			<span className="range-heading"><span>{label}</span><strong>{value}{unit}</strong></span>
			<input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
			<span className="range-scale"><span>{min}{unit}</span><span>{max}{unit}</span></span>
		</label>
	)
}

function Probability({ value, color }: { value: number; color: 'green' | 'coral' | 'amber' }) {
	return (
		<div className={`probability probability-${color}`} style={{ '--value': `${value}%` } as CSSProperties}>
			<div className="probability-inner"><strong>{value}<small>%</small></strong></div>
		</div>
	)
}

function App() {
	const [saved, setSaved] = useState<SavedState>(readSavedState)
	const [view, setView] = useState<View>('twin')
	const [simulation, setSimulation] = useState<SimulationResult | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [lastRun, setLastRun] = useState<Date | null>(null)

	useEffect(() => {
		localStorage.setItem(storageKey, JSON.stringify(saved))
	}, [saved])

	const runSimulation = async () => {
		setBusy(true)
		setError('')
		try {
			const result = await simulate(saved.plans, saved.profile, saved.consent)
			setSimulation(result)
			setLastRun(new Date())
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'The simulation could not be reached.')
		} finally {
			setBusy(false)
		}
	}

	useEffect(() => {
		void runSimulation()
	}, [])

	const updatePlan = (id: string, field: 'exam_hours' | 'assignment_hours', value: number) => {
		setSaved((current) => ({ ...current, plans: current.plans.map((plan) => plan.id === id ? { ...plan, [field]: value } : plan) }))
	}

	const updateProfile = (field: keyof Profile, value: number) => {
		setSaved((current) => ({ ...current, profile: { ...current.profile, [field]: value } }))
	}

	const updateConsent = (key: keyof Consent, value: boolean) => {
		setSaved((current) => ({ ...current, consent: { ...current.consent, [key]: value } }))
	}

	const recommended = simulation?.results.find((result) => result.id === simulation.recommended_plan_id)
	const formatTime = lastRun ? lastRun.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Not run yet'

	return (
		<div className="app-shell">
			<aside className="sidebar">
				<a className="brand" href="#home" onClick={(event) => event.preventDefault()} aria-label="DejaVu home">
					<span className="brand-mark"><BrainCircuit size={21} strokeWidth={1.8} /></span>
					  <span>Deja<span>Vu</span></span>
					<span className="brand-beta">BETA</span>
				</a>
				<div className="sidebar-label">YOUR SPACE</div>
				<nav className="primary-nav" aria-label="Primary navigation">
					<button className={view === 'twin' ? 'nav-item active' : 'nav-item'} onClick={() => setView('twin')}><Compass size={18} /><span>Decision studio</span><ChevronRight size={15} className="nav-chevron" /></button>
					<button className={view === 'patterns' ? 'nav-item active' : 'nav-item'} onClick={() => setView('patterns')}><Activity size={18} /><span>My patterns</span></button>
					<button className={view === 'privacy' ? 'nav-item active' : 'nav-item'} onClick={() => setView('privacy')}><ShieldCheck size={18} /><span>Data & consent</span></button>
				</nav>
				<div className="sidebar-bottom">
					<div className="privacy-note"><LockKeyhole size={15} /><span>Your profile stays on this device.</span></div>
					<button className="help-link" onClick={() => setView('privacy')}><CircleHelp size={16} /> Privacy settings</button>
					<div className="student-row"><div className="avatar">S</div><div><strong>Student profile</strong><span>Private workspace</span></div><span className="status-dot" /></div>
				</div>
			</aside>

			<main className="main-content">
				<header className="topbar">
					<div className="breadcrumb"><span>My workspace</span><ChevronRight size={14} /><strong>{view === 'twin' ? 'Decision studio' : view === 'patterns' ? 'My patterns' : 'Data & consent'}</strong></div>
					<div className="topbar-right"><span className="live-indicator"><i /> Twin ready</span><span className="topbar-divider" /><button className="icon-button" title="Open privacy settings" aria-label="Open privacy settings" onClick={() => setView('privacy')}><SlidersHorizontal size={18} /></button></div>
				</header>

				{view === 'twin' && <>
					<section className="page-heading">
						<div><div className="eyebrow"><span className="eyebrow-line" /> YOUR WEEK, IN CONTEXT</div><h1>Think it through.</h1><p>See how two study choices might play out before you commit.</p></div>
						<div className="heading-date"><CalendarDays size={16} /><span>This week</span><i /></div>
					</section>

					<section className="context-strip" aria-label="Current study context">
						<div className="context-icon"><CalendarDays size={19} /></div>
						<div className="context-copy"><strong>Two deadlines on your horizon</strong><span>Exam in {saved.profile.exam_days_left} days <b>·</b> Assignment in {saved.profile.assignment_days_left} days</span></div>
						<button className="text-button" onClick={() => setView('privacy')}>Edit context <ArrowRight size={15} /></button>
					</section>

					<section className="plans-section">
						<div className="section-heading"><div><span className="step-label">01 <i /> SET THE SCENARIO</span><h2>Where could your hours go?</h2></div><span className="allocation-total">{saved.plans[0].exam_hours + saved.plans[0].assignment_hours}h <span>in each plan</span></span></div>
						<div className="plans-grid">
							{saved.plans.map((plan, index) => <article className={`plan-card ${index === 1 ? 'plan-card-alt' : ''}`} key={plan.id}>
								<div className="plan-card-top"><div className={`plan-icon plan-icon-${index}`}><BookOpenCheck size={18} /></div><span className="plan-letter">OPTION 0{index + 1}</span>{simulation?.recommended_plan_id === plan.id && <span className="recommended-tag"><Sparkles size={12} /> TWIN PICK</span>}</div>
								<label className="plan-name-label" htmlFor={`name-${plan.id}`}>Plan name</label>
								<input id={`name-${plan.id}`} className="plan-name-input" value={plan.name} maxLength={48} onChange={(event) => setSaved((current) => ({ ...current, plans: current.plans.map((item) => item.id === plan.id ? { ...item, name: event.target.value } : item) }))} />
								<RangeControl id={`exam-${plan.id}`} label="Exam preparation" value={plan.exam_hours} min={0} max={24} unit="h" onChange={(value) => updatePlan(plan.id, 'exam_hours', value)} />
								<RangeControl id={`assignment-${plan.id}`} label="Assignment work" value={plan.assignment_hours} min={0} max={24} unit="h" onChange={(value) => updatePlan(plan.id, 'assignment_hours', value)} />
								<div className="plan-total"><Clock3 size={15} /><span>Total focused time</span><strong>{plan.exam_hours + plan.assignment_hours}h</strong></div>
							</article>)}
						</div>
						<div className="plan-actions"><span><LockKeyhole size={14} /> No calendar connection needed</span><button className="run-button" onClick={() => void runSimulation()} disabled={busy}>{busy ? <span className="spinner" /> : <FlaskConical size={17} />}{busy ? 'Running scenarios' : 'Run twin simulation'}<ArrowRight size={16} /></button></div>
						{error && <div className="error-message"><TriangleAlert size={17} /><span>{error} Start the API with <code>uvicorn app.main:app --reload --port 8000</code> from <code>backend/</code>.</span></div>}
					</section>

					<section className="results-section">
						<div className="section-heading results-heading"><div><span className="step-label">02 <i /> LOOK AHEAD</span><h2>Possible outcomes</h2></div><span className="run-meta">{simulation ? `${simulation.simulations_run.toLocaleString()} scenarios · updated ${formatTime}` : 'Waiting for simulation'}</span></div>
						{!simulation && !busy && <div className="empty-results"><div className="empty-mark"><FlaskConical size={22} /></div><strong>Your comparison will appear here</strong><span>Run a simulation to explore the tradeoffs in each plan.</span></div>}
						{busy && !simulation && <div className="empty-results"><span className="spinner spinner-large" /><strong>Playing out your week</strong><span>Testing thousands of possible days and focus levels.</span></div>}
						{simulation && <>
							<div className="outcome-grid">
								{simulation.results.map((result, index) => <OutcomeCard key={result.id} result={result} index={index} recommended={result.id === simulation.recommended_plan_id} />)}
							</div>
							<div className="recommendation-panel">
								<div className="recommendation-icon"><Sparkles size={19} /></div>
								<div className="recommendation-copy"><div className="recommendation-label">YOUR TWIN'S READ <span /></div><strong>{recommended?.name} looks like the stronger fit.</strong><p>{simulation.recommendation}</p></div>
								<div className="recommendation-score"><span>Balance score</span><strong>{recommended?.decision_score}<small>/100</small></strong></div>
							</div>
							<div className="transparency-line"><ShieldCheck size={16} /><span>{simulation.context_note}</span>{simulation.excluded_categories.length > 0 && <button onClick={() => setView('privacy')}>Review settings</button>}</div>
						</>}
					</section>
					<footer className="page-footer"><span><Sparkles size={14} /> A simulation, not a promise. Your week can always change.</span><button onClick={() => void runSimulation()} disabled={busy}><RotateCcw size={14} /> Re-run</button></footer>
				</>}

				{view === 'patterns' && <PatternsView profile={saved.profile} consent={saved.consent} onEdit={() => setView('privacy')} />}
				{view === 'privacy' && <PrivacyView saved={saved} onUpdateProfile={updateProfile} onUpdateConsent={updateConsent} />}
			</main>
		</div>
	)
}

function OutcomeCard({ result, index, recommended }: { result: PlanResult; index: number; recommended: boolean }) {
	return (
		<article className={`outcome-card ${recommended ? 'outcome-recommended' : ''}`}>
			<div className="outcome-top"><div><span className="outcome-option">OPTION 0{index + 1}</span><h3>{result.name || 'Untitled plan'}</h3></div>{recommended && <span className="pick-label"><Check size={13} /> BEST BALANCE</span>}</div>
			<div className="outcome-main">
				<Probability value={result.assignment_completion_probability} color="green" />
				<div className="outcome-main-copy"><span>ASSIGNMENT ON TIME</span><strong>{result.assignment_completion_probability}%</strong><small>chance of finishing</small></div>
			</div>
			<div className="outcome-divider" />
			<div className="outcome-metric"><span className="metric-icon exam"><Target size={16} /></span><span>Exam target reached</span><strong>{result.exam_success_probability}%</strong><div className="metric-track"><i style={{ width: `${result.exam_success_probability}%` }} /></div></div>
			<div className="outcome-metric"><span className="metric-icon risk"><Activity size={16} /></span><span>Overload risk</span><strong>{result.burnout_risk}%</strong><div className="metric-track risk-track"><i style={{ width: `${result.burnout_risk}%` }} /></div></div>
			<div className="outcome-bottom"><span>{result.total_hours} focused hours</span><span>Expected exam score <strong>{result.expected_exam_score}</strong></span></div>
		</article>
	)
}

function PatternsView({ profile, consent, onEdit }: { profile: Profile; consent: Consent; onEdit: () => void }) {
	const enabledCount = Object.values(consent).filter(Boolean).length
	return (
		<div className="secondary-page">
			<section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> LEARNED WITH YOU</div><h1>Your patterns.</h1><p>A small, editable picture of how you work. Nothing here is a fixed label.</p></div><div className="heading-date"><BrainCircuit size={16} /><span>{enabledCount} sources active</span></div></section>
			<div className="pattern-feature"><div className="pattern-feature-orbit orbit-one" /><div className="pattern-feature-orbit orbit-two" /><div className="pattern-feature-core"><BrainCircuit size={34} /></div><div className="pattern-feature-text"><span>YOUR CURRENT PROFILE</span><h2>Built from what you choose to share.</h2><p>Adjust any assumption or turn off a source. The twin will show what it could not use.</p><button className="dark-button" onClick={onEdit}>Review profile & consent <ArrowRight size={16} /></button></div><Sparkles className="feature-spark" size={19} /></div>
			<div className="section-heading pattern-heading"><div><span className="step-label">PROFILE SNAPSHOT</span><h2>What your twin currently knows</h2></div></div>
			<div className="pattern-grid">
				<PatternCard icon={<CalendarDays size={18} />} tone="lime" label="Time available" value={`${profile.weekly_available_hours} hours`} note="per week" enabled={consent.schedule} />
				<PatternCard icon={<Target size={18} />} tone="coral" label="Exam readiness" value={`${profile.exam_readiness}%`} note={`target ${profile.exam_target}%`} enabled={consent.history && consent.goals} />
				<PatternCard icon={<BookOpenCheck size={18} />} tone="blue" label="Assignment progress" value={`${profile.assignment_progress}%`} note={`${profile.assignment_hours_remaining}h estimated remaining`} enabled={consent.history} />
				<PatternCard icon={<Clock3 size={18} />} tone="gold" label="Focus & estimates" value={`${Math.round(profile.focus_multiplier * 100)}% focus`} note={`${Math.round(profile.estimation_accuracy * 100)}% estimate accuracy`} enabled={consent.habits} />
			</div>
			<div className="patterns-footnote"><ShieldCheck size={17} /><span>These are starting assumptions, not diagnoses. Your twin only uses the categories you enable.</span></div>
		</div>
	)
}

function PatternCard({ icon, tone, label, value, note, enabled }: { icon: ReactNode; tone: string; label: string; value: string; note: string; enabled: boolean }) {
	return <article className="pattern-card"><span className={`pattern-icon ${tone}`}>{icon}</span><span className="pattern-source">{enabled ? 'IN USE' : 'NOT SHARED'}</span><h3>{label}</h3><strong>{enabled ? value : 'Not included'}</strong><p>{enabled ? note : 'Enable this category to include it.'}</p></article>
}

function PrivacyView({ saved, onUpdateProfile, onUpdateConsent }: { saved: SavedState; onUpdateProfile: (field: keyof Profile, value: number) => void; onUpdateConsent: (key: keyof Consent, value: boolean) => void }) {
	const profileFields: { key: keyof Profile; label: string; min: number; max: number; unit: string; step?: number; category: keyof Consent }[] = [
		{ key: 'weekly_available_hours', label: 'Study hours available each week', min: 4, max: 60, unit: 'h', category: 'schedule' },
		{ key: 'exam_days_left', label: 'Days until exam', min: 1, max: 30, unit: ' days', category: 'schedule' },
		{ key: 'assignment_days_left', label: 'Days until assignment deadline', min: 1, max: 30, unit: ' days', category: 'schedule' },
		{ key: 'exam_readiness', label: 'Current exam readiness', min: 0, max: 100, unit: '%', category: 'history' },
		{ key: 'assignment_progress', label: 'Assignment already completed', min: 0, max: 100, unit: '%', category: 'history' },
		{ key: 'assignment_hours_remaining', label: 'Estimated hours left on assignment', min: 1, max: 40, unit: 'h', category: 'history' },
		{ key: 'exam_target', label: 'Exam score you are aiming for', min: 50, max: 100, unit: '%', category: 'goals' },
		{ key: 'focus_multiplier', label: 'Focus on a typical session', min: 0.5, max: 1.5, unit: 'x', step: 0.05, category: 'habits' },
		{ key: 'estimation_accuracy', label: 'How close your time estimates usually are', min: 0.5, max: 1.5, unit: 'x', step: 0.05, category: 'habits' },
	]
	return (
		<div className="secondary-page privacy-page">
			<section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR DATA, YOUR CALL</div><h1>Keep control.</h1><p>Choose what your twin may use. Switching a category off replaces it with a neutral assumption.</p></div><div className="privacy-heading-mark"><LockKeyhole size={20} /><span>ON THIS DEVICE</span></div></section>
			<div className="privacy-intro"><ShieldCheck size={20} /><div><strong>No account. No data sent for storage.</strong><span>Your profile is saved in this browser only. Scenario inputs are sent to the local simulation API and are not persisted there.</span></div></div>
			<section className="consent-section"><div className="section-heading"><div><span className="step-label">01 <i /> CHOOSE YOUR SOURCES</span><h2>What can the twin use?</h2></div></div>
				<div className="consent-list">{categories.map((category) => <label className={`consent-row ${saved.consent[category.key] ? 'consent-on' : ''}`} key={category.key}>
					<span className="consent-row-icon">{category.key === 'schedule' ? <CalendarDays size={18} /> : category.key === 'history' ? <Activity size={18} /> : category.key === 'goals' ? <Target size={18} /> : <BrainCircuit size={18} />}</span>
					<span className="consent-copy"><strong>{category.title}</strong><small>{category.description}</small></span>
					<span className="toggle-wrap"><input type="checkbox" checked={saved.consent[category.key]} onChange={(event) => onUpdateConsent(category.key, event.target.checked)} /><span className="toggle-track" /></span>
				</label>)}</div>
			</section>
			<section className="profile-section"><div className="section-heading"><div><span className="step-label">02 <i /> EDIT YOUR ASSUMPTIONS</span><h2>Your profile, in your words</h2></div><span className="profile-save-note"><Check size={14} /> Saved automatically</span></div>
				<div className="profile-controls">{profileFields.map((field) => <div className={`profile-control ${saved.consent[field.category] ? '' : 'profile-disabled'}`} key={field.key}><RangeControl id={`profile-${field.key}`} label={field.label} value={saved.profile[field.key]} min={field.min} max={field.max} step={field.step} unit={field.unit} onChange={(value) => onUpdateProfile(field.key, value)} />{!saved.consent[field.category] && <span className="excluded-hint"><LockKeyhole size={12} /> Excluded from simulation</span>}</div>)}</div>
			</section>
			<div className="privacy-bottom"><LockKeyhole size={16} /><span>Turning a category off takes effect on your next simulation.</span></div>
		</div>
	)
}

export default App
