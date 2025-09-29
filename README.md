# AI Schedule Recommender

A React + Flask app that generates hourly staffing and builds real shift plans from your ML forecasts. The UI uses Bootstrap 5 and Axios to call a single API: `/schedule`.

## What it does

- Renders your model output: Calls, ASA, and integer **Required Staff** per hour
- Plans shifts under **concurrent caps** for FT and PT
- Optional **total headcount** limit so scheduled people never exceed available employees
- FT and PT strategies: auto, FT first, PT first, mixed ratio
- PT length control: 4h or 6h, with optional weekend override
- Per employee **roster** with start, end, and lunch time
- **Lunches** placed mid shift, snapped to 30-minute blocks; duration configurable
- Coverage table: Required vs Coverage vs Short vs Excess, with color coding
- **Recommended hires** panel that explains least new hires needed to eliminate shortages
- CSV exports: Hourly model data, Shift plan, Roster

## Why ML and not LP/IP

- Data-driven and adaptive
- Handles nonlinearity of arrivals and service
- Fast to evaluate scenarios
- Easy to explain with features and outputs

## Requirements

### Frontend
- Node 16+
- npm or yarn
- `.env` in `client/`

  ```env
  REACT_APP_API_BASE=http://localhost:5000
  ```

### Backend
- Python 3.9+
- Flask, Flask-CORS, scikit-learn, joblib, pandas, numpy

## Install and run

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

The API exposes exactly one route:

- `POST /schedule`
  - Body JSON:
    ```json
    { "Date": "YYYY-MM-DD", "Threshold": 3.0 }
    ```
  - Response JSON (shape used by the UI):
    ```json
    {
      "data": [
        {
          "ASA": 3.0,
          "CALLS": 58.7,
          "DateLabel": "Monday 9/29/2025",
          "DateMDY": "9/29/2025",
          "Day": 29,
          "DayName": "Monday",
          "Hour": 8,
          "Is_Weekend": 0,
          "Month": 9,
          "Staff": 17.0,
          "Year": 2025
        }
      ],
      "inputs": { "ASA_Threshold_Min": 3.0, "Date": "2025-09-29", "Weekday": "Monday" },
      "model_meta": {
        "calls_model_features": ["Day","Month","Year","Hour","Is_Weekend"],
        "staff_model_features": ["Day","Month","Is_Weekend","Year","Hour","CALLS","ASA"],
        "records": 24
      }
    }
    ```

### Frontend

```bash
cd client
npm install
npm start
```

## Using the app

1. Pick **Date** and **ASA Threshold (min)** and click **Generate Schedule**. The UI renders your model output immediately.
2. Set **Capped full timers** and **Capped part timers**. These are concurrent ceilings per hour.
3. If you want to hard-limit total people used for the day, fill **Total full time employees** and **Total part time employees**. If you leave them blank the app defaults totals = caps, so it never exceeds the people you have.
4. Choose **Utilization strategy** and **Part-time length**. Optionally set a different PT length for weekends.
5. Set **Lunch minutes**. Lunch is placed mid shift and snapped to 30 minutes.
6. Review:
   - **Hourly Requirements**: raw model output
   - **Shift Plan**: FT and PT shift blocks under your limits
   - **Coverage vs Requirement**: Required, Coverage, Short, Excess by hour
   - **Recommended hires**: least FT and PT needed to remove shortages
   - **Roster**: one row per employee with start, end, and lunch
7. Export CSVs as needed.

## File structure

```
project/
├─ backend/
│  ├─ app.py
│  ├─ requirements.txt
│  ├─ Calls_model.pkl
│  └─ staffing.pkl
└─ client/
   ├─ public/
   └─ src/
      ├─ App.jsx
      └─ index.js
```

## Notes on limits

- **Caps** control concurrent agents allowed per hour (FT and PT separately)
- **Totals** control unique people for the day. The planner never creates more than 1 shift per employee.
- If totals are blank, the app treats totals as equal to caps to avoid over-scheduling more people than you have.
- If you see **Short**, either raise caps, change strategy, add PT coverage, or increase headcount.

## Troubleshooting

- CORS or 404: check `REACT_APP_API_BASE` and that Flask is running
- Empty tables: your `/schedule` response must include `data`, `inputs`, and `model_meta` with the fields shown above
- Big **Excess**: stagger start times or introduce more PT

## Build for production

```bash
cd client
npm run build
```

## License

MIT

## Credits

Built by Mohamed Gad