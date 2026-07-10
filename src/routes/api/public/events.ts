
import { createFileRoute } from "@tanstack/react-router";

type OutEvent = {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  date: string | null;
  url: string;
  source: string;
};

async function runsignup(lat: number, lng: number, radiusMi: number): Promise<OutEvent[]> {
  const out: OutEvent[] = [];
  try {
    const key = process.env.RUNSIGNUP_CONSUMER_KEY;
    const secret = process.env.RUNSIGNUP_CONSUMER_SECRET;
    const auth = key && secret ? `&api_key=${encodeURIComponent(key)}&api_secret=${encodeURIComponent(secret)}` : "";
    const url = `https://runsignup.com/rest/races?format=json&results_per_page=250&near_geo=${lat},${lng}&near_geo_radius=${radiusMi}mi&start_date=today${auth}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return out;
    const j: any = await r.json();
    for (const row of j.races || []) {
      const race = row.race || {};
      const addr = race.address || {};
      const rlat = parseFloat(addr.latitude);
      const rlng = parseFloat(addr.longitude);
      if (!isFinite(rlat) || !isFinite(rlng)) continue;
      out.push({
        id: `rsu:${race.race_id}`,
        name: race.name || "(unnamed race)",
        kind: "running race",
        lat: rlat,
        lng: rlng,
        date: race.next_date || race.last_date || null,
        url: race.url || `https://runsignup.com/Race/${race.race_id}`,
        source: "RunSignup",
      });
    }
  } catch {}
  return out;
}

async function ticketmaster(lat: number, lng: number, radiusMi: number): Promise<OutEvent[]> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return [];
  const out: OutEvent[] = [];
  try {
    // classification "Sports", segmentId for Sports is KZFzniwnSyZfZ7v7nE
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${key}&latlong=${lat},${lng}&radius=${radiusMi}&unit=miles&segmentId=KZFzniwnSyZfZ7v7nE&size=100&sort=date,asc`;
    const r = await fetch(url);
    if (!r.ok) return out;
    const j: any = await r.json();
    for (const ev of j._embedded?.events || []) {
      const v = ev._embedded?.venues?.[0];
      const vlat = parseFloat(v?.location?.latitude);
      const vlng = parseFloat(v?.location?.longitude);
      if (!isFinite(vlat) || !isFinite(vlng)) continue;
      out.push({
        id: `tm:${ev.id}`,
        name: ev.name,
        kind: ev.classifications?.[0]?.genre?.name || "sports event",
        lat: vlat,
        lng: vlng,
        date: ev.dates?.start?.localDate || null,
        url: ev.url,
        source: "Ticketmaster",
      });
    }
  } catch {}
  return out;
}

export const Route = createFileRoute("/api/public/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const lat = parseFloat(url.searchParams.get("lat") || "");
        const lng = parseFloat(url.searchParams.get("lng") || "");
        const radiusMi = Math.min(300, Math.max(5, parseFloat(url.searchParams.get("radiusMi") || "150")));
        if (!isFinite(lat) || !isFinite(lng)) {
          return new Response(JSON.stringify({ error: "lat/lng required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const [a, b] = await Promise.all([
          runsignup(lat, lng, radiusMi),
          ticketmaster(lat, lng, radiusMi),
        ]);
        const events = [...a, ...b];
        return new Response(JSON.stringify({ events }), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=600",
          },
        });
      },
    },
  },
});
