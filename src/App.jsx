import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";
import { useState } from "react";

/**
 * AI Schedule Recommender — React + Axios + Bootstrap
 * API base from .env:
 *   - CRA:  process.env.REACT_APP_API_BASE
 *   - Vite: import.meta.env.VITE_API_BASE
 */

function getApiBase() {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) {
      return import.meta.env.VITE_API_BASE;
    }
  } catch (_) {}
  return process.env.REACT_APP_API_BASE || "";
}

// helpers
function asaClass(asa, target) {
  if (asa == null || target == null) return "badge bg-secondary";
  if (asa <= target) return "badge bg-success";
  if (asa <= target * 1.5) return "badge bg-warning text-dark";
  return "badge bg-danger";
}
function staffClass(staff) {
  if (staff == null) return "badge bg-secondary";
  const v = Number(staff);
  if (v <= 0) return "badge bg-secondary";
  if (v <= 5) return "badge bg-success";
  if (v <= 10) return "badge bg-primary";
  if (v <= 20) return "badge bg-warning text-dark";
  return "badge bg-danger";
}
function CallsBar({ value = 0, max = 1 }) {
  const pct = Math.min(100, Math.round((Number(value) / Math.max(1, Number(max))) * 100));
  return (
    <div className="progress" style={{ height: 8 }}>
      <div
        className="progress-bar"
        role="progressbar"
        style={{ width: `${pct}%` }}
        aria-valuenow={pct}
        aria-valuemin="0"
        aria-valuemax="100"
      />
    </div>
  );
}

