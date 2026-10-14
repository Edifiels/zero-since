// «Оператор» камеры: плавные пролёты по дуге, параллакс от мыши, лёгкое «дыхание», тряска.
//
//   rig.flyTo({ pos: [x,y,z], target: [x,y,z], fov: 45, roll: 0 }, { duration: 1.6, arc: 0.3 })
//   rig.set(pose)                         — мгновенно
//   rig.setDriver((dt, t) => pose | null, blend, owner) — покадровое управление (облёт); setDriver(null) — отключить
//   rig.shake(0.3, 0.6)
import * as THREE from 'three';
import { gsap } from 'gsap';
import { damp } from './utils.js';

/**
 * Вертикальный угол обзора для экрана с соотношением aspect, при котором по горизонтали видно столько же,
 * сколько на 16:9 при угле fov. Ядро применяет это к позам из camera() само; для поз «водителя» (drive)
 * вызывайте вручную: fov: fitFov(45, ctx.camera.aspect).
 */
export function fitFov(fov, aspect) {
  if (!aspect || aspect >= 16 / 9 - 0.01) return fov;
  const r = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * (16 / 9) / aspect;
  return Math.min(150, THREE.MathUtils.radToDeg(2 * Math.atan(r)));
}

const V = (a) => (a instanceof THREE.Vector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 14);
    this.target = new THREE.Vector3(0, 0, 0);
    this.fov = 45;
    this.roll = 0;
    this.parallax = 0.45;
    this.breathe = 0.08;
    this.pointer = new THREE.Vector2();
    this._pp = new THREE.Vector2();
    this._shake = 0;
    this.driver = null;
    this.driverMix = { v: 0 };
    this._tween = null;
    this._tmpPos = new THREE.Vector3();
    this._tmpTgt = new THREE.Vector3();
    this._dPos = new THREE.Vector3();
    this._dTgt = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
  }

  get pose() {
    return { pos: this.pos.toArray(), target: this.target.toArray(), fov: this.fov, roll: this.roll };
  }

  set(pose) {
    if (!pose) return;
    this._tween?.kill();
    if (pose.pos) this.pos.copy(V(pose.pos));
    if (pose.target) this.target.copy(V(pose.target));
    if (pose.fov) this.fov = pose.fov;
    this.roll = pose.roll ?? 0;
  }

  /** Пролёт к позе. arc — подъём траектории (доля расстояния), ease — gsap-изинг. */
  flyTo(pose, { duration = 1.6, ease = 'power3.inOut', arc = 0.15, delay = 0 } = {}) {
    if (!pose) return Promise.resolve();
    this._tween?.kill();
    const p0 = this.pos.clone(), t0 = this.target.clone();
    const p1 = pose.pos ? V(pose.pos) : p0.clone();
    const t1 = pose.target ? V(pose.target) : t0.clone();
    const f0 = this.fov, f1 = pose.fov ?? this.fov;
    const r0 = this.roll, r1 = pose.roll ?? 0;
    if (duration <= 0) { this.set(pose); return Promise.resolve(); }
    // контрольная точка дуги: середина, приподнятая и отодвинутая от цели
    const mid = p0.clone().lerp(p1, 0.5);
    const dist = p0.distanceTo(p1);
    const away = mid.clone().sub(t0.clone().lerp(t1, 0.5));
    if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
    away.normalize();
    const ctrl = mid.addScaledVector(away, dist * arc).add(new THREE.Vector3(0, dist * arc * 0.5, 0));
    const curve = new THREE.QuadraticBezierCurve3(p0, ctrl, p1);
    const st = { k: 0 };
    return new Promise((resolve) => {
      this._tween = gsap.to(st, {
        k: 1, duration, ease, delay,
        onUpdate: () => {
          curve.getPoint(st.k, this.pos);
          this.target.lerpVectors(t0, t1, st.k);
          this.fov = f0 + (f1 - f0) * st.k;
          this.roll = r0 + (r1 - r0) * st.k;
        },
        onComplete: resolve,
        onInterrupt: resolve,
      });
    });
  }

  /** Покадровый «водитель» камеры: fn(dt, t) => { pos, target, fov?, roll? }. owner — кто управляет. */
  setDriver(fn, blend = 0.9, owner = null) {
    gsap.killTweensOf(this.driverMix);
    if (fn) {
      this.driver = fn;
      this.driverOwner = owner;
      gsap.fromTo(this.driverMix, { v: 0 }, { v: 1, duration: blend, ease: 'power2.inOut' });
    } else if (this.driver) {
      // «отпускаем» камеру: текущая поза становится базовой
      this.pos.copy(this.camera.position);
      this._tmpTgt.set(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(this.pos.distanceTo(this.target) || 10).add(this.pos);
      this.target.copy(this._tmpTgt);
      this.driver = null;
      this.driverOwner = null;
      this.driverMix.v = 0;
    }
  }

  /** Снять «водителя», только если им управляет owner. */
  releaseDriver(owner) {
    if (this.driver && (!owner || this.driverOwner === owner)) this.setDriver(null);
  }

  shake(amount = 0.25, duration = 0.6) {
    gsap.fromTo(this, { _shake: amount }, { _shake: 0, duration, ease: 'power2.out', overwrite: 'auto' });
  }

  update(dt, t) {
    const cam = this.camera;
    let pos = this.pos, tgt = this.target, fov = this.fov, roll = this.roll;
    if (this.driver) {
      const d = this.driver(dt, t);
      if (d) {
        const m = this.driverMix.v;
        const dp = d.pos.isVector3 ? d.pos : this._dPos.fromArray(d.pos);
        const dtg = d.target.isVector3 ? d.target : this._dTgt.fromArray(d.target);
        pos = this._tmpPos.copy(this.pos).lerp(dp, m);
        tgt = this._tmpTgt.copy(this.target).lerp(dtg, m);
        if (d.fov) fov = this.fov + (d.fov - this.fov) * m;
        if (d.roll != null) roll = this.roll + (d.roll - this.roll) * m;
      }
    }
    // параллакс от мыши (сглаженный)
    this._pp.x = damp(this._pp.x, this.pointer.x, 2.5, dt);
    this._pp.y = damp(this._pp.y, this.pointer.y, 2.5, dt);
    this._fwd.subVectors(tgt, pos);
    const dist = this._fwd.length() || 1;
    this._fwd.normalize();
    this._right.crossVectors(this._fwd, cam.up).normalize();
    this._up.crossVectors(this._right, this._fwd).normalize();
    const k = this.parallax * Math.min(2, dist / 14);
    const bx = Math.sin(t * 0.21) * this.breathe + Math.sin(t * 0.13 + 1.7) * this.breathe * 0.6;
    const by = Math.sin(t * 0.17 + 0.6) * this.breathe * 0.7;
    cam.position.copy(pos)
      .addScaledVector(this._right, this._pp.x * k + bx)
      .addScaledVector(this._up, this._pp.y * k * 0.7 + by);
    if (this._shake > 0.0001) {
      const s = this._shake;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.lookAt(tgt);
    if (roll) cam.rotateZ(roll);
    if (Math.abs(cam.fov - fov) > 0.001) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
