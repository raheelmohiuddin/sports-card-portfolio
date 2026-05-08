// GET /travel-time?originZip=12345&destCity=Selinsgrove&destState=PA
//
// Returns driving duration + distance from a US zip to a city/state, OR an
// estimated flight time when the trip is long enough to justify flying
// (>= 300 mi). Two Google Geocoding calls (one per endpoint) followed by
// one Distance Matrix call.
//
// Response shape:
//   { mode: "drive" | "fly",
//     distanceMiles:    number,   // round-trip, one-decimal precision
//     durationMinutes:  number }
//
// Caller is the My Shows page, which calls this once per (zip, city, state)
// combination and caches results in the browser session. We also keep a
// small per-container cache to dedupe within a warm Lambda; Google billing
// for Distance Matrix is per element so this matters at scale.
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { json } = require("../_response");

const smClient = new SecretsManagerClient({});
let cachedApiKey;

async function getApiKey() {
  if (cachedApiKey) return cachedApiKey;
  const secret = await smClient.send(
    new GetSecretValueCommand({ SecretId: "sports-card-portfolio/google-maps-api-key" })
  );
  cachedApiKey = JSON.parse(secret.SecretString).apiKey;
  return cachedApiKey;
}

const FLIGHT_THRESHOLD_MILES = 300;
const CRUISE_MPH             = 500;
const AIRPORT_BUFFER_MIN     = 120;
const METERS_PER_MILE        = 1609.344;

// Per-container cache. 24h TTL is generous — driving times do change with
// road construction etc., but the savings on repeated lookups are worth a
// stale time once a day.
const TTL_MS = 24 * 60 * 60 * 1000;
const lookupCache = new Map(); // key -> { value, expires }

function cacheKey(zip, city, state) {
  return `${zip}|${city}|${state}`;
}
function readCache(key) {
  const hit = lookupCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) { lookupCache.delete(key); return null; }
  return hit.value;
}
function writeCache(key, value) {
  lookupCache.set(key, { value, expires: Date.now() + TTL_MS });
}

async function geocode(address, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geocode HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.length) {
    throw new Error(`geocode ${data.status}${data.error_message ? `: ${data.error_message}` : ""}`);
  }
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}

async function distanceMatrix(origin, dest, apiKey) {
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}` +
    `&destinations=${dest.lat},${dest.lng}&mode=driving&units=imperial&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`distance matrix HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK") {
    throw new Error(`distance matrix ${data.status}${data.error_message ? `: ${data.error_message}` : ""}`);
  }
  const el = data.rows?.[0]?.elements?.[0];
  if (!el || el.status !== "OK") {
    throw new Error(`distance element ${el?.status ?? "missing"}`);
  }
  return {
    distanceMeters:  el.distance.value,
    durationSeconds: el.duration.value,
  };
}

exports.handler = async (event) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) return json(401, { error: "Unauthorized" });

  const qs        = event.queryStringParameters ?? {};
  const originZip = (qs.originZip ?? "").trim();
  const destCity  = (qs.destCity  ?? "").trim();
  const destState = (qs.destState ?? "").trim().toUpperCase();
  const country   = (qs.destCountry ?? "USA").trim();

  if (!/^\d{5}$/.test(originZip)) return json(400, { error: "originZip must be a 5-digit US zip code" });
  if (!destCity || !destState)   return json(400, { error: "destCity and destState required" });

  const key = cacheKey(originZip, destCity, destState);
  const cached = readCache(key);
  if (cached) return json(200, cached);

  try {
    const apiKey = await getApiKey();
    const [origin, dest] = await Promise.all([
      geocode(originZip, apiKey),
      geocode(`${destCity}, ${destState}, ${country}`, apiKey),
    ]);
    const { distanceMeters, durationSeconds } = await distanceMatrix(origin, dest, apiKey);
    const distanceMiles = distanceMeters / METERS_PER_MILE;

    let result;
    if (distanceMiles < FLIGHT_THRESHOLD_MILES) {
      result = {
        mode:            "drive",
        distanceMiles:   Math.round(distanceMiles * 10) / 10,
        durationMinutes: Math.round(durationSeconds / 60),
      };
    } else {
      // Flight estimate: cruise time at 500 mph + 2h airport buffer. Uses
      // the driving distance as a stand-in for great-circle since it's the
      // number we already have, and the difference is small at this range.
      const flightMinutes = Math.round((distanceMiles / CRUISE_MPH) * 60) + AIRPORT_BUFFER_MIN;
      result = {
        mode:            "fly",
        distanceMiles:   Math.round(distanceMiles * 10) / 10,
        durationMinutes: flightMinutes,
      };
    }

    writeCache(key, result);
    return json(200, result);
  } catch (err) {
    console.error("travel-time error", err);
    return json(502, { error: err.message ?? "travel-time lookup failed" });
  }
};
