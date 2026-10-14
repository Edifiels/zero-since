// Модель гоночной лодки (low-poly) + пенный след.
// Используется в «Гонке» (часть b5a) и может импортироваться другими частями для визуальной рифмы.
//
//   import { Boat, figureEight } from '../b5a/boat-model.js';
//   const boat = new Boat({ scale: 1 });   // нос смотрит в +Z, длина корпуса ≈ 1 × scale
//   group.add(boat.object);                // лодка
//   group.add(boat.wake);                  // пенный след — в ТУ ЖЕ группу (он живёт в координатах родителя)
//   // каждый кадр (без аллокаций):
//   figureEight(u, { a: 1.6, b: 0.8, cx: 0, cz: 0 }, pos, tan);  // восьмёрка в плоскости XZ
//   boat.place(pos, tan);                  // поставить в точку и развернуть по касательной (без tan — курс по движению)
//   boat.update(dt, t);                    // покачивание, крен в поворотах, след, огни
//   boat.resetWake();                      // после «телепорта»
//   boat.dispose();                        // освободить ресурсы (если их не освобождает dispose() визуализации)
//
// Материалы: корпус — MeshStandardMaterial (нужен свет сцены — он есть в движке), полоса и огни светятся (bloom),
// след — ShaderMaterial с uniform uOpacity (совместим с общим fade визуализаций).
import * as THREE from 'three';

/** Восьмёрка (лемниската Жероно) в плоскости XZ. u — фаза (рад). Пишет точку в out и (необязательно) единичную касательную в tan. */
export function figureEight(u, { a = 1.6, b = 0.8, cx = 0, cz = 0, y = 0 } = {}, out = new THREE.Vector3(), tan = null) {
  const s = Math.sin(u), c = Math.cos(u);
  out.set(cx + a * s, y, cz + b * Math.sin(2 * u));
  if (tan) tan.set(a * c, 0, 2 * b * Math.cos(2 * u)).normalize();
  return out;
}

function hullGeometry() {
  // Контур палубы (вид сверху): корма — z = -0.5, нос — z = +0.53
  const s = new THREE.Shape();
  const w = 0.19;
  s.moveTo(-w * 0.92, -0.5);
  s.lineTo(w * 0.92, -0.5);
  s.quadraticCurveTo(w, -0.5, w, -0.44);
  s.lineTo(w, 0.04);
  s.bezierCurveTo(w, 0.26, w * 0.55, 0.42, 0, 0.53);
  s.bezierCurveTo(-w * 0.55, 0.42, -w, 0.26, -w, 0.04);
  s.lineTo(-w, -0.44);
  s.quadraticCurveTo(-w, -0.5, -w * 0.92, -0.5);
  const depth = 0.15;
  const g = new THREE.ExtrudeGeometry(s, {
    depth, curveSegments: 10, steps: 1,
    bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.022, bevelSegments: 2,
  });
  // (x, y, z) → (x, -z, y): контур лёг в плоскость XZ, выдавливание — вниз
  g.rotateX(Math.PI / 2);
  g.translate(0, depth + 0.025, 0);
  // V-образное днище, киль и задранный нос
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i);
    const z = p.getZ(i);
    const yN = THREE.MathUtils.clamp(y / (depth + 0.05), 0, 1);
    const zN = THREE.MathUtils.clamp((z + 0.5) / 1.05, 0, 1);
    const low = 1 - yN;
    x *= 1 - 0.42 * low * low;
    y += low * 0.07 * zN * zN * zN;
    y -= low * 0.03 * Math.max(0, 1 - Math.abs(x) / 0.2);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

const WAKE_VERT = /* glsl */ `
attribute float aAge;
attribute float aSide;
varying float vAge;
varying float vSide;
void main() {
  vAge = aAge;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const WAKE_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor, uEdge;
varying float vAge;
varying float vSide;
void main() {
  float s = abs(vSide);
  float edge = smoothstep(0.5, 0.92, s) * (1.0 - smoothstep(0.94, 1.0, s));
  float core = (1.0 - smoothstep(0.0, 0.55, s)) * 0.3;
  float life = clamp(1.0 - vAge, 0.0, 1.0);
  float a = (edge * 0.85 + core) * life * life * uOpacity;
  vec3 col = mix(uColor, uEdge, edge);
  gl_FragColor = vec4(col * a, a);
}
`;

