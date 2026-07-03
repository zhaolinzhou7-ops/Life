import * as THREE from 'three';

/**
 * 俯视斜角相机 + 触屏/鼠标控制。
 * - 单指拖动 / 鼠标左键拖动：平移视角焦点
 * - 双指捏合 / 滚轮：缩放（改变相机与焦点距离）
 * 点击（无拖动）通过 onTap 回调抛出，用于建塔等交互。
 */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3(0, 0, 0);
  private dist = 16;
  private minDist = 8;
  private maxDist = 26;
  private angle = Math.PI * 0.36; // 俯仰角（离水平，越大越俯视）
  private azimuth = 0;
  private bound: { x: number; z: number };

  private dom: HTMLElement;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinch = 0;
  private dragged = false;
  private downPos = { x: 0, y: 0 };

  onTap: ((clientX: number, clientY: number) => void) | null = null;

  constructor(aspect: number, dom: HTMLElement, mapCols: number, mapRows: number) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 200);
    this.bound = { x: mapCols / 2 + 1, z: mapRows / 2 + 1 };
    this.dom = dom;
    this.dist = Math.max(mapCols, mapRows) * 1.15;
    this.maxDist = this.dist * 1.5;
    this.minDist = this.dist * 0.45;
    this.attach();
    this.apply();
  }

  private attach() {
    const d = this.dom;
    d.addEventListener('pointerdown', this.onDown);
    d.addEventListener('pointermove', this.onMove);
    d.addEventListener('pointerup', this.onUp);
    d.addEventListener('pointercancel', this.onUp);
    d.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this.onDown);
    d.removeEventListener('pointermove', this.onMove);
    d.removeEventListener('pointerup', this.onUp);
    d.removeEventListener('pointercancel', this.onUp);
    d.removeEventListener('wheel', this.onWheel);
  }

  private onDown = (e: PointerEvent) => {
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragged = false;
      this.downPos = { x: e.clientX, y: e.clientY };
    } else if (this.pointers.size === 2) {
      this.lastPinch = this.pinchDist();
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const prev = { x: p.x, y: p.y };
    p.x = e.clientX;
    p.y = e.clientY;

    if (this.pointers.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(e.clientX - this.downPos.x) + Math.abs(e.clientY - this.downPos.y) > 8) {
        this.dragged = true;
      }
      // 屏幕平移 → 世界平移（按缩放比例）
      const k = this.dist * 0.0016;
      const forward = new THREE.Vector3(Math.sin(this.azimuth), 0, Math.cos(this.azimuth));
      const right = new THREE.Vector3(forward.z, 0, -forward.x);
      this.target.addScaledVector(right, -dx * k);
      this.target.addScaledVector(forward, -dy * k);
      this.clampTarget();
      this.apply();
    } else if (this.pointers.size === 2) {
      const nd = this.pinchDist();
      if (this.lastPinch > 0) {
        const ratio = this.lastPinch / nd;
        this.dist = THREE.MathUtils.clamp(this.dist * ratio, this.minDist, this.maxDist);
        this.apply();
      }
      this.lastPinch = nd;
      this.dragged = true;
    }
  };

  private onUp = (e: PointerEvent) => {
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    if (wasSingle && !this.dragged && this.onTap) {
      this.onTap(e.clientX, e.clientY);
    }
    if (this.pointers.size < 2) this.lastPinch = 0;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.dist = THREE.MathUtils.clamp(this.dist * (e.deltaY > 0 ? 1.1 : 0.9), this.minDist, this.maxDist);
    this.apply();
  };

  private pinchDist(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private clampTarget() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, -this.bound.x, this.bound.x);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -this.bound.z, this.bound.z);
  }

  private apply() {
    const horiz = Math.cos(this.angle) * this.dist;
    const vert = Math.sin(this.angle) * this.dist;
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * horiz,
      this.target.y + vert,
      this.target.z + Math.cos(this.azimuth) * horiz,
    );
    this.camera.lookAt(this.target);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  focus(p: THREE.Vector3) {
    this.target.set(p.x, 0, p.z);
    this.clampTarget();
    this.apply();
  }
}
