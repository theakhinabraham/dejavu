# DejaVu

DejaVu is a student decision simulator for comparing two ways to spend study time. It runs thousands of noisy scenarios for each plan, estimates exam and assignment outcomes plus overload risk, then explains which option has the strongest balance.

The profile is kept in browser `localStorage`. Scenario details are sent to the local API for calculation and are not stored by the app. Schedule, history, goals, and habits can each be excluded; excluded categories are replaced with neutral assumptions and listed in the result. This MVP uses a transparent rules-based model, not an LLM or a validated prediction of academic performance.

## Run locally

Start the API in one terminal:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000
```

Start the web app in another terminal:

```sh
cd frontend
npm install
npm run dev
```

Open the local Vite URL, usually `http://localhost:5173`.

## Verify

```sh
cd backend
python -m pytest
```

```sh
cd frontend
npm run build
```

The API also exposes `GET /api/health` and `POST /api/simulate`.
