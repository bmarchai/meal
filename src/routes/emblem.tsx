import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Text3D, Center } from "@react-three/drei";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/emblem")({
  head: () => ({
    meta: [
      { title: "BMARCHAI Emblem — 3D Metal Crest" },
      { name: "description", content: "An interactive 3D metal emblem you can rotate, inspect, and export as GLB." },
    ],
  }),
  component: EmblemPage,
});

const FONT_URL = "https://threejs.org/examples/fonts/helvetiker_bold.typeface.json";

// Polished antique-gold PBR material — applied to every metal part.
const GOLD = {
  color: "#c9a04a",
  metalness: 1,
  roughness: 0.28,
  envMapIntensity: 1.4,
} as const;

const DARK_GOLD = {
  color: "#5a4319",
  metalness: 1,
  roughness: 0.55,
  envMapIntensity: 0.8,
} as const;

// Place characters of `text` evenly around an arc of `radius` at `yCenter` angle (radians).
// `arc` is the total angular span (radians). `flip` rotates each char to face outward.
function CurvedText({
  text,
  radius,
  arcDeg,
  centerDeg,
  size,
  depth,
  flip = false,
}: {
  text: string;
  radius: number;
  arcDeg: number;
  centerDeg: number;
  size: number;
  depth: number;
  flip?: boolean;
}) {
  const arc = (arcDeg * Math.PI) / 180;
  const center = (centerDeg * Math.PI) / 180;
  const n = text.length;
  const step = arc / Math.max(n - 1, 1);
  const start = center - arc / 2;
  return (
    <group>
      {Array.from(text).map((ch, i) => {
        const a = start + step * i;
        const x = Math.cos(a) * radius;
        const y = Math.sin(a) * radius;
        // Make characters tangent to the ring: text local +X points along the tangent.
        // Tangent angle = a + π/2.  For the bottom arc we flip so letters aren't upside down.
        const rot = a + Math.PI / 2 + (flip ? Math.PI : 0);
        return (
          <group key={i} position={[x, y, 0]} rotation={[0, 0, rot]}>
            <Center>
              <Text3D font={FONT_URL} size={size} height={depth} bevelEnabled bevelSize={0.005} bevelThickness={0.008} bevelSegments={2}>
                {ch}
                <meshStandardMaterial {...GOLD} />
              </Text3D>
            </Center>
          </group>
        );
      })}
    </group>
  );
}

function Rivets({ count, radius, size = 0.04 }: { count: number; radius: number; size?: number }) {
  return (
    <group>
      {Array.from({ length: count }).map((_, i) => {
        const a = (i / count) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius, Math.sin(a) * radius, 0.18]}>
            <sphereGeometry args={[size, 24, 24]} />
            <meshStandardMaterial {...GOLD} />
          </mesh>
        );
      })}
    </group>
  );
}

function Emblem({ groupRef }: { groupRef: React.RefObject<THREE.Group> }) {
  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += dt * 0.15;
  });

  // Inner "BMARCH⊕" cross/spoke pattern — four bars in a wheel.
  const spokes = useMemo(() => [0, 45, 90, 135].map((d) => (d * Math.PI) / 180), []);

  return (
    <group ref={groupRef}>
      {/* Outer torus ring */}
      <mesh castShadow receiveShadow>
        <torusGeometry args={[2.0, 0.12, 32, 200]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      {/* Inner torus (secondary frame) */}
      <mesh castShadow receiveShadow>
        <torusGeometry args={[1.55, 0.05, 24, 160]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>

      {/* Dark recessed back disc — gives the engraved feel */}
      <mesh position={[0, 0, -0.05]} receiveShadow>
        <cylinderGeometry args={[1.95, 1.95, 0.08, 96]} />
        <meshStandardMaterial {...DARK_GOLD} />
      </mesh>

      {/* Central banner bar */}
      <mesh position={[0, 0, 0.05]} castShadow>
        <boxGeometry args={[3.6, 0.55, 0.18]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      {/* Banner inset (darker) */}
      <mesh position={[0, 0, 0.14]} castShadow>
        <boxGeometry args={[3.45, 0.42, 0.04]} />
        <meshStandardMaterial {...DARK_GOLD} />
      </mesh>

      {/* BMARCHAI raised text on the banner */}
      <group position={[0, -0.13, 0.18]}>
        <Center>
          <Text3D font={FONT_URL} size={0.32} height={0.09} bevelEnabled bevelSize={0.012} bevelThickness={0.02} bevelSegments={3}>
            BMARCHAI
            <meshStandardMaterial {...GOLD} />
          </Text3D>
        </Center>
      </group>

      {/* Four diagonal spokes behind the banner — the "X" wheel motif */}
      {spokes.map((a, i) => (
        <mesh key={i} rotation={[0, 0, a]} position={[0, 0, -0.02]}>
          <boxGeometry args={[3.4, 0.06, 0.1]} />
          <meshStandardMaterial {...GOLD} />
        </mesh>
      ))}

      {/* Center hub */}
      <mesh position={[0, 0, 0.22]} castShadow>
        <cylinderGeometry args={[0.18, 0.18, 0.12, 48]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>

      {/* Curved top text */}
      <CurvedText
        text="STRENGTH STARTS"
        radius={1.78}
        arcDeg={120}
        centerDeg={90}
        size={0.18}
        depth={0.05}
      />
      {/* Curved bottom text (flipped so it reads left→right along the bottom) */}
      <CurvedText
        text="AT THE CORE"
        radius={1.78}
        arcDeg={90}
        centerDeg={270}
        size={0.18}
        depth={0.05}
        flip
      />

      {/* Decorative rivets around the ring */}
      <Rivets count={24} radius={2.0} size={0.035} />

      {/* Top mounting loop */}
      <mesh position={[0, 2.18, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.12, 0.03, 16, 48]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
    </group>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EmblemPage() {
  const groupRef = useRef<THREE.Group>(null!);

  const exportGLB = () => {
    if (!groupRef.current) return;
    const exporter = new GLTFExporter();
    exporter.parse(
      groupRef.current,
      (result) => {
        const blob = new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
        downloadBlob(blob, "bmarchai-emblem.glb");
      },
      (err) => console.error(err),
      { binary: true },
    );
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm text-neutral-400 hover:text-neutral-100">← Home</Link>
          <h1 className="text-base font-semibold tracking-wide">BMARCHAI · 3D Metal Emblem</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportGLB}>Download .glb</Button>
        </div>
      </header>

      <div className="flex-1 relative">
        <Canvas shadows camera={{ position: [0, 0.4, 6], fov: 38 }} dpr={[1, 2]}>
          <color attach="background" args={["#0a0a0c"]} />
          <fog attach="fog" args={["#0a0a0c", 8, 18]} />

          <ambientLight intensity={0.25} />
          <directionalLight position={[4, 5, 4]} intensity={1.3} castShadow shadow-mapSize={[2048, 2048]} />
          <directionalLight position={[-5, -2, -3]} intensity={0.4} color="#ffb066" />
          <pointLight position={[0, 0, 4]} intensity={0.6} color="#ffd58a" />

          <Suspense fallback={null}>
            <Emblem groupRef={groupRef} />
            <Environment preset="warehouse" />
          </Suspense>

          <ContactShadows position={[0, -2.4, 0]} opacity={0.5} blur={2.5} far={4} />
          <OrbitControls enablePan={false} minDistance={3.5} maxDistance={12} />
        </Canvas>

        <div className="absolute bottom-3 left-3 text-xs text-neutral-500">
          Drag to rotate · scroll to zoom
        </div>
      </div>
    </div>
  );
}
