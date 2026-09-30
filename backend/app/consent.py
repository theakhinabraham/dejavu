from app.models import ConsentSettings, StudentProfile


DEFAULTS = {
	"schedule": {"weekly_available_hours": 24.0, "exam_days_left": 5, "assignment_days_left": 3},
	"history": {"exam_readiness": 40.0, "assignment_progress": 0.0},
	"goals": {"exam_target": 70.0},
	"habits": {"focus_multiplier": 1.0, "estimation_accuracy": 1.0},
}


def apply_consent(profile: StudentProfile, consent: ConsentSettings) -> tuple[StudentProfile, list[str]]:
	values = profile.model_dump()
	excluded = []
	for category, defaults in DEFAULTS.items():
		if not getattr(consent, category):
			values.update(defaults)
			excluded.append(category)
	return StudentProfile(**values), excluded
