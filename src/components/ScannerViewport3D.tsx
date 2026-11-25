import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Box, Layers } from 'lucide-react';

export type ScannerPhase = 'idle' | 'scanning' | 'complete';

interface ScannerViewport3DProps {
  phase: ScannerPhase;
  stageLabel?: string;
}

export function ScannerViewport3D({ phase, stageLabel }: ScannerViewport3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<ScannerPhase>(phase);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setWebglUnavailable(true);
      return;
    }

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    const canvas = renderer.domElement;
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
    };
    const handleContextRestored = () => {
      setWebglUnavailable(false);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    const width = container.clientWidth || 460;
    const height = container.clientHeight || 380;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    container.innerHTML = '';
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0.75, 5.4);
    camera.lookAt(0, 0, 0);

    // Three-point studio + cyan rim lighting
    const ambientLight = new THREE.AmbientLight(0x94a3b8, 0.55);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff1e0, 1.75);
    keyLight.position.set(4.5, 5.5, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.1);
    fillLight.position.set(-4.5, -1.5, 3.5);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0x22d3ee, 3.4, 16);
    rimLight.position.set(0, 2.8, -3.5);
    scene.add(rimLight);

    const accentLight = new THREE.PointLight(0x6366f1, 2.4, 14);
    accentLight.position.set(-2.5, -2.5, 2.5);
    scene.add(accentLight);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // Inner faceted core
    const coreGeo = new THREE.OctahedronGeometry(1.05, 1);
    const coreMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      emissive: 0x083344,
      emissiveIntensity: 0.65,
      metalness: 0.35,
      roughness: 0.18,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
      flatShading: true,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    rootGroup.add(coreMesh);

    // Architectural wireframe shell
    const cageGeo = new THREE.IcosahedronGeometry(1.42, 1);
    const cageEdges = new THREE.EdgesGeometry(cageGeo);
    const cageMat = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.62,
    });
    const cageWireframe = new THREE.LineSegments(cageEdges, cageMat);
    rootGroup.add(cageWireframe);

    // Orbital ring 1 (cyan)
    const ring1Geo = new THREE.TorusGeometry(1.92, 0.018, 16, 96);
    const ring1Mat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.8,
      metalness: 0.7,
      roughness: 0.2,
    });
    const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1.rotation.x = Math.PI / 2.4;
    rootGroup.add(ring1);

    // Orbital ring 2 (indigo)
    const ring2Geo = new THREE.TorusGeometry(2.24, 0.014, 16, 96);
    const ring2Mat = new THREE.MeshStandardMaterial({
      color: 0x818cf8,
      emissive: 0x4f46e5,
      emissiveIntensity: 0.65,
      metalness: 0.6,
      roughness: 0.25,
    });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.rotation.y = Math.PI / 3;
    ring2.rotation.x = -Math.PI / 5;
    rootGroup.add(ring2);

    // Laser scan plane ring (active during scanning)
    const scanRingGeo = new THREE.TorusGeometry(1.68, 0.022, 12, 80);
    const scanRingMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.0,
    });
    const scanRing = new THREE.Mesh(scanRingGeo, scanRingMat);
    scanRing.rotation.x = Math.PI / 2;
    rootGroup.add(scanRing);

    // Spatial reference grid below the prism
    const grid = new THREE.GridHelper(6.5, 16, 0x1e3a5f, 0x0f172a);
    grid.position.y = -2.05;
    scene.add(grid);

    // Subtle pointer parallax
    let targetPointerX = 0;
    let targetPointerY = 0;
    let currentPointerX = 0;
    let currentPointerY = 0;

    const onPointerMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      targetPointerX = ((ev.clientX - rect.left) / rect.width - 0.5) * 0.5;
      targetPointerY = ((ev.clientY - rect.top) / rect.height - 0.5) * 0.35;
    };

    const onPointerLeave = () => {
      targetPointerX = 0;
      targetPointerY = 0;
    };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerleave', onPointerLeave);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0 && renderer) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    let rafId = 0;
    let elapsed = 0;
    let lastTime = performance.now();

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      elapsed += dt;

      const currentPhase = phaseRef.current;
      const speedMultiplier =
        currentPhase === 'scanning' ? 2.6 : currentPhase === 'complete' ? 0.65 : 1.0;

      coreMesh.rotation.y += dt * 0.42 * speedMultiplier;
      coreMesh.rotation.x = Math.sin(elapsed * 0.6) * 0.14;

      cageWireframe.rotation.y -= dt * 0.28 * speedMultiplier;
      cageWireframe.rotation.z += dt * 0.15 * speedMultiplier;

      ring1.rotation.z += dt * 0.36 * speedMultiplier;
      ring2.rotation.z -= dt * 0.25 * speedMultiplier;

      // Smooth scan ring sweep during analysis
      if (currentPhase === 'scanning') {
        scanRingMat.opacity = THREE.MathUtils.lerp(scanRingMat.opacity, 0.9, 0.08);
        scanRing.position.y = Math.sin(elapsed * 3.2) * 1.35;
        coreMat.emissiveIntensity = 1.05 + Math.sin(elapsed * 6) * 0.25;
        cageMat.opacity = 0.88;
      } else if (currentPhase === 'complete') {
        scanRingMat.opacity = THREE.MathUtils.lerp(scanRingMat.opacity, 0.0, 0.08);
        coreMat.emissiveIntensity = THREE.MathUtils.lerp(coreMat.emissiveIntensity, 0.85, 0.05);
        cageMat.opacity = THREE.MathUtils.lerp(cageMat.opacity, 0.72, 0.05);
      } else {
        scanRingMat.opacity = THREE.MathUtils.lerp(scanRingMat.opacity, 0.0, 0.08);
        coreMat.emissiveIntensity = THREE.MathUtils.lerp(coreMat.emissiveIntensity, 0.55, 0.05);
        cageMat.opacity = THREE.MathUtils.lerp(cageMat.opacity, 0.52, 0.05);
      }

      currentPointerX = THREE.MathUtils.lerp(currentPointerX, targetPointerX, 0.06);
      currentPointerY = THREE.MathUtils.lerp(currentPointerY, targetPointerY, 0.06);

      rootGroup.rotation.y = currentPointerX;
      rootGroup.rotation.x = currentPointerY;
      rootGroup.position.y = Math.sin(elapsed * 1.3) * 0.08;

      renderer?.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      coreGeo.dispose();
      coreMat.dispose();
      cageGeo.dispose();
      cageEdges.dispose();
      cageMat.dispose();
      ring1Geo.dispose();
      ring1Mat.dispose();
      ring2Geo.dispose();
      ring2Mat.dispose();
      scanRingGeo.dispose();
      scanRingMat.dispose();
      renderer?.dispose();
    };
  }, []);

  const phaseText =
    phase === 'scanning'
      ? stageLabel || 'Escaneando fontes públicas...'
      : phase === 'complete'
        ? 'Blueprint arquitetônico sintetizado'
        : 'Núcleo 3D pronto para leitura de link';

  return (
    <div className="surface-3d relative flex h-full min-h-[340px] flex-col justify-between overflow-hidden rounded-3xl p-5">
      {/* Ambient radial lighting backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(34,211,238,0.14),transparent_62%)]"
      />

      <div className="relative z-10 flex items-center justify-between gap-4 text-xs text-slate-400">
        <span className="font-medium tracking-wide text-slate-300">
          Projeção Arquitetônica Espacial
        </span>
        <span className="font-mono text-cyan-300/90 tabular-nums">
          {phase === 'scanning' ? 'SCAN ATIVO' : phase === 'complete' ? 'CONCLUÍDO' : 'PRONTO'}
        </span>
      </div>

      {webglUnavailable ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-cyan-400/30 bg-cyan-500/10 shadow-[0_0_40px_-8px_rgba(34,211,238,0.45)]">
            {phase === 'scanning' ? (
              <Layers className="h-10 w-10 text-cyan-300" />
            ) : (
              <Box className="h-10 w-10 text-cyan-300" />
            )}
          </div>
          <p className="max-w-xs text-sm text-slate-300">
            Visualização espacial em modo acessível simplificado.
          </p>
        </div>
      ) : (
        <div
          ref={containerRef}
          aria-label="Núcleo 3D interativo do VIRA SCANNER 3D"
          className="relative z-10 h-[280px] w-full cursor-grab active:cursor-grabbing lg:h-[320px]"
        />
      )}

      <div className="relative z-10 flex items-center justify-between gap-3 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
        <span className="truncate text-slate-300">{phaseText}</span>
        <span className="shrink-0 text-slate-500">Arraste o ponteiro para orbitar</span>
      </div>
    </div>
  );
}