export class Boat {
  /**
   * @param {object} o
   *   scale (1), hull (цвет корпуса), accent (цвет полосы и огней), wake (true — делать след),
   *   wakeLength (72 сегмента), wakeWidth (0.16) — полуширина следа у кормы, wakeSpread (0.9) — расхождение к хвосту,
   *   spacing (0.07) — шаг записи следа, wakeLife (2.6 с) — за сколько след гаснет, если лодка стоит
   */
  constructor({ scale = 1, hull = 0xc9d2c9, accent = 0x00ff00, wake = true, wakeLength = 72, wakeWidth = 0.16, wakeSpread = 0.9, spacing = 0.07, wakeLife = 2.6 } = {}) {
    this.scale = scale;
    this.object = new THREE.Group();
    this.object.name = 'boat';
    this.body = new THREE.Group();
    this.object.add(this.body);
    this.body.scale.setScalar(scale);

    const accentCol = new THREE.Color(accent);
    const mats = this.materials = {
      hull: new THREE.MeshStandardMaterial({ color: hull, roughness: 0.38, metalness: 0.15, flatShading: true }),
      // одинаковые флаги (flatShading, side) у материалов одного типа — меньше вариантов шейдеров для компиляции
      dark: new THREE.MeshStandardMaterial({ color: 0x0c110c, roughness: 0.55, metalness: 0.3, flatShading: true }),
      seat: new THREE.MeshStandardMaterial({ color: 0x9aa59a, roughness: 0.6, metalness: 0.05, flatShading: true }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1d3a1d, roughness: 0.08, metalness: 0.7, transparent: true, opacity: 0.85, flatShading: true }),
      stripe: new THREE.MeshBasicMaterial({ color: accentCol.clone().multiplyScalar(1.25), side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ color: accentCol.clone().multiplyScalar(2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    };

    // Корпус
    this.body.add(new THREE.Mesh(hullGeometry(), mats.hull));
    // Кокпит (тёмная выемка) и сиденья
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 0.4), mats.dark);
    cockpit.position.set(0, 0.185, -0.17);
    this.body.add(cockpit);
    const seatGeo = new THREE.BoxGeometry(0.09, 0.05, 0.1);
    [-0.06, 0.06].forEach((x) => {
      const seat = new THREE.Mesh(seatGeo, mats.seat);
      seat.position.set(x, 0.215, -0.22);
      this.body.add(seat);
    });
    // Лобовое стекло
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.02), mats.glass);
    glass.position.set(0, 0.24, 0.06);
    glass.rotation.x = -0.75;
    this.body.add(glass);
    // Гоночная полоса по палубе и неоновые борта
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.34), mats.stripe);
    stripe.position.set(0, 0.198, 0.25);
    this.body.add(stripe);
    const sideGeo = new THREE.BoxGeometry(0.012, 0.03, 0.6);
    [-1, 1].forEach((sd) => {
      const side = new THREE.Mesh(sideGeo, mats.stripe);
      side.position.set(sd * 0.205, 0.12, -0.12);
      this.body.add(side);
    });
    // Мотор на корме
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.1), mats.dark);
    motor.position.set(0, 0.2, -0.53);
    this.body.add(motor);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.03, 0.105), mats.stripe);
    cap.position.set(0, 0.3, -0.53);
    this.body.add(cap);
    // Огни: у мотора и ходовой на носу
    this.light = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), mats.glow);
    this.light.position.set(0, 0.26, -0.6);
    this.body.add(this.light);
    this.bowLight = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mats.glow);
    this.bowLight.position.set(0, 0.2, 0.5);
    this.body.add(this.bowLight);

    // Пенный след (в координатах родителя)
    this.wake = null;
    if (wake) {
      const N = this.wakeN = Math.max(8, wakeLength | 0);
      this.wakeWidth = wakeWidth * scale;
      this.wakeSpread = wakeSpread;
      this.spacing = spacing * scale;
      this.wakeLife = wakeLife;
      this.pts = new Float32Array(N * 3);   // история положений кормы (0 — голова)
      this.dirs = new Float32Array(N * 2);  // поперечное направление в каждой точке (XZ)
      this.stamps = new Float32Array(N);    // время записи точки
      this.count = 0;
      const pos = new Float32Array(N * 2 * 3);
      const age = new Float32Array(N * 2).fill(1);
      const side = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
      const idx = [];
      for (let i = 0; i < N - 1; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aAge', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      g.setIndex(idx);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
      this.wakeUniforms = {
        uOpacity: { value: 1 },
        uColor: { value: new THREE.Color(0xbfffc0).multiplyScalar(0.55) },
        uEdge: { value: new THREE.Color(0xffffff).multiplyScalar(1.15) },
      };
      this.wake = new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: this.wakeUniforms,
        vertexShader: WAKE_VERT,
        fragmentShader: WAKE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }));
      this.wake.frustumCulled = false;
      this.wake.name = 'boat-wake';
      this.wake.renderOrder = 2;
    }

    this._heading = 0;
    this._targetHeading = null;
    this._yawRate = 0;
    this._prev = new THREE.Vector3();
    this._has = false;
    this._clock = 0;
    this.speed = 0;        // текущая скорость (ед/с)
  }

  /** Поставить лодку. tan — направление курса (XZ); без tan курс берётся из перемещения. */
  place(pos, tan = null) {
    const o = this.object;
    if (tan) {
      if (tan.x * tan.x + tan.z * tan.z > 1e-8) this._targetHeading = Math.atan2(tan.x, tan.z);
    } else if (this._has) {
      const dx = pos.x - o.position.x, dz = pos.z - o.position.z;
      if (dx * dx + dz * dz > 1e-7) this._targetHeading = Math.atan2(dx, dz);
    }
    o.position.copy(pos);
    if (!this._has) {
      this._has = true;
      this._prev.copy(pos);
      if (this._targetHeading != null) this._heading = this._targetHeading;
    }
  }

  /** Мгновенно задать курс (рад; 0 — нос в +Z). */
  setHeading(a) { this._heading = a; this._targetHeading = a; this._yawRate = 0; this.object.rotation.y = a; }

  /** Стереть след (после мгновенного перемещения). */
  resetWake() {
    this.count = 0;
    this._has = false;
    this.speed = 0;
    if (this.wake) {
      const age = this.wake.geometry.attributes.aAge;
      age.array.fill(1);
      age.needsUpdate = true;
    }
  }

  update(dt, t) {
    const o = this.object;
    dt = Math.min(dt, 0.05);
    this._clock += dt;
    // скорость
    const dx = o.position.x - this._prev.x, dz = o.position.z - this._prev.z;
    const sp = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    this.speed += (sp - this.speed) * Math.min(1, dt * 6);
    this._prev.copy(o.position);
    // курс со сглаживанием и крен в поворотах
    if (this._targetHeading != null) {
      let diff = this._targetHeading - this._heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const k = Math.min(1, dt * 10);
      this._heading += diff * k;
      const rate = dt > 0 ? (diff * k) / dt : 0;
      this._yawRate += (rate - this._yawRate) * Math.min(1, dt * 5);
    }
    o.rotation.y = this._heading;
    const fast = Math.min(1, this.speed / 2.5);
    const b = this.body;
    b.position.y = (Math.sin(t * 3.1) * 0.012 + fast * 0.03) * this.scale;
    b.rotation.z = Math.sin(t * 2.3) * 0.035 * (1 - fast * 0.5) - THREE.MathUtils.clamp(this._yawRate * 0.12, -0.35, 0.35);
    b.rotation.x = -0.05 * fast + Math.sin(t * 2.7 + 1) * 0.02;
    const pulse = 0.75 + 0.25 * Math.sin(t * 9);
    this.light.scale.setScalar((0.8 + fast * 0.8) * pulse);
    this.bowLight.scale.setScalar(Math.sin(t * 4.5) > 0 ? 1.2 : 0.55);
    if (this.wake) this._updateWake();
  }

  _updateWake() {
    const N = this.wakeN, P = this.pts, D = this.dirs, T = this.stamps;
    const o = this.object;
    const h = this._heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    // голова следа — у кормы
    P[0] = o.position.x - fx * 0.5 * this.scale;
    P[1] = o.position.y + 0.02 * this.scale;
    P[2] = o.position.z - fz * 0.5 * this.scale;
    D[0] = fz; D[1] = -fx;
    T[0] = this._clock;
    if (this.count < 2) {
      P.copyWithin(3, 0, 3); D.copyWithin(2, 0, 2); T[1] = T[0];
      this.count = 2;
    } else if (Math.hypot(P[0] - P[3], P[2] - P[5]) >= this.spacing) {
      P.copyWithin(3, 0, (N - 1) * 3);
      D.copyWithin(2, 0, (N - 1) * 2);
      T.copyWithin(1, 0, N - 1);
      this.count = Math.min(N, this.count + 1);
    }
    const pos = this.wake.geometry.attributes.position;
    const age = this.wake.geometry.attributes.aAge;
    const pa = pos.array, aa = age.array;
    const n = this.count;
    const w0 = this.wakeWidth;
    const inv = 1 / (N - 1);
    for (let i = 0; i < N; i++) {
      const j = i < n ? i : n - 1;
      const k = i * inv;
      const hw = w0 * (0.35 + k * (1 + this.wakeSpread * 2.2));
      const cx = P[j * 3], cy = P[j * 3 + 1], cz = P[j * 3 + 2];
      const rx = D[j * 2], rz = D[j * 2 + 1];
      const v = i * 6;
      pa[v] = cx - rx * hw; pa[v + 1] = cy; pa[v + 2] = cz - rz * hw;
      pa[v + 3] = cx + rx * hw; pa[v + 4] = cy; pa[v + 5] = cz + rz * hw;
      const ageT = (this._clock - T[j]) / this.wakeLife;
      const ag = i < n ? Math.min(1, Math.max(k, ageT)) : 1;
      aa[i * 2] = aa[i * 2 + 1] = ag;
    }
    pos.needsUpdate = true;
    age.needsUpdate = true;
  }

  dispose() {
    this.object.traverse((o) => { o.geometry?.dispose?.(); });
    Object.values(this.materials).forEach((m) => m.dispose());
    if (this.wake) { this.wake.geometry.dispose(); this.wake.material.dispose(); }
  }
}

/** Фабрика: то же, что new Boat(opts). */
export function createBoat(opts) { return new Boat(opts); }
