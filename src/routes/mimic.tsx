import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/mimic")({
  head: () => ({
    meta: [
      { title: "Motion Mimic — Drive a 3D Figure from a Workout Video" },
      {
        name: "description",
        content:
          "Upload a workout clip. Pose is extracted with MediaPipe and replayed on a rigged 3D humanoid in your browser.",
      },
    ],
  }),
  component: MimicPage,
});

// Three.js example Xbot — fully rigged humanoid (MIT-licensed example asset).
const RIG_URL = "https://threejs.org/examples/models/gltf/Xbot.glb";
useGLTF.preload(RIG_URL, true);

// MediaPipe BlazePose 33-point topology.
const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13,    R_ELBOW: 14,
  L_WRIST: 15,    R_WRIST: 16,
  L_HIP: 23,      R_HIP: 24,
  L_KNEE: 25,     R_KNEE: 26,
  L_ANKLE: 27,    R_ANKLE: 28,
} as const;

type BoneMap = { match: string; parent: number; child: number };
// Ordered parent→child so world quats cascade correctly.
const BONE_MAP: BoneMap[] = [
  { match: "Spine",        parent: -1,            child: -2 }, // synthetic: mid-hip → mid-shoulder
  { match: "LeftArm",      parent: LM.L_SHOULDER, child: LM.L_ELBOW },
  { match: "LeftForeArm",  parent: LM.L_ELBOW,    child: LM.L_WRIST },
  { match: "RightArm",     parent: LM.R_SHOULDER, child: LM.R_ELBOW },
  { match: "RightForeArm", parent: LM.R_ELBOW,    child: LM.R_WRIST },
  { match: "LeftUpLeg",    parent: LM.L_HIP,      child: LM.L_KNEE  },
  { match: "LeftLeg",      parent: LM.L_KNEE,     child: LM.L_ANKLE },
  { match: "RightUpLeg",   parent: LM.R_HIP,      child: LM.R_KNEE  },
  { match: "RightLeg",     parent: LM.R_KNEE,     child: LM.R_ANKLE },
];

type PoseFrame = {
  t: number; // seconds
  pts: Float32Array; // 33 * 3, remapped into model space (+Y up, facing -Z)
};

// MediaPipe world: x = subject-left+, y = down+, z = away+
// Model space:     x = subject-left+, y = up+, z = forward (-Z)
function remap(lm: { x: number; y: number; z: number }, out: Float32Array, i: number) {
  out[i * 3]     =  lm.x;
  out[i * 3 + 1] = -lm.y;
  out[i * 3 + 2] = -lm.z;
}

