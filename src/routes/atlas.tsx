import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import AtlasGlobe from "@/components/AtlasGlobe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";

export const Route = createFileRoute("/atlas")({
  head: () => ({
    meta: [
      { title: "World Atlas — Route Planner for Runs, Marathons & Triathlons" },
      {
        name: "description",
        content:
          "Plan runs, marathons, triathlons and cycling routes on an interactive world atlas. Search a start and end, view path, distance, and elevation profile.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
      },
    ],
  }),
  component: AtlasPage,
});

type LatLng = { lat: number; lng: number };
type Endpoint = { label: string; lat: number; lng: number };
type ElevPoint = { d: number; ele: number; lat: number; lng: number };

type CurrentWeather = {
  temp: number;
  humidity: number;
  windSpeed: number;
  windDir: number;
  code: number;
};
type DailyForecast = {
  date: string;
  tMax: number;
  tMin: number;
  precip: number;
  windMax: number;
  windDir: number;
  code: number;
};
type NewsItem = { title: string; url: string; source: string; date: string };
type WildlifeItem = { name: string; common: string; count: number; key: number };
type RaceEvent = {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  distanceKm: number;
  date: string | null;
  url: string;
};

type UserEvent = {
  id: string;
  created_by: string;
  name: string;
  description: string | null;
  event_date: string;
  start_lat: number;
  start_lng: number;
  location_label: string;
  route_id: string | null;
  capacity: number | null;
  is_public: boolean;
};

type EventRsvp = {
  event_id: string;
  user_id: string;
  status: "going" | "interested" | "waitlist";
  finish_time_min: number | null;
};

const WEATHER_CODES: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow",
  80: "Rain showers", 81: "Heavy showers", 82: "Violent showers",
  95: "Thunderstorm", 96: "Thunder w/ hail", 99: "Severe thunder",
};

function bearingDeg(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const dl = toRad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function compass(deg: number): string {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function windRelation(raceDir: number, windFromDir: number) {
  const windToward = (windFromDir + 180) % 360;
  let diff = Math.abs(raceDir - windToward);
  if (diff > 180) diff = 360 - diff;
  if (diff <= 45) return { type: "Tailwind" as const, delta: diff };
  if (diff >= 135) return { type: "Headwind" as const, delta: 180 - diff };
  return { type: "Crosswind" as const, delta: diff };
}

async function fetchWeather(pt: LatLng): Promise<{ current: CurrentWeather; daily: DailyForecast[] } | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${pt.lat}&longitude=${pt.lng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant&forecast_days=7&timezone=auto&wind_speed_unit=kmh&temperature_unit=celsius`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    const c = j.current;
    const d = j.daily;
    const current: CurrentWeather = {
      temp: c.temperature_2m,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      windDir: c.wind_direction_10m,
      code: c.weather_code,
    };
    const daily: DailyForecast[] = d.time.map((t: string, i: number) => ({
      date: t,
      tMax: d.temperature_2m_max[i],
      tMin: d.temperature_2m_min[i],
      precip: d.precipitation_sum[i],
      windMax: d.wind_speed_10m_max[i],
      windDir: d.wind_direction_10m_dominant[i],
      code: d.weather_code[i],
    }));
    return { current, daily };
  } catch { return null; }
}

async function fetchNews(pt: LatLng, placeName: string): Promise<NewsItem[]> {
  try {
    const q = encodeURIComponent(`"${placeName.split(",")[0]}"`);
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=15&format=json&sort=datedesc`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const j = await res.json();
    if (!Array.isArray(j.articles)) return [];
    return j.articles.slice(0, 12).map((a: any) => ({
      title: a.title || "(untitled)",
      url: a.url,
      source: a.domain || a.sourcecountry || "news",
      date: a.seendate || "",
    }));
  } catch { return []; }
}

async function fetchWildlife(pt: LatLng): Promise<WildlifeItem[]> {
  try {
    const r = 0.25; // ~25km bbox
    const url = `https://api.gbif.org/v1/occurrence/search?decimalLatitude=${(pt.lat - r).toFixed(3)},${(pt.lat + r).toFixed(3)}&decimalLongitude=${(pt.lng - r).toFixed(3)},${(pt.lng + r).toFixed(3)}&kingdomKey=1&facet=speciesKey&facetLimit=15&limit=0`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const j = await res.json();
    const facet = j.facets?.[0]?.counts || [];
    const species = await Promise.all(
      facet.slice(0, 10).map(async (f: any) => {
        try {
          const sr = await fetch(`https://api.gbif.org/v1/species/${f.name}`);
          if (!sr.ok) return null;
          const sj = await sr.json();
          return {
            name: sj.scientificName || sj.canonicalName || "unknown",
            common: sj.vernacularName || "",
            count: Number(f.count) || 0,
            key: Number(f.name),
          } as WildlifeItem;
        } catch { return null; }
      }),
    );
    return species.filter(Boolean) as WildlifeItem[];
  } catch { return []; }
}

/**
 * Nearby athletic events via Wikidata SPARQL — pulls anything that is (or is a
 * subclass of) a marathon, triathlon, running / cycling / obstacle race,
 * duathlon, ultramarathon, Ironman, or general sports competition, within a
 * radius of the given midpoint.
 */
async function fetchEvents(pt: LatLng, radiusKm = 250): Promise<RaceEvent[]> {
  const query = `
SELECT ?event ?eventLabel ?typeLabel ?coord ?date ?article WHERE {
  SERVICE wikibase:around {
    ?event wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${pt.lng} ${pt.lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
  }
  VALUES ?type {
    wd:Q4200        # marathon
    wd:Q210773      # triathlon
    wd:Q1656682     # event
    wd:Q18536594    # ultramarathon
    wd:Q1520159     # running race / road race
    wd:Q2312410     # cycling race
    wd:Q13406554    # sports competition
    wd:Q106043376   # obstacle course race (Spartan / Hyrox / Tough Mudder family)
    wd:Q6942233     # duathlon
    wd:Q179700      # Ironman / long-distance triathlon
    wd:Q17317604    # half marathon
  }
  ?event wdt:P31/wdt:P279* ?type .
  OPTIONAL { ?event wdt:P585 ?date . }
  OPTIONAL {
    ?article schema:about ?event ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 200`;
  try {
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: "application/sparql-results+json" } });
    if (!res.ok) return [];
    const j = await res.json();
    const rows = j.results?.bindings || [];
    const dedup = new Map<string, RaceEvent>();
    for (const r of rows) {
      const id = r.event.value.split("/").pop() as string;
      if (dedup.has(id)) continue;
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.coord.value);
      if (!m) continue;
      const lng = parseFloat(m[1]);
      const lat = parseFloat(m[2]);
      dedup.set(id, {
        id,
        name: r.eventLabel?.value || "(unnamed event)",
        kind: r.typeLabel?.value || "event",
        lat,
        lng,
        distanceKm: haversine({ lat, lng }, pt) / 1000,
        date: r.date?.value ? r.date.value.slice(0, 10) : null,
        url: r.article?.value || r.event.value,
      });
    }
    return Array.from(dedup.values()).sort((a, b) => a.distanceKm - b.distanceKm);
  } catch {
    return [];
  }
}

const ACTIVITIES = {
  run: { name: "Run / Jog", color: "#e11d48", pace: 6, osrm: "foot" },
  marathon: { name: "Marathon (42.2 km)", color: "#7c3aed", pace: 5.5, osrm: "foot" },
  triathlon: { name: "Triathlon", color: "#0ea5e9", pace: 4.5, osrm: "foot" },
  cycle: { name: "Cycling", color: "#059669", pace: 2.2, osrm: "bike" },
  hike: { name: "Hike / Trail", color: "#a16207", pace: 12, osrm: "foot" },
} as const;
type ActKey = keyof typeof ACTIVITIES;

