/** Minimal equirectangular 360° viewer (WebGL, no dependencies): drag / pinch / wheel, optional phone-motion look-around. */
const VERT = `attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision highp float; varying vec2 v; uniform sampler2D tex; uniform float yaw, pitch, tanHalf, aspect;
const float PI = 3.14159265358979;
void main(){
  vec3 d = normalize(vec3(v.x * aspect * tanHalf, v.y * tanHalf, -1.0));
  float cp = cos(pitch), sp = sin(pitch);
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  float cy = cos(yaw), sy = sin(yaw);
  d = vec3(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy);
  float lon = atan(d.x, -d.z), lat = asin(clamp(d.y, -1.0, 1.0));
  gl_FragColor = texture2D(tex, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI));
}`;

export type PanoOptions = { yaw?: number; pitch?: number; fov?: number };

export class PanoView {
  yaw = 0; pitch = 0; fov = 75;                      // radians for yaw/pitch, degrees for fov
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private prog: WebGLProgram; private tex: WebGLTexture | null = null; private u: Record<string, WebGLUniformLocation | null> = {};
  private dirty = true; private raf = 0; private disposed = false; private ptrs = new Map<number, { x: number; y: number }>(); private pinch = 0;
  private gyro: ((e: DeviceOrientationEvent) => void) | null = null; private gyroBase: { yaw: number; alpha: number } | null = null;
  onChange?: () => void;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = (canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true }) || canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true })) as WebGLRenderingContext | null;
    if (!gl) throw new Error("WebGL is not available on this device");
    this.gl = gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader error"); return s; };
    this.prog = gl.createProgram()!; gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(this.prog);
    gl.useProgram(this.prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["tex", "yaw", "pitch", "tanHalf", "aspect"]) this.u[n] = gl.getUniformLocation(this.prog, n);
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.down); canvas.addEventListener("pointermove", this.move); canvas.addEventListener("pointerup", this.up); canvas.addEventListener("pointercancel", this.up);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.loop();
  }

  /** Upload an image (already same-origin or CORS-enabled). Large images are scaled to the GPU's limit. */
  setImage(img: HTMLImageElement | ImageBitmap) {
    const gl = this.gl;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    let src: TexImageSource = img;
    if (img.width > max || img.height > max) {
      const k = Math.min(max / img.width, max / img.height); const c = document.createElement("canvas"); c.width = Math.floor(img.width * k); c.height = Math.floor(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height); src = c;
    }
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const w2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    if (w2) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); }
    else { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.dirty = true;
  }

  look(o: PanoOptions) { if (o.yaw !== undefined) this.yaw = o.yaw; if (o.pitch !== undefined) this.pitch = Math.max(-1.45, Math.min(1.45, o.pitch)); if (o.fov !== undefined) this.fov = Math.max(30, Math.min(100, o.fov)); this.dirty = true; this.onChange?.(); }
  /** Current compass-style view direction in degrees (0 = the photo's centre / heading). */
  get yawDeg() { return ((this.yaw * 180) / Math.PI + 360) % 360; }

  private resize() {
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(c.clientWidth * dpr)), h = Math.max(2, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.gl.viewport(0, 0, w, h); this.dirty = true; }
  }
  private loop = () => {
    if (this.disposed) return;
    this.resize();
    if (this.dirty && this.tex) {
      const gl = this.gl; this.dirty = false;
      gl.uniform1i(this.u.tex, 0); gl.uniform1f(this.u.yaw, this.yaw); gl.uniform1f(this.u.pitch, this.pitch);
      gl.uniform1f(this.u.tanHalf, Math.tan((this.fov * Math.PI) / 360)); gl.uniform1f(this.u.aspect, this.canvas.width / this.canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private down = (e: PointerEvent) => { this.canvas.setPointerCapture(e.pointerId); this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (this.ptrs.size === 2) this.pinch = this.span(); };
  private span() { const [a, b] = [...this.ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
  private move = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId); if (!p) return;
    if (this.ptrs.size === 2) { this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); const s = this.span(); if (this.pinch) this.look({ fov: this.fov * (this.pinch / s) }); this.pinch = s; return; }
    const k = ((this.fov * Math.PI) / 180) / Math.max(1, this.canvas.clientHeight);
    this.look({ yaw: this.yaw - (e.clientX - p.x) * k, pitch: this.pitch + (e.clientY - p.y) * k });
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  private up = (e: PointerEvent) => { this.ptrs.delete(e.pointerId); this.pinch = 0; };
  private wheel = (e: WheelEvent) => { e.preventDefault(); this.look({ fov: this.fov * (1 + Math.sign(e.deltaY) * 0.08) }); };

  /** Look around by moving the phone. Returns false if the device has no motion sensors / permission is refused. */
  async enableGyro(): Promise<boolean> {
    const DO = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (!DO) return false;
    try { if (typeof DO.requestPermission === "function" && (await DO.requestPermission()) !== "granted") return false; } catch { return false; }
    this.disableGyro();
    this.gyroBase = null;
    this.gyro = (e) => {
      if (e.alpha == null || e.beta == null) return;
      const heading = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading ?? (360 - e.alpha);
      if (!this.gyroBase) this.gyroBase = { yaw: this.yaw, alpha: heading };
      this.look({ yaw: this.gyroBase.yaw + ((heading - this.gyroBase.alpha) * Math.PI) / 180, pitch: ((e.beta - 90) * Math.PI) / 180 });
    };
    window.addEventListener("deviceorientation", this.gyro);
    return true;
  }
  disableGyro() { if (this.gyro) window.removeEventListener("deviceorientation", this.gyro); this.gyro = null; }
  get gyroOn() { return !!this.gyro; }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.disableGyro();
    const c = this.canvas; c.removeEventListener("pointerdown", this.down); c.removeEventListener("pointermove", this.move); c.removeEventListener("pointerup", this.up); c.removeEventListener("pointercancel", this.up); c.removeEventListener("wheel", this.wheel);
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
