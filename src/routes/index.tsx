import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AnatomyFigure3D } from "@/components/AnatomyFigure3D";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Human Musculoskeletal System — 3D Interactive Atlas" },
      {
        name: "description",
        content:
          "A 3D rotating model of the human musculoskeletal system. Drag to orbit like a globe, click any muscle to identify it.",
      },
    ],
  }),
  component: Index,
});

// Anatomical reference groupings (full Latin nomenclature)
const groups: { title: string; muscles: string[] }[] = [
  {
    title: "Head & Neck",
    muscles: [
      "Frontalis", "Occipitalis", "Temporalis", "Orbicularis oculi",
      "Orbicularis oris", "Zygomaticus major", "Masseter", "Buccinator",
      "Platysma", "Sternocleidomastoid", "Splenius capitis", "Scalenes",
      "Digastric", "Mylohyoid", "Sternohyoid", "Omohyoid",
    ],
  },
  {
    title: "Shoulder & Upper Back",
    muscles: [
      "Trapezius", "Levator scapulae", "Rhomboid major", "Rhomboid minor",
      "Deltoid (anterior / lateral / posterior)", "Supraspinatus",
      "Infraspinatus", "Teres minor", "Teres major", "Subscapularis",
      "Latissimus dorsi", "Serratus anterior",
    ],
  },
  {
    title: "Chest & Abdomen",
    muscles: [
      "Pectoralis major", "Pectoralis minor", "Subclavius",
      "External intercostals", "Internal intercostals", "Diaphragm",
      "Rectus abdominis", "External oblique", "Internal oblique",
      "Transversus abdominis", "Quadratus lumborum",
    ],
  },
  {
    title: "Arm & Forearm",
    muscles: [
      "Biceps brachii", "Brachialis", "Coracobrachialis",
      "Triceps brachii (long / lateral / medial head)", "Anconeus",
      "Brachioradialis", "Pronator teres", "Supinator",
      "Flexor carpi radialis", "Flexor carpi ulnaris", "Palmaris longus",
      "Flexor digitorum superficialis", "Flexor digitorum profundus",
      "Extensor carpi radialis longus", "Extensor carpi radialis brevis",
      "Extensor carpi ulnaris", "Extensor digitorum",
    ],
  },
  {
    title: "Spine & Deep Back",
    muscles: [
      "Erector spinae — Iliocostalis", "Erector spinae — Longissimus",
      "Erector spinae — Spinalis", "Semispinalis capitis", "Multifidus",
      "Rotatores", "Thoracolumbar fascia",
    ],
  },
  {
    title: "Hip & Gluteal",
    muscles: [
      "Gluteus maximus", "Gluteus medius", "Gluteus minimus",
      "Tensor fasciae latae", "Iliotibial tract", "Iliopsoas",
      "Piriformis", "Obturator internus", "Obturator externus",
      "Quadratus femoris",
    ],
  },
  {
    title: "Thigh",
    muscles: [
      "Sartorius", "Rectus femoris", "Vastus lateralis", "Vastus medialis",
      "Vastus intermedius", "Adductor longus", "Adductor brevis",
      "Adductor magnus", "Pectineus", "Gracilis",
      "Biceps femoris (long / short head)", "Semitendinosus",
      "Semimembranosus", "Popliteus",
    ],
  },
  {
    title: "Leg & Foot",
    muscles: [
      "Tibialis anterior", "Tibialis posterior", "Extensor digitorum longus",
      "Extensor hallucis longus", "Peroneus longus", "Peroneus brevis",
      "Gastrocnemius (medial / lateral head)", "Soleus", "Plantaris",
      "Flexor digitorum longus", "Flexor hallucis longus",
      "Calcaneal (Achilles) tendon", "Abductor hallucis",
    ],
  },
];