const TILE_LAYERS = {
  street: {
    name: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  },
  topo: {
    name: "Topographic",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap · SRTM · OpenTopoMap (CC-BY-SA)",
  },
  satellite: {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri",
  },
} as const;
type LayerKey = keyof typeof TILE_LAYERS;

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function densify(points: LatLng[], spacingMeters = 150): LatLng[] {
  if (points.length < 2) return points;
  const out: LatLng[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = haversine(a, b);
    const steps = Math.max(1, Math.floor(d / spacingMeters));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
    }
  }
  return out;
}

// Downsample if too many samples (keep first/last, decimate middle)
function limitPoints(points: LatLng[], max = 200): LatLng[] {
  if (points.length <= max) return points;
  const stride = points.length / max;
  const out: LatLng[] = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.min(points.length - 1, Math.floor(i * stride))]);
  }
  out[out.length - 1] = points[points.length - 1];
  return out;
}

async function fetchElevations(points: LatLng[]): Promise<number[]> {
  const chunkSize = 100;
  const results: number[] = [];
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    try {
      const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locations: chunk.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        }),
      });
      if (!res.ok) throw new Error("elev failed");
      const json = await res.json();
      for (const r of json.results) results.push(r.elevation ?? 0);
    } catch {
      for (let j = 0; j < chunk.length; j++) results.push(0);
    }
  }
  return results;
}

