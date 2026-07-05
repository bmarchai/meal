import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, ContactShadows, useGLTF, Environment, Html } from "@react-three/drei";
import * as THREE from "three";

/**
 * Anatomical 3D figure — body.glb from hpfrei/body-anatomy-3d-viewer
 * (CC BY-SA 4.0). 826 individually-named muscle and bone meshes.
 *
 * Optional organs layer — HuBMAP CCF 3D Reference Object Library
 * (CC BY 4.0), VH_Male v1.2. Eight major organs, individually selectable.
 */

const MODEL_URL =
  "https://raw.githubusercontent.com/hpfrei/body-anatomy-3d-viewer/main/public/body.glb";

const HUBMAP_BASE =
  "https://raw.githubusercontent.com/hubmapconsortium/ccf-3d-reference-object-library/main/VH_Male/v1.2";

type OrganDef = { id: string; label: string; file: string; color: string };

const ORGANS: OrganDef[] = [
  { id: "heart", label: "Heart", file: "VH_M_Heart.glb", color: "#c63b3b" },
  { id: "lungs", label: "Lungs", file: "VH_M_Lung.glb", color: "#e29bb0" },
  { id: "liver", label: "Liver", file: "VH_M_Liver.glb", color: "#7a3b2a" },
  { id: "kidney_l", label: "Left Kidney", file: "VH_M_Kidney_L.glb", color: "#8a4a3a" },
  { id: "kidney_r", label: "Right Kidney", file: "VH_M_Kidney_R.glb", color: "#8a4a3a" },
  { id: "spleen", label: "Spleen", file: "VH_M_Spleen.glb", color: "#6a2a3a" },
  { id: "pancreas", label: "Pancreas", file: "VH_M_Pancreas.glb", color: "#d6a36a" },
  { id: "bladder", label: "Urinary Bladder", file: "VH_M_Urinary_Bladder.glb", color: "#d6c46a" },
  { id: "intestine_small", label: "Small Intestine", file: "VH_M_Small_Intestine.glb", color: "#c98a6a" },
  { id: "intestine_large", label: "Large Intestine", file: "SBU_M_Intestine_Large.glb", color: "#b87050" },
];

function cleanName(raw: string): string {
  return raw.replace(/\.\d{3,}$/, "");
}

function HumanModel({
  autoRotate,
  groupRef,
  selectedUUID,
  setSelectedUUID,
  onSelect,
  muscleOpacity,
}: {
  autoRotate: boolean;
  groupRef: React.RefObject<THREE.Group>;
  selectedUUID: string | null;
  setSelectedUUID: (uuid: string | null) => void;
  onSelect: (name: string | null) => void;
  muscleOpacity: number;
}) {
  const { scene } = useGLTF(MODEL_URL, true);
  const originalMaterials = useRef(new Map<string, THREE.Material | THREE.Material[]>());

  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if ((mesh as any).isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (!originalMaterials.current.has(mesh.uuid)) {
          originalMaterials.current.set(mesh.uuid, mesh.material);
        }
      }
    });
  }, [scene]);

  // Highlight selection + apply muscle opacity
  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as any).isMesh) return;
      const original = originalMaterials.current.get(mesh.uuid);
      if (!original) return;

      const base = Array.isArray(original) ? original[0] : original;
      if (mesh.uuid === selectedUUID) {
        const highlight = (base as THREE.MeshStandardMaterial).clone();
        highlight.emissive = new THREE.Color("#ff3322");
        highlight.emissiveIntensity = 0.6;
        highlight.transparent = muscleOpacity < 1;
        highlight.opacity = muscleOpacity;
        highlight.depthWrite = muscleOpacity >= 1;
        mesh.material = highlight;
      } else if (muscleOpacity < 1) {
        const fade = (base as THREE.MeshStandardMaterial).clone();
        fade.transparent = true;
        fade.opacity = muscleOpacity;
        fade.depthWrite = false;
        mesh.material = fade;
      } else {
        mesh.material = original;
      }
    });
  }, [selectedUUID, scene, muscleOpacity]);

  useFrame((_, dt) => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += dt * 0.25;
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const mesh = e.object as THREE.Mesh;
    if (!(mesh as any).isMesh) return;
    if (mesh.uuid === selectedUUID) {
      setSelectedUUID(null);
      onSelect(null);
    } else {
      setSelectedUUID(mesh.uuid);
      onSelect(cleanName(mesh.name || "Unnamed structure"));
    }
  };

  return (
    <group onClick={handleClick}>
      <primitive object={scene} />
    </group>
  );
}

function Organ({
  def,
  selectedUUID,
  setSelectedUUID,
  onSelect,
  onReady,
}: {
  def: OrganDef;
  selectedUUID: string | null;
  setSelectedUUID: (uuid: string | null) => void;
  onSelect: (name: string | null) => void;
  onReady: (def: OrganDef, root: THREE.Object3D) => void;
}) {
  const { scene } = useGLTF(`${HUBMAP_BASE}/${def.file}`, true);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const originalMats = useRef(new Map<string, THREE.Material | THREE.Material[]>());

  useEffect(() => {
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if ((mesh as any).isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.organId = def.id;
        mesh.userData.organLabel = def.label;
        // Many HuBMAP organs ship with a flat default material — tint it.
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(def.color),
          roughness: 0.55,
          metalness: 0.05,
        });
        mesh.material = mat;
        originalMats.current.set(mesh.uuid, mat);
      }
    });
    onReady(def, cloned);
  }, [cloned, def, onReady]);

  // Selection highlight
  useEffect(() => {
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as any).isMesh) return;
      const base = originalMats.current.get(mesh.uuid);
      if (!base) return;
      if (mesh.userData.organId === selectedUUID) {
        const hl = (base as THREE.MeshStandardMaterial).clone();
        hl.emissive = new THREE.Color("#ffd166");
        hl.emissiveIntensity = 0.7;
        mesh.material = hl;
      } else {
        mesh.material = base;
      }
    });
  }, [selectedUUID, cloned]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const mesh = e.object as THREE.Mesh;
    const id: string | undefined = mesh.userData?.organId;
    const label: string | undefined = mesh.userData?.organLabel;
    if (!id) return;
    if (selectedUUID === id) {
      setSelectedUUID(null);
      onSelect(null);
    } else {
      setSelectedUUID(id);
      onSelect(label ?? id);
    }
  };

  return <primitive object={cloned} onClick={handleClick} />;
}

