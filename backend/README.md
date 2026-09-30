# DejaVu API

FastAPI service that runs a Monte Carlo comparison for two study plans. The current model samples focus and task execution variability, applies consent-filtered profile assumptions, and reports estimated exam success, assignment completion, and overload risk.

Run from this directory:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000
```

Run tests with `python -m pytest`. Interactive API docs are available at `http://localhost:8000/docs`.

No profile or simulation result is persisted by this service. The probabilities are illustrative estimates from a simple rules-based model, not calibrated forecasts.