// Parse "lat,lng" or "lat lng" — return null if not coords
function parseCoords(q: string): LatLng | null {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

async function geocode(query: string): Promise<Endpoint | null> {
  const coords = parseCoords(query);
  if (coords) {
    return {
      label: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
      ...coords,
    };
  }
  // Photon (photon.komoot.io) instead of Nominatim's public demo endpoint.
  // Nominatim's usage policy caps clients at 1 req/sec and requires a custom
  // User-Agent identifying the app — but browsers block fetch() from setting
  // a custom User-Agent, so a client-side call can never actually comply.
  // Photon is built by Komoot specifically to power in-app search (same OSM
  // data underneath) and doesn't carry that restriction.
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const feature = j.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.geometry.coordinates as [number, number];
  const p = feature.properties || {};
  const label = [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(", ");
  return { label: label || query, lat, lng };
}

async function geolocate(): Promise<Endpoint> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation unavailable"));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          label: `My location (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

async function fetchRoute(
  start: LatLng,
  end: LatLng,
  profile: string,
): Promise<LatLng[] | null> {
  const url = `https://router.project-osrm.org/route/v1/${profile}/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.routes?.[0]?.geometry?.coordinates) return null;
    return json.routes[0].geometry.coordinates.map((c: [number, number]) => ({
      lat: c[1],
      lng: c[0],
    }));
  } catch {
    return null;
  }
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function formatTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function AtlasPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const hoverMarkerRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  const [startQuery, setStartQuery] = useState("");
  const [endQuery, setEndQuery] = useState("");
  const [start, setStart] = useState<Endpoint | null>(null);
  const [end, setEnd] = useState<Endpoint | null>(null);
  const [routePath, setRoutePath] = useState<LatLng[]>([]);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [activity, setActivity] = useState<ActKey>("run");
  const [layer, setLayer] = useState<LayerKey>("topo");
  const [elevation, setElevation] = useState<ElevPoint[]>([]);
  const [loadingElev, setLoadingElev] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<LatLng | null>(null);
  const [searchBusy, setSearchBusy] = useState<"start" | "end" | null>(null);

  const [weather, setWeather] = useState<{ current: CurrentWeather; daily: DailyForecast[] } | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [wildlife, setWildlife] = useState<WildlifeItem[]>([]);
  const [wildlifeLoaded, setWildlifeLoaded] = useState(false);
  const [loadingWildlife, setLoadingWildlife] = useState(false);
  const [events, setEvents] = useState<RaceEvent[]>([]);
  const [loadingIntel, setLoadingIntel] = useState(false);
  const [showNews, setShowNews] = useState(false);
  const [showWildlife, setShowWildlife] = useState(false);
  const [showEvents, setShowEvents] = useState(true);
  const [eventRadius, setEventRadius] = useState(250);
  const [view, setView] = useState<"globe" | "map">("globe");

  // ── Auth (own sign-in, same Supabase project/users as Muscle Selector) ──
  const { user, ready: authReady } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  // ── Cross-origin session bridge ──────────────────────────────────────
  // Atlas is embedded via iframe inside Muscle Selector, on a different
  // origin. Supabase sessions live in localStorage, which is scoped per
  // origin — being signed in on the parent page doesn't carry over here
  // automatically, even though it's the same Supabase project. The parent
  // posts its session tokens once this iframe is ready; we just hydrate.
  useEffect(() => {
    const ALLOWED_PARENT_ORIGINS = [
      "https://meal.bmarchai.com",
      "https://meal.breelaun.workers.dev",
      "http://localhost:3000",
    ];
    const onMessage = (e: MessageEvent) => {
      if (!ALLOWED_PARENT_ORIGINS.includes(e.origin)) return;
      if (e.data?.type !== "atlas:auth-session") return;
      const { access_token, refresh_token } = e.data;
      if (access_token && refresh_token) {
        supabase.auth.setSession({ access_token, refresh_token });
      }
    };
    window.addEventListener("message", onMessage);
    // Ping the parent in case it loaded before we attached this listener —
    // it replies with the session if the user's already signed in there.
    if (window.self !== window.top) {
      window.parent.postMessage({ type: "atlas:ready" }, "*");
    }
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const submitAuth = async () => {
    if (!authEmail.trim() || authPass.length < 8) {
      setAuthMsg("Email + password (min 8 chars) required.");
      return;
    }
    setAuthBusy(true);
    setAuthMsg("");
    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({ email: authEmail.trim(), password: authPass });
      if (error) { setAuthBusy(false); setAuthMsg(error.message); return; }
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPass,
    });
    setAuthBusy(false);
    if (error) { setAuthMsg(authMode === "signup" ? "Account created — please sign in." : error.message); return; }
    setAuthOpen(false);
    setAuthEmail("");
    setAuthPass("");
  };

  // ── Save to Race Plan ────────────────────────────────────────────────
  type RacePlanWeek = { weekNum: number; days: { day?: string }[] };
  const [savePlanOpen, setSavePlanOpen] = useState(false);
  const [planWeeks, setPlanWeeks] = useState<RacePlanWeek[] | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [saveWeekIdx, setSaveWeekIdx] = useState(0);
  const [saveDayIdx, setSaveDayIdx] = useState(0);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // ── Route sharing (public link + fork) ──────────────────────────────
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [forkedFromId, setForkedFromId] = useState<string | null>(null);
  const [sharedRouteId, setSharedRouteId] = useState<string | null>(null);

  // If we arrived here via "Use this route →" on a shared-route page,
  // sessionStorage carries the route data across the navigation — load it
  // once, then clear it so a refresh doesn't re-trigger the fork.
  useEffect(() => {
    const raw = sessionStorage.getItem("atlas:fork");
    if (!raw) return;
    sessionStorage.removeItem("atlas:fork");
    try {
      const f = JSON.parse(raw);
      setStart({ label: f.start_label, lat: f.start_lat, lng: f.start_lng });
      setEnd({ label: f.end_label, lat: f.end_lat, lng: f.end_lng });
      setRoutePath(f.route_path || []);
      setElevation(f.elevation || []);
      if (f.activity) setActivity(f.activity);
      setForkedFromId(f.id ?? null);
    } catch {
      // malformed session data — ignore, user just starts from a blank planner
    }
  }, []);

  const genSlug = () =>
    Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 4);

  const shareRoute = async () => {
    if (!user) { setAuthOpen(true); return; }
    if (!start || !end || elevation.length < 2) return;
    setShareBusy(true);
    setShareMsg("");
    const slug = genSlug();
    const { data, error } = await supabase.from("shared_routes").insert({
      user_id: user.id,
      slug,
      title: `${start.label} → ${end.label}`,
      activity,
      start_label: start.label,
      start_lat: start.lat,
      start_lng: start.lng,
      end_label: end.label,
      end_lat: end.lat,
      end_lng: end.lng,
      route_path: routePath,
      elevation,
      distance_km: +(stats.dist / 1000).toFixed(3),
      elev_gain_m: Math.round(stats.gain),
      elev_loss_m: Math.round(stats.loss),
      est_time_min: Math.round(stats.time),
      forked_from: forkedFromId,
    }).select("id").single();
    setShareBusy(false);
    if (error) { setShareMsg(error.message); return; }
    setSharedRouteId(data.id);
    setShareUrl(`${window.location.origin}/atlas/share/${slug}`);
    setShareOpen(true);
  };

  // ── Marathons / Events (user-created) ───────────────────────────────
  // Distinct from `events` (the read-only Wikidata "nearby events" panel
  // above) — these are events people actually create and RSVP to here.
  const [showUserEvents, setShowUserEvents] = useState(false);
  const [userEvents, setUserEvents] = useState<UserEvent[]>([]);
  const [loadingUserEvents, setLoadingUserEvents] = useState(false);
  const [myRsvps, setMyRsvps] = useState<Record<string, EventRsvp>>({});

  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [evName, setEvName] = useState("");
  const [evDescription, setEvDescription] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evCapacity, setEvCapacity] = useState("");
  const [evBusy, setEvBusy] = useState(false);
  const [evMsg, setEvMsg] = useState("");

  const [leaderboardEvent, setLeaderboardEvent] = useState<UserEvent | null>(null);
  const [leaderboardRows, setLeaderboardRows] = useState<(EventRsvp & { email?: string })[]>([]);
  const [finishTimeInput, setFinishTimeInput] = useState("");

  const loadUserEvents = async () => {
    if (loadingUserEvents) return;
    setLoadingUserEvents(true);
    const { data, error } = await supabase
      .from("user_events")
      .select("*")
      .gte("event_date", new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString().slice(0, 10))
      .order("event_date", { ascending: true })
      .limit(100);
    setLoadingUserEvents(false);
    if (error || !data) return;
    const mid = start && end
      ? { lat: (start.lat + end.lat) / 2, lng: (start.lng + end.lng) / 2 }
      : start || end || null;
    const rows = data as UserEvent[];
    const sorted = mid
      ? [...rows].sort(
          (a, b) =>
            haversine(mid, { lat: a.start_lat, lng: a.start_lng }) -
            haversine(mid, { lat: b.start_lat, lng: b.start_lng }),
        )
      : rows;
    setUserEvents(sorted);
    if (user) {
      const { data: rsvps } = await supabase
        .from("event_rsvps")
        .select("*")
        .eq("user_id", user.id)
        .in("event_id", sorted.map((e) => e.id));
      if (rsvps) {
        const map: Record<string, EventRsvp> = {};
        for (const r of rsvps as EventRsvp[]) map[r.event_id] = r;
        setMyRsvps(map);
      }
    }
  };

  const createEvent = async () => {
    if (!user) { setAuthOpen(true); return; }
    if (!start) { setEvMsg("Set a start point on the map first — that becomes the event location."); return; }
    if (!evName.trim() || !evDate) { setEvMsg("Name and date are required."); return; }
    setEvBusy(true);
    setEvMsg("");
    const { error } = await supabase.from("user_events").insert({
      created_by: user.id,
      name: evName.trim(),
      description: evDescription.trim() || null,
      event_date: evDate,
      start_lat: start.lat,
      start_lng: start.lng,
      location_label: start.label,
      route_id: sharedRouteId,
      capacity: evCapacity ? Number(evCapacity) : null,
      is_public: true,
    });
    setEvBusy(false);
    if (error) { setEvMsg(error.message); return; }
    setCreateEventOpen(false);
    setEvName(""); setEvDescription(""); setEvDate(""); setEvCapacity("");
    loadUserEvents();
  };

  const rsvp = async (ev: UserEvent, status: EventRsvp["status"]) => {
    if (!user) { setAuthOpen(true); return; }
    // Simple capacity check — count current "going" RSVPs before allowing
    // another one; ties go to whoever's request lands first.
    if (status === "going" && ev.capacity != null) {
      const { count } = await supabase
        .from("event_rsvps")
        .select("*", { count: "exact", head: true })
        .eq("event_id", ev.id)
        .eq("status", "going");
      if ((count ?? 0) >= ev.capacity) status = "waitlist";
    }
    const { error } = await supabase
      .from("event_rsvps")
      .upsert({ event_id: ev.id, user_id: user.id, status }, { onConflict: "event_id,user_id" });
    if (!error) {
      setMyRsvps((m) => ({ ...m, [ev.id]: { event_id: ev.id, user_id: user.id, status, finish_time_min: null } }));
    }
  };

  const openLeaderboard = async (ev: UserEvent) => {
    setLeaderboardEvent(ev);
    const { data } = await supabase
      .from("event_rsvps")
      .select("*")
      .eq("event_id", ev.id)
      .not("finish_time_min", "is", null)
      .order("finish_time_min", { ascending: true });
    setLeaderboardRows((data as EventRsvp[]) || []);
  };

  const submitFinishTime = async () => {
    if (!user || !leaderboardEvent || !finishTimeInput) return;
    const mins = Number(finishTimeInput);
    if (!mins || mins <= 0) return;
    await supabase
      .from("event_rsvps")
      .upsert(
        { event_id: leaderboardEvent.id, user_id: user.id, status: "going", finish_time_min: mins },
        { onConflict: "event_id,user_id" },
      );
    setFinishTimeInput("");
    openLeaderboard(leaderboardEvent);
  };

  // "Train for this event" — bridges into Muscle Selector's Race Plan
  // wizard. Atlas doesn't own that logic, so it just asks the parent
  // window to open it, pre-filled with this event's date. Standalone
  // visits (not inside the iframe) get a plain heads-up instead.
  const trainForEvent = (ev: UserEvent) => {
    if (window.self !== window.top) {
      window.parent.postMessage(
        { type: "atlas:train-for-event", raceDate: ev.event_date, eventName: ev.name },
        "*",
      );
    } else {
      alert("Open Atlas inside Muscle Selector to build a training plan for this event.");
    }
  };

  const openSavePlan = async () => {
    if (!user) { setAuthOpen(true); return; }
    setSavePlanOpen(true);
    setSaveMsg("");
    setPlanLoading(true);
    const { data, error } = await supabase
      .from("user_race_plans")
      .select("plan")
      .eq("user_id", user.id)
      .maybeSingle();
    setPlanLoading(false);
    if (error || !data?.plan?.weeks?.length) {
      setPlanWeeks(null);
      return;
    }
    setPlanWeeks(data.plan.weeks);
    setSaveWeekIdx(0);
    setSaveDayIdx(0);
  };

  const saveRouteToPlan = async () => {
    if (!user || !start || !end || elevation.length < 2) return;
    setSaveBusy(true);
    setSaveMsg("");
    const { error } = await supabase.from("race_plan_routes").upsert(
      {
        user_id: user.id,
        week_idx: saveWeekIdx,
        day_idx: saveDayIdx,
        title: `${start.label} → ${end.label}`,
        activity,
        start_label: start.label,
        start_lat: start.lat,
        start_lng: start.lng,
        end_label: end.label,
        end_lat: end.lat,
        end_lng: end.lng,
        elevation,
        distance_km: +(stats.dist / 1000).toFixed(3),
        elev_gain_m: Math.round(stats.gain),
        elev_loss_m: Math.round(stats.loss),
        est_time_min: Math.round(stats.time),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,week_idx,day_idx" },
    );
    setSaveBusy(false);
    if (error) { setSaveMsg(error.message); return; }
    setSaveMsg("✅ Saved! Check this day in your Race Plan.");
  };

  // When switching back to map, force Leaflet to recompute its size
  useEffect(() => {
    if (view !== "map") return;
    const map = leafletMapRef.current;
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 50);
    return () => clearTimeout(t);
  }, [view]);

  // Init map — starts at globe view
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !mapRef.current || leafletMapRef.current) return;
      LRef.current = L;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current, {
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        worldCopyJump: true,
        zoomControl: true,
      });
      leafletMapRef.current = map;

      const tl = L.tileLayer(TILE_LAYERS[layer].url, {
        attribution: TILE_LAYERS[layer].attribution,
        maxZoom: 18,
      }).addTo(map);
      tileLayerRef.current = tl;
    })();
    return () => {
      cancelled = true;
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

  // Swap tile layer
  useEffect(() => {
    const map = leafletMapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(TILE_LAYERS[layer].url, {
      attribution: TILE_LAYERS[layer].attribution,
      maxZoom: 18,
    }).addTo(map);
  }, [layer]);

  // Fetch route whenever start/end/activity change
  useEffect(() => {
    if (!start || !end) {
      setRoutePath([]);
      setRouteError(null);
      return;
    }
    let cancelled = false;
    setRouting(true);
    setRouteError(null);
    fetchRoute(start, end, ACTIVITIES[activity].osrm).then((path) => {
      if (cancelled) return;
      if (path && path.length > 1) {
        setRoutePath(path);
      } else {
        // Fallback to straight line
        setRoutePath([start, end]);
        setRouteError("No routable path found — showing straight-line estimate.");
      }
      setRouting(false);
    });
    return () => {
      cancelled = true;
    };
  }, [start, end, activity]);

  // Redraw endpoints + path
  useEffect(() => {
    const map = leafletMapRef.current;
    const L = LRef.current;
    if (!map || !L) return;

    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    const mkIcon = (txt: string, color: string) =>
      L.divIcon({
        className: "wp-marker",
        html: `<div style="background:${color};color:#fff;font-family:ui-sans-serif,system-ui;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);white-space:nowrap;">${txt}</div>`,
        iconSize: [50, 22],
        iconAnchor: [25, 11],
      });

    const bounds: [number, number][] = [];
    if (start) {
      const m = L.marker([start.lat, start.lng], {
        icon: mkIcon("Start", "#16a34a"),
      }).addTo(map);
      markersRef.current.push(m);
      bounds.push([start.lat, start.lng]);
    }
    if (end) {
      const m = L.marker([end.lat, end.lng], {
        icon: mkIcon("End", "#dc2626"),
      }).addTo(map);
      markersRef.current.push(m);
      bounds.push([end.lat, end.lng]);
    }

    if (routePath.length >= 2) {
      polylineRef.current = L.polyline(
        routePath.map((p) => [p.lat, p.lng]),
        { color: ACTIVITIES[activity].color, weight: 5, opacity: 0.85 },
      ).addTo(map);
      map.fitBounds(polylineRef.current.getBounds(), { padding: [40, 40] });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 13);
    } else if (bounds.length === 2) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [start, end, routePath, activity]);

  // Elevation profile whenever routePath changes
  useEffect(() => {
    if (routePath.length < 2) {
      setElevation([]);
      return;
    }
    const sampled = limitPoints(densify(routePath, 150), 200);
    let cancelled = false;
    setLoadingElev(true);
    fetchElevations(sampled).then((eles) => {
      if (cancelled) return;
      const pts: ElevPoint[] = [];
      let dist = 0;
      for (let i = 0; i < sampled.length; i++) {
        if (i > 0) dist += haversine(sampled[i - 1], sampled[i]);
        pts.push({
          d: dist,
          ele: eles[i] ?? 0,
          lat: sampled[i].lat,
          lng: sampled[i].lng,
        });
      }
      setElevation(pts);
      setLoadingElev(false);
    });
    return () => {
      cancelled = true;
    };
  }, [routePath]);

  // Hover marker
  useEffect(() => {
    const map = leafletMapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    if (hoverMarkerRef.current) {
      map.removeLayer(hoverMarkerRef.current);
      hoverMarkerRef.current = null;
    }
    if (hoverPoint) {
      hoverMarkerRef.current = L.circleMarker([hoverPoint.lat, hoverPoint.lng], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: ACTIVITIES[activity].color,
        fillOpacity: 1,
      }).addTo(map);
    }
  }, [hoverPoint, activity]);

  // Daily-refreshed area intel: weather + news + nearby races at route
  // midpoint. Wildlife is fetched separately and lazily (see below) — its
  // lookup is expensive (a facet search plus up to 10 sequential per-species
  // detail calls) and most visits never open that panel, so there's no
  // reason to pay for it upfront.
  useEffect(() => {
    if (!start || !end) {
      setWeather(null);
      setNews([]);
      setWildlife([]);
      setWildlifeLoaded(false);
      setEvents([]);
      return;
    }
    const mid: LatLng = {
      lat: (start.lat + end.lat) / 2,
      lng: (start.lng + end.lng) / 2,
    };
    const placeName = end.label || start.label;
    let cancelled = false;
    setLoadingIntel(true);
    setWildlife([]);
    setWildlifeLoaded(false);
    Promise.all([
      fetchWeather(mid),
      fetchNews(mid, placeName),
      fetchEvents(mid, eventRadius),
    ]).then(([w, n, ev]) => {
      if (cancelled) return;
      setWeather(w);
      setNews(n);
      setEvents(ev);
      setLoadingIntel(false);
    });
    return () => { cancelled = true; };
  }, [start, end, eventRadius]);

  // Wildlife — fetched once, on demand, the first time the "Wildlife in
  // area" panel is opened for the current start/end pair.
  const loadWildlifeIfNeeded = () => {
    if (wildlifeLoaded || loadingWildlife || !start || !end) return;
    const mid: LatLng = {
      lat: (start.lat + end.lat) / 2,
      lng: (start.lng + end.lng) / 2,
    };
    setLoadingWildlife(true);
    fetchWildlife(mid).then((wl) => {
      setWildlife(wl);
      setWildlifeLoaded(true);
      setLoadingWildlife(false);
    });
  };

  const stats = useMemo(() => {
    if (elevation.length < 2)
      return { dist: 0, gain: 0, loss: 0, min: 0, max: 0, time: 0 };
    let gain = 0;
    let loss = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < elevation.length; i++) {
      const e = elevation[i].ele;
      if (e < min) min = e;
      if (e > max) max = e;
      if (i > 0) {
        const d = e - elevation[i - 1].ele;
        if (d > 0) gain += d;
        else loss += -d;
      }
    }
    const dist = elevation[elevation.length - 1].d;
    const time = (dist / 1000) * ACTIVITIES[activity].pace;
    return { dist, gain, loss, min, max, time };
  }, [elevation, activity]);

  const chartData = useMemo(
    () =>
      elevation.map((p) => ({
        km: +(p.d / 1000).toFixed(3),
        ele: Math.round(p.ele),
        lat: p.lat,
        lng: p.lng,
      })),
    [elevation],
  );

  const raceBearing = useMemo(() => {
    if (!start || !end) return null;
    return bearingDeg(start, end);
  }, [start, end]);

  const windVsRace = useMemo(() => {
    if (raceBearing == null || !weather) return null;
    return windRelation(raceBearing, weather.current.windDir);
  }, [raceBearing, weather]);

  const downloadReport = async () => {
    if (!start || !end) return;
    // Wildlife loads lazily on panel-open now — if the user never opened it,
    // fetch it here so the "full" report actually includes everything the
    // filename promises instead of silently shipping an empty array.
    let wildlifeForReport = wildlife;
    if (!wildlifeLoaded) {
      const mid: LatLng = { lat: (start.lat + end.lat) / 2, lng: (start.lng + end.lng) / 2 };
      setLoadingWildlife(true);
      wildlifeForReport = await fetchWildlife(mid);
      setWildlife(wildlifeForReport);
      setWildlifeLoaded(true);
      setLoadingWildlife(false);
    }
    const report = {
      generatedAt: new Date().toISOString(),
      activity: ACTIVITIES[activity].name,
      start: { label: start.label, lat: start.lat, lng: start.lng },
      end: { label: end.label, lat: end.lat, lng: end.lng },
      raceBearing: raceBearing != null ? { deg: Math.round(raceBearing), compass: compass(raceBearing) } : null,
      route: {
        distance_km: +(stats.dist / 1000).toFixed(3),
        est_time_min: Math.round(stats.time),
        elev_gain_m: Math.round(stats.gain),
        elev_loss_m: Math.round(stats.loss),
        min_alt_m: stats.min === Infinity ? null : Math.round(stats.min),
        max_alt_m: stats.max === -Infinity ? null : Math.round(stats.max),
      },
      weather: weather
        ? {
            current: {
              ...weather.current,
              windFromCompass: compass(weather.current.windDir),
              condition: WEATHER_CODES[weather.current.code] || "unknown",
            },
            forecast_7day: weather.daily.map((d) => ({
              ...d,
              windFromCompass: compass(d.windDir),
              condition: WEATHER_CODES[d.code] || "unknown",
            })),
          }
        : null,
      windVsRace,
      news,
      wildlife: wildlifeForReport,
      nearbyEvents: events,
      nearbyEventsRadiusKm: eventRadius,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `route-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadEvents = (fmt: "csv" | "json" = "csv") => {
    if (!events.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    let blob: Blob;
    let filename: string;
    if (fmt === "json") {
      blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
      filename = `nearby-events-${stamp}.json`;
    } else {
      const esc = (v: unknown) => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ["name", "kind", "date", "distance_km", "lat", "lng", "url"];
      const rows = events.map((e) =>
        [e.name, e.kind, e.date ?? "", e.distanceKm.toFixed(1), e.lat, e.lng, e.url].map(esc).join(","),
      );
      blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" });
      filename = `nearby-events-${stamp}.csv`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };




  const handleSearch = async (which: "start" | "end") => {
    const q = which === "start" ? startQuery : endQuery;
    if (!q.trim()) return;
    setSearchBusy(which);
    try {
      const ep = await geocode(q);
      if (!ep) {
        setRouteError(`Could not find "${q}".`);
        return;
      }
      if (which === "start") setStart(ep);
      else setEnd(ep);
    } catch {
      setRouteError("Search failed. Try again.");
    } finally {
      setSearchBusy(null);
    }
  };

  const handleGeolocate = async (which: "start" | "end") => {
    setSearchBusy(which);
    try {
      const ep = await geolocate();
      if (which === "start") {
        setStart(ep);
        setStartQuery(ep.label);
      } else {
        setEnd(ep);
        setEndQuery(ep.label);
      }
    } catch {
      setRouteError("Location permission denied.");
    } finally {
      setSearchBusy(null);
    }
  };

  const swapEnds = () => {
    setStart(end);
    setEnd(start);
    setStartQuery(endQuery);
    setEndQuery(startQuery);
  };

  const clearAll = () => {
    setStart(null);
    setEnd(null);
    setStartQuery("");
    setEndQuery("");
    setRoutePath([]);
    setElevation([]);
    setRouteError(null);
    const map = leafletMapRef.current;
    if (map) map.setView([20, 0], 2);
  };

  const exportGPX = () => {
    if (elevation.length < 2) return;
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="World Atlas" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${ACTIVITIES[activity].name}</name><trkseg>
${elevation
  .map(
    (p) =>
      `    <trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.ele}</ele></trkpt>`,
  )
  .join("\n")}
  </trkseg></trk>
</gpx>`;
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `route-${Date.now()}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen" style={{ background: "var(--paper-deep)" }}>

      <section className="mx-auto max-w-[1600px] px-4 py-6">
        {/* Search bars */}
        <div
          className="mb-4 rounded-md border border-foreground/20 p-4"
          style={{ background: "var(--paper)" }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            {(["start", "end"] as const).map((which) => {
              const value = which === "start" ? startQuery : endQuery;
              const set = which === "start" ? setStartQuery : setEndQuery;
              const dotColor = which === "start" ? "#16a34a" : "#dc2626";
              return (
                <div key={which} className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-foreground/60">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: dotColor }}
                    />
                    {which === "start" ? "Start" : "End"} — address or lat,lng
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={value}
                      maxLength={200}
                      placeholder={
                        which === "start"
                          ? "e.g. Central Park, NYC  or  40.7829,-73.9654"
                          : "e.g. Brooklyn Bridge  or  40.7061,-73.9969"
                      }
                      onChange={(e) => set(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSearch(which);
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSearch(which)}
                      disabled={searchBusy === which || !value.trim()}
                    >
                      {searchBusy === which ? "…" : "Search"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      title="Use my current location"
                      onClick={() => handleGeolocate(which)}
                      disabled={searchBusy === which}
                    >
                      📍
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-widest text-foreground/60">
                Activity
              </label>
              <Select value={activity} onValueChange={(v) => setActivity(v as ActKey)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTIVITIES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-widest text-foreground/60">
                Map
              </label>
              <Select value={layer} onValueChange={(v) => setLayer(v as LayerKey)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TILE_LAYERS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:ml-auto sm:justify-end">
              <Button size="sm" variant="outline" onClick={swapEnds} disabled={!start && !end}>
                ⇅ Swap
              </Button>
              <Button size="sm" variant="outline" onClick={clearAll}>
                Clear
              </Button>
              <Button size="sm" onClick={exportGPX} disabled={elevation.length < 2}>
                Export .gpx
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={downloadReport}
                disabled={!start || !end}
                title="Download today's full route report (weather, wind, news, wildlife)"
              >
                ⬇ Daily report
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={openSavePlan}
                disabled={elevation.length < 2}
                title="Attach this route to a day in your Race Plan"
              >
                📅 Save to Race Plan
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={shareRoute}
                disabled={elevation.length < 2 || shareBusy}
                title="Get a shareable link others can view and fork"
              >
                {shareBusy ? "Sharing…" : "🔗 Share route"}
              </Button>
              {authReady && (
                user ? (
                  <Button size="sm" variant="ghost" onClick={() => supabase.auth.signOut()}>
                    Sign out ({user.email})
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setAuthOpen(true)}>
                    Sign in
                  </Button>
                )
              )}
            </div>
          </div>
          {routeError && (
            <p className="mt-2 text-xs text-red-600">{routeError}</p>
          )}
          {routing && (
            <p className="mt-2 text-xs italic text-foreground/60">
              Calculating route…
            </p>
          )}
        </div>

        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-foreground/60">View</span>
          <div className="inline-flex overflow-hidden rounded-md border border-foreground/20">
            <button
              type="button"
              onClick={() => setView("globe")}
              className={`px-3 py-1 text-xs uppercase tracking-widest transition ${view === "globe" ? "bg-foreground text-background" : "bg-transparent text-foreground/70 hover:bg-foreground/10"}`}
            >
              🌐 Globe
            </button>
            <button
              type="button"
              onClick={() => setView("map")}
              className={`px-3 py-1 text-xs uppercase tracking-widest transition ${view === "map" ? "bg-foreground text-background" : "bg-transparent text-foreground/70 hover:bg-foreground/10"}`}
            >
              🗺 Map
            </button>
          </div>
        </div>

        <div style={{ display: view === "globe" ? "block" : "none" }}>
          <AtlasGlobe
            start={start}
            end={end}
            routePath={routePath}
            color={ACTIVITIES[activity].color}
            height={560}
          />
        </div>

        <div
          ref={mapRef}
          className="rounded-md border border-foreground/20 shadow-2xl"
          style={{
            height: "min(65vh, 700px)",
            width: "100%",
            zIndex: 0,
            display: view === "map" ? "block" : "none",
          }}
        />

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
          {[
            { label: "Distance", value: formatDistance(stats.dist) },
            { label: "Est. time", value: formatTime(stats.time) },
            { label: "Elev gain", value: `${Math.round(stats.gain)} m` },
            { label: "Elev loss", value: `${Math.round(stats.loss)} m` },
            {
              label: "Min alt",
              value: stats.min === Infinity ? "—" : `${Math.round(stats.min)} m`,
            },
            {
              label: "Max alt",
              value: stats.max === -Infinity ? "—" : `${Math.round(stats.max)} m`,
            },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-md border border-foreground/20 px-3 py-2"
              style={{ background: "var(--paper)" }}
            >
              <p className="text-[10px] uppercase tracking-widest text-foreground/60">
                {s.label}
              </p>
              <p
                className="font-serif text-xl"
                style={{ fontFamily: "'Cormorant Garamond', serif" }}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>

        <div
          className="mt-4 rounded-md border border-foreground/20 p-4"
          style={{ background: "var(--paper)" }}
        >
          <div className="mb-2 flex items-baseline justify-between border-b border-foreground/20 pb-1">
            <h2
              className="font-serif text-lg"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}
            >
              Elevation Profile
            </h2>
            <span className="text-[10px] uppercase tracking-widest text-foreground/50">
              {loadingElev
                ? "Sampling terrain…"
                : chartData.length > 0
                  ? `${chartData.length} samples`
                  : "Enter a start and end to begin"}
            </span>
          </div>
          <div style={{ width: "100%", height: 220 }}>
            {chartData.length > 1 ? (
              <ResponsiveContainer>
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                  onMouseMove={(e: any) => {
                    if (e?.activePayload?.[0]?.payload) {
                      const p = e.activePayload[0].payload;
                      setHoverPoint({ lat: p.lat, lng: p.lng });
                    }
                  }}
                  onMouseLeave={() => setHoverPoint(null)}
                >
                  <defs>
                    <linearGradient id="elev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACTIVITIES[activity].color} stopOpacity={0.6} />
                      <stop offset="100%" stopColor={ACTIVITIES[activity].color} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="km"
                    tick={{ fontSize: 11 }}
                    label={{ value: "km", position: "insideBottomRight", fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    domain={["dataMin - 10", "dataMax + 10"]}
                    label={{ value: "m", angle: -90, position: "insideLeft", fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v: any) => [`${v} m`, "Elevation"]}
                    labelFormatter={(l: any) => `${l} km`}
                  />
                  <Area
                    type="monotone"
                    dataKey="ele"
                    stroke={ACTIVITIES[activity].color}
                    strokeWidth={2}
                    fill="url(#elev)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm italic text-foreground/50">
                Search a Start and End address (or use 📍) to see the path & elevation.
              </div>
            )}
          </div>
        </div>



        {(start && end) && (
          <div
            className="mt-4 rounded-md border border-foreground/20 p-4"
            style={{ background: "var(--paper)" }}
          >
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-foreground/20 pb-2">
              <h2
                className="font-serif text-lg"
                style={{ fontFamily: "'Cormorant Garamond', serif" }}
              >
                🏁 Nearby Races & Events{" "}
                <span className="text-foreground/50">({events.length})</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] uppercase tracking-widest text-foreground/60">
                  Radius
                </label>
                <Select
                  value={String(eventRadius)}
                  onValueChange={(v) => setEventRadius(Number(v))}
                >
                  <SelectTrigger className="h-8 w-[110px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[50, 100, 250, 500, 1000].map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r} km
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowEvents((s) => !s)}
                >
                  {showEvents ? "Hide list" : "Show list"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => downloadEvents("csv")}
                  disabled={!events.length}
                >
                  ⬇ CSV
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => downloadEvents("json")}
                  disabled={!events.length}
                >
                  ⬇ JSON
                </Button>
              </div>
            </div>

            {loadingIntel && !events.length && (
              <p className="text-xs italic text-foreground/60">
                Searching Wikidata for marathons, triathlons, Spartan, Hyrox &
                more within {eventRadius} km…
              </p>
            )}
            {!loadingIntel && events.length === 0 && (
              <p className="text-xs italic text-foreground/60">
                No cataloged athletic events found in this radius. Try widening
                the search.
              </p>
            )}

            {showEvents && events.length > 0 && (
              <div className="max-h-80 overflow-y-auto rounded border border-foreground/10">
                <table className="w-full text-xs">
                  <thead
                    className="sticky top-0 text-[10px] uppercase tracking-widest text-foreground/60"
                    style={{ background: "var(--paper-deep)" }}
                  >
                    <tr>
                      <th className="px-2 py-1 text-left">Event</th>
                      <th className="px-2 py-1 text-left">Type</th>
                      <th className="px-2 py-1 text-right">Distance</th>
                      <th className="px-2 py-1 text-left">Date</th>
                      <th className="px-2 py-1 text-left">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.slice(0, 100).map((e) => (
                      <tr
                        key={e.id}
                        className="border-t border-foreground/10 hover:bg-foreground/5"
                      >
                        <td className="px-2 py-1 font-medium">{e.name}</td>
                        <td className="px-2 py-1 text-foreground/60">
                          {e.kind}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {e.distanceKm.toFixed(0)} km
                        </td>
                        <td className="px-2 py-1 text-foreground/60">
                          {e.date || "—"}
                        </td>
                        <td className="px-2 py-1">
                          <a
                            href={e.url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline text-foreground/70 hover:text-foreground"
                          >
                            open ↗
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[10px] italic text-foreground/50">
              Data: Wikidata SPARQL (marathons, triathlons, ultras, Ironman,
              running & cycling races, obstacle races incl. Spartan/Hyrox).
              Coverage is best for well-known and historic events.
            </p>
          </div>
        )}

        {(start && end) && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {/* Weather + Wind vs Race */}
            <div
              className="rounded-md border border-foreground/20 p-4"
              style={{ background: "var(--paper)" }}
            >
              <div className="mb-2 flex items-baseline justify-between border-b border-foreground/20 pb-1">
                <h2 className="font-serif text-lg" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                  Weather & Wind
                </h2>
                <span className="text-[10px] uppercase tracking-widest text-foreground/50">
                  {loadingIntel ? "Refreshing…" : weather ? "Updated today" : "—"}
                </span>
              </div>
              {weather ? (
                <>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-foreground/60">Temp</p>
                      <p className="font-serif text-xl" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                        {Math.round(weather.current.temp)}°C
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-foreground/60">Humidity</p>
                      <p className="font-serif text-xl" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                        {Math.round(weather.current.humidity)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-foreground/60">Wind</p>
                      <p className="font-serif text-xl" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                        {Math.round(weather.current.windSpeed)} km/h
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-foreground/60">From</p>
                      <p className="font-serif text-xl" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                        {compass(weather.current.windDir)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs italic text-foreground/60">
                    {WEATHER_CODES[weather.current.code] || "—"}
                  </p>
                  {raceBearing != null && windVsRace && (
                    <div
                      className="mt-3 flex items-center gap-3 rounded border p-3"
                      style={{
                        borderColor:
                          windVsRace.type === "Headwind"
                            ? "#dc2626"
                            : windVsRace.type === "Tailwind"
                              ? "#16a34a"
                              : "#a16207",
                        background:
                          windVsRace.type === "Headwind"
                            ? "rgba(220,38,38,0.08)"
                            : windVsRace.type === "Tailwind"
                              ? "rgba(22,163,74,0.08)"
                              : "rgba(161,98,7,0.08)",
                      }}
                    >
                      <svg width="46" height="46" viewBox="0 0 46 46" style={{ overflow: "visible" }}>
                        <circle cx="23" cy="23" r="20" fill="none" stroke="currentColor" strokeOpacity="0.2" />
                        {/* Race arrow */}
                        <g transform={`rotate(${raceBearing} 23 23)`}>
                          <line x1="23" y1="35" x2="23" y2="11" stroke="#0ea5e9" strokeWidth="2.5" />
                          <polygon points="23,7 20,13 26,13" fill="#0ea5e9" />
                        </g>
                        {/* Wind arrow (pointing where wind goes TOWARD) */}
                        <g transform={`rotate(${(weather.current.windDir + 180) % 360} 23 23)`}>
                          <line x1="23" y1="35" x2="23" y2="14" stroke="#dc2626" strokeWidth="2" strokeDasharray="3 2" />
                          <polygon points="23,10 21,15 25,15" fill="#dc2626" />
                        </g>
                      </svg>
                      <div className="text-xs">
                        <p className="font-semibold uppercase tracking-widest">{windVsRace.type}</p>
                        <p className="text-foreground/70">
                          Race heading {compass(raceBearing)} ({Math.round(raceBearing)}°) ·
                          wind from {compass(weather.current.windDir)}
                        </p>
                        <p className="text-foreground/50">Offset {Math.round(windVsRace.delta)}° from axis</p>
                      </div>
                    </div>
                  )}
                  <div className="mt-3">
                    <p className="mb-1 text-[10px] uppercase tracking-widest text-foreground/60">7-Day forecast</p>
                    <div className="grid grid-cols-7 gap-1 text-center">
                      {weather.daily.map((d) => (
                        <div key={d.date} className="rounded border border-foreground/15 px-1 py-1">
                          <p className="text-[9px] text-foreground/60">
                            {new Date(d.date).toLocaleDateString(undefined, { weekday: "short" })}
                          </p>
                          <p className="text-[11px] font-semibold">{Math.round(d.tMax)}°</p>
                          <p className="text-[9px] text-foreground/50">{Math.round(d.tMin)}°</p>
                          <p className="text-[9px] text-foreground/60">
                            {Math.round(d.windMax)}k · {compass(d.windDir)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs italic text-foreground/50">No weather yet.</p>
              )}
            </div>

            {/* News & Wildlife */}
            <div
              className="rounded-md border border-foreground/20 p-4"
              style={{ background: "var(--paper)" }}
            >
              <div className="mb-2 flex items-baseline justify-between border-b border-foreground/20 pb-1">
                <h2 className="font-serif text-lg" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
                  Area Intelligence
                </h2>
                <span className="text-[10px] uppercase tracking-widest text-foreground/50">
                  {loadingIntel ? "Refreshing…" : "Daily update"}
                </span>
              </div>

              {/* News dropdown */}
              <button
                type="button"
                onClick={() => setShowNews((s) => !s)}
                className="flex w-full items-center justify-between rounded border border-foreground/20 px-3 py-2 text-sm hover:bg-foreground/5"
              >
                <span className="font-semibold">
                  📰 Recent news <span className="text-foreground/50">({news.length})</span>
                </span>
                <span>{showNews ? "▲" : "▼"}</span>
              </button>
              {showNews && (
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded border border-foreground/10 p-2 text-xs">
                  {news.length === 0 && (
                    <li className="italic text-foreground/50">No recent articles found.</li>
                  )}
                  {news.map((n, i) => (
                    <li key={i} className="border-b border-foreground/10 pb-1 last:border-0">
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground hover:underline"
                      >
                        {n.title}
                      </a>
                      <p className="text-[10px] text-foreground/50">
                        {n.source}
                        {n.date && ` · ${n.date.slice(0, 8)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {/* Wildlife dropdown — fetched lazily on first open */}
              <button
                type="button"
                onClick={() => {
                  setShowWildlife((s) => !s);
                  loadWildlifeIfNeeded();
                }}
                className="mt-2 flex w-full items-center justify-between rounded border border-foreground/20 px-3 py-2 text-sm hover:bg-foreground/5"
              >
                <span className="font-semibold">
                  🐾 Wildlife in area{" "}
                  <span className="text-foreground/50">
                    {wildlifeLoaded ? `(${wildlife.length})` : ""}
                  </span>
                </span>
                <span>{showWildlife ? "▲" : "▼"}</span>
              </button>
              {showWildlife && (
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded border border-foreground/10 p-2 text-xs">
                  {loadingWildlife && (
                    <li className="italic text-foreground/50">Looking up nearby species…</li>
                  )}
                  {!loadingWildlife && wildlifeLoaded && wildlife.length === 0 && (
                    <li className="italic text-foreground/50">No species records found nearby.</li>
                  )}
                  {wildlife.map((w) => (
                    <li key={w.key} className="flex justify-between border-b border-foreground/10 pb-1 last:border-0">
                      <span>
                        {w.common ? <b>{w.common}</b> : <i>{w.name}</i>}
                        {w.common && <span className="text-foreground/50"> — <i>{w.name}</i></span>}
                      </span>
                      <span className="text-foreground/50">{w.count}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Marathons & Events — user-created, distinct from the Wikidata panel above */}
              <button
                type="button"
                onClick={() => {
                  const next = !showUserEvents;
                  setShowUserEvents(next);
                  if (next && userEvents.length === 0) loadUserEvents();
                }}
                className="mt-2 flex w-full items-center justify-between rounded border border-foreground/20 px-3 py-2 text-sm hover:bg-foreground/5"
              >
                <span className="font-semibold">🏁 Marathons &amp; Events</span>
                <span>{showUserEvents ? "▲" : "▼"}</span>
              </button>
              {showUserEvents && (
                <div className="mt-2 space-y-2 rounded border border-foreground/10 p-2 text-xs">
                  <Button
                    size="sm"
                    onClick={() => setCreateEventOpen(true)}
                    disabled={!start}
                    title={!start ? "Set a start point on the map first" : "Create an event at this location"}
                  >
                    + Create event here
                  </Button>
                  {loadingUserEvents && <p className="italic text-foreground/50">Loading events…</p>}
                  {!loadingUserEvents && userEvents.length === 0 && (
                    <p className="italic text-foreground/50">No upcoming events yet — be the first to create one.</p>
                  )}
                  <ul className="max-h-72 space-y-2 overflow-y-auto">
                    {userEvents.map((ev) => {
                      const mine = myRsvps[ev.id];
                      const isPast = new Date(ev.event_date) < new Date();
                      return (
                        <li key={ev.id} className="rounded border border-foreground/10 p-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold">{ev.name}</p>
                              <p className="text-foreground/50">
                                {ev.event_date} · {ev.location_label}
                              </p>
                              {ev.description && <p className="mt-1 text-foreground/70">{ev.description}</p>}
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {!isPast && (
                              <>
                                <Button
                                  size="sm"
                                  variant={mine?.status === "going" ? "default" : "secondary"}
                                  onClick={() => rsvp(ev, "going")}
                                >
                                  {mine?.status === "going" ? "✓ Going" : "Going"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant={mine?.status === "interested" ? "default" : "secondary"}
                                  onClick={() => rsvp(ev, "interested")}
                                >
                                  Interested
                                </Button>
                                {mine?.status === "waitlist" && (
                                  <span className="self-center text-foreground/50">On waitlist</span>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => trainForEvent(ev)}>
                                  🏋️ Train for this
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => openLeaderboard(ev)}>
                              🏆 {isPast ? "Results" : "Leaderboard"}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <p className="mt-3 text-[10px] italic text-foreground/50">
                News via GDELT · wildlife via GBIF · weather via Open-Meteo. Data refreshes daily when you reload.
              </p>
            </div>
          </div>
        )}


        {(start || end) && (
          <div
            className="mt-4 rounded-md border border-foreground/20 p-4 text-sm"
            style={{ background: "var(--paper)" }}
          >
            {start && (
              <p>
                <span className="font-semibold text-green-700">Start:</span>{" "}
                <span className="text-foreground/80">{start.label}</span>
              </p>
            )}
            {end && (
              <p>
                <span className="font-semibold text-red-700">End:</span>{" "}
                <span className="text-foreground/80">{end.label}</span>
              </p>
            )}
          </div>
        )}
      </section>

      <footer
        className="border-t border-foreground/15 px-6 py-6 text-center text-xs text-foreground/50"
        style={{ background: "var(--paper)" }}
      >
        Map © OpenStreetMap · Topo © OpenTopoMap · Imagery © Esri · Routing © OSRM · Elevation via Open-Elevation · Geocoding © Photon/Komoot
      </footer>

      {/* Sign in / sign up — own auth, same Supabase project as Muscle Selector */}
      <Dialog open={authOpen} onOpenChange={setAuthOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{authMode === "signup" ? "Create Account" : "Sign In"}</DialogTitle>
            <DialogDescription>
              Sign in to save routes to your Race Plan and log runs as workouts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Email</label>
              <Input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Password</label>
              <Input type="password" value={authPass} onChange={(e) => setAuthPass(e.target.value)} placeholder="Min 8 characters" />
            </div>
            {authMsg && <p className="text-xs text-red-600">{authMsg}</p>}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button className="w-full" onClick={submitAuth} disabled={authBusy}>
              {authBusy ? "…" : authMode === "signup" ? "Create Account →" : "Sign In →"}
            </Button>
            <button
              type="button"
              className="text-xs text-foreground/60 underline"
              onClick={() => { setAuthMode(authMode === "signup" ? "signin" : "signup"); setAuthMsg(""); }}
            >
              {authMode === "signup" ? "Already have an account? Sign in" : "No account? Create one"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save this route to a day in the user's Race Plan */}
      <Dialog open={savePlanOpen} onOpenChange={setSavePlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>📅 Save to Race Plan</DialogTitle>
            <DialogDescription>
              Attach this route to a day in your Muscle Selector Race Plan.
            </DialogDescription>
          </DialogHeader>
          {planLoading && <p className="text-sm text-foreground/60">Loading your Race Plan…</p>}
          {!planLoading && !planWeeks && (
            <p className="text-sm text-foreground/70">
              You don't have an active Race Plan yet — build one in Muscle Selector first, then come back here to attach routes to it.
            </p>
          )}
          {!planLoading && planWeeks && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Week</label>
                  <Select value={String(saveWeekIdx)} onValueChange={(v) => { setSaveWeekIdx(Number(v)); setSaveDayIdx(0); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {planWeeks.map((w, i) => (
                        <SelectItem key={i} value={String(i)}>Week {w.weekNum}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Day</label>
                  <Select value={String(saveDayIdx)} onValueChange={(v) => setSaveDayIdx(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {planWeeks[saveWeekIdx]?.days.map((_, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i] ?? `Day ${i + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-foreground/60">
                {start?.label} → {end?.label} · {(stats.dist / 1000).toFixed(1)} km
              </p>
              {saveMsg && <p className="text-xs">{saveMsg}</p>}
            </div>
          )}
          {!planLoading && planWeeks && (
            <DialogFooter>
              <Button onClick={saveRouteToPlan} disabled={saveBusy}>
                {saveBusy ? "Saving…" : "Save route to this day"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Share route — public link + fork */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>🔗 Route shared</DialogTitle>
            <DialogDescription>
              Anyone with this link can view the route and fork it into their own planner — no account required to view.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
            <Button onClick={() => navigator.clipboard.writeText(shareUrl)}>Copy</Button>
          </div>
          {shareMsg && <p className="text-xs text-red-600">{shareMsg}</p>}
        </DialogContent>
      </Dialog>

      {/* Create a user event (marathon, group run, etc.) at the current start point */}
      <Dialog open={createEventOpen} onOpenChange={setCreateEventOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>🏁 Create Event</DialogTitle>
            <DialogDescription>
              {start ? `Location: ${start.label}` : "Set a start point on the map first."}
              {sharedRouteId && " · This event will link to your currently shared route as its official course."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Event name</label>
              <Input value={evName} onChange={(e) => setEvName(e.target.value)} placeholder="Saturday Sunrise 10K" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Description (optional)</label>
              <Input value={evDescription} onChange={(e) => setEvDescription(e.target.value)} placeholder="Casual group run, all paces welcome" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Date</label>
                <Input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Capacity (optional)</label>
                <Input type="number" min="1" value={evCapacity} onChange={(e) => setEvCapacity(e.target.value)} placeholder="Unlimited" />
              </div>
            </div>
            {evMsg && <p className="text-xs text-red-600">{evMsg}</p>}
          </div>
          <DialogFooter>
            <Button onClick={createEvent} disabled={evBusy}>
              {evBusy ? "Creating…" : "Create event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leaderboard / results — RSVP list pre-event, finish times post-event */}
      <Dialog open={!!leaderboardEvent} onOpenChange={(o) => !o && setLeaderboardEvent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>🏆 {leaderboardEvent?.name}</DialogTitle>
            <DialogDescription>
              {leaderboardEvent && new Date(leaderboardEvent.event_date) < new Date()
                ? "Finishing times, fastest first."
                : "Log your time once the event's happened to appear on the leaderboard."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {leaderboardRows.length === 0 && (
              <p className="text-sm italic text-foreground/50">No times logged yet.</p>
            )}
            <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
              {leaderboardRows.map((r, i) => (
                <li key={r.user_id} className="flex justify-between border-b border-foreground/10 pb-1 last:border-0">
                  <span>#{i + 1} {r.user_id === user?.id ? "You" : r.user_id.slice(0, 8)}</span>
                  <span className="font-semibold">{r.finish_time_min} min</span>
                </li>
              ))}
            </ul>
            {leaderboardEvent && new Date(leaderboardEvent.event_date) < new Date() && (
              <div className="flex gap-2 pt-2">
                <Input
                  type="number"
                  placeholder="Your finish time (min)"
                  value={finishTimeInput}
                  onChange={(e) => setFinishTimeInput(e.target.value)}
                />
                <Button onClick={submitFinishTime} disabled={!user}>
                  Log time
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
