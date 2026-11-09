// Haalt de Belgische Day-Ahead (EPEX SPOT BE) kwartierprijzen op via de
// publieke Energy-Charts API (Fraunhofer ISE) en schrijft data/prices.json.
// Gebruik: node scripts/fetch-prices.mjs [aantalDagenHistoriek]
import { writeFile, mkdir } from "node:fs/promises";

const DAYS = Number(process.argv[2] ?? 90);
const day = 86400_000;
const fmt = (d) => d.toISOString().slice(0, 10);
const start = new Date(Date.now() - DAYS * day);
const end = new Date(Date.now() + 2 * day); // inclusief morgen zodra gepubliceerd

const url = `https://api.energy-charts.info/price?bzn=BE&start=${fmt(start)}&end=${fmt(end)}`;
const res = await fetch(url, { headers: { "User-Agent": "energie-tarieven-dashboard" } });
if (!res.ok) throw new Error(`Energy-Charts API ${res.status}: ${await res.text()}`);
const json = await res.json();
if (!Array.isArray(json.unix_seconds) || !Array.isArray(json.price)) throw new Error("Onverwacht antwoord van API");

const points = [];
json.unix_seconds.forEach((t, i) => {
  const p = json.price[i];
  if (typeof p === "number" && Number.isFinite(p)) points.push([t, p]);
});
if (points.length < 96) throw new Error(`Te weinig datapunten (${points.length})`);

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../data/prices.json", import.meta.url),
  JSON.stringify({
    updated: new Date().toISOString(),
    source: "EPEX SPOT Day-Ahead België via Energy-Charts (Fraunhofer ISE)",
    license: json.license_info ?? null,
    unit: "EUR/MWh",
    points,
  })
);
const last = new Date(points.at(-1)[0] * 1000).toISOString();
console.log(`OK: ${points.length} kwartierprijzen, laatste kwartier ${last}`);
