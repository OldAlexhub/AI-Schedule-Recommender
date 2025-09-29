
# AI Schedule Recommender

A React + Flask application for generating AI-based hourly staffing recommendations based on call volume forecasts and user-defined ASA (Average Speed of Answer) thresholds.

Unlike traditional **Integer Programming (IP)** or **Linear Programming (LP)** optimization approaches, this solution uses machine learning models to dynamically learn from historical data rather than relying solely on static constraints or linear cost functions.  
This offers several key advantages:
- **Data-Driven**: Instead of hard-coded assumptions, the model adapts as new call volume and staffing data become available.
- **Nonlinear Relationships**: Call arrival patterns, abandon rates, and service levels rarely behave linearly; ML models capture these complexities better than LP/IP approximations.
- **Fast & Scalable**: No need to repeatedly solve large optimization problems; once trained, predictions are nearly instantaneous for any day/hour combination.
- **Scenario Flexibility**: Users can easily test different ASA thresholds or traffic patterns without redefining the entire mathematical program.
- **Explainability**: Outputs include feature importance, predicted volumes, and staffing curves that can be visualized—something LP/IP solutions rarely offer natively.

The result is a system that combines the interpretability and speed of analytics dashboards with the predictive power of modern ML pipelines, enabling better decision-making for workforce planners.

## Features

- **React Frontend**: Modern, responsive UI built with Bootstrap.
- **Flask API**: Backend serving ML model predictions from pre-trained models.
- **Axios Integration**: Fetches predictions seamlessly from the API.
- **CSV & JSON Downloads**: Export hourly recommendations with one click.
- **Dynamic Visuals**: Color-coded metrics and inline call volume bars for clarity.

## Requirements

### Frontend
- Node.js >= 16
- npm or yarn
- `.env` file with API base URL:
  ```env
  REACT_APP_API_BASE=http://localhost:5000
  ```

### Backend
- Python >= 3.9
- Flask, Flask-CORS, scikit-learn, joblib, pandas, numpy

## Installation

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate   # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

### Frontend Setup

```bash
cd client
npm install
npm start
```

## Usage

1. Enter a date (YYYY-MM-DD) and ASA threshold in minutes.
2. Click **Get Schedule**.
3. View hourly calls, ASA, and staffing recommendations.
4. Export results as CSV or JSON.

## File Structure

```
project/
├── backend/
│   ├── app.py              # Flask API
│   ├── Calls_model.pkl     # Pre-trained calls forecasting model
│   ├── staffing.pkl        # Pre-trained staffing model
│   └── requirements.txt
└── client/
    ├── src/
    │   ├── App.jsx          # Main React component
    │   └── index.js
    ├── public/
    └── package.json
```

## Environment Variables

- `REACT_APP_API_BASE`: Base URL for the Flask API, e.g., `http://localhost:5000`

## Build for Production

```bash
cd client
npm run build
```

## License

MIT License
