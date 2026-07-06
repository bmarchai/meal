import { useEffect, useRef, useState } from "react";

type LatLng = { lat: number; lng: number };
type Endpoint = { label: string; lat: number; lng: number };

type Props = {
  start: Endpoint | null;
  end: Endpoint | null;
  routePath: LatLng[];
  color: string;
  height?: number;
};

/**
 * 3D spinning globe view. Uses react-globe.gl (three.js).
 * Auto-rotates until user drags; drag to spin, scroll to zoom.
 */
export default function AtlasGlobe({ start, end, routePath, color, height = 560 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 800, h: height });

  // Load lib + init globe
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const mod: any = await import("globe.gl");
      const Globe = mod.default;
      if (cancelled || !containerRef.current) return;

      const el = containerRef.current;
      const rect = el.getBoundingClientRect();
      const w = Math.max(320, rect.width);
      setSize({ w, h: height });

      const g: any = Globe()(el)
        .width(w)
        .height(height)
        .backgroundColor("rgba(0,0,0,0)")
        .globeImageUrl(
          "https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg"
        )
        .bumpImageUrl(
          "https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png"
        )
        .showAtmosphere(true)
        .atmosphereColor("#7dd3fc")
        .atmosphereAltitude(0.18);

      // Auto-rotate
      const controls = g.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.6;
      controls.enableZoom = true;
      controls.enablePan = false;

      // Stop rotation on user interaction, resume after idle
      let idleTimer: any;
      const stopSpin = () => {
        controls.autoRotate = false;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          controls.autoRotate = true;
        }, 4000);
      };
      el.addEventListener("pointerdown", stopSpin);
      el.addEventListener("wheel", stopSpin);

      globeRef.current = g;
      setReady(true);

      // Resize handler
      const ro = new ResizeObserver(() => {
        const r = el.getBoundingClientRect();
        const nw = Math.max(320, r.width);
        g.width(nw).height(height);
        setSize({ w: nw, h: height });
      });
      ro.observe(el);

      cleanup = () => {
        ro.disconnect();
        el.removeEventListener("pointerdown", stopSpin);
        el.removeEventListener("wheel", stopSpin);
        clearTimeout(idleTimer);
        try {
          g._destructor?.();
        } catch {}
        el.innerHTML = "";
      };
    })();
    return () => {
      cancelled = true;
      if (cleanup) cleanup();
      globeRef.current = null;
    };
  }, [height]);

  // Update points/arcs/path when data changes
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !ready) return;

    const points = [
      start && { ...start, kind: "start", color: "#22c55e", label: `Start: ${start.label}` },
      end && { ...end, kind: "end", color: "#ef4444", label: `End: ${end.label}` },
    ].filter(Boolean) as any[];

    g.pointsData(points)
      .pointLat("lat")
      .pointLng("lng")
      .pointColor("color")
      .pointAltitude(0.02)
      .pointRadius(0.6)
      .pointLabel("label");

    // Route as path along ground
    if (routePath && routePath.length > 1) {
      g.pathsData([routePath.map((p) => [p.lat, p.lng])])
        .pathPoints((d: any) => d)
        .pathPointLat((p: any) => p[0])
        .pathPointLng((p: any) => p[1])
        .pathColor(() => [color, color])
        .pathStroke(1.5)
        .pathPointAlt(0.005)
        .pathTransitionDuration(800);
      // Also draw an arc between endpoints for that "globe" feel
      if (start && end) {
        g.arcsData([
          {
            startLat: start.lat,
            startLng: start.lng,
            endLat: end.lat,
            endLng: end.lng,
          },
        ])
          .arcColor(() => [color, color])
          .arcAltitudeAutoScale(0.4)
          .arcStroke(0.4)
          .arcDashLength(0.5)
          .arcDashGap(0.2)
          .arcDashAnimateTime(3000);
      } else {
        g.arcsData([]);
      }

      // Fly camera to the route midpoint
      const mid = routePath[Math.floor(routePath.length / 2)];
      g.pointOfView({ lat: mid.lat, lng: mid.lng, altitude: 1.6 }, 1200);
    } else {
      g.pathsData([]);
      g.arcsData([]);
      if (start) g.pointOfView({ lat: start.lat, lng: start.lng, altitude: 2.2 }, 1000);
    }
  }, [start, end, routePath, color, ready]);

  return (
    <div
      className="relative overflow-hidden rounded-md border border-foreground/20 shadow-2xl"
      style={{
        height,
        width: "100%",
        background:
          "radial-gradient(ellipse at center, #0b1e3a 0%, #050a18 60%, #000 100%)",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height }} />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-xs uppercase tracking-widest text-white/60">
          Spinning up the globe…
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] uppercase tracking-widest text-white/50">
        Drag to spin · Scroll to zoom · Auto-rotates when idle
      </div>
      <div className="pointer-events-none absolute bottom-2 right-3 text-[10px] uppercase tracking-widest text-white/40">
        {size.w}×{size.h}
      </div>
    </div>
  );
}