// ---------- Synthetic exercise demos ----------
// Procedurally builds a 33-point landmark frame in model space from joint angles.
// All angles in radians; subject faces -Z, +Y up, +X is subject-left.
type SkelOpts = {
  torsoLean?: number;        // forward lean of spine (rad)
  hipFlex?: number;          // both legs forward bend at hip
  kneeFlex?: number;         // both knees bend
  lShoulderFlex?: number;    // left arm raise forward (0=down, π/2=horiz, π=overhead)
  rShoulderFlex?: number;
  lShoulderAbduct?: number;  // left arm raise sideways
  rShoulderAbduct?: number;
  lElbowFlex?: number;       // 0=straight, π=fully curled
  rElbowFlex?: number;
  legSpread?: number;        // jumping-jack stance width angle
};
function buildSkeletonFrame(o: SkelOpts): Float32Array {
  const pts = new Float32Array(33 * 3);
  const set = (i: number, x: number, y: number, z: number) => {
    pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z;
  };
  const hipY = 0.95, hipW = 0.11, shW = 0.20, torso = 0.50;
  const upper = 0.28, fore = 0.26, thigh = 0.42, shin = 0.42;

  // Torso
  const tL = o.torsoLean || 0;
  set(LM.L_HIP,  hipW, hipY, 0);
  set(LM.R_HIP, -hipW, hipY, 0);
  const shY = hipY + Math.cos(tL) * torso;
  const shZ = -Math.sin(tL) * torso;
  set(LM.L_SHOULDER,  shW, shY, shZ);
  set(LM.R_SHOULDER, -shW, shY, shZ);
  set(LM.NOSE, 0, shY + 0.18, shZ - 0.04);

  // Legs
  const hf = o.hipFlex || 0, kf = o.kneeFlex || 0;
  const spread = o.legSpread || 0;
  const lThighDx =  Math.sin(spread), rThighDx = -Math.sin(spread);
  const thighDown = Math.cos(spread);
  const thighDy = -thighDown * Math.cos(hf);
  const thighDz = -Math.sin(hf);
  const lKx = hipW + lThighDx * thigh;
  const rKx = -hipW + rThighDx * thigh;
  const kY = hipY + thighDy * thigh;
  const kZ = thighDz * thigh;
  set(LM.L_KNEE, lKx, kY, kZ);
  set(LM.R_KNEE, rKx, kY, kZ);
  const shinW = hf - kf;
  const aY = kY + (-thighDown * Math.cos(shinW)) * shin;
  const aZ = kZ + (-Math.sin(shinW)) * shin;
  set(LM.L_ANKLE, lKx + lThighDx * shin, aY, aZ);
  set(LM.R_ANKLE, rKx + rThighDx * shin, aY, aZ);

  // Arms — combine shoulder flex (forward, rotates in YZ plane) and abduction (sideways, in XY plane).
  // Build direction: start "down" (-Y in torso frame), apply abduction about Z, then flex about X, then add torso lean.
  const buildArm = (sFlex: number, sAbd: number, eFlex: number, side: 1 | -1, origin: [number, number, number]): [THREE.Vector3, THREE.Vector3] => {
    // Down vector in torso-local
    const d = new THREE.Vector3(0, -1, 0);
    // Abduction: rotate about Z so arm goes outward (+X for left side, -X for right)
    const abdAng = sAbd * side;
    d.applyAxisAngle(new THREE.Vector3(0, 0, 1), abdAng);
    // Forward flex: rotate about X so arm comes forward (-Z)
    d.applyAxisAngle(new THREE.Vector3(1, 0, 0), -sFlex);
    // Apply torso lean (rotation about X)
    d.applyAxisAngle(new THREE.Vector3(1, 0, 0), -tL);
    const elbow = new THREE.Vector3(origin[0] + d.x * upper, origin[1] + d.y * upper, origin[2] + d.z * upper);
    // Forearm: bend in the arm's swing plane. Take cross of arm dir and lateral axis to get bend axis.
    const bendAxis = new THREE.Vector3(side, 0, 0); // approx — lateral
    const f = d.clone().applyAxisAngle(bendAxis, -eFlex);
    const wrist = new THREE.Vector3(elbow.x + f.x * fore, elbow.y + f.y * fore, elbow.z + f.z * fore);
    return [elbow, wrist];
  };
  const [lE, lW] = buildArm(o.lShoulderFlex || 0, o.lShoulderAbduct || 0, o.lElbowFlex || 0,  1, [shW, shY, shZ]);
  const [rE, rW] = buildArm(o.rShoulderFlex || 0, o.rShoulderAbduct || 0, o.rElbowFlex || 0, -1, [-shW, shY, shZ]);
  set(LM.L_ELBOW, lE.x, lE.y, lE.z);
  set(LM.L_WRIST, lW.x, lW.y, lW.z);
  set(LM.R_ELBOW, rE.x, rE.y, rE.z);
  set(LM.R_WRIST, rW.x, rW.y, rW.z);

  return pts;
}

