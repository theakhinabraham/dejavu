from pydantic import BaseModel, Field, model_validator


class ConsentSettings(BaseModel):
	schedule: bool = True
	history: bool = True
	goals: bool = True
	habits: bool = True


class StudentProfile(BaseModel):
	weekly_available_hours: float = Field(default=24, ge=1, le=70)
	exam_days_left: int = Field(default=5, ge=1, le=30)
	assignment_days_left: int = Field(default=3, ge=1, le=30)
	exam_readiness: float = Field(default=46, ge=0, le=100)
	assignment_progress: float = Field(default=25, ge=0, le=100)
	assignment_hours_remaining: float = Field(default=12, ge=1, le=100)
	exam_target: float = Field(default=70, ge=50, le=100)
	focus_multiplier: float = Field(default=1.0, ge=0.5, le=1.5)
	estimation_accuracy: float = Field(default=1.0, ge=0.5, le=1.5)


class StudyPlan(BaseModel):
	id: str = Field(min_length=1, max_length=32)
	name: str = Field(min_length=1, max_length=48)
	exam_hours: float = Field(ge=0, le=100)
	assignment_hours: float = Field(ge=0, le=100)

	@property
	def total_hours(self) -> float:
		return self.exam_hours + self.assignment_hours


class SimulationRequest(BaseModel):
	plans: list[StudyPlan] = Field(min_length=2, max_length=2)
	profile: StudentProfile = Field(default_factory=StudentProfile)
	consent: ConsentSettings = Field(default_factory=ConsentSettings)
	simulations: int = Field(default=5000, ge=500, le=20000)
	seed: int | None = None

	@model_validator(mode="after")
	def plans_must_have_unique_ids(self):
		if self.plans[0].id == self.plans[1].id:
			raise ValueError("Plan IDs must be unique")
		return self