function OrgansLayer({
  selectedUUID,
  setSelectedUUID,
  onSelect,
}: {
  selectedUUID: string | null;
  setSelectedUUID: (uuid: string | null) => void;
  onSelect: (name: string | null) => void;
}) {
  const fitGroup = useRef<THREE.Group>(null);
  const [transform, setTransform] = useState<{ scale: number; pos: [number, number, number] }>({
    scale: 0.001,
    pos: [0, 0.15, 0],
  });
  const fittedRef = useRef(false);

  // Fit once after children mount — poll on frame in case meshes arrive
  // across separate suspense resolves.
  useFrame(() => {
    if (fittedRef.current || !fitGroup.current) return;
    const box = new THREE.Box3().setFromObject(fitGroup.current);
    if (box.isEmpty() || !isFinite(box.min.x)) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    if (size.y < 1e-4) return;
    const targetTorsoHeight = 0.55;
    const scale = targetTorsoHeight / size.y;
    const pos: [number, number, number] = [
      -center.x * scale,
      0.15 - center.y * scale,
      -center.z * scale,
    ];
    setTransform({ scale, pos });
    fittedRef.current = true;
  });

  const handleReady = () => {};

  return (
    <group position={transform.pos} scale={transform.scale}>
      <group ref={fitGroup}>
        {ORGANS.map((o) => (
          <Organ
            key={o.id}
            def={o}
            selectedUUID={selectedUUID}
            setSelectedUUID={setSelectedUUID}
            onSelect={onSelect}
            onReady={handleReady}
          />
        ))}
      </group>
    </group>
  );
}

useGLTF.preload(MODEL_URL, true);

function LoadingFallback() {
  return (
    <Html center>
      <div
        style={{
          color: "#f5e9d4",
          fontFamily: "'Cormorant Garamond', serif",
          fontStyle: "italic",
          fontSize: 14,
          padding: "8px 14px",
          background: "rgba(20,15,10,0.7)",
          border: "1px solid rgba(200,160,80,0.3)",
          borderRadius: 4,
        }}
      >
        Loading anatomical atlas…
      </div>
    </Html>
  );
}

export function AnatomyFigure3D({
  autoRotate = true,
  onSelect,
  showOrgans = false,
  muscleOpacity = 1,
}: {
  selectedId?: string | null;
  onSelect?: (name: string | null) => void;
  autoRotate?: boolean;
  showOrgans?: boolean;
  muscleOpacity?: number;
}) {
  const [selectedMuscleUUID, setSelectedMuscleUUID] = useState<string | null>(null);
  const [selectedOrganId, setSelectedOrganId] = useState<string | null>(null);
  const figureRef = useRef<THREE.Group>(null!);

  const selectMuscle = (uuid: string | null) => {
    setSelectedMuscleUUID(uuid);
    if (uuid) setSelectedOrganId(null);
  };
  const selectOrgan = (id: string | null) => {
    setSelectedOrganId(id);
    if (id) setSelectedMuscleUUID(null);
  };

  return (
    <Canvas
      shadows
      camera={{ position: [0, 0, 4], fov: 35 }}
      style={{ width: "100%", height: "100%" }}
      gl={{ antialias: true, toneMappingExposure: 1.05 }}
    >
      <color attach="background" args={["#1a1410"]} />
      <fog attach="fog" args={["#1a1410", 12, 28]} />

      <ambientLight intensity={0.55} />
      <directionalLight
        position={[4, 6, 5]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-4, 3, -3]} intensity={0.5} color="#a89070" />
      <pointLight position={[0, 2, 5]} intensity={0.4} color="#f5c14e" />

      <Suspense fallback={<LoadingFallback />}>
        <Environment preset="studio" />
        <group ref={figureRef} position={[0, -0.7, 0]} onPointerMissed={() => {
          setSelectedMuscleUUID(null);
          setSelectedOrganId(null);
          onSelect?.(null);
        }}>
          <HumanModel
            autoRotate={autoRotate}
            groupRef={figureRef}
            selectedUUID={selectedMuscleUUID}
            setSelectedUUID={selectMuscle}
            onSelect={onSelect ?? (() => {})}
            muscleOpacity={muscleOpacity}
          />
          {showOrgans && (
            <Suspense fallback={null}>
              <OrgansLayer
                selectedUUID={selectedOrganId}
                setSelectedUUID={selectOrgan}
                onSelect={onSelect ?? (() => {})}
              />
            </Suspense>
          )}
        </group>
        <ContactShadows
          position={[0, -1.7, 0]}
          opacity={0.5}
          scale={6}
          blur={2.5}
          far={3}
        />
      </Suspense>

      <OrbitControls
        enablePan={false}
        minDistance={1.2}
        maxDistance={8}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI - Math.PI / 6}
      />
    </Canvas>
  );
}

export const MUSCLE_LIST: { id: string; name: string }[] = [];