// Exercise library — each defines a "down" and "up" pose. The figure animates between them.
const EXERCISES: Record<string, { name: string; emoji: string; period: number; up: SkelOpts; down: SkelOpts }> = {
  squat:        { name: "Squat",          emoji: "🦵", period: 2.4, up: { hipFlex: 0, kneeFlex: 0, torsoLean: 0 },          down: { hipFlex: 1.25, kneeFlex: 1.7, torsoLean: 0.55 } },
  bicep_curl:   { name: "Bicep Curl",     emoji: "🦾", period: 1.8, up: { lElbowFlex: 0.05, rElbowFlex: 0.05 },              down: { lElbowFlex: 2.4,  rElbowFlex: 2.4 } },
  shoulder_press:{ name:"Shoulder Press", emoji: "🏋️", period: 2.0, up: { lShoulderAbduct: 1.4, rShoulderAbduct: 1.4, lElbowFlex: 1.7, rElbowFlex: 1.7 },
                                                                    down:{ lShoulderAbduct: 1.55, rShoulderAbduct: 1.55, lElbowFlex: 0.15, rElbowFlex: 0.15 } },
  jumping_jack: { name: "Jumping Jack",   emoji: "✶",  period: 1.2, up: { legSpread: 0, lShoulderAbduct: 0.05, rShoulderAbduct: 0.05 },
                                                                    down:{ legSpread: 0.45, lShoulderAbduct: 2.9, rShoulderAbduct: 2.9 } },
  pushup:       { name: "Push-Up",        emoji: "💪", period: 1.8, up: { torsoLean: 1.3, hipFlex: 1.3, lShoulderFlex: 1.4, rShoulderFlex: 1.4, lElbowFlex: 0.1, rElbowFlex: 0.1 },
                                                                    down:{ torsoLean: 1.3, hipFlex: 1.3, lShoulderFlex: 1.4, rShoulderFlex: 1.4, lElbowFlex: 1.5, rElbowFlex: 1.5 } },
  lunge:        { name: "Lunge",          emoji: "🚶", period: 2.4, up: { hipFlex: 0, kneeFlex: 0 },                         down: { hipFlex: 0.9, kneeFlex: 1.5, torsoLean: 0.1 } },
};

function generateExerciseFrames(key: string, reps: number = 4, fps: number = 30): { frames: PoseFrame[]; duration: number } {
  const ex = EXERCISES[key];
  const total = ex.period * reps;
  const n = Math.max(2, Math.floor(total * fps));
  const frames: PoseFrame[] = [];
  const lerpOpts = (a: SkelOpts, b: SkelOpts, t: number): SkelOpts => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SkelOpts>;
    const out: SkelOpts = {};
    keys.forEach((k) => {
      const av = (a[k] ?? 0) as number, bv = (b[k] ?? 0) as number;
      (out as any)[k] = av + (bv - av) * t;
    });
    return out;
  };
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    // Smooth oscillation between up (0) and down (1)
    const phase = (t / ex.period) * Math.PI * 2;
    const k = (1 - Math.cos(phase)) * 0.5; // 0..1..0
    frames.push({ t, pts: buildSkeletonFrame(lerpOpts(ex.up, ex.down, k)) });
  }
  return { frames, duration: total };
}

function findBone(root: THREE.Object3D, fragment: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  const lower = fragment.toLowerCase();
  root.traverse((o) => {
    if (found) return;
    if ((o as THREE.Bone).isBone && o.name.toLowerCase().endsWith(lower)) found = o as THREE.Bone;
  });
  if (found) return found;
  root.traverse((o) => {
    if (found) return;
    if ((o as THREE.Bone).isBone && o.name.toLowerCase().includes(lower)) found = o as THREE.Bone;
  });
  return found;
}

// Read a point or a synthetic midpoint into `out`.
function readPoint(pts: Float32Array, idx: number, out: THREE.Vector3) {
  if (idx >= 0) {
    out.set(pts[idx * 3], pts[idx * 3 + 1], pts[idx * 3 + 2]);
  } else if (idx === -1) {
    // mid-hip
    out.set(
      (pts[LM.L_HIP * 3]     + pts[LM.R_HIP * 3])     * 0.5,
      (pts[LM.L_HIP * 3 + 1] + pts[LM.R_HIP * 3 + 1]) * 0.5,
      (pts[LM.L_HIP * 3 + 2] + pts[LM.R_HIP * 3 + 2]) * 0.5,
    );
  } else if (idx === -2) {
    // mid-shoulder
    out.set(
      (pts[LM.L_SHOULDER * 3]     + pts[LM.R_SHOULDER * 3])     * 0.5,
      (pts[LM.L_SHOULDER * 3 + 1] + pts[LM.R_SHOULDER * 3 + 1]) * 0.5,
      (pts[LM.L_SHOULDER * 3 + 2] + pts[LM.R_SHOULDER * 3 + 2]) * 0.5,
    );
  }
}

