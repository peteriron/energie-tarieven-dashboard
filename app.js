"use strict";

const TZ = "Europe/Brussels";
const Q = 900; // seconden per kwartier
const DAY = 86400;
const LS_KEY = "etd.tariffOverrides.v1";

// ---------- Tarieven ----------
function loadOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch { return {}; }
}
function saveOverrides(o) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { /* opslag niet beschikbaar */ }
}
let overrides = loadOverrides();
const T = () => ({ ...window.TARIFFS, ...overrides });

const energyPrice = (spot, t = T()) => (t.offtakeA + t.offtakeB * spot) * (1 + t.vat);
const perKwhExtras = (t = T()) => t.greenWkk + t.networkKwh + t.excise + (t.green ? t.greenOption : 0);
const allInPrice = (spot, t = T()) => energyPrice(spot, t) + perKwhExtras(t);
const injectPrice = (spot, t = T()) => t.injectA + t.injectB * spot;

// ---------- Tijd (Europe/Brussels) ----------
const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
});
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const partsCache = new Map();
function parts(sec) {
  let p = partsCache.get(sec);
  if (p) return p;
  const o = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(sec * 1000))) o[type] = value;
  p = { day: `${o.year}-${o.month}-${o.day}`, h: +o.hour, m: +o.minute, wd: WD[o.weekday] };
  partsCache.set(sec, p);
  return p;
}
const fmtTime = new Intl.DateTimeFormat("nl-BE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fmtDayTime = new Intl.DateTimeFormat("nl-BE", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("nl-BE", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const fmtDayShort = new Intl.DateTimeFormat("nl-BE", { timeZone: TZ, day: "numeric", month: "short" });
const nowSec = () => Math.floor(Date.now() / 1000);
const quarterStart = (s) => s - (s % Q);
function startOfDay(sec) {
  // zoek middernacht Brussel: stap terug in kwartieren tot uur 0, minuut 0
  let s = quarterStart(sec);
  const p = parts(s);
  s -= (p.h * 60 + p.m) * 60;
  // DST-correctie
  while (parts(s).h !== 0 && parts(s).h > 12) s += 3600;
  while (parts(s).h !== 0) s -= 3600;
  return s;
}

const num = (v, d = 2) => v.toLocaleString("nl-BE", { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- Data ----------
let raw = null;          // { updated, points: [[t, €/MWh]] }
let known = new Map();   // t -> €/MWh
let projected = new Map();
let lastKnownT = 0;

async function loadData() {
  const res = await fetch(`data/prices.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  raw = await res.json();
  known = new Map(raw.points.map(([t, p]) => [t, p]));
  lastKnownT = raw.points.at(-1)[0];
  buildProjection();
}

// Indicatieve verwachting: weekprofiel (laatste 28 dagen) per weekdag+kwartier,
// verschoven naar het gemiddelde niveau van de laatste 7 dagen.
function buildProjection() {
  projected = new Map();
  const from = lastKnownT - 28 * DAY;
  const sums = new Map();
  let recentSum = 0, recentN = 0, recentProfSum = 0;
  for (const [t, p] of raw.points) {
    if (t <= from) continue;
    const { wd, h, m } = parts(t);
    const k = wd * 96 + h * 4 + m / 15;
    const s = sums.get(k) || [0, 0];
    s[0] += p; s[1] += 1;
    sums.set(k, s);
  }
  const prof = (t) => {
    const { wd, h, m } = parts(t);
    const s = sums.get(wd * 96 + h * 4 + m / 15);
    return s ? s[0] / s[1] : null;
  };
  for (const [t, p] of raw.points) {
    if (t <= lastKnownT - 7 * DAY) continue;
    const pr = prof(t);
    if (pr == null) continue;
    recentSum += p; recentProfSum += pr; recentN++;
  }
  const shift = recentN ? (recentSum - recentProfSum) / recentN : 0;
  const until = startOfDay(nowSec() + 8 * DAY);
  for (let t = lastKnownT + Q; t < until; t += Q) {
    const pr = prof(t);
    if (pr != null) projected.set(t, pr + shift);
  }
}

const spotAt = (t) => known.get(t) ?? projected.get(t);

// ---------- Kleuren ----------
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function mix(a, b, f) {
  const pa = hex(a), pb = hex(b);
  return `rgb(${pa.map((x, i) => Math.round(x + (pb[i] - x) * f)).join(",")})`;
}
function hex(c) {
  const h = c.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function scaleColor(v, lo, mid, hi) {
  const good = css("--good"), m = css("--mid"), bad = css("--bad");
  if (v <= mid) return mix(good, m, hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (mid - lo || 1))));
  return mix(m, bad, Math.max(0, Math.min(1, (v - mid) / (hi - mid || 1))));
}

// ---------- UI-state ----------
let range = "48h";
let mode = "allin";
let showInject = false;
let chart = null;

function valueFor(spot) {
  if (mode === "spot") return spot;
  if (mode === "energy") return energyPrice(spot);
  return allInPrice(spot);
}

function rangeBounds() {
  const n = nowSec();
  const today = startOfDay(n);
  switch (range) {
    case "7d": return [today - 6 * DAY, startOfDay(today + 3.5 * DAY)];
    case "30d": return [today - 29 * DAY, startOfDay(today + 7.5 * DAY)];
    case "90d": return [today - 89 * DAY, startOfDay(today + 7.5 * DAY)];
    default: return [today, startOfDay(today + 2.5 * DAY)];
  }
}

function series(from, to) {
  const n = quarterStart(nowSec());
  const step = range === "48h" || range === "7d" ? Q : 3600; // langere periodes: uurgemiddelden
  const hist = [], da = [], proj = [], inj = [];
  for (let t = from; t < to; t += step) {
    let sum = 0, cnt = 0, isProj = false;
    for (let q = t; q < t + step; q += Q) {
      const s = spotAt(q);
      if (s == null) continue;
      if (!known.has(q)) isProj = true;
      sum += s; cnt++;
    }
    if (!cnt) continue;
    const spot = sum / cnt;
    const pt = { x: t * 1000, y: valueFor(spot), spot };
    if (isProj) proj.push(pt);
    else if (t + step <= n + Q && t <= n) hist.push(pt);
    else da.push(pt);
    if (!isProj) inj.push({ x: t * 1000, y: mode === "spot" ? null : injectPrice(spot), spot });
  }
  // aaneensluitende lijnen
  if (hist.length && da.length) da.unshift(hist.at(-1));
  const lastSolid = da.at(-1) || hist.at(-1);
  if (lastSolid && proj.length) proj.unshift(lastSolid);
  return { hist, da, proj, inj, step };
}

const nowLinePlugin = {
  id: "nowLine",
  afterDatasetsDraw(c) {
    const x = c.scales.x.getPixelForValue(Date.now());
    if (x < c.chartArea.left || x > c.chartArea.right) return;
    const ctx = c.ctx;
    ctx.save();
    ctx.strokeStyle = css("--text");
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, c.chartArea.top); ctx.lineTo(x, c.chartArea.bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = css("--text");
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("nu", x, c.chartArea.top - 4);
    ctx.restore();
  },
};

const dayBandsPlugin = {
  id: "dayBands",
  beforeDatasetsDraw(c) {
    if (range !== "48h" && range !== "7d") return;
    const { left, right, top, bottom } = c.chartArea;
    const ctx = c.ctx;
    ctx.save();
    ctx.fillStyle = css("--grid");
    let i = 0;
    for (let d = startOfDay(c.scales.x.min / 1000); d * 1000 < c.scales.x.max; d = startOfDay(d + 1.5 * DAY), i++) {
      if (i % 2) continue;
      const x0 = Math.max(left, c.scales.x.getPixelForValue(d * 1000));
      const x1 = Math.min(right, c.scales.x.getPixelForValue(startOfDay(d + 1.5 * DAY) * 1000));
      if (x1 > x0) ctx.fillRect(x0, top, x1 - x0, bottom - top);
    }
    ctx.restore();
  },
};

function renderChart() {
  const [from, to] = rangeBounds();
  const { hist, da, proj, inj, step } = series(from, to);
  const unit = mode === "spot" ? "€/MWh" : "c€/kWh";
  document.getElementById("chartUnit").textContent = unit;
  const stepped = step === Q && range === "48h" ? "before" : false;
  const text = css("--muted"), grid = css("--grid");
  const ds = [
    { label: "Historiek", data: hist, borderColor: css("--hist"), backgroundColor: css("--hist") },
    { label: "Day-ahead", data: da, borderColor: css("--da"), backgroundColor: css("--da") },
    { label: "Verwachting", data: proj, borderColor: css("--proj"), backgroundColor: css("--proj"), borderDash: [5, 4] },
  ];
  if (showInject && mode !== "spot") {
    ds.push({ label: "Injectie", data: inj, borderColor: css("--inject"), backgroundColor: css("--inject"), borderWidth: 1.25 });
  }
  ds.forEach((d) => Object.assign(d, {
    parsing: false, pointRadius: 0, pointHoverRadius: 3, borderWidth: d.borderWidth ?? (range === "90d" ? 1.25 : 1.75),
    stepped, tension: 0, spanGaps: false,
  }));

  const longRange = range === "30d" || range === "90d";
  const opts = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: 14 } },
    scales: {
      x: {
        type: "linear", min: from * 1000, max: to * 1000,
        grid: { color: grid, drawTicks: false }, border: { display: false },
        ticks: {
          color: text, maxRotation: 0, autoSkip: true, maxTicksLimit: range === "48h" ? 9 : 10, padding: 6,
          stepSize: (range === "48h" ? 6 * 3600 : longRange ? 7 * DAY : DAY) * 1000,
          callback: (v) => {
            const s = v / 1000;
            if (range === "48h") return parts(s).h === 0 ? fmtDay.format(new Date(v)) : fmtTime.format(new Date(v));
            return fmtDayShort.format(new Date(v));
          },
        },
        afterBuildTicks: (axis) => {
          // ticks op lokale middernacht / 6u-grenzen i.p.v. UTC
          const out = [];
          const stepH = range === "48h" ? 6 : longRange ? 24 * 7 : 24;
          for (let d = startOfDay(axis.min / 1000); d * 1000 <= axis.max; d = startOfDay(d + 1.5 * DAY)) {
            if (stepH >= 24) {
              if (stepH === 24 || out.length === 0 || (d - out.at(-1).value / 1000) >= 6.5 * DAY) out.push({ value: d * 1000 });
            } else for (let h = 0; h < 24; h += stepH) {
              const v = (d + h * 3600) * 1000;
              if (v >= axis.min && v <= axis.max) out.push({ value: v });
            }
          }
          axis.ticks = out.filter((t) => t.value >= axis.min && t.value <= axis.max);
        },
      },
      y: {
        grid: { color: grid, drawTicks: false }, border: { display: false },
        ticks: { color: text, padding: 6, callback: (v) => num(v, mode === "spot" ? 0 : 0) },
        title: { display: true, text: unit, color: text, font: { size: 11 } },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => {
            const v = items[0].parsed.x;
            const end = v + step * 1000;
            return `${fmtDayTime.format(new Date(v))}–${fmtTime.format(new Date(end))}`;
          },
          label: (it) => {
            const sp = it.raw.spot;
            const extra = mode === "spot" ? "" : `  (EPEX ${num(sp, 1)} €/MWh)`;
            return ` ${it.dataset.label}: ${num(it.parsed.y, mode === "spot" ? 1 : 2)} ${unit}${extra}`;
          },
        },
      },
    },
  };

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById("chart"), { type: "line", data: { datasets: ds }, options: opts, plugins: [nowLinePlugin, dayBandsPlugin] });
}

// ---------- KPI's ----------
function dayStats(day0) {
  const vals = [];
  for (let t = day0; t < startOfDay(day0 + 1.5 * DAY); t += Q) {
    if (known.has(t)) vals.push({ t, v: allInPrice(known.get(t)) });
  }
  if (!vals.length) return null;
  const vs = vals.map((x) => x.v);
  const min = vals.reduce((a, b) => (b.v < a.v ? b : a));
  const max = vals.reduce((a, b) => (b.v > a.v ? b : a));
  return { avg: vs.reduce((a, b) => a + b, 0) / vs.length, min, max, n: vals.length };
}

function renderKpis() {
  const n = nowSec();
  const q = quarterStart(n);
  const today = startOfDay(n);
  const tomorrow = startOfDay(today + 1.5 * DAY);
  const spot = known.get(q);
  const st = dayStats(today);

  document.getElementById("nowSlot").textContent = `${fmtTime.format(new Date(q * 1000))}–${fmtTime.format(new Date((q + Q) * 1000))}`;
  if (spot != null) {
    const v = allInPrice(spot);
    document.getElementById("nowPrice").textContent = num(v);
    document.getElementById("nowSub").textContent = `all-in incl. btw · EPEX ${num(spot, 1)} €/MWh · injectie ${num(injectPrice(spot))} c€`;
    if (st) {
      const f = st.max.v === st.min.v ? 0.5 : (v - st.min.v) / (st.max.v - st.min.v);
      document.getElementById("nowMeter").style.left = `${Math.max(0, Math.min(1, f)) * 100}%`;
    }
  } else {
    document.getElementById("nowPrice").textContent = "–";
    document.getElementById("nowSub").textContent = "Geen prijs voor dit kwartier in de data";
  }

  if (st) {
    document.getElementById("todayAvg").textContent = num(st.avg);
    document.getElementById("todayRange").textContent =
      `min ${num(st.min.v)} (${fmtTime.format(new Date(st.min.t * 1000))}) · max ${num(st.max.v)} (${fmtTime.format(new Date(st.max.t * 1000))})`;
  }

  const tm = dayStats(tomorrow);
  if (tm && tm.n >= 90) {
    document.getElementById("tomAvg").textContent = num(tm.avg);
    document.getElementById("tomUnit").textContent = " gem.";
    const diff = st ? tm.avg - st.avg : 0;
    document.getElementById("tomRange").textContent =
      `min ${num(tm.min.v)} · max ${num(tm.max.v)}${st ? ` · ${diff >= 0 ? "+" : "−"}${num(Math.abs(diff))} t.o.v. vandaag` : ""}`;
  } else {
    let s = 0, c = 0;
    for (let t = tomorrow; t < startOfDay(tomorrow + 1.5 * DAY); t += Q) { const p = spotAt(t); if (p != null) { s += allInPrice(p); c++; } }
    document.getElementById("tomAvg").textContent = c ? `≈ ${num(s / c)}` : "–";
    document.getElementById("tomUnit").textContent = " verw.";
    document.getElementById("tomRange").textContent = "Day-ahead verschijnt rond 13u";
  }

  // goedkoopste aaneengesloten 2 uur in de komende gekende kwartieren
  const fut = [];
  for (let t = q; known.has(t); t += Q) fut.push([t, allInPrice(known.get(t))]);
  if (fut.length >= 8) {
    let best = null;
    for (let i = 0; i + 8 <= fut.length; i++) {
      const avg = fut.slice(i, i + 8).reduce((a, b) => a + b[1], 0) / 8;
      if (!best || avg < best.avg) best = { t: fut[i][0], avg };
    }
    const d = startOfDay(best.t) === today ? "vandaag" : startOfDay(best.t) === tomorrow ? "morgen" : fmtDay.format(new Date(best.t * 1000));
    document.getElementById("bestWin").textContent = `${fmtTime.format(new Date(best.t * 1000))}–${fmtTime.format(new Date((best.t + 8 * Q) * 1000))}`;
    document.getElementById("bestSub").textContent = `${d} · gem. ${num(best.avg)} c€/kWh`;
  } else {
    document.getElementById("bestWin").textContent = "–";
    document.getElementById("bestSub").textContent = "Te weinig gekende kwartieren";
  }
}

// ---------- Heatmap ----------
function renderHeat() {
  const el = document.getElementById("heat");
  const today = startOfDay(nowSec());
  const days = [
    [startOfDay(today - 0.5 * DAY), "Gisteren"],
    [today, "Vandaag"],
    [startOfDay(today + 1.5 * DAY), "Morgen"],
  ];
  const curHour = parts(nowSec()).h;
  let html = `<div></div>${Array.from({ length: 24 }, (_, h) => `<div class="hh">${h}</div>`).join("")}`;
  for (const [d0, label] of days) {
    const end = startOfDay(d0 + 1.5 * DAY);
    const hours = Array.from({ length: 24 }, () => ({ s: 0, c: 0, proj: false }));
    for (let t = d0; t < end; t += Q) {
      const p = spotAt(t);
      if (p == null) continue;
      const h = hours[parts(t).h];
      h.s += allInPrice(p); h.c++;
      if (!known.has(t)) h.proj = true;
    }
    const vals = hours.filter((h) => h.c).map((h) => h.s / h.c);
    const isProj = hours.some((h) => h.proj);
    const lo = Math.min(...vals), hi = Math.max(...vals), avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    html += `<div class="lbl">${label}${isProj ? "*" : ""}</div>`;
    hours.forEach((h, i) => {
      if (!h.c) { html += `<div class="c empty"></div>`; return; }
      const v = h.s / h.c;
      const now = d0 === today && i === curHour ? " now" : "";
      const op = h.proj ? "opacity:.55;" : "";
      html += `<div class="c${now}" style="background:${scaleColor(v, lo, avg, hi)};${op}" title="${label} ${i}u–${i + 1}u: ${num(v)} c€/kWh${h.proj ? " (verwachting)" : ""}">${Math.round(v)}</div>`;
    });
  }
  el.innerHTML = html;
  const note = el.nextElementSibling;
  note.textContent = "Gemiddelde all-in prijs per uur (c€/kWh). Groen = goedkoper dan het daggemiddelde, rood = duurder." +
    (days.some(([d]) => d > today && !known.has(d + 12 * 3600)) ? " * = indicatieve verwachting (day-ahead nog niet gepubliceerd)." : "");
}

// ---------- Opbouw ----------
function renderBreakdown() {
  const t = T();
  const spot = known.get(quarterStart(nowSec()));
  const el = document.getElementById("breakdown");
  if (spot == null) { el.innerHTML = "<tr><td>Geen actuele prijs</td><td></td></tr>"; return; }
  const rows = [
    ["Energie ENGIE (eSpot-formule)", energyPrice(spot, t), css("--da")],
    ["Netkosten Fluvius Limburg (kWh-tarief)", t.networkKwh, css("--hist")],
    ["Federale bijzondere accijns", t.excise, css("--proj")],
    ["Groene stroom & WKK-certificaten", t.greenWkk, css("--inject")],
  ];
  if (t.green) rows.push(["Optie 100% Belgische groene stroom", t.greenOption, css("--good")]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r[1])));
  el.innerHTML = rows.map(([l, v, c]) =>
    `<tr><td><span class="bar" style="width:${Math.max(2, (Math.abs(v) / maxAbs) * 60)}px;background:${c}"></span>${l}</td><td>${num(v, 3)}</td></tr>`
  ).join("") + `<tr class="total"><td>Totaal per kWh</td><td>${num(total, 3)}</td></tr>`;

  const cap = t.capacityKwYear * t.capacityMinKw;
  const fixed = [
    ["Vaste vergoeding ENGIE", `${num(t.fixedFeeYear)} €/jaar`],
    [`Capaciteitstarief (${num(t.capacityKwYear)} €/kW/jaar, min. ${num(t.capacityMinKw, 1)} kW)`, `≥ ${num(cap)} €/jaar`],
    ["Tarief databeheer", `${num(t.dataMgmtYear)} €/jaar`],
    ["Bijdrage Energiefonds (met domicilie)", `${num(t.energyFundMonth * 12)} €/jaar`],
  ];
  const sumY = t.fixedFeeYear + cap + t.dataMgmtYear + t.energyFundMonth * 12;
  document.getElementById("fixed").innerHTML = fixed.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join("") +
    `<tr class="total"><td>Minimaal per maand</td><td>${num(sumY / 12)} €</td></tr>`;
}

function renderFormula() {
  const t = T();
  const e = perKwhExtras(t);
  document.getElementById("formula").textContent =
    `all-in (c€/kWh) = (${num(t.offtakeA, 4)} + ${num(t.offtakeB, 4)} × eSpot_15) × ${num(1 + t.vat, 2)}\n` +
    `                 + ${num(e, 3)}   (net ${num(t.networkKwh, 3)} + accijns ${num(t.excise, 3)} + GSC/WKK ${num(t.greenWkk, 3)}${t.green ? ` + groen ${num(t.greenOption, 3)}` : ""})\n` +
    `injectie (c€/kWh) = ${num(t.injectA, 4)} + ${num(t.injectB, 4)} × eSpot_15   (geen btw)\n` +
    `eSpot_15 = EPEX SPOT Day-Ahead België per kwartier in €/MWh`;
}

function renderStatus() {
  const dot = document.getElementById("statusDot");
  const txt = document.getElementById("statusText");
  const upd = new Date(raw.updated);
  const ageH = (Date.now() - upd.getTime()) / 3.6e6;
  const hasNow = known.has(quarterStart(nowSec()));
  dot.className = `dot ${hasNow && ageH < 3 ? "live" : "stale"}`;
  txt.textContent = `Data t.e.m. ${fmtDayTime.format(new Date((lastKnownT + Q) * 1000))} · bijgewerkt ${fmtTime.format(upd)}`;
  document.getElementById("updated").textContent = `Laatste update: ${fmtDayTime.format(upd)}.`;
}

function renderAll() {
  renderStatus();
  renderKpis();
  renderChart();
  renderHeat();
  renderBreakdown();
  renderFormula();
}

// ---------- Instellingen ----------
function initSettings() {
  const map = { fA: "offtakeA", fB: "offtakeB", fIA: "injectA", fIB: "injectB" };
  const sync = () => {
    const t = T();
    for (const [id, k] of Object.entries(map)) document.getElementById(id).value = t[k];
    document.getElementById("fGreen").checked = !!t.green;
  };
  sync();
  for (const [id, k] of Object.entries(map)) {
    document.getElementById(id).addEventListener("change", (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) { overrides[k] = v; saveOverrides(overrides); renderAll(); }
    });
  }
  document.getElementById("fGreen").addEventListener("change", (e) => {
    overrides.green = e.target.checked; saveOverrides(overrides); renderAll();
  });
  document.getElementById("fReset").addEventListener("click", () => {
    overrides = {}; saveOverrides(overrides); sync(); renderAll();
  });
}

function initControls() {
  const seg = (id, attr, set) => {
    const root = document.getElementById(id);
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      root.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      set(b.dataset[attr]);
      renderChart();
    });
  };
  seg("rangeSeg", "range", (v) => (range = v));
  seg("modeSeg", "mode", (v) => (mode = v));
  document.getElementById("showInject").addEventListener("change", (e) => { showInject = e.target.checked; renderChart(); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
}

// ---------- Start ----------
async function refresh() {
  try {
    await loadData();
    renderAll();
  } catch (err) {
    console.error(err);
    document.getElementById("statusDot").className = "dot stale";
    document.getElementById("statusText").textContent = `Kon prijzen niet laden (${err.message})`;
  }
}

initControls();
initSettings();
refresh();
setInterval(refresh, 10 * 60 * 1000); // nieuwe data ophalen
let lastQ = quarterStart(nowSec());
setInterval(() => {
  const q = quarterStart(nowSec());
  if (q !== lastQ && raw) { lastQ = q; renderAll(); }
}, 20 * 1000);
