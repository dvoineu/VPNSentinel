import * as THREE from '../vendor/three.module.min.js';

/**
 * VPN Sentinel 3D Hero Observatory:
 * A sculpted macOS squircle & crystalline Packet Gate surrounded by three
 * orbital telemetry rings and a 2,800-particle GLSL packet stream.
 *
 * - Anchored to a DOM element (.stage-anchor) so it follows responsive layout.
 * - Reacts to live simulator state ('vs-demo' events): active, blocked, unknown, paused.
 * - Follows the pointer, adapts to light and dark appearance.
 * - Pauses when the hero is off-screen or the tab is hidden; with
 *   prefers-reduced-motion: reduce it draws a single still frame.
 */

const GATE_BARS = [0.52, 0.82, 1.0, 0.82, 0.52];
const TILE = 4.2;

const STATE_PRESETS = {
  active: {
    energy: 1.0,
    gateOpen: 1.0,
    mode: 0.0,
    darkA: 0x22d3ee,
    darkB: 0x10b981,
    lightA: 0x0284c7,
    lightB: 0x059669,
    emissive: 0x0ea5e9,
  },
  blocked: {
    energy: 0.35,
    gateOpen: 0.18,
    mode: 1.0,
    darkA: 0xf43f5e,
    darkB: 0xf97316,
    lightA: 0xe11d48,
    lightB: 0xea580c,
    emissive: 0xe11d48,
  },
  unknown: {
    energy: 0.65,
    gateOpen: 0.55,
    mode: 2.0,
    darkA: 0xf59e0b,
    darkB: 0x38bdf8,
    lightA: 0xd97706,
    lightB: 0x0284c7,
    emissive: 0xd97706,
  },
  paused: {
    energy: 0.85,
    gateOpen: 1.25,
    mode: 3.0,
    darkA: 0xfbbf24,
    darkB: 0x22d3ee,
    lightA: 0xd97706,
    lightB: 0x0891b2,
    emissive: 0xf59e0b,
  },
};

export class HeroScene {
  constructor({ canvas, host, anchor }) {
    this.canvas = canvas;
    this.host = host;
    this.anchor = anchor;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.pointer = new THREE.Vector2();
    this.pointerTarget = new THREE.Vector2();

    this.stateName = 'active';
    this.energy = 1.0;
    this.energyTarget = 1.0;
    this.gateOpen = 1.0;
    this.gateOpenTarget = 1.0;
    this.modeValue = 0.0;
    this.modeTarget = 0.0;
    this.pulse = 0;

    this.visible = true;
    this.running = false;
    this.clock = new THREE.Clock();
    this.time = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    this.camera.position.set(0, 0, 30);

    this.stage = new THREE.Group();
    this.scene.add(this.stage);

    this.buildLights();
    this.buildCoreTile();
    this.buildPacketField();
    this.applyTheme();
    this.bindEvents();
    this.resize();
    this.renderOnce();
    if (!this.reducedMotion.matches) this.start();
  }

  buildLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(-5, 7, 11);
    this.scene.add(key);

    this.rim = new THREE.PointLight(0x10b981, 42, 32, 1.5);
    this.rim.position.set(6, -3, 7);
    this.scene.add(this.rim);