function RiggedFigure({
  poseRef,
  playingRef,
  startTimeRef,
  durationRef,
  smoothingRef,
}: {
  poseRef: React.MutableRefObject<PoseFrame[] | null>;
  playingRef: React.MutableRefObject<boolean>;
  startTimeRef: React.MutableRefObject<number>;
  durationRef: React.MutableRefObject<number>;
  smoothingRef: React.MutableRefObject<number>;
}) {
  const { scene } = useGLTF(RIG_URL, true);

  type Tracked = {
    bone: THREE.Bone;
    restWorldDir: THREE.Vector3;
    restWorldQuat: THREE.Quaternion;
    parent: number;
    child: number;
    smoothed: THREE.Quaternion; // for slerp smoothing
    initialized: boolean;
  };
  const tracked = useRef<Tracked[]>([]);
  const hipBone = useRef<THREE.Bone | null>(null);
  const hipRestY = useRef<number>(0);
  const hipYaw = useRef<THREE.Quaternion>(new THREE.Quaternion());

  useEffect(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m as any).isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    scene.updateMatrixWorld(true);
    const _wpA = new THREE.Vector3();
    const _wpB = new THREE.Vector3();
    tracked.current = BONE_MAP.flatMap((b) => {
      const bone = findBone(scene, b.match);
      if (!bone) { console.warn("[mimic] bone not found:", b.match); return []; }
      const restWorldQuat = new THREE.Quaternion();
      bone.getWorldQuaternion(restWorldQuat);

      // Derive rest direction from this bone's world position to its first child bone's
      // world position. That is the TRUE direction the bone points in rest pose, regardless
      // of whether the rig's local "down the bone" axis is +Y, +X, or something else.
      const childBone = bone.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
      const restWorldDir = new THREE.Vector3(0, 1, 0);
      if (childBone) {
        bone.getWorldPosition(_wpA);
        childBone.getWorldPosition(_wpB);
        restWorldDir.copy(_wpB).sub(_wpA);
        if (restWorldDir.lengthSq() < 1e-8) restWorldDir.set(0, 1, 0);
        else restWorldDir.normalize();
      } else {
        restWorldDir.applyQuaternion(restWorldQuat).normalize();
      }

      return [{
        bone, restWorldDir, restWorldQuat,
        parent: b.parent, child: b.child,
        smoothed: new THREE.Quaternion(),
        initialized: false,
      }];
    });
    // Find hip / root bone for global yaw
    hipBone.current = findBone(scene, "Hips") || findBone(scene, "Hip") || null;
    if (hipBone.current) hipRestY.current = hipBone.current.quaternion.y;
  }, [scene]);

  const tmp = useMemo(() => ({
    targetDir: new THREE.Vector3(),
    pA: new THREE.Vector3(),
    pB: new THREE.Vector3(),
    deltaQ: new THREE.Quaternion(),
    newWorldQ: new THREE.Quaternion(),
    parentWorldQ: new THREE.Quaternion(),
    parentInv: new THREE.Quaternion(),
    hipL: new THREE.Vector3(),
    hipR: new THREE.Vector3(),
    yawQ: new THREE.Quaternion(),
  }), []);

  useFrame(() => {
    const frames = poseRef.current;
    if (!frames || frames.length === 0 || !playingRef.current) return;
    const elapsed = (performance.now() - startTimeRef.current) / 1000;
    const t = elapsed % Math.max(durationRef.current, 0.01);

    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t < t) lo = mid + 1; else hi = mid;
    }
    const frame = frames[Math.max(0, lo - 1)];
    const pts = frame.pts;
    const smooth = smoothingRef.current; // 0 = no smoothing, 1 = max

    // Root yaw from hip line (subject-left → subject-right vector)
    if (hipBone.current) {
      tmp.hipL.set(pts[LM.L_HIP * 3], pts[LM.L_HIP * 3 + 1], pts[LM.L_HIP * 3 + 2]);
      tmp.hipR.set(pts[LM.R_HIP * 3], pts[LM.R_HIP * 3 + 1], pts[LM.R_HIP * 3 + 2]);
      const hipVec = tmp.hipR.clone().sub(tmp.hipL); // points subject-right (model -X if facing -Z)
      hipVec.y = 0;
      if (hipVec.lengthSq() > 1e-5) {
        hipVec.normalize();
        // Compute yaw so model "right" axis aligns with hipVec on XZ plane.
        // Rest pose hip "right" is +X. We want it to become hipVec direction (negated since model right is -X when facing -Z, but Xbot rest faces +Z).
        const yaw = Math.atan2(hipVec.z, hipVec.x);
        tmp.yawQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
        if (smooth > 0) hipYaw.current.slerp(tmp.yawQ, 1 - smooth);
        else hipYaw.current.copy(tmp.yawQ);
        hipBone.current.quaternion.copy(hipYaw.current);
      }
    }

    for (const tr of tracked.current) {
      readPoint(pts, tr.parent, tmp.pA);
      readPoint(pts, tr.child,  tmp.pB);
      tmp.targetDir.copy(tmp.pB).sub(tmp.pA);
      if (tmp.targetDir.lengthSq() < 1e-6) continue;
      tmp.targetDir.normalize();

      tmp.deltaQ.setFromUnitVectors(tr.restWorldDir, tmp.targetDir);
      tmp.newWorldQ.multiplyQuaternions(tmp.deltaQ, tr.restWorldQuat);

      if (tr.bone.parent) {
        tr.bone.parent.getWorldQuaternion(tmp.parentWorldQ);
        tmp.parentInv.copy(tmp.parentWorldQ).invert();
        tmp.deltaQ.multiplyQuaternions(tmp.parentInv, tmp.newWorldQ); // reuse as local target
      } else {
        tmp.deltaQ.copy(tmp.newWorldQ);
      }

      if (!tr.initialized || smooth <= 0) {
        tr.smoothed.copy(tmp.deltaQ);
        tr.initialized = true;
      } else {
        tr.smoothed.slerp(tmp.deltaQ, 1 - smooth);
      }
      tr.bone.quaternion.copy(tr.smoothed);
    }
  });

  return <primitive object={scene} />;
}