function Index() {
  const [autoRotate, setAutoRotate] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [showOrgans, setShowOrgans] = useState(false);
  const [muscleOpacity, setMuscleOpacity] = useState(1);

  let counter = 0;
  return (
    <main className="min-h-screen" style={{ background: "var(--paper-deep)" }}>
      <header
        className="border-b border-foreground/15 px-6 py-6 text-center"
        style={{ background: "var(--paper)" }}
      >
        <p className="text-xs uppercase tracking-[0.4em] text-foreground/60">
          Anatomical Atlas — Plate I
        </p>
        <h1
          className="mt-2 font-serif text-3xl md:text-5xl font-bold tracking-tight"
          style={{ fontFamily: "'Cormorant Garamond', 'Times New Roman', serif" }}
        >
          The Human Musculoskeletal System
        </h1>
        <p className="mt-1 text-sm italic text-foreground/70">
          A rotating three-dimensional study · Anterior · Lateral · Posterior
        </p>
        <p className="mt-3 text-xs text-foreground/50">
          Click any muscle or bone to identify it · drag to orbit · scroll to zoom
        </p>
        <p className="mt-3 text-xs">
          <Link to="/mimic" className="underline text-foreground/70 hover:text-foreground">
            Open Motion Mimic → drive a 3D figure from a workout video
          </Link>
          <span className="mx-2 text-foreground/30">·</span>
          <Link to="/atlas" className="underline text-foreground/70 hover:text-foreground">
            Open World Route Atlas → plan runs, marathons & triathlons
          </Link>
        </p>
      </header>

      <section className="mx-auto max-w-[1600px] px-4 py-6">
        <div
          className="relative overflow-hidden rounded-md border border-foreground/20 shadow-2xl"
          style={{ height: "min(85vh, 900px)" }}
        >
          <AnatomyFigure3D
            autoRotate={autoRotate}
            onSelect={setSelected}
            showOrgans={showOrgans}
            muscleOpacity={muscleOpacity}
          />

          {/* Overlay HUD */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
            {selected && (
              <div
                className="pointer-events-auto rounded-md border px-4 py-2 shadow-lg"
                style={{
                  background: "rgba(20,15,10,0.85)",
                  borderColor: "rgba(200,160,80,0.35)",
                  color: "#f5e9d4",
                  fontFamily: "'Cormorant Garamond', serif",
                }}
              >
                <p className="text-[10px] uppercase tracking-[0.3em] opacity-60">
                  Selected
                </p>
                <p className="text-lg italic">{selected}</p>
              </div>
            )}
            <div className="pointer-events-auto ml-auto flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={showOrgans ? "default" : "outline"}
                  onClick={() => setShowOrgans((s) => !s)}
                >
                  {showOrgans ? "Hide organs" : "Show organs"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAutoRotate((s) => !s)}
                >
                  {autoRotate ? "Pause rotation" : "Auto-rotate"}
                </Button>
              </div>
              {showOrgans && (
                <div
                  className="rounded-md border px-3 py-2 shadow-lg"
                  style={{
                    background: "rgba(20,15,10,0.85)",
                    borderColor: "rgba(200,160,80,0.35)",
                    color: "#f5e9d4",
                    fontFamily: "'Cormorant Garamond', serif",
                    minWidth: 200,
                  }}
                >
                  <label className="text-[10px] uppercase tracking-[0.3em] opacity-70">
                    Muscle opacity · {Math.round(muscleOpacity * 100)}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muscleOpacity}
                    onChange={(e) => setMuscleOpacity(parseFloat(e.target.value))}
                    className="mt-1 w-full accent-orange-400"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>



      <section className="mx-auto max-w-[1600px] px-6 pb-16">
        <div className="mb-6 flex items-baseline justify-between border-b border-foreground/30 pb-2">
          <h2
            className="font-serif text-2xl md:text-3xl"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}
          >
            Complete Reference — Muscles of the Human Body
          </h2>
          <span className="text-xs uppercase tracking-widest text-foreground/50">
            Latin nomenclature
          </span>
        </div>

        <div className="columns-1 gap-8 sm:columns-2 xl:columns-3">
          {groups.map((g) => (
            <div key={g.title} className="mb-8 break-inside-avoid">
              <h3
                className="mb-2 border-b border-foreground/20 pb-1 font-serif text-lg font-semibold uppercase tracking-wider"
                style={{ color: "var(--accent-rust)" }}
              >
                {g.title}
              </h3>
              <ol className="space-y-1 text-sm">
                {g.muscles.map((m) => {
                  counter += 1;
                  return (
                    <li key={m} className="flex gap-2">
                      <span className="w-7 shrink-0 text-right font-mono text-foreground/50 tabular-nums">
                        {counter}.
                      </span>
                      <span className="text-foreground/90">{m}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <footer
        className="border-t border-foreground/15 px-6 py-6 text-center text-xs text-foreground/50"
        style={{ background: "var(--paper)" }}
      >
        Muscles work in coordinated groups to produce movement, maintain posture, and support vital functions.
      </footer>
    </main>
  );
}
