// App.jsx
// Bootstrap 5 UI. No hardcoded samples. Consumes your /schedule output.
// Enforces headcount <= Total FT/PT (or caps if totals omitted).
// Builds a per-employee roster with lunch windows.

import axios from 'axios';
import { useMemo, useRef, useState } from 'react';

const fmtInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmtFloat1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const snap30 = (minutes) => Math.round(minutes / 30) * 30;
const isWeekendName = (weekday) => weekday === 'Saturday' || weekday === 'Sunday';
const ceilDiv = (a, b) => Math.ceil(a / b);

// ---------- hire recommendations from shortages ----------
function computeHireRecommendations(plan, ptLenHours = 4) {
  if (!plan?.shortage?.length) return null;
  const totalShort = plan.totalShortUnits ?? plan.shortage.reduce((s, v) => s + v, 0);
  const peakShort = Math.max(...plan.shortage, 0);
  const minFT8 = Math.max(ceilDiv(totalShort, 8), peakShort);
  const minPTcur = ceilDiv(totalShort, ptLenHours);
  const minPT4 = ceilDiv(totalShort, 4);
  const minPT6 = ceilDiv(totalShort, 6);
  const mixFT = Math.max(peakShort, Math.floor(totalShort / 8));
  const mixResidual = Math.max(0, totalShort - mixFT * 8);
  const mixPT = ceilDiv(mixResidual, ptLenHours);
  return { totalShort, peakShort, minFT8, minPTcur, minPT4, minPT6, mixed: { ft: mixFT, pt: mixPT, ptLenHours } };
}

// ---------- roster builder with lunches ----------
function buildRoster(shiftsFT, shiftsPT, lunchMin) {
  const roster = [];
  let idFT = 1;
  let idPT = 1;

  const add = (type, start, end, L) => {
    const lenH = end - start;
    const durMin = lenH * 60;
    const lunchDur = Math.max(0, parseInt(L || '30', 10));
    const mid = start * 60 + durMin / 2;
    const ls = snap30(mid - lunchDur / 2);
    const le = ls + lunchDur;
    roster.push({
      agent: `${type}-${type === 'FT' ? idFT++ : idPT++}`,
      type,
      start,
      end,
      hours: lenH,
      lunchStart: Math.max(start * 60, ls),
      lunchEnd: Math.min(end * 60, le),
    });
  };

  for (const s of shiftsFT) for (let k = 0; k < s.count; k++) add('FT', s.start, s.end, lunchMin);
  for (const s of shiftsPT) for (let k = 0; k < s.count; k++) add('PT', s.start, s.end, lunchMin);
  return roster;
}