function MimicPage() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Upload a workout clip — or load a saved pose JSON.");
  const [progress, setProgress] = useState(0);
  const [processed, setProcessed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sampleFps, setSampleFps] = useState(20);
  const [smoothing, setSmoothing] = useState(0.6); // 0..0.95
  const [frameCount, setFrameCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const poseRef = useRef<PoseFrame[] | null>(null);
  const playingRef = useRef(false);
  const startTimeRef = useRef(0);
  const durationRef = useRef(1);
  const smoothingRef = useRef(smoothing);
  useEffect(() => { smoothingRef.current = smoothing; }, [smoothing]);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  const handleVideoFile = (file: File) => {
    poseRef.current = null;
    setProcessed(false); setIsPlaying(false); playingRef.current = false;
    setProgress(0); setFrameCount(0);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setStatus("Video loaded. Click \u201CExtract pose\u201D to analyze.");
  };

  const extractPose = async () => {
    const video = videoRef.current;
    if (!video) return;
    setStatus("Loading pose model\u2026");
    setProgress(0);

    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
    );
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO", numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    setStatus(`Extracting pose at ${sampleFps} fps\u2026`);
    if (!isFinite(video.duration) || video.duration === 0) {
      await new Promise<void>((res) => {
        const on = () => { video.removeEventListener("loadedmetadata", on); res(); };
        video.addEventListener("loadedmetadata", on);
      });
    }

    const duration = video.duration;
    const step = 1 / sampleFps;
    const frames: PoseFrame[] = [];

    const seekTo = (t: number) => new Promise<void>((res) => {
      const on = () => { video.removeEventListener("seeked", on); res(); };
      video.addEventListener("seeked", on);
      video.currentTime = Math.min(t, duration - 0.001);
    });

    for (let t = 0; t < duration; t += step) {
      await seekTo(t);
      const result = landmarker.detectForVideo(video, Math.round(t * 1000));
      if (result.worldLandmarks && result.worldLandmarks.length > 0) {
        const lms = result.worldLandmarks[0];
        const pts = new Float32Array(33 * 3);
        for (let i = 0; i < 33 && i < lms.length; i++) remap(lms[i], pts, i);
        frames.push({ t, pts });
      }
      setProgress(Math.min(1, t / duration));
    }
    landmarker.close();

    if (frames.length === 0) {
      setStatus("No person detected. Try a clip with the full body visible.");
      return;
    }
    poseRef.current = frames;
    durationRef.current = duration;
    setProcessed(true); setFrameCount(frames.length);
    setStatus(`Extracted ${frames.length} pose frames over ${duration.toFixed(1)}s. Press play.`);
    setProgress(1);
  };

  const togglePlay = () => {
    if (!processed) return;
    if (!playingRef.current) {
      startTimeRef.current = performance.now();
      playingRef.current = true; setIsPlaying(true);
      const v = videoRef.current;
      if (v) { v.currentTime = 0; v.play().catch(() => {}); }
    } else {
      playingRef.current = false; setIsPlaying(false);
      videoRef.current?.pause();
    }
  };

  const loadExerciseDemo = (key: string) => {
    if (!EXERCISES[key]) return;
    const { frames, duration } = generateExerciseFrames(key, 4, 30);
    poseRef.current = frames;
    durationRef.current = duration;
    setProcessed(true); setFrameCount(frames.length); setProgress(1);
    // auto-start
    startTimeRef.current = performance.now();
    playingRef.current = true; setIsPlaying(true);
    setStatus(`Demoing ${EXERCISES[key].name} · ${frames.length} synthesized frames`);
  };

  const downloadPoseJSON = () => {
    if (!poseRef.current) return;
    const serial = {
      version: 1,
      duration: durationRef.current,
      sampleFps,
      frames: poseRef.current.map((f) => ({ t: f.t, pts: Array.from(f.pts) })),
    };
    const blob = new Blob([JSON.stringify(serial)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pose_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const loadPoseJSON = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.frames || !Array.isArray(data.frames)) throw new Error("Invalid pose JSON");
      const frames: PoseFrame[] = data.frames.map((f: any) => ({
        t: f.t, pts: new Float32Array(f.pts),
      }));
      poseRef.current = frames;
      durationRef.current = data.duration || frames[frames.length - 1].t + 0.1;
      setProcessed(true); setFrameCount(frames.length); setProgress(1);
      setStatus(`Loaded ${frames.length} pose frames from JSON. Press play.`);
    } catch (e: any) {
      setStatus(`Failed to load pose JSON: ${e.message}`);
    }
  };

  return (
    <main className="min-h-screen" style={{ background: "var(--paper-deep)" }}>
      <header className="border-b border-foreground/15 px-6 py-6 text-center" style={{ background: "var(--paper)" }}>
        <p className="text-xs uppercase tracking-[0.4em] text-foreground/60">Anatomical Atlas — Plate II</p>
        <h1 className="mt-2 font-serif text-3xl md:text-5xl font-bold tracking-tight"
            style={{ fontFamily: "'Cormorant Garamond', 'Times New Roman', serif" }}>
          Motion Mimic
        </h1>
        <p className="mt-1 text-sm italic text-foreground/70">Pose extracted from video · replayed on a rigged figure</p>
        <p className="mt-3 text-xs text-foreground/50">
          <Link to="/" className="underline">&larr; Back to the musculoskeletal atlas</Link>
        </p>
      </header>

      <section className="mx-auto max-w-[1600px] px-4 py-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Video panel */}
        <div className="relative overflow-hidden rounded-md border border-foreground/20 shadow-2xl flex flex-col"
             style={{ background: "#1a1410", minHeight: 480 }}>
          <div className="flex-1 flex items-center justify-center p-4">
            {videoUrl ? (
              <video ref={videoRef} src={videoUrl} controls playsInline muted crossOrigin="anonymous"
                     className="max-h-[480px] w-auto max-w-full" />
            ) : (
              <label className="cursor-pointer rounded-md border border-dashed border-foreground/30 px-8 py-12 text-center hover:border-foreground/60"
                     style={{ color: "#f5e9d4" }}>
                <p className="font-serif text-lg italic mb-2">Drop a workout video here</p>
                <p className="text-xs opacity-70">MP4, WebM, MOV · full body visible · 5–30 sec works best</p>
                <input type="file" accept="video/*" className="hidden"
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoFile(f); }} />
              </label>
            )}
          </div>

          <div className="border-t border-foreground/20 p-3 flex flex-wrap items-center gap-2"
               style={{ background: "rgba(20,15,10,0.7)", color: "#f5e9d4" }}>
            <Button size="sm" variant="outline"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file"; input.accept = "video/*";
                input.onchange = (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleVideoFile(f);
                };
                input.click();
              }}>
              {videoUrl ? "Replace video" : "Choose video"}
            </Button>

            <label className="text-xs flex items-center gap-1 opacity-90">
              FPS
              <select value={sampleFps} onChange={(e) => setSampleFps(parseInt(e.target.value))}
                      className="bg-black/40 border border-white/20 rounded px-1 py-0.5 text-xs">
                <option value={10}>10 (fast)</option>
                <option value={20}>20 (balanced)</option>
                <option value={30}>30 (max)</option>
              </select>
            </label>

            <Button size="sm" onClick={extractPose} disabled={!videoUrl}>Extract pose</Button>
            <Button size="sm" variant={isPlaying ? "default" : "outline"} onClick={togglePlay} disabled={!processed}>
              {isPlaying ? "Pause" : "Play mimic"}
            </Button>

            <Button size="sm" variant="outline" onClick={downloadPoseJSON} disabled={!processed}>
              ↓ JSON
            </Button>
            <Button size="sm" variant="outline"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file"; input.accept = "application/json";
                input.onchange = (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0]; if (f) loadPoseJSON(f);
                };
                input.click();
              }}>
              ↑ JSON
            </Button>

            <label className="text-xs flex items-center gap-1 opacity-90 ml-2 border-l border-white/15 pl-2">
              Demo
              <select defaultValue="" onChange={(e) => { const v = e.target.value; if (v) loadExerciseDemo(v); e.target.value = ""; }}
                      className="bg-black/40 border border-white/20 rounded px-1 py-0.5 text-xs">
                <option value="" disabled>Pick exercise…</option>
                {Object.entries(EXERCISES).map(([k, ex]) => (
                  <option key={k} value={k}>{ex.emoji} {ex.name}</option>
                ))}
              </select>
            </label>

            <div className="ml-auto text-xs italic opacity-80 max-w-full">{status}</div>
          </div>

          {progress > 0 && progress < 1 && (
            <div className="h-1 w-full" style={{ background: "rgba(255,255,255,0.1)" }}>
              <div className="h-full" style={{ width: `${progress * 100}%`, background: "#e29bb0" }} />
            </div>
          )}
        </div>

        {/* 3D mimic panel */}
        <div className="relative overflow-hidden rounded-md border border-foreground/20 shadow-2xl"
             style={{ height: "min(70vh, 720px)" }}>
          <Canvas shadows camera={{ position: [0, 1.4, 3.2], fov: 35 }} gl={{ antialias: true }}>
            <color attach="background" args={["#1a1410"]} />
            <fog attach="fog" args={["#1a1410", 8, 20]} />
            <ambientLight intensity={0.55} />
            <directionalLight position={[4, 6, 5]} intensity={1.1} castShadow />
            <directionalLight position={[-4, 3, -3]} intensity={0.4} color="#a89070" />
            <Suspense fallback={null}>
              <Environment preset="studio" />
              <group position={[0, 0, 0]}>
                <RiggedFigure
                  poseRef={poseRef} playingRef={playingRef}
                  startTimeRef={startTimeRef} durationRef={durationRef}
                  smoothingRef={smoothingRef}
                />
              </group>
              <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={6} blur={2.5} far={3} />
            </Suspense>
            <OrbitControls target={[0, 1, 0]} enablePan={false} minDistance={1.5} maxDistance={8} />
          </Canvas>

          {/* Smoothing overlay */}
          <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 px-3 py-2 rounded-md text-xs"
               style={{ background: "rgba(20,15,10,0.7)", color: "#f5e9d4", backdropFilter: "blur(4px)" }}>
            <span className="opacity-70">Smoothing</span>
            <input type="range" min={0} max={0.95} step={0.05} value={smoothing}
                   onChange={(e) => setSmoothing(parseFloat(e.target.value))} className="flex-1" />
            <span className="tabular-nums opacity-90 w-10 text-right">{smoothing.toFixed(2)}</span>
            <span className="opacity-50 mx-2">·</span>
            <span className="opacity-70">{frameCount} frames</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1600px] px-6 pb-12 text-sm text-foreground/70">
        <h2 className="font-serif text-xl mb-2" style={{ fontFamily: "'Cormorant Garamond', serif" }}>How it works</h2>
        <ol className="list-decimal pl-5 space-y-1">
          <li>The video is sampled at your chosen frame rate in your browser.</li>
          <li>MediaPipe Pose extracts 33 body landmarks per sample (runs locally — nothing is uploaded).</li>
          <li>Each limb&apos;s direction is converted into a bone rotation; the spine and hip yaw are driven too.</li>
          <li>Slerp-smoothing reduces jitter; save the recording as JSON to replay it later.</li>
        </ol>
        <p className="mt-3 italic opacity-70">
          Best results: single person, full body in frame, mostly facing the camera. Side-on clips will mis-track depth.
        </p>
      </section>
    </main>
  );
}
