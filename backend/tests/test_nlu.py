from app.nlu import InterpretRequest, interpret_turn, reset_sessions


def setup_function():
    reset_sessions()


def test_extracts_fuzzy_study_and_gym_language():
    response = interpret_turn(InterpretRequest(
        session_id="week-off",
        text="I've got a week off and I'm torn between gym and assignments",
    ))

    assert response.active is True
    assert response.fields.time_horizon_days.value == 7
    assert response.fields.decision_topic is not None
    assert response.ready is False
    assert response.assistant_message


def test_normalizes_couple_weeks_and_hour_and_a_half():
    interpret_turn(InterpretRequest(session_id="fuzzy", text="I'm planning gym and assignments"))
    first = interpret_turn(InterpretRequest(session_id="fuzzy", text="Maybe a couple weeks"))
    second = interpret_turn(InterpretRequest(session_id="fuzzy", text="I can do an hour and a half a day"))

    assert first.fields.time_horizon_days.value == 14
    assert first.fields.time_horizon_days.confidence < 0.8
    assert second.fields.hours_per_day.value == 1.5


def test_consistency_fuzzy_values_and_last_correction_win():
    interpret_turn(InterpretRequest(session_id="correction", text="I'm planning gym and assignments"))
    first = interpret_turn(InterpretRequest(session_id="correction", text="I usually do okay but not always"))
    second = interpret_turn(InterpretRequest(session_id="correction", text="I said 2 hours a day but maybe 5 hours a day"))

    assert first.fields.consistency_pattern.value == 4
    assert second.fields.hours_per_day.value == 5
    assert second.corrections


def test_only_asks_for_confirmation_after_required_slots_are_present():
    session = "complete"
    turns = [
        "I'm torn between gym and assignments for a week",
        "I can do 5 hours a day",
        "I'm behind on assignments",
        "Gym sessions would be an hour and a half",
        "I want to get in shape",
        "I usually follow through",
    ]
    response = None
    for text in turns:
        response = interpret_turn(InterpretRequest(session_id=session, text=text))

    assert response is not None
    assert response.needs_confirmation is True
    assert response.ready is False
    confirmed = interpret_turn(InterpretRequest(session_id=session, text="yes, that sounds right"))
    assert confirmed.ready is True


def test_one_messy_message_can_fill_multiple_distinct_fields():
    response = interpret_turn(InterpretRequest(
        session_id="multi-slot",
        text=("I've got a week off and I'm torn between gym and assignments; "
              "I can do 5 hours a day, gym sessions take an hour and a half, "
              "I'm behind on assignments, want to get in shape, and usually follow through"),
    ))

    assert response.fields.hours_per_day.value == 5
    assert response.fields.workout_duration_hours.value == 1.5
    assert response.fields.assignment_load.value == "behind on assignments"
    assert response.fields.gym_goal.value == "get in shape"
    assert response.fields.consistency_pattern.value == 4