// ---------- planner (concurrent caps + total headcount) ----------
function buildShiftPlanStrategic(requiredPerHourInt, limits, opts) {
  // limits: { capFT, capPT, maxFTShifts, maxPTShifts }
  const H = 24;
  const FT = 8;
  const PT = opts.ptLenHours;
  const startsFT = Array.from({ length: H - FT + 1 }, (_, s) => s);
  const startsPT = Array.from({ length: H - PT + 1 }, (_, s) => s);
  const deficit = requiredPerHourInt.slice();
  const covFT = Array(H).fill(0);
  const covPT = Array(H).fill(0);
  let placedFT = 0;
  let placedPT = 0;

  const canPlaceFTAt = (s) => {
    if (placedFT >= limits.maxFTShifts) return false;
    for (let h = s; h < s + FT; h++) {
      if (covFT[h] >= limits.capFT) return false;
      if (covFT[h] + covPT[h] >= limits.capFT + limits.capPT) return false;
    }
    return true;
  };
  const canPlacePTAt = (s) => {
    if (placedPT >= limits.maxPTShifts) return false;
    for (let h = s; h < s + PT; h++) {
      if (covPT[h] >= limits.capPT) return false;
      if (covFT[h] + covPT[h] >= limits.capFT + limits.capPT) return false;
    }
    return true;
  };

  const scoreWindow = (s, len, type) => {
    let score = 0;
    for (let h = s; h < s + len; h++) {
      const totalRoom = Math.max(0, limits.capFT + limits.capPT - (covFT[h] + covPT[h]));
      if (totalRoom <= 0) continue;
      const roomType = type === 'FT'
        ? Math.min(totalRoom, Math.max(0, limits.capFT - covFT[h]))
        : Math.min(totalRoom, Math.max(0, limits.capPT - covPT[h]));
      if (roomType > 0) score += Math.min(deficit[h], roomType);
    }
    return score;
  };

  const shiftsFT = [];
  const shiftsPT = [];

  const placeOneFT = () => {
    if (placedFT >= limits.maxFTShifts) return false;
    let bestS = -1, best = 0;
    for (const s of startsFT) {
      if (!canPlaceFTAt(s)) continue;
      const sc = scoreWindow(s, FT, 'FT');
      if (sc > best) { best = sc; bestS = s; }
    }
    if (best <= 0) return false;
    shiftsFT.push({ start: bestS, end: bestS + FT, count: 1 });
    for (let h = bestS; h < bestS + FT; h++) { covFT[h] += 1; deficit[h] = Math.max(0, deficit[h] - 1); }
    placedFT += 1;
    return true;
  };

  const placeOnePT = () => {
    if (placedPT >= limits.maxPTShifts) return false;
    let bestS = -1, best = 0;
    for (const s of startsPT) {
      if (!canPlacePTAt(s)) continue;
      const sc = scoreWindow(s, PT, 'PT');
      if (sc > best) { best = sc; bestS = s; }
    }
    if (best <= 0) return false;
    shiftsPT.push({ start: bestS, end: bestS + PT, count: 1 });
    for (let h = bestS; h < bestS + PT; h++) { covPT[h] += 1; deficit[h] = Math.max(0, deficit[h] - 1); }
    placedPT += 1;
    return true;
  };

  const placeLoop = () => {
    if (opts.strategy === 'ft_first') {
      while (placeOneFT() || placeOnePT()) {}
    } else if (opts.strategy === 'pt_first') {
      while (placeOnePT() || placeOneFT()) {}
    } else if (opts.strategy === 'mixed') {
      const target = Math.min(100, Math.max(0, opts.mixedFtPercent)) / 100;
      let ft = 0, pt = 0, progress = true;
      while (progress) {
        progress = false;
        const share = (ft + pt) > 0 ? ft / (ft + pt) : 1;
        if (share < target) {
          if (placeOneFT()) { ft++; progress = true; }
          if (placeOnePT()) { pt++; progress = true; }
        } else {
          if (placeOnePT()) { pt++; progress = true; }
          if (placeOneFT()) { ft++; progress = true; }
        }
      }
    } else {
      if (opts.isWeekend) while (placeOnePT() || placeOneFT()) {}
      else while (placeOneFT() || placeOnePT()) {}
    }
  };

  placeLoop();

  const merge = (arr) => {
    const sorted = arr.sort((a, b) => a.start - b.start || a.end - b.end);
    const out = [];
    for (const p of sorted) {
      const last = out[out.length - 1];
      if (last && last.start === p.start && last.end === p.end) last.count += p.count;
      else out.push({ ...p });
    }
    return out;
  };

  const mergedFT = merge(shiftsFT);
  const mergedPT = merge(shiftsPT);
  const coverage = covFT.map((v, i) => v + covPT[i]);
  const shortage = coverage.map((c, h) => Math.max(0, requiredPerHourInt[h] - c));
  const excess = coverage.map((c, h) => Math.max(0, c - requiredPerHourInt[h]));

  return {
    shiftsFT: mergedFT,
    shiftsPT: mergedPT,
    coverage,
    required: requiredPerHourInt,
    shortage,
    excess,
    maxConcurrent: Math.max(...coverage),
    limits,
    hoursShort: shortage.reduce((n, v) => n + (v > 0 ? 1 : 0), 0),
    totalShortUnits: shortage.reduce((s, v) => s + v, 0),
  };
}