    this.fill = new THREE.PointLight(0x22d3ee, 34, 32, 1.5);
    this.fill.position.set(-6, 4, 5);
    this.scene.add(this.fill);
  }

  buildCoreTile() {
    this.tileGroup = new THREE.Group();
    this.stage.add(this.tileGroup);

    const r = 0.92;
    const h = TILE / 2 - 0.12;
    const shape = new THREE.Shape();
    shape.moveTo(-h + r, -h);
    shape.lineTo(h - r, -h);
    shape.quadraticCurveTo(h, -h, h, -h + r);
    shape.lineTo(h, h - r);
    shape.quadraticCurveTo(h, h, h - r, h);
    shape.lineTo(-h + r, h);
    shape.quadraticCurveTo(-h, h, -h, h - r);
    shape.lineTo(-h, -h + r);
    shape.quadraticCurveTo(-h, -h, -h + r, -h);

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: 0.44,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.12,
      bevelSegments: 6,
      curveSegments: 24,
    });
    geom.translate(0, 0, -0.44);

    const from = new THREE.Color(0x092038);
    const to = new THREE.Color(0x0b4f5c);
    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const t = THREE.MathUtils.clamp((pos.getX(i) - pos.getY(i)) / (TILE * 1.1) + 0.5, 0, 1);
      c.copy(from).lerp(to, t);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.tileMaterial = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.26,
      metalness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.42,
    });
    this.tileMesh = new THREE.Mesh(geom, this.tileMaterial);
    this.tileGroup.add(this.tileMesh);

    // Orbital shield rings around the Sentinel core
    this.orbitGroup = new THREE.Group();
    this.orbitGroup.position.z = 0.22;
    this.tileGroup.add(this.orbitGroup);

    this.ringMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      roughness: 0.2,
      metalness: 0.3,
      transparent: true,
      opacity: 0.72,
      emissive: 0x22d3ee,
      emissiveIntensity: 0.65,
    });

    this.outerOrbit = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.045, 12, 64), this.ringMat);
    this.innerOrbit = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.035, 12, 48), this.ringMat);
    this.innerOrbit.rotation.x = 0.45;
    this.orbitGroup.add(this.outerOrbit, this.innerOrbit);

    // Central crystalline flask/core
    this.prismMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0f2fe,
      roughness: 0.15,
      metalness: 0.1,
      clearcoat: 1,
      emissive: 0x10b981,
      emissiveIntensity: 0.75,
    });
    this.prism = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), this.prismMat);
    this.prism.position.set(0, 0, 0.38);
    this.tileGroup.add(this.prism);

    // Five packet-gate bars that open/close on policy state transitions
    this.bars = GATE_BARS.map((height, i) => {
      const bar = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.11, 1, 6, 16),
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.18,
          clearcoat: 1,
          emissive: 0x38bdf8,
          emissiveIntensity: 0.75,
        }),
      );
      bar.position.set((i - 2) * 0.46, 0, 0.3);
      bar.userData.base = height;
      bar.userData.index = i;
      this.tileGroup.add(bar);
      return bar;
    });
  }

  buildPacketField() {
    const count = window.innerWidth < 700 ? 1500 : 2800;
    const angles = new Float32Array(count);
    const phases = new Float32Array(count);
    const seeds = new Float32Array(count);
    const lanes = 10;

    for (let i = 0; i < count; i += 1) {
      angles[i] = Math.random() * Math.PI * 2;
      phases[i] = (Math.floor(Math.random() * lanes) + Math.random() * 0.16) / lanes;
      seeds[i] = Math.random();
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geom.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
    geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geom.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this.ringUniforms = {
      uTime: { value: 0 },
      uEnergy: { value: 1 },
      uMode: { value: 0 },
      uPixelRatio: { value: this.renderer.getPixelRatio() },
      uScale: { value: 1 },
      uColorA: { value: new THREE.Color(0x22d3ee) },
      uColorB: { value: new THREE.Color(0x10b981) },
      uAlpha: { value: 1 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.ringUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aAngle;
        attribute float aPhase;
        attribute float aSeed;
        uniform float uTime;
        uniform float uEnergy;
        uniform float uMode;
        uniform float uPixelRatio;
        varying float vFade;
        varying float vMix;
        void main() {
          float speed = 0.045 + 0.065 * uEnergy;
          float p = fract(aPhase + uTime * speed);
          // In blocked mode (uMode ~ 1), clamp radius at the fail-closed perimeter barrier
          float maxSpan = mix(11.8, 3.6, clamp(1.0 - abs(uMode - 1.0), 0.0, 1.0));
          float radius = 2.4 + p * maxSpan;
          float swirl = aAngle + p * (0.85 * uEnergy);
          float wave = sin(aAngle * 7.0 + uTime * 1.9 + aSeed * 6.28) * (0.14 + 0.28 * uEnergy) * (1.0 - p);
          vec3 pos = vec3(
            cos(swirl) * (radius + wave),
            sin(swirl) * (radius + wave) * 0.9,
            (aSeed - 0.5) * 1.3 - p * 1.9
          );
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (2.1 + aSeed * 3.1) * uPixelRatio * (35.0 / -mv.z);
          vFade = smoothstep(0.0, 0.09, p) * pow(1.0 - p, 1.55);
          vMix = 0.5 + 0.5 * sin(aAngle * 2.0 + p * 3.14);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uAlpha;
        uniform float uEnergy;
        varying float vFade;
        varying float vMix;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float soft = smoothstep(0.5, 0.08, d);
          gl_FragColor = vec4(
            mix(uColorA, uColorB, vMix),
            soft * vFade * uAlpha * (0.48 + 0.52 * uEnergy)
          );
        }
      `,
    });

    this.rings = new THREE.Points(geom, material);
    this.rings.frustumCulled = false;
    this.rings.rotation.x = -0.2;
    this.stage.add(this.rings);
  }

  applyStatePreset(state) {
    const preset = STATE_PRESETS[state] || STATE_PRESETS.active;
    this.stateName = state in STATE_PRESETS ? state : 'active';
    this.energyTarget = preset.energy;
    this.gateOpenTarget = preset.gateOpen;
    this.modeTarget = preset.mode;
    this.pulse = 1;
    this.applyTheme();
  }

  applyTheme() {
    const dark = this.darkQuery.matches;
    const preset = STATE_PRESETS[this.stateName] || STATE_PRESETS.active;
    const material = this.rings.material;
    material.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.ringUniforms.uAlpha.value = dark ? 0.94 : 0.78;
    this.ringUniforms.uColorA.value.set(dark ? preset.darkA : preset.lightA);
    this.ringUniforms.uColorB.value.set(dark ? preset.darkB : preset.lightB);
    this.tileMaterial.emissive.setHex(preset.emissive);
    this.ringMat.emissive.setHex(dark ? preset.darkA : preset.lightA);
    this.prismMat.emissive.setHex(dark ? preset.darkB : preset.lightB);
    material.needsUpdate = true;
    this.renderOnce();
  }

  resize() {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.placeStage(rect);
    this.renderOnce();
  }

  placeStage(hostRect = this.host.getBoundingClientRect()) {
    const a = this.anchor.getBoundingClientRect();
    if (!a.width || !a.height) return;
    const cx = a.left + a.width / 2 - hostRect.left;
    const cy = a.top + a.height / 2 - hostRect.top;
    const dist = this.camera.position.z;
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist) / hostRect.height;
    this.stage.position.set(
      (cx - hostRect.width / 2) * worldPerPx,
      -(cy - hostRect.height / 2) * worldPerPx,
      0,
    );
    const tilePx = Math.min(a.height * 0.72, a.width * 0.48);
    const scale = (tilePx * worldPerPx) / TILE;
    this.stage.scale.setScalar(scale);
    this.ringUniforms.uScale.value = scale;
  }

  bindEvents() {
    this.onResize = () => this.resize();
    new ResizeObserver(this.onResize).observe(this.host);
    window.addEventListener('resize', this.onResize);

    window.addEventListener('pointermove', (event) => {
      this.pointerTarget.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        (event.clientY / window.innerHeight) * 2 - 1,
      );
    }, { passive: true });

    const onStateEvent = (event) => {
      this.applyStatePreset(event.detail);
    };
    document.addEventListener('vs-demo', onStateEvent);
    document.addEventListener('vh-demo', onStateEvent);

    this.darkQuery.addEventListener('change', () => this.applyTheme());
    this.reducedMotion.addEventListener('change', () => {
      if (this.reducedMotion.matches) this.stop();
      else this.start();
    });

    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.updateRunning();
    }).observe(this.host);
    document.addEventListener('visibilitychange', () => this.updateRunning());
  }

  updateRunning() {
    const shouldRun = this.visible && !document.hidden && !this.reducedMotion.matches;
    if (shouldRun) this.start();
    else this.stop();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    const loop = () => {
      if (!this.running) return;
      this.update(Math.min(this.clock.getDelta(), 0.05));
      this.renderer.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const step = Math.min(1, dt * 3.2);
    this.energy += (this.energyTarget - this.energy) * step;
    this.gateOpen += (this.gateOpenTarget - this.gateOpen) * step;
    this.modeValue += (this.modeTarget - this.modeValue) * step;
    this.pulse = Math.max(0, this.pulse - dt * 1.6);
    this.pointer.lerp(this.pointerTarget, step);

    this.bars.forEach((bar, i) => {
      const telemetry = 0.5 + 0.5 * Math.sin(t * 5.8 + i * 1.4) * Math.cos(t * 2.7 + i * 0.8);
      const factor = 0.42 + 0.55 * this.gateOpen * (0.65 + 0.35 * telemetry) + 0.25 * this.pulse;
      const length = Math.max(0.14, bar.userData.base * 2.1 * factor);
      bar.scale.y = length / 1.24;
    });

    this.prism.rotation.y = t * 0.9;
    this.prism.rotation.z = t * 0.5;
    this.outerOrbit.rotation.z = t * (0.25 + 0.2 * this.energy);
    this.innerOrbit.rotation.y = -t * (0.38 + 0.25 * this.energy);

    this.tileGroup.rotation.y = -0.34 + this.pointer.x * 0.34 + Math.sin(t * 0.55) * 0.05;
    this.tileGroup.rotation.x = 0.15 + this.pointer.y * 0.24 + Math.cos(t * 0.48) * 0.04;
    this.tileGroup.position.y = Math.sin(t * 0.85) * 0.11;

    this.rings.rotation.z = t * 0.028;
    this.ringUniforms.uTime.value = t;
    this.ringUniforms.uEnergy.value = this.energy;
    this.ringUniforms.uMode.value = this.modeValue;
  }

  renderOnce() {
    if (this.running) return;
    this.update(0);
    this.renderer.render(this.scene, this.camera);
  }
}