export default function App() {
  const API_BASE = getApiBase();
  const apiURL = `${(API_BASE || "").replace(/\/$/, "")}/schedule`;

  const [dateStr, setDateStr] = useState("");
  const [threshold, setThreshold] = useState("3");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);

  const data = payload?.data || [];
  const asaTarget = payload?.inputs?.ASA_Threshold_Min ?? Number(threshold);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    setPayload(null);
    try {
      if (!API_BASE) {
        throw new Error("API base URL is not set. Add REACT_APP_API_BASE or VITE_API_BASE in your .env.");
      }
      const params = { Date: dateStr, Threshold: threshold };
      const res = await axios.get(apiURL, { params, timeout: 20000 });
      setPayload(res.data);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Request failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function downloadCSV() {
    if (!data.length) return;
    const header = Object.keys(data[0]);
    const rows = data.map((row) => header.map((h) => JSON.stringify(row[h] ?? "")));
    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const label = payload?.inputs?.Date ? payload.inputs.Date : "export";
    a.download = `schedule_${label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadJSON() {
    const blob = new Blob([JSON.stringify(payload ?? {}, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `schedule_${payload?.inputs?.Date || "export"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalCalls = data.reduce((s, r) => s + Number(r.CALLS || 0), 0);
  const avgASA = data.length ? Math.round((data.reduce((s, r) => s + Number(r.ASA || 0), 0) / data.length) * 100) / 100 : 0;
  const maxStaff = data.reduce((m, r) => Math.max(m, Number(r.Staff || 0)), 0);
  const maxCalls = data.reduce((m, r) => Math.max(m, Number(r.CALLS || 0)), 1);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f8fafc 0%, #eef2ff 40%, #e0f2fe 100%)",
      }}
    >
      <div className="container py-4">
        <header className="mb-4">
          <div
            className="rounded-4 p-4 shadow-sm"
            style={{
              background: "linear-gradient(90deg, rgba(13,110,253,0.10) 0%, rgba(25,135,84,0.10) 100%)",
              border: "1px solid rgba(0,0,0,0.05)",
            }}
          >
            <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
              <div>
                <h1 className="h3 mb-1">AI Schedule Recommender</h1>
                <p className="text-muted mb-0">Actionable hourly staffing from your AI models</p>
              </div>
              <div className="text-end">
                <span className="badge rounded-pill text-bg-primary me-2">Bootstrap</span>
                <span className="badge rounded-pill text-bg-success">Axios</span>
              </div>
            </div>
          </div>
        </header>

        <div className="card shadow-sm mb-4 border-0">
          <div className="card-body">
            <form className="row g-3" onSubmit={handleSubmit}>
              <div className="col-md-4">
                <label className="form-label">Date</label>
                <input
                  type="date"
                  className="form-control"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  required
                />
              </div>

              <div className="col-md-3">
                <label className="form-label">ASA Threshold (min)</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  className="form-control"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  required
                />
              </div>

              <div className="col-md-5 d-flex align-items-end">
                <button type="submit" className="btn btn-primary me-2" disabled={loading}>
                  {loading ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      Loading
                    </>
                  ) : (
                    "Get Schedule"
                  )}
                </button>
                {data.length > 0 && (
                  <>
                    <button type="button" className="btn btn-outline-secondary me-2" onClick={downloadCSV}>
                      CSV
                    </button>
                    <button type="button" className="btn btn-outline-secondary" onClick={downloadJSON}>
                      JSON
                    </button>
                  </>
                )}
              </div>
            </form>

            {error && (
              <div className="alert alert-danger mt-3" role="alert">
                {error}
              </div>
            )}
          </div>
        </div>

        {payload && (
          <>
            <section className="row g-3 mb-3">
              <div className="col-12 col-lg-4">
                <div className="card h-100 shadow-sm border-0">
                  <div className="card-body">
                    <h5 className="card-title mb-3">Inputs</h5>
                    <div className="d-flex flex-wrap gap-2 mb-2">
                      <span className="badge text-bg-light border">
                        <strong>Date</strong>: {payload.inputs?.Date}
                      </span>
                      <span className="badge text-bg-light border">
                        <strong>Weekday</strong>: {payload.inputs?.Weekday}
                      </span>
                    </div>
                    <div>
                      <span className="badge text-bg-light border me-2">ASA Target</span>
                      <span className="badge rounded-pill bg-primary-subtle text-primary border">
                        {asaTarget} min
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-4">
                <div className="card h-100 shadow-sm border-0">
                  <div className="card-body">
                    <h5 className="card-title mb-3">Summary</h5>
                    <div className="row text-center g-3">
                      <div className="col-4">
                        <div className="p-3 rounded-3 bg-light border">
                          <div className="text-muted small">Hours</div>
                          <div className="fs-5 fw-semibold">{data.length}</div>
                        </div>
                      </div>
                      <div className="col-4">
                        <div className="p-3 rounded-3 bg-light border">
                          <div className="text-muted small">Total Calls</div>
                          <div className="fs-5 fw-semibold">{Math.round(totalCalls)}</div>
                        </div>
                      </div>
                      <div className="col-4">
                        <div className="p-3 rounded-3 bg-light border">
                          <div className="text-muted small">Avg ASA</div>
                          <div className="fs-5 fw-semibold">{avgASA}m</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-4">
                <div className="card h-100 shadow-sm border-0">
                  <div className="card-body">
                    <h5 className="card-title mb-3">Model Metadata</h5>
                    <small className="text-muted d-block mb-2">For transparency</small>
                    <div style={{ maxHeight: 180, overflow: "auto" }}>
                      <strong>Calls features</strong>
                      <ul className="mb-2">
                        {(payload.model_meta?.calls_model_features || []).map((f) => (
                          <li key={f}>
                            <code>{f}</code>
                          </li>
                        ))}
                      </ul>
                      <strong>Staff features</strong>
                      <ul className="mb-0">
                        {(payload.model_meta?.staff_model_features || []).map((f) => (
                          <li key={f}>
                            <code>{f}</code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="card shadow-sm border-0">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="card-title mb-0">Hourly Recommendations</h5>
                  <span className="text-muted small">Weekend rows are shaded</span>
                </div>
                <div className="table-responsive">
                  <table className="table table-hover align-middle">
                    <thead className="table-light" style={{ position: "sticky", top: 0 }}>
                      <tr>
                        <th style={{ minWidth: 160 }}>Date</th>
                        <th>Hour</th>
                        <th>Weekend</th>
                        <th style={{ minWidth: 160 }}>Calls</th>
                        <th>ASA</th>
                        <th>Staff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((r, idx) => (
                        <tr key={idx} className={r.Is_Weekend === 1 ? "table-light" : ""}>
                          <td>{r.DateLabel}</td>
                          <td className="fw-semibold">{r.Hour}</td>
                          <td>
                            <span
                              className={`badge rounded-pill ${
                                r.Is_Weekend === 1 ? "text-bg-warning text-dark" : "text-bg-secondary"
                              }`}
                            >
                              {r.Is_Weekend === 1 ? "Yes" : "No"}
                            </span>
                          </td>
                          <td style={{ minWidth: 180 }}>
                            <div className="d-flex align-items-center gap-2">
                              <div style={{ width: 90 }}>
                                <CallsBar value={Number(r.CALLS)} max={maxCalls} />
                              </div>
                              <div className="text-nowrap">{Number(r.CALLS).toFixed(0)}</div>
                            </div>
                          </td>
                          <td>
                            <span className={asaClass(Number(r.ASA), Number(asaTarget))}>
                              {Number(r.ASA).toFixed(2)}m
                            </span>
                          </td>
                          <td>
                            <span className={staffClass(Number(r.Staff))}>{Number(r.Staff).toFixed(0)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="d-flex gap-2">
                  <button type="button" className="btn btn-outline-secondary" onClick={downloadCSV}>
                    Download CSV
                  </button>
                  <button type="button" className="btn btn-outline-secondary" onClick={downloadJSON}>
                    Download JSON
                  </button>
                </div>
              </div>
            </section>
          </>
        )}

        {!payload && !loading && !error && (
          <div className="text-center text-muted mt-4">Submit a date and threshold to generate a schedule.</div>
        )}

        <footer className="text-center text-muted small mt-4">
          <hr />
          <div>© {new Date().getFullYear()} Schedule Recommender</div>
        </footer>
      </div>
    </div>
  );
}
