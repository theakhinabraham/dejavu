def payload():
	return {
		"seed": 9,
		"simulations": 500,
		"profile": {
			"weekly_available_hours": 12,
			"exam_readiness": 82,
			"assignment_progress": 72,
			"assignment_hours_remaining": 5,
			"exam_target": 90,
			"focus_multiplier": 1.4,
			"estimation_accuracy": 1.4,
		},
		"plans": [
			{"id": "exam", "name": "Exam focus", "exam_hours": 12, "assignment_hours": 2},
			{"id": "balance", "name": "Split the week", "exam_hours": 7, "assignment_hours": 7},
		],
	}


def test_simulate_returns_outcomes_and_recommendation(client):
	response = client.post("/api/simulate", json=payload())

	assert response.status_code == 200
	data = response.json()
	assert len(data["results"]) == 2
	assert data["recommended_plan_id"] in {"exam", "balance"}
	assert data["simulations_run"] == 500
	assert all(0 <= item["burnout_risk"] <= 100 for item in data["results"])


def test_disabled_categories_are_excluded_from_model(client):
	request = payload()
	request["consent"] = {"schedule": False, "history": False, "goals": False, "habits": False}

	response = client.post("/api/simulate", json=request)

	assert response.status_code == 200
	data = response.json()
	assert data["excluded_categories"] == ["schedule", "history", "goals", "habits"]
	assert "left out" in data["context_note"]


def test_plan_validation_rejects_duplicate_ids(client):
	request = payload()
	request["plans"][1]["id"] = request["plans"][0]["id"]

	assert client.post("/api/simulate", json=request).status_code == 422