export default function App() {
  const [date, setDate] = useState('');
  const [asaThreshold, setAsaThreshold] = useState('');

  // concurrent caps
  const [capFT, setCapFT] = useState('');
  const [capPT, setCapPT] = useState('');

  // total headcount (always enforced; if left blank we assume totals = caps)
  const [totalFT, setTotalFT] = useState('');
  const [totalPT, setTotalPT] = useState('');

  // strategy and shifts
  const [strategy, setStrategy] = useState('auto'); // auto | ft_first | pt_first | mixed
  const [mixedRatio, setMixedRatio] = useState('60'); // FT percent when mixed
  const [ptLen, setPtLen] = useState('4'); // 4 or 6
  const [ptLenWeekendOverride, setPtLenWeekendOverride] = useState(false);
  const [ptLenWeekend, setPtLenWeekend] = useState('6');
  const [lunchMinutes, setLunchMinutes] = useState('30');

  const [scheduleData, setScheduleData] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const formRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const form = formRef.current;
    if (form && !form.checkValidity()) { form.reportValidity(); return; }
    setIsLoading(true);
    try {
      const payload = { Date: date, Threshold: parseFloat(asaThreshold) };
      const res = await axios.post(`${process.env.REACT_APP_API_BASE}/schedule`, payload);
      setScheduleData(res.data);
    } catch (err) {
      setScheduleData(null);
      setError(err.response?.data?.error || 'Failed to fetch schedule');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setDate(''); setAsaThreshold('');
    setCapFT(''); setCapPT('');
    setTotalFT(''); setTotalPT('');
    setStrategy('auto'); setMixedRatio('60');
    setPtLen('4'); setPtLenWeekendOverride(false); setPtLenWeekend('6');
    setLunchMinutes('30'); setScheduleData(null); setError('');
  };

  // ---------- aggregates + plan + roster ----------
  const aggregates = useMemo(() => {
    if (!scheduleData?.data?.length) return null;

    const rows = scheduleData.data;
    const totalCalls = rows.reduce((s, r) => s + (r.CALLS ?? 0), 0);
    const staffInt = rows.map((r) => Math.max(0, Math.ceil(r.Staff ?? 0)));
    const totalStaffHours = staffInt.reduce((s, v) => s + v, 0);
    const peakStaff = Math.max(...staffInt);
    const avgStaff = totalStaffHours / rows.length;

    const peakCallsRow = rows.reduce((max, r) => (r.CALLS > max.CALLS ? r : max), rows[0]);
    const breaches = rows.filter((r) => r.ASA > scheduleData.inputs.ASA_Threshold_Min).length;

    const weekday = scheduleData.inputs.Weekday;
    const weekend = isWeekendName(weekday);
    const ptHours = weekend && ptLenWeekendOverride ? parseInt(ptLenWeekend, 10) : parseInt(ptLen, 10);

    // if totals not provided, assume totals = caps
    const capFt = Math.max(0, parseInt(capFT || `${Math.ceil(peakStaff)}`, 10));
    const capPt = Math.max(0, parseInt(capPT || '0', 10));
    const maxFTShifts = Math.max(0, parseInt((totalFT || capFT || `${Math.ceil(peakStaff)}`), 10));
    const maxPTShifts = Math.max(0, parseInt((totalPT || capPT || '0'), 10));

    const plan = buildShiftPlanStrategic(
      staffInt,
      { capFT: capFt, capPT: capPt, maxFTShifts, maxPTShifts },
      { strategy, mixedFtPercent: parseInt(mixedRatio, 10), isWeekend: weekend, ptLenHours: ptHours }
    );

    const roster = buildRoster(plan.shiftsFT, plan.shiftsPT, lunchMinutes);
    const recs = computeHireRecommendations(plan, ptHours);

    return {
      hours: rows.length,
      totalCalls,
      totalStaffHours,
      peakStaff,
      avgStaff,
      peakHour: peakCallsRow.Hour,
      peakCalls: peakCallsRow.CALLS,
      breaches,
      plan,
      roster,
      ptLenHours: ptHours,
      recs,
    };
  }, [
    scheduleData,
    capFT, capPT, totalFT, totalPT,
    strategy, mixedRatio,
    ptLen, ptLenWeekendOverride, ptLenWeekend,
    lunchMinutes
  ]);

  // ---------- exports ----------
  const exportHourlyCSV = () => {
    if (!scheduleData?.data?.length) return;
    const headers = ['DateLabel','DateMDY','Year','Month','Day','DayName','Hour','Is_Weekend','CALLS','ASA','Staff'];
    const lines = [headers.join(',')];
    scheduleData.data.forEach((r) => {
      lines.push(
        [
          r.DateLabel, r.DateMDY, r.Year, r.Month, r.Day, r.DayName, r.Hour, r.Is_Weekend, r.CALLS, r.ASA, r.Staff
        ].map((v) => (typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v)).join(',')
      );
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    const d = scheduleData.inputs?.Date || 'schedule';
    a.download = `hourly_${d}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const exportShiftCSV = () => {
    if (!aggregates?.plan) return;
    const p = aggregates.plan;
    const out = [];
    out.push(`Capped full timers,${p.limits.capFT}`);
    out.push(`Capped part timers,${p.limits.capPT}`);
    out.push(`Total FT employees,${p.limits.maxFTShifts}`);
    out.push(`Total PT employees,${p.limits.maxPTShifts}`);
    out.push('');
    out.push('Full-time shifts (8h)'); out.push('StartHour,EndHour,Agents');
    p.shiftsFT.forEach((s) => out.push([s.start, s.end, s.count].join(',')));
    out.push('');
    out.push('Part-time shifts'); out.push('StartHour,EndHour,Agents');
    p.shiftsPT.forEach((s) => out.push([s.start, s.end, s.count].join(',')));
    out.push('');
    out.push('Coverage'); out.push('Hour,Required,Coverage,Short,Excess');
    for (let h = 0; h < 24; h++) {
      const req = p.required[h] ?? 0;
      const cov = p.coverage[h] ?? 0;
      const short = Math.max(0, req - cov);
      const over = Math.max(0, cov - req);
      out.push([h, req, cov, short, over].join(','));
    }
    const blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    const d = scheduleData?.inputs?.Date || 'schedule';
    a.download = `shift_plan_${d}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const exportRosterCSV = () => {
    if (!aggregates?.roster?.length) return;
    const hhmm = (mins) => `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
    const out = [['Employee','Type','Start','End','LunchStart','LunchEnd','Hours'].join(',')];
    aggregates.roster.forEach((r) => {
      out.push([
        r.agent, r.type,
        `${String(r.start).padStart(2,'0')}:00`,
        `${String(r.end).padStart(2,'0')}:00`,
        hhmm(r.lunchStart),
        hhmm(r.lunchEnd),
        r.hours
      ].join(','));
    });
    const blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    const d = scheduleData?.inputs?.Date || 'schedule';
    a.download = `roster_${d}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const meta = scheduleData?.model_meta || {};

  return (
    <div className="container py-4">
      <header className="mb-4 d-flex align-items-center justify-content-between">
        <div>
          <h1 className="h3 mb-1">AI Schedule Recommender</h1>
          <p className="text-body-secondary mb-0">Consumes /schedule, enforces headcount, prints a per-employee roster with lunches</p>
        </div>
        <button className="btn btn-outline-secondary" type="button" onClick={handleReset}>Reset</button>
      </header>

      {/* Inputs */}
      <div className="card shadow-sm mb-4">
        <div className="card-body">
          <h5 className="card-title mb-3">Inputs</h5>
          <form ref={formRef} onSubmit={handleSubmit} noValidate>
            <div className="row g-3">
              <div className="col-md-3">
                <label htmlFor="date" className="form-label">Date</label>
                <input type="date" className="form-control" id="date" value={date}
                  onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="col-md-3">
                <label htmlFor="asaThreshold" className="form-label">ASA Threshold (minutes)</label>
                <input type="number" className="form-control" id="asaThreshold" value={asaThreshold}
                  onChange={(e) => setAsaThreshold(e.target.value)} step="0.1" min="0" required />
              </div>
              <div className="col-md-3">
                <label htmlFor="capFT" className="form-label">Capped full timers (concurrent)</label>
                <input type="number" className="form-control" id="capFT" value={capFT}
                  onChange={(e) => setCapFT(e.target.value)} min="0" step="1" required />
              </div>
              <div className="col-md-3">
                <label htmlFor="capPT" className="form-label">Capped part timers (concurrent)</label>
                <input type="number" className="form-control" id="capPT" value={capPT}
                  onChange={(e) => setCapPT(e.target.value)} min="0" step="1" required />
              </div>
            </div>

            <div className="row g-3 mt-1">
              <div className="col-md-3">
                <label htmlFor="totalFT" className="form-label">Total full time employees</label>
                <input type="number" className="form-control" id="totalFT" value={totalFT}
                  onChange={(e) => setTotalFT(e.target.value)} min="0" step="1" placeholder="defaults to cap FT if blank" />
              </div>
              <div className="col-md-3">
                <label htmlFor="totalPT" className="form-label">Total part time employees</label>
                <input type="number" className="form-control" id="totalPT" value={totalPT}
                  onChange={(e) => setTotalPT(e.target.value)} min="0" step="1" placeholder="defaults to cap PT if blank" />
              </div>

              <div className="col-md-3">
                <label htmlFor="strategy" className="form-label">Utilization strategy</label>
                <select id="strategy" className="form-select" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                  <option value="auto">Auto (FT weekdays, PT weekends)</option>
                  <option value="ft_first">FT first</option>
                  <option value="pt_first">PT first</option>
                  <option value="mixed">Mixed ratio</option>
                </select>
                {strategy === 'mixed' && (
                  <div className="mt-2">
                    <label className="form-label">FT share target (%)</label>
                    <input type="number" className="form-control" value={mixedRatio}
                      onChange={(e) => setMixedRatio(e.target.value)} min="0" max="100" step="5" />
                  </div>
                )}
              </div>

              <div className="col-md-3">
                <label className="form-label">Part-time length (hours)</label>
                <select className="form-select" value={ptLen} onChange={(e) => setPtLen(e.target.value)}>
                  <option value="4">4</option>
                  <option value="6">6</option>
                </select>
                <div className="form-check mt-2">
                  <input className="form-check-input" type="checkbox" id="ptWeekendOverride"
                    checked={ptLenWeekendOverride} onChange={(e) => setPtLenWeekendOverride(e.target.checked)} />
                  <label className="form-check-label" htmlFor="ptWeekendOverride">Different PT length on weekends</label>
                </div>
                {ptLenWeekendOverride && (
                  <select className="form-select mt-2" value={ptLenWeekend} onChange={(e) => setPtLenWeekend(e.target.value)}>
                    <option value="4">Weekend PT: 4</option>
                    <option value="6">Weekend PT: 6</option>
                  </select>
                )}
              </div>
            </div>

            <div className="row g-3 mt-1">
              <div className="col-md-3">
                <label htmlFor="lunchMinutes" className="form-label">Lunch minutes</label>
                <input type="number" className="form-control" id="lunchMinutes" value={lunchMinutes}
                  onChange={(e) => setLunchMinutes(e.target.value)} min="0" step="5" />
                <div className="form-text">Placed mid shift, snapped to 30 minute blocks.</div>
              </div>
              <div className="col-md-3 d-flex align-items-end">
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={isLoading || !date || !asaThreshold || capFT === '' || capPT === ''}
                  aria-busy={isLoading}
                >
                  {isLoading ? (<><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />Generating...</>) : ('Generate Schedule')}
                </button>
              </div>
            </div>

            {error ? <div className="alert alert-danger mt-3 mb-0">{error}</div> : null}
          </form>
        </div>
      </div>

      {/* Render once API data arrives */}
      {scheduleData && (
        <>
          {/* Model Meta */}
          <div className="card border-0 shadow-sm mb-4">
            <div className="card-body">
              <div className="d-flex flex-wrap align-items-center justify-content-between mb-3">
                <h5 className="card-title mb-0">Model Metadata</h5>
                <span className="badge text-bg-secondary">Records: {fmtInt.format((scheduleData.model_meta?.records) ?? 0)}</span>
              </div>
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <h6 className="text-body-secondary mb-2">Calls Model Features</h6>
                  <div className="d-flex flex-wrap gap-2">
                    {(scheduleData.model_meta?.calls_model_features || []).map((f) => (
                      <span key={`calls-${f}`} className="badge rounded-pill text-bg-primary">{f}</span>
                    ))}
                  </div>
                </div>
                <div className="col-12 col-md-6">
                  <h6 className="text-body-secondary mb-2">Staff Model Features</h6>
                  <div className="d-flex flex-wrap gap-2">
                    {(scheduleData.model_meta?.staff_model_features || []).map((f) => (
                      <span key={`staff-${f}`} className="badge rounded-pill text-bg-info">{f}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="row g-3 mb-4">
            <div className="col-12 col-md-3">
              <div className="card border-0 shadow-sm h-100"><div className="card-body">
                <div className="text-body-secondary small">Total Calls</div>
                <div className="fs-4 fw-semibold">{fmtInt.format(scheduleData.data.reduce((s,r)=>s+(r.CALLS??0),0))}</div>
              </div></div>
            </div>
            <div className="col-12 col-md-3">
              <div className="card border-0 shadow-sm h-100"><div className="card-body">
                <div className="text-body-secondary small">ASA Breaches</div>
                <div className="fs-4 fw-semibold">
                  {scheduleData.data.filter(r => r.ASA > scheduleData.inputs.ASA_Threshold_Min).length}/{scheduleData.data.length}
                </div>
              </div></div>
            </div>
          </div>

          {/* Raw hourly from your model */}
          <div className="card shadow-sm mb-4">
            <div className="card-body">
              <div className="d-flex flex-wrap align-items-center justify-content-between mb-2">
                <h5 className="card-title mb-0">
                  Hourly Requirements for {scheduleData.inputs.Date} ({scheduleData.inputs.Weekday})
                </h5>
                <span className="badge text-bg-info">ASA Threshold: {fmtFloat1.format(scheduleData.inputs.ASA_Threshold_Min)} min</span>
              </div>
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle">
                  <thead className="table-light sticky-top">
                    <tr>
                      <th style={{ minWidth: 140 }}>Date</th>
                      <th>Hour</th>
                      <th>Weekend</th>
                      <th className="text-end">Predicted Calls</th>
                      <th className="text-end">ASA (min)</th>
                      <th className="text-end">Required Staff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleData.data.map((row, idx) => {
                      const breach = row.ASA > scheduleData.inputs.ASA_Threshold_Min;
                      return (
                        <tr key={idx} className={breach ? 'table-danger' : ''}>
                          <td>{row.DateLabel}</td>
                          <td>{row.Hour}:00</td>
                          <td>{row.Is_Weekend ? 'Yes' : 'No'}</td>
                          <td className="text-end">{fmtInt.format(Math.round(row.CALLS))}</td>
                          <td className="text-end">{fmtFloat1.format(row.ASA)}</td>
                          <td className="text-end">{fmtInt.format(Math.ceil(row.Staff))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Shift plan and coverage */}
          <ShiftAndCoverage
            scheduleData={scheduleData}
            aggregates={aggregates}
            exportShiftCSV={exportShiftCSV}
          />

          {/* Recommended hires */}
          {aggregates?.recs && (
            <RecommendedHires recs={aggregates.recs} ptLenHours={aggregates.ptLenHours} />
          )}

          {/* Roster per employee with lunch windows */}
          <RosterTable roster={aggregates?.roster} exportRosterCSV={exportRosterCSV} />
        </>
      )}
    </div>
  );
}

/* ---------- subcomponents ---------- */

function ShiftAndCoverage({ scheduleData, aggregates, exportShiftCSV }) {
  if (!aggregates?.plan) return null;
  const p = aggregates.plan;
  return (
    <div className="card shadow-sm mb-4">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center justify-content-between mb-2">
          <h5 className="card-title mb-0">Shift Plan</h5>
          <div className="d-flex align-items-center gap-2">
            <span className="badge text-bg-secondary">Capped full timers {fmtInt.format(p.limits.capFT)}</span>
            <span className="badge text-bg-secondary">Capped part timers {fmtInt.format(p.limits.capPT)}</span>
            <span className="badge text-bg-info">Total FT {fmtInt.format(p.limits.maxFTShifts)}</span>
            <span className="badge text-bg-info">Total PT {fmtInt.format(p.limits.maxPTShifts)}</span>
            <span className="badge text-bg-primary">Max concurrent {fmtInt.format(p.maxConcurrent)}</span>
          </div>
        </div>

        {p.hoursShort > 0 && (
          <div className="alert alert-warning">
            Unmet demand for {p.hoursShort} hours. Short units {fmtInt.format(p.totalShortUnits)}.
          </div>
        )}

        <div className="row g-3">
          <div className="col-12 col-lg-6">
            <h6 className="text-body-secondary">Full time shifts (8h)</h6>
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <thead className="table-light">
                  <tr><th>Start</th><th>End</th><th className="text-end">Agents</th></tr>
                </thead>
                <tbody>
                  {p.shiftsFT.map((s, i) => (
                    <tr key={`ft-${i}`}><td>{s.start}:00</td><td>{s.end}:00</td><td className="text-end">{fmtInt.format(s.count)}</td></tr>
                  ))}
                  {p.shiftsFT.length === 0 && <tr><td colSpan={3} className="text-body-secondary">No FT shifts</td></tr>}
                </tbody>
              </table>
            </div>

            <h6 className="text-body-secondary mt-3">Part time shifts</h6>
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <thead className="table-light">
                  <tr><th>Start</th><th>End</th><th className="text-end">Agents</th></tr>
                </thead>
                <tbody>
                  {p.shiftsPT.map((s, i) => (
                    <tr key={`pt-${i}`}><td>{s.start}:00</td><td>{s.end}:00</td><td className="text-end">{fmtInt.format(s.count)}</td></tr>
                  ))}
                  {p.shiftsPT.length === 0 && <tr><td colSpan={3} className="text-body-secondary">No PT shifts</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="col-12 col-lg-6">
            <h6 className="text-body-secondary">Coverage vs Requirement</h6>
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <thead className="table-light">
                  <tr>
                    <th>Hour</th>
                    <th className="text-end">Required</th>
                    <th className="text-end">Coverage</th>
                    <th className="text-end">Short</th>
                    <th className="text-end">Excess</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 24 }, (_, h) => {
                    const req = p.required[h] ?? 0;
                    const cov = p.coverage[h] ?? 0;
                    const short = Math.max(0, req - cov);
                    const over = Math.max(0, cov - req);
                    const cls = short ? 'table-danger' : over ? 'table-warning' : '';
                    return (
                      <tr key={h} className={cls}>
                        <td>{h}:00</td>
                        <td className="text-end">{fmtInt.format(req)}</td>
                        <td className="text-end">{fmtInt.format(cov)}</td>
                        <td className="text-end">{short ? fmtInt.format(short) : ''}</td>
                        <td className="text-end">{over ? fmtInt.format(over) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="alert alert-secondary mt-2 mb-0">
              <strong>How to read this:</strong>
              <ul className="mb-0">
                <li><strong>Required</strong> is the model target per hour.</li>
                <li><strong>Coverage</strong> is what the shifts provide under caps and headcount.</li>
                <li><strong>Short</strong> is unmet headcount that hour.</li>
                <li><strong>Excess</strong> is overage from packing fixed shift lengths.</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="d-flex gap-2 mt-3">
          <button type="button" className="btn btn-outline-info" onClick={exportShiftCSV}>
            Export Shift Plan CSV
          </button>
        </div>
      </div>
    </div>
  );
}

function RecommendedHires({ recs, ptLenHours }) {
  return (
    <div className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <h5 className="card-title mb-0">Recommended hires</h5>
          <span className="badge text-bg-secondary">
            Short staff-hours: {fmtInt.format(recs.totalShort)} • Peak short: {fmtInt.format(recs.peakShort)}
          </span>
        </div>
        <div className="row g-3">
          <div className="col-12 col-md-4">
            <div className="card h-100"><div className="card-body">
              <div className="text-body-secondary small mb-1">Full time only</div>
              <div className="fs-4 fw-semibold">{fmtInt.format(recs.minFT8)} FT</div>
              <div className="small text-body-secondary">8h shifts</div>
            </div></div>
          </div>
          <div className="col-12 col-md-4">
            <div className="card h-100"><div className="card-body">
              <div className="text-body-secondary small mb-1">Part time only</div>
              <div className="fs-5 fw-semibold mb-1">
                {fmtInt.format(recs.minPTcur)} PT <span className="text-body-secondary small">({ptLenHours}h)</span>
              </div>
              <div className="small text-body-secondary">
                Or {fmtInt.format(recs.minPT4)} PT at 4h, {fmtInt.format(recs.minPT6)} PT at 6h
              </div>
            </div></div>
          </div>
          <div className="col-12 col-md-4">
            <div className="card h-100"><div className="card-body">
              <div className="text-body-secondary small mb-1">Mixed example</div>
              <div className="fs-5 fw-semibold mb-1">{fmtInt.format(recs.mixed.ft)} FT + {fmtInt.format(recs.mixed.pt)} PT</div>
              <div className="small text-body-secondary">FT 8h, PT {recs.mixed.ptLenHours}h</div>
            </div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RosterTable({ roster, exportRosterCSV }) {
  if (!roster?.length) return null;
  const hhmm = (mins) => `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
  return (
    <div className="card shadow-sm">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center justify-content-between mb-2">
          <h5 className="card-title mb-0">Per employee roster with lunches</h5>
          <button type="button" className="btn btn-outline-secondary" onClick={exportRosterCSV}>
            Export Roster CSV
          </button>
        </div>
        <div className="table-responsive">
          <table className="table table-sm align-middle">
            <thead className="table-light">
              <tr>
                <th>Employee</th><th>Type</th><th>Start</th><th>End</th><th>Lunch start</th><th>Lunch end</th><th className="text-end">Hours</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r, i) => (
                <tr key={i}>
                  <td>{r.agent}</td>
                  <td>{r.type}</td>
                  <td>{String(r.start).padStart(2,'0')}:00</td>
                  <td>{String(r.end).padStart(2,'0')}:00</td>
                  <td>{hhmm(r.lunchStart)}</td>
                  <td>{hhmm(r.lunchEnd)}</td>
                  <td className="text-end">{fmtInt.format(r.hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-body-secondary small">
          One shift per employee. Lunches placed mid shift and snapped to 30 minute blocks. Change lunch minutes in Inputs to adjust.
        </div>
      </div>
    </div>
  );
}
