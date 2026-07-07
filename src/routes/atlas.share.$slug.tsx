import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import AtlasGlobe from "@/components/AtlasGlobe";
import { Button } from "@/components/ui/button";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/atlas/share/$slug")({
  head: () => ({
    meta: [{ title: "Shared Route — Atlas" }],
    links: [
      {
        rel: "stylesheet",
        href: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
      },
    ],
  }),
  component: SharedRoutePage,
});

type LatLng = { lat: number; lng: number };
type ElevPoint = { d: number; ele: number; lat: number; lng: number };

type SharedRoute = {
  id: string;
  slug: string;
  title: string;
  activity: string;
  start_label: string;
  start_lat: number;
  start_lng: number;
  end_label: string;
  end_lat: number;
  end_lng: number;
  route_path: LatLng[];
  elevation: ElevPoint[];
  distance_km: number;
  elev_gain_m: number;
  elev_loss_m: number;
  est_time_min: number;
  fork_count: number;
};

function SharedRoutePage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [route, setRoute] = useState<SharedRoute | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("shared_routes")
      .select("*")
      .eq("slug", slug)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setNotFound(true);
          return;
        }
        setRoute(data as SharedRoute);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Hands the route data to the main planner via sessionStorage, then
  // navigates there — the planner picks it up on mount and loads it as a
  // fresh, editable route (see the "atlas:fork" effect in atlas.tsx).
  const useRoute = () => {
    if (!route) return;
    sessionStorage.setItem("atlas:fork", JSON.stringify(route));
    navigate({ to: "/atlas" });
  };

  if (notFound) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-lg font-semibold">Route not found</p>
        <p className="mt-1 text-sm text-foreground/60">
          This link may be private, mistyped, or no longer exists.
        </p>
      </main>
    );
  }

  if (!route) {
    return (
      <main className="px-4 py-16 text-center text-sm text-foreground/60">
        Loading route…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold">{route.title}</h1>
        <p className="text-sm text-foreground/60">
          {route.activity} · {route.distance_km} km · +{route.elev_gain_m}m / −
          {route.elev_loss_m}m · ~{route.est_time_min} min
          {route.fork_count > 0 && <> · forked {route.fork_count}×</>}
        </p>
      </div>

      <AtlasGlobe
        start={{ label: route.start_label, lat: route.start_lat, lng: route.start_lng }}
        end={{ label: route.end_label, lat: route.end_lat, lng: route.end_lng }}
        routePath={route.route_path}
        color="#7dd3fc"
        height={420}
      />

      <div style={{ width: "100%", height: 160 }}>
        <ResponsiveContainer>
          <AreaChart data={route.elevation}>
            <XAxis dataKey="d" hide />
            <YAxis hide domain={["dataMin - 20", "dataMax + 20"]} />
            <Tooltip formatter={(v: number) => `${Math.round(v)} m`} labelFormatter={() => ""} />
            <Area type="monotone" dataKey="ele" stroke="#7dd3fc" fill="#7dd3fc33" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <Button onClick={useRoute}>Use this route →</Button>
    </main>
  );
}
