import * as THREE from 'three';
import { createMap, type Vec } from './physics';
import type { ImportedMap, MapId } from './maps';
import { Viewmodel } from './viewmodel';
import { lightmappedMaterial } from './lightmapped';
import { MapLighting } from './map-lighting';

function texture(kind: 'concrete' | 'grid') {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d')!;
  c.fillStyle = kind === 'concrete' ? '#a9ada6' : '#d0d0bd'; c.fillRect(0, 0, 256, 256);
  // Seeded noise keeps the room visually stable between reloads.
  let seed = 81;
  for (let i = 0; i < 14000; i++) {
    seed = (seed * 16807) % 2147483647; const x = seed % 256;
    seed = (seed * 16807) % 2147483647; const y = seed % 256;
    c.fillStyle = `rgba(${i % 2 ? '0,0,0' : '255,255,255'},${kind === 'grid' ? 0.025 : 0.06})`;
    c.fillRect(x, y, 1, 1);
  }
  if (kind === 'grid') {
    c.strokeStyle = '#b5b7a7'; c.lineWidth = 1;
    for (let i = 0; i <= 256; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 256); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(256, i); c.stroke(); }
    c.strokeStyle = '#969d8c'; c.strokeRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
const toThree = (p: Vec) => new THREE.Vector3(p.x, p.z, -p.y);
// Source's 2D skybox layout (Quake 2's st_to_vec): each face maps (s, t, 1) to a direction; rt = +X, lf = -X,
// bk = +Y, ft = -Y, up = +Z, dn = -Z, with t = +1 at the top of the image.
const SKY_FACES = { rt: [3, -1, 2], lf: [-3, 1, 2], bk: [1, 3, 2], ft: [-1, -3, 2], up: [-2, -1, 3], dn: [2, -1, -3] } as const;
async function skybox(base: string, faces: Record<keyof typeof SKY_FACES, string>) {
  const loader = new THREE.TextureLoader(), group = new THREE.Group();
  await Promise.all((Object.keys(SKY_FACES) as (keyof typeof SKY_FACES)[]).map(async face => {
    const map = await loader.loadAsync(`${base}/${faces[face]}`);
    map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    const positions: number[] = [], uvs: number[] = [];
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
      const b = [s, t, 1], v = SKY_FACES[face].map(k => k > 0 ? b[k - 1] : -b[-k - 1]);
      positions.push(v[0], v[2], -v[1]); uvs.push((s + 1) / 2, (t + 1) / 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    // UnlitGeneric: drawn first, unlit, without depth, so it costs one background pass.
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, depthWrite: false, depthTest: false, toneMapped: false, fog: false }));
    mesh.renderOrder = -1000; mesh.frustumCulled = false; group.add(mesh);
  }));
  group.scale.setScalar(16);
  return group;
}
export class World {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(90, innerWidth / innerHeight, 0.5, 5000);
  renderer: THREE.WebGLRenderer;
  room = new THREE.Group(); platforms = new THREE.Group(); trail = new THREE.Group(); imported = new THREE.Group();
  classic: ImportedMap | null = null;
  viewmodel = new Viewmodel();
  sun = new THREE.DirectionalLight('#fff3d6', 3.1);
  // Compiled lighting of the current imported map: lightmap atlas for surfaces, light state for the viewmodel.
  lighting: MapLighting | null = null; private lightmap: THREE.Texture | null = null;
  sky = new THREE.Group();
  constructor(container: HTMLElement, gap: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color('#a9b7b1'); this.scene.fog = new THREE.Fog('#a9b7b1', 1700, 4000);
    this.scene.add(new THREE.HemisphereLight('#e3f5ef', '#4d5544', 2.4));
    const sun = this.sun; sun.position.set(-500, 1100, 350);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1400, right: 1400, top: 1400, bottom: -1400, near: 100, far: 2600 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 1; this.scene.add(sun);
    this.scene.add(this.room, this.platforms, this.trail, this.imported, this.sky);
    const concrete = new THREE.MeshStandardMaterial({ map: texture('concrete'), roughness: 0.92, color: '#c8cfc9' });
    const dark = new THREE.MeshStandardMaterial({ color: '#404d49', roughness: 0.9 });
    const beam = new THREE.MeshStandardMaterial({ color: '#6f8277', roughness: 0.8 });
    this.box(this.room, 1850, 25, 1550, 0, -190, -80, dark);
    this.box(this.room, 30, 500, 1600, -890, 40, -80, concrete);
    this.box(this.room, 30, 500, 1600, 890, 40, -80, concrete);
    this.box(this.room, 1800, 500, 30, 0, 40, 720, concrete);
    this.box(this.room, 1800, 500, 30, 0, 40, -875, concrete);
    for (const x of [-890, 890]) for (const z of [-750, -360, 30, 420, 700]) {
      this.box(this.room, 38, 575, 40, x, 65, z, beam);
      this.box(this.room, 25, 12, 130, x > 0 ? x - 22 : x + 22, 254, z, new THREE.MeshBasicMaterial({ color: '#efffe8' }));
    }
    for (const z of [-550, -50, 450]) this.box(this.room, 1800, 28, 24, 0, 335, z, beam);
    // Open skylight, steel crossbeams, and a low distant skyline.
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshBasicMaterial({ color: '#bdcac1', side: THREE.DoubleSide }));
    sky.rotation.x = Math.PI / 2; sky.position.y = 1300; this.room.add(sky);
    this.room.add(this.label('LONG JUMP / TRAINING FACILITY', new THREE.Vector3(0, 130, -856), 750, 48, '#cdd6cb', '#475e52'));
    this.room.add(this.label('VNL', new THREE.Vector3(-872, 145, -160), 220, 100, '#cdd6cb', '#536a5e', Math.PI / 2));
    this.room.add(this.label('01 — 05', new THREE.Vector3(870, 140, -160), 260, 80, '#cdd6cb', '#536a5e', -Math.PI / 2));
    this.buildPlatforms(gap);
    this.viewmodel.resize(innerWidth / innerHeight);
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.viewmodel.resize(innerWidth / innerHeight); this.renderer.setSize(innerWidth, innerHeight); });
  }
  box(group: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material | THREE.Material[]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
  }
  label(text: string, position: THREE.Vector3, w: number, h: number, background: string, color: string, yaw = 0, flat = false) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const c = canvas.getContext('2d')!; c.fillStyle = background; c.fillRect(0, 0, 1024, 256);
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 200px monospace';
    const fontSize = Math.min(200, 200 * 950 / c.measureText(text).width);
    c.font = `bold ${fontSize}px monospace`; c.fillText(text, 512, 137);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    mesh.position.copy(position); mesh.rotation.y = yaw; if (flat) mesh.rotation.x = -Math.PI / 2;
    this.platforms.add(mesh); return mesh;
  }
  buildPlatforms(gap: number) {
    this.disposeGroup(this.platforms);
    const topTex = texture('grid');
    const top = new THREE.MeshStandardMaterial({ map: topTex, color: '#dce0ce', roughness: 0.9 });
    const side = new THREE.MeshStandardMaterial({ map: texture('concrete'), color: '#a6b3a6', roughness: 0.95 });
    const green = new THREE.MeshStandardMaterial({ color: '#b4ed77', emissive: '#6e993b', emissiveIntensity: 0.12 });
    const dark = new THREE.MeshStandardMaterial({ color: '#36473e' });
    for (const b of createMap(gap)) {
      const w = b.max.x - b.min.x, d = b.max.y - b.min.y;
      // Separate tiled planes avoid stretching the grid texture across differently sized pads.
      this.box(this.platforms, w, 100, d, (b.min.x + b.max.x) / 2, -50, -(b.min.y + b.max.y) / 2, side);
      const tex = topTex.clone(); tex.repeat.set(w / 256, d / 256);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), top.clone()); (plane.material as THREE.MeshStandardMaterial).map = tex;
      plane.rotation.x = -Math.PI / 2; plane.position.set((b.min.x + b.max.x) / 2, 0.1, -(b.min.y + b.max.y) / 2); plane.receiveShadow = true; this.platforms.add(plane);
      if (b.id === 'back') continue;
      const front = b.id.startsWith('start') ? b.max.y : b.min.y;
      this.box(this.platforms, w, 1, 5, (b.min.x + b.max.x) / 2, 0.65, -front, green);
      this.box(this.platforms, w, 9, 1, (b.min.x + b.max.x) / 2, -5, -front, green);
      const i = Number(b.id.at(-1)), x = (i - 2) * 320, distance = [220, 230, gap, 250, 260][i];
      if (b.id.startsWith('end')) {
        this.label(String(distance), new THREE.Vector3(x, 0.4, -front - 125), 142, 43, '#d0d5c4', '#476349', 0, true);
        this.label(`${String(i + 1).padStart(2, '0')} / ${distance}`, new THREE.Vector3(x, -48, -front + 0.8), 160, 36, '#677d68', '#d9edca');
        this.box(this.platforms, w - 8, 0.8, 2, x, 0.5, -front - 32, dark);
      } else {
        for (let y = -32; y >= -480; y -= 32) this.box(this.platforms, 12, 0.8, 1, b.max.x - 12, 0.5, -y, dark);
        this.label('TAKEOFF', new THREE.Vector3(x, 0.4, 75), 120, 22, '#d0d5c4', '#607252', 0, true);
        this.label(String(distance), new THREE.Vector3(x, 0.4, 380), 150, 45, '#d0d5c4', '#617257', 0, true);
      }
    }
  }
  async buildImported(id: MapId, data: ImportedMap | null) {
    const group = new THREE.Group();
    if (data) {
      const loader = new THREE.TextureLoader();
      const used = new Set(data.meshes.map(m => m.material));
      const materials = new Map<number, THREE.ShaderMaterial>();
      let lightmap: THREE.Texture | null = null;
      try {
        lightmap = await loader.loadAsync(`${import.meta.env.BASE_URL}maps/${id}/${data.lightmap.texture}`);
        lightmap.colorSpace = THREE.NoColorSpace; lightmap.flipY = false; lightmap.generateMipmaps = false; lightmap.minFilter = THREE.LinearFilter;
        const results = await Promise.allSettled([...used].map(async i => {
          const source = data.materials[i];
          const bumped = !!source.normalMap && data.meshes.some(m => m.material === i && m.lmStep);
          const [map, normalMap] = await Promise.all([source.texture, bumped ? source.normalMap : undefined].map(file =>
            file ? loader.loadAsync(`${import.meta.env.BASE_URL}maps/${id}/${file}`) : Promise.resolve(null)));
          for (const texture of [map, normalMap]) if (texture) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 8; }
          if (normalMap) normalMap.colorSpace = THREE.NoColorSpace;
          materials.set(i, lightmappedMaterial(map, source.color, lightmap!, source.alpha ? 0.4 : 0, undefined,
            normalMap ? { normalMap, ssbump: !!source.ssbump } : undefined));
        }));
        const failed = results.find(r => r.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        const convert = (values: number[]) => { const result = new Float32Array(values.length); for (let i = 0; i < values.length; i += 3) { result[i] = values[i]; result[i + 1] = values[i + 2]; result[i + 2] = -values[i + 1]; } return result; };
        for (const mesh of data.meshes) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(convert(mesh.positions), 3));
          geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uvs, 2));
          geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(mesh.uv2, 2));
          if (mesh.lmStep) geometry.setAttribute('lmStep', new THREE.Float32BufferAttribute(mesh.lmStep, 1));
          const object = new THREE.Mesh(geometry, materials.get(mesh.material)!); group.add(object);
        }
        // Static decals (block numbers, signs), drawn after the world with the surfaces' lightmaps.
        const decalMaps = await Promise.all(data.decals.materials.map(async m => {
          const map = await loader.loadAsync(`${import.meta.env.BASE_URL}maps/${id}/${m.texture}`);
          map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping; map.anisotropy = 8;
          return lightmappedMaterial(map, [1, 1, 1], lightmap!, 0, m);
        }));
        for (const mesh of data.decals.meshes) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(convert(mesh.positions), 3));
          geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uvs, 2));
          geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(mesh.uv2, 2));
          const object = new THREE.Mesh(geometry, decalMaps[mesh.material]); object.renderOrder = 1; group.add(object);
        }
      } catch (error) { for (const m of materials.values()) { m.uniforms.map.value?.dispose(); m.uniforms.normalMap.value?.dispose(); m.dispose(); } lightmap?.dispose(); throw error; }
      this.lightmap?.dispose(); this.lightmap = lightmap;
      const sky = data.sky ? await skybox(`${import.meta.env.BASE_URL}maps/${id}`, data.sky.faces).catch(error => { console.warn('Skybox failed to load', error); return null; }) : null;
      this.disposeGroup(this.sky); if (sky) this.sky.add(...sky.children.splice(0)), this.sky.scale.copy(sky.scale);
    }
    this.disposeGroup(this.imported); for (const child of group.children.slice()) this.imported.add(child);
    this.classic = data; this.room.visible = this.platforms.visible = !data;
    this.lighting = data ? new MapLighting(data) : null;
    if (!data) { this.lightmap?.dispose(); this.lightmap = null; this.disposeGroup(this.sky); }
    // Imported maps are fully baked: no dynamic sun, so no shadow-map pass.
    this.sun.castShadow = !data;
    this.scene.fog = data ? null : new THREE.Fog('#a9b7b1', 1700, 4000);
    this.disposeGroup(this.trail);
  }
  showTrail(path: Vec[]) {
    this.disposeGroup(this.trail);
    if (path.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(path.map(p => toThree({ ...p, z: p.z + 3 })));
    this.trail.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#c2f989', transparent: true, opacity: 0.9 })));
    for (const p of [path[0], path.at(-1)!]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(5, 7, 24), new THREE.MeshBasicMaterial({ color: '#c2f989', side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(toThree({ ...p, z: p.z + 1 })); this.trail.add(ring);
    }
  }
  disposeGroup(group: THREE.Group) {
    group.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if ('map' in m) (m as THREE.MeshStandardMaterial).map?.dispose(); if (m instanceof THREE.ShaderMaterial) { m.uniforms.map?.value?.dispose(); m.uniforms.normalMap?.value?.dispose(); } m.dispose(); } } }); group.clear();
  }
  preview(time: number) {
    this.camera.fov = 66; this.camera.updateProjectionMatrix();
    if (this.classic) {
      this.camera.position.copy(toThree(this.classic.preview.position)); this.camera.position.x += Math.sin(time * 0.08) * 20;
      this.camera.lookAt(toThree(this.classic.preview.target));
    } else { this.camera.position.set(550 + Math.sin(time * 0.08) * 35, 320, 410); this.camera.lookAt(0, -20, -150); }
    this.sky.position.copy(this.camera.position);
    this.renderer.clear(); this.renderer.render(this.scene, this.camera);
  }
  // eye: the interpolated eye position from Movement.eye(); punch: CS:GO view punch in degrees (positive looks down).
  play(eye: Vec, yaw: number, pitch: number, fov: number, dt: number,
    view: { punch: number; speed: number; grounded: boolean; show: boolean; leftHand: boolean }) {
    this.camera.position.set(eye.x, eye.z, -eye.y);
    pitch -= view.punch * Math.PI / 180;
    this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(pitch, -yaw, 0);
    // Source FOV is horizontal at 4:3; Three.js expects vertical FOV.
    const verticalFov = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * 0.75) * 180 / Math.PI;
    if (this.camera.fov !== verticalFov) { this.camera.fov = verticalFov; this.camera.updateProjectionMatrix(); }
    this.sky.position.copy(this.camera.position);
    this.renderer.clear(); this.renderer.render(this.scene, this.camera);
    if (!view.show) return;
    this.viewmodel.update({ speed: view.speed, grounded: view.grounded, yaw, pitch, dt, leftHand: view.leftHand });
    this.viewmodel.render(this.renderer, this.camera.quaternion, this.lighting?.state(eye) ?? null);
  }
}
