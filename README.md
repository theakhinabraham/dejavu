# DejaVu

DejaVu is a privacy-aware “what if?” planning companion built around a fictional student and synthetic data. It compares possible study plans with a Monte Carlo simulation, explains tradeoffs, and learns from the choice the student makes.

Describe a choice in the chat panel, set the hours you would spend on each task under two options, and compare simulated completion chances. Each option shows potential gains, tradeoffs, uncertainty ranges, and an overall risk label. The first working interaction uses synthetic task estimates; later phases will connect the consent gate, belief ledger, and Gemini explanation layer.

## Project structure

```text
backend/
  app/
    main.py
    models.py
    db.py
    consent.py
    ledger.py
    simulation.py
    llm.py
    seed.py
    security.py
frontend/
  src/
```

## Start the API

Run the backend and frontend in two separate terminals. The comparison chat needs the API running on port 8000.

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API docs will be available at <http://localhost:8000/docs>.

## Start the frontend

In a second terminal:

```sh
cd frontend
npm install
npm run dev
```

Vite serves the frontend at <http://localhost:5173>.

Copy `backend/.env.example` to `backend/.env` before configuring local secrets. Never put API credentials in frontend variables or commit `.env` files.
