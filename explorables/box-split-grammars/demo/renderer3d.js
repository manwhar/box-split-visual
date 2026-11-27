/**
 * renderer3d.js
 * Zero-dependency WebGL1 + 2D HUD renderer for 3D Box-Split Grammars.
 * Renders Minecraft-faithful tiled 16x16 textures (NEAREST + REPEAT),
 * directional face shading, integer grid lines, cut boundaries,
 * translucent slice plane previews, and animated code-hover scope highlighting.
 */

import { GRID_SIZE_3D } from './model3d.js';
import { TEXTURE_TYPES, TextureLibrary } from './textures.js';

const DEFAULT_YAW = 0.72;
const DEFAULT_PITCH = 0.46;
const DEFAULT_DIST = 16.8;
const FOV_DEG = 38;

const AXIS_COLORS = {
  X: { hex: '#ef4444', fill: [0.937, 0.267, 0.267, 0.32], edge: [0.863, 0.149, 0.149, 0.95] },
  Y: { hex: '#16a34a', fill: [0.086, 0.639, 0.290, 0.32], edge: [0.082, 0.502, 0.239, 0.95] },
  Z: { hex: '#2563eb', fill: [0.145, 0.388, 0.922, 0.32], edge: [0.114, 0.306, 0.847, 0.95] }
};

// Minimal column-major 4x4 matrix helpers
function mat4Perspective(fovyRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
}

function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1
  ]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Shader compile failed: ' + info);
  }
  return shader;
}

function createProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error('Program link failed: ' + info);
  }
  return prog;
}

function pushBoxWireEdges(arr, x, y, z, w, h, d, inset = 0) {
  const x0 = x + inset, x1 = x + w - inset;
  const y0 = y + inset, y1 = y + h - inset;
  const z0 = z + inset, z1 = z + d - inset;
  // Bottom 4
  arr.push(x0, y0, z0, x1, y0, z0);
  arr.push(x1, y0, z0, x1, y0, z1);
  arr.push(x1, y0, z1, x0, y0, z1);
  arr.push(x0, y0, z1, x0, y0, z0);
  // Top 4
  arr.push(x0, y1, z0, x1, y1, z0);
  arr.push(x1, y1, z0, x1, y1, z1);
  arr.push(x1, y1, z1, x0, y1, z1);
  arr.push(x0, y1, z1, x0, y1, z0);
  // Vertical 4
  arr.push(x0, y0, z0, x0, y1, z0);
  arr.push(x1, y0, z0, x1, y1, z0);
  arr.push(x1, y0, z1, x1, y1, z1);
  arr.push(x0, y0, z1, x0, y1, z1);
}

function pushSolidBoxTriangles(arr, x, y, z, w, h, d, inset = 0) {
  const x0 = x + inset, x1 = x + w - inset;
  const y0 = y + inset, y1 = y + h - inset;
  const z0 = z + inset, z1 = z + d - inset;
  // +Y
  arr.push(x0, y1, z0, x0, y1, z1, x1, y1, z1, x0, y1, z0, x1, y1, z1, x1, y1, z0);
  // -Y
  arr.push(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z0, x1, y0, z1, x0, y0, z1);
  // +Z
  arr.push(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y0, z1, x1, y1, z1, x0, y1, z1);
  // -Z
  arr.push(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y0, z0, x0, y1, z0, x1, y1, z0);
  // +X
  arr.push(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z0, x1, y1, z1);
  // -X
  arr.push(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y0, z0, x0, y1, z1, x0, y1, z0);
}

export class BoxRenderer3D {
  constructor(glCanvas, hudCanvas) {
    this.canvas = glCanvas;
    this.hudCanvas = hudCanvas;
    this.hudCtx = hudCanvas.getContext('2d');
    this.textureLib = new TextureLibrary();
    this.detailScale = window.devicePixelRatio || 1;

    // Camera state orbiting center of 6x6x6 cube
    this.target = [GRID_SIZE_3D / 2, GRID_SIZE_3D / 2, GRID_SIZE_3D / 2];
    this.yaw = DEFAULT_YAW;
    this.pitch = DEFAULT_PITCH;
    this.distance = DEFAULT_DIST;

    // Highlight animation state matching 2D renderer
    this.codeHighlightId = null;
    this.lastHighlightNodeId = null;
    this.highlightProgress = 0;
    this.targetProgress = 0;
    this.animId = null;

    this.lastRootRegion = null;
    this.lastHoverCut = null;
    this.lastHoverRegion = null;

    const gl = glCanvas.getContext('webgl', { alpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) {
      throw new Error('WebGL context unavailable');
    }
    this.gl = gl;
    this.initGL();
  }

  initGL() {
    const gl = this.gl;

    // Textured block shader with per-face Minecraft shading + highlight dim/lift
    this.texProg = createProgram(
      gl,
      `attribute vec3 aPos;
       attribute vec2 aUv;
       attribute float aShade;
       uniform mat4 uMvp;
       varying vec2 vUv;
       varying float vShade;
       void main() {
         gl_Position = uMvp * vec4(aPos, 1.0);
         vUv = aUv;
         vShade = aShade;
       }`,
      `precision mediump float;
       uniform sampler2D uTex;
       uniform float uDim;
       uniform float uLift;
       varying vec2 vUv;
       varying float vShade;
       void main() {
         vec4 c = texture2D(uTex, vUv);
         vec3 lit = c.rgb * vShade;
         lit = mix(lit, vec3(0.06, 0.09, 0.16), uDim);
         lit = clamp(lit + vec3(uLift), 0.0, 1.0);
         gl_FragColor = vec4(lit, c.a);
       }`
    );

    // Flat color shader for grid lines, outlines, axes, translucent planes
    this.flatProg = createProgram(
      gl,
      `attribute vec3 aPos;
       uniform mat4 uMvp;
       void main() {
         gl_Position = uMvp * vec4(aPos, 1.0);
       }`,
      `precision mediump float;
       uniform vec4 uColor;
       void main() {
         gl_FragColor = uColor;
       }`
    );

    this.posBuffer = gl.createBuffer();
    this.uvBuffer = gl.createBuffer();
    this.shadeBuffer = gl.createBuffer();

    // Upload Minecraft 16x16 textures with NEAREST + REPEAT
    this.glTextures = {
      oak_log_top: this.uploadTexture(this.textureLib.getCanvas(TEXTURE_TYPES.OAK_LOG)),
      oak_log_side: this.uploadTexture(this.textureLib.getSideCanvas(TEXTURE_TYPES.OAK_LOG)),
      cobblestone: this.uploadTexture(this.textureLib.getCanvas(TEXTURE_TYPES.COBBLESTONE)),
      oak_planks: this.uploadTexture(this.textureLib.getCanvas(TEXTURE_TYPES.OAK_PLANKS))
    };

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  uploadTexture(sourceCanvas) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  setResolution(scale) {
    this.detailScale = scale;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;

    const pw = Math.round(w * this.detailScale);
    const ph = Math.round(h * this.detailScale);
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.hudCanvas.width = pw;
    this.hudCanvas.height = ph;
    this.hudCtx.setTransform(this.detailScale, 0, 0, this.detailScale, 0, 0);
    this.gl.viewport(0, 0, pw, ph);
  }

  orbit(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + dPitch));
    this.renderCurrent();
  }

  zoom(delta) {
    this.distance = Math.max(8, Math.min(26, this.distance + delta));
    this.renderCurrent();
  }

  resetCamera() {
    this.yaw = DEFAULT_YAW;
    this.pitch = DEFAULT_PITCH;
    this.distance = DEFAULT_DIST;
    this.renderCurrent();
  }

  getCameraEye() {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw)
    ];
  }

  getMatrices() {
    const w = this.canvas.clientWidth || 350;
    const h = this.canvas.clientHeight || 350;
    const aspect = w / h;
    const proj = mat4Perspective((FOV_DEG * Math.PI) / 180, aspect, 0.1, 100);
    const eye = this.getCameraEye();
    const view = mat4LookAt(eye, this.target, [0, 1, 0]);
    const mvp = mat4Multiply(proj, view);
    return { eye, view, proj, mvp, w, h };
  }

  /**
   * Computes a world-space camera ray through (clientX, clientY).
   */
  getRay(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;

    const eye = this.getCameraEye();
    // Forward, right, up basis matching mat4LookAt
    let fx = this.target[0] - eye[0];
    let fy = this.target[1] - eye[1];
    let fz = this.target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;

    // right = normalize(forward x up)
    let rx = fy * 0 - fz * 1;
    let ry = fz * 0 - fx * 0;
    let rz = fx * 1 - fy * 0;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;

    // camUp = right x forward
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    const tanHalfFov = Math.tan(((FOV_DEG * Math.PI) / 180) / 2);
    const aspect = rect.width / rect.height;
    const sx = ndcX * tanHalfFov * aspect;
    const sy = ndcY * tanHalfFov;

    let dx = fx + rx * sx + ux * sy;
    let dy = fy + ry * sx + uy * sy;
    let dz = fz + rz * sx + uz * sy;
    const dl = Math.hypot(dx, dy, dz) || 1;
    return {
      origin: eye,
      dir: [dx / dl, dy / dl, dz / dl]
    };
  }

  projectPoint(x, y, z, mvp, w, h) {
    const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
    const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
    const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    if (cw <= 0.001) return null;
    const nx = cx / cw;
    const ny = cy / cw;
    return {
      x: (nx * 0.5 + 0.5) * w,
      y: (0.5 - ny * 0.5) * h
    };
  }

  setCodeHighlightId(nodeId) {
    if (nodeId !== null) {
      this.codeHighlightId = nodeId;
      this.lastHighlightNodeId = nodeId;
      this.targetProgress = 1.0;
    } else {
      this.codeHighlightId = null;
      this.targetProgress = 0.0;
    }
    this.startDimAnimation();
  }

  startDimAnimation() {
    if (this.animId) cancelAnimationFrame(this.animId);

    let lastTime = performance.now();
    const step = (now) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const diff = this.targetProgress - this.highlightProgress;
      if (Math.abs(diff) > 0.01) {
        const speed = this.targetProgress > 0 ? 15 : 20;
        this.highlightProgress += diff * Math.min(speed * dt, 0.55);
        this.renderCurrent();
        this.animId = requestAnimationFrame(step);
      } else {
        this.highlightProgress = this.targetProgress;
        if (this.highlightProgress === 0) {
          this.lastHighlightNodeId = null;
        }
        this.renderCurrent();
        this.animId = null;
      }
    };
    this.animId = requestAnimationFrame(step);
  }

  renderCurrent() {
    if (this.lastRootRegion) {
      this.render(this.lastRootRegion, this.lastHoverCut, this.lastHoverRegion);
    }
  }

  drawFlat(mvp, mode, positions, color) {
    if (positions.length === 0) return;
    const gl = this.gl;
    gl.useProgram(this.flatProg);
    const uMvp = gl.getUniformLocation(this.flatProg, 'uMvp');
    const uColor = gl.getUniformLocation(this.flatProg, 'uColor');
    const aPos = gl.getAttribLocation(this.flatProg, 'aPos');

    gl.uniformMatrix4fv(uMvp, false, mvp);
    gl.uniform4fv(uColor, color);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(mode, 0, positions.length / 3);
  }

  drawTexturedBoxFace(mvp, tex, positions, uvs, shades, dim, lift) {
    const gl = this.gl;
    gl.useProgram(this.texProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(this.texProg, 'uTex'), 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.texProg, 'uMvp'), false, mvp);
    gl.uniform1f(gl.getUniformLocation(this.texProg, 'uDim'), dim);
    gl.uniform1f(gl.getUniformLocation(this.texProg, 'uLift'), lift);

    const aPos = gl.getAttribLocation(this.texProg, 'aPos');
    const aUv = gl.getAttribLocation(this.texProg, 'aUv');
    const aShade = gl.getAttribLocation(this.texProg, 'aShade');

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shades), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aShade);
    gl.vertexAttribPointer(aShade, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, positions.length / 3);
    gl.disableVertexAttribArray(aUv);
    gl.disableVertexAttribArray(aShade);
  }

  renderFilledRegion(mvp, leaf, dim, lift) {
    const { x, y, z, w, h, d, fill } = leaf;
    const x0 = x, x1 = x + w;
    const y0 = y, y1 = y + h;
    const z0 = z, z1 = z + d;

    const pushFace = (posArr, uvArr, shadeArr, verts, uSpan, vSpan, shade) => {
      // Two triangles: (0,1,2) and (0,2,3)
      const idx = [0, 1, 2, 0, 2, 3];
      const uvs = [[0, vSpan], [uSpan, vSpan], [uSpan, 0], [0, 0]];
      for (const i of idx) {
        posArr.push(verts[i][0], verts[i][1], verts[i][2]);
        uvArr.push(uvs[i][0], uvs[i][1]);
        shadeArr.push(shade);
      }
    };

    const topBottomPos = [], topBottomUv = [], topBottomShade = [];
    const sidePos = [], sideUv = [], sideShade = [];

    // +Y (top: shade 1.0)
    pushFace(topBottomPos, topBottomUv, topBottomShade,
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], w, d, 1.0);
    // -Y (bottom: shade 0.58)
    pushFace(topBottomPos, topBottomUv, topBottomShade,
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], w, d, 0.58);

    // +Z (front: shade 0.86)
    pushFace(sidePos, sideUv, sideShade,
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], w, h, 0.86);
    // -Z (back: shade 0.86)
    pushFace(sidePos, sideUv, sideShade,
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], w, h, 0.86);
    // +X (right: shade 0.74)
    pushFace(sidePos, sideUv, sideShade,
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], d, h, 0.74);
    // -X (left: shade 0.74)
    pushFace(sidePos, sideUv, sideShade,
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], d, h, 0.74);

    if (fill === TEXTURE_TYPES.OAK_LOG) {
      this.drawTexturedBoxFace(mvp, this.glTextures.oak_log_top, topBottomPos, topBottomUv, topBottomShade, dim, lift);
      this.drawTexturedBoxFace(mvp, this.glTextures.oak_log_side, sidePos, sideUv, sideShade, dim, lift);
    } else {
      const tex = fill === TEXTURE_TYPES.COBBLESTONE
        ? this.glTextures.cobblestone
        : this.glTextures.oak_planks;
      this.drawTexturedBoxFace(
        mvp,
        tex,
        topBottomPos.concat(sidePos),
        topBottomUv.concat(sideUv),
        topBottomShade.concat(sideShade),
        dim,
        lift
      );
    }
  }

  isInsideHighlight(leaf, targetNode) {
    if (!targetNode) return false;
    return (
      leaf.x >= targetNode.x && leaf.x + leaf.w <= targetNode.x + targetNode.w &&
      leaf.y >= targetNode.y && leaf.y + leaf.h <= targetNode.y + targetNode.h &&
      leaf.z >= targetNode.z && leaf.z + leaf.d <= targetNode.z + targetNode.d
    );
  }

  render(rootRegion, hoverCut = null, hoverRegion = null) {
    this.lastRootRegion = rootRegion;
    this.lastHoverCut = hoverCut;
    this.lastHoverRegion = hoverRegion;

    const gl = this.gl;
    const { eye, mvp, w, h } = this.getMatrices();

    // Clean light viewport matching 2D slide backdrop
    gl.clearColor(0.973, 0.980, 0.988, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const activeHighlightId = this.codeHighlightId || this.lastHighlightNodeId;
    const highlightP = this.highlightProgress;
    const highlightNode = (highlightP > 0.005 && activeHighlightId !== null)
      ? rootRegion.findNodeById(activeHighlightId)
      : null;

    // 1. Subtle floor & back-wall integer reference grids (depending on camera side)
    const refGridLines = [];
    const S = GRID_SIZE_3D;
    const floorY = eye[1] >= 0 ? 0 : S;
    for (let i = 0; i <= S; i++) {
      refGridLines.push(i, floorY, 0, i, floorY, S);
      refGridLines.push(0, floorY, i, S, floorY, i);
    }
    gl.lineWidth(1);
    this.drawFlat(mvp, gl.LINES, refGridLines, [0.82, 0.86, 0.91, 0.85]);

    // 2. Opaque Minecraft Textured Filled Leaves
    const leaves = rootRegion.getAllLeaves();
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    for (const leaf of leaves) {
      if (!leaf.fill) continue;
      let dim = 0;
      let lift = 0;
      if (highlightNode) {
        if (this.isInsideHighlight(leaf, highlightNode)) {
          lift = 0.14 * highlightP;
        } else {
          dim = 0.62 * highlightP;
        }
      }
      this.renderFilledRegion(mvp, leaf, dim, lift);
    }
    gl.disable(gl.CULL_FACE);

    // 3. Glowing green outlines around filled regions (locked from slicing)
    const filledEdges = [];
    for (const leaf of leaves) {
      if (leaf.fill) {
        pushBoxWireEdges(filledEdges, leaf.x, leaf.y, leaf.z, leaf.w, leaf.h, leaf.d, -0.008);
      }
    }
    gl.lineWidth(2);
    this.drawFlat(mvp, gl.LINES, filledEdges, [0.133, 0.773, 0.369, 0.9]);

    // 4. Executed cut split lines & bounding box frame
    const outerEdges = [];
    pushBoxWireEdges(outerEdges, 0, 0, 0, S, S, S, 0);
    this.drawFlat(mvp, gl.LINES, outerEdges, [0.059, 0.090, 0.165, 0.88]);

    const cutEdges = [];
    for (const cut of rootRegion.getAllCuts()) {
      const { axis, coord, x, y, z, w: cw, h: ch, d: cd } = cut;
      if (axis === 'X') {
        cutEdges.push(coord, y, z, coord, y + ch, z);
        cutEdges.push(coord, y + ch, z, coord, y + ch, z + cd);
        cutEdges.push(coord, y + ch, z + cd, coord, y, z + cd);
        cutEdges.push(coord, y, z + cd, coord, y, z);
      } else if (axis === 'Y') {
        cutEdges.push(x, coord, z, x + cw, coord, z);
        cutEdges.push(x + cw, coord, z, x + cw, coord, z + cd);
        cutEdges.push(x + cw, coord, z + cd, x, coord, z + cd);
        cutEdges.push(x, coord, z + cd, x, coord, z);
      } else {
        cutEdges.push(x, y, coord, x + cw, y, coord);
        cutEdges.push(x + cw, y, coord, x + cw, y + ch, coord);
        cutEdges.push(x + cw, y + ch, coord, x, y + ch, coord);
        cutEdges.push(x, y + ch, coord, x, y, coord);
      }
    }
    this.drawFlat(mvp, gl.LINES, cutEdges, [0.118, 0.161, 0.231, 0.75]);

    // 5. Coordinate Axes along origin (0,0,0) -> +X (red), +Y (green), +Z (blue)
    const axisExtend = 0.65;
    this.drawFlat(mvp, gl.LINES, [0, 0, 0, S + axisExtend, 0, 0], [0.937, 0.267, 0.267, 0.95]);
    this.drawFlat(mvp, gl.LINES, [0, 0, 0, 0, S + axisExtend, 0], [0.086, 0.639, 0.290, 0.95]);
    this.drawFlat(mvp, gl.LINES, [0, 0, 0, 0, 0, S + axisExtend], [0.145, 0.388, 0.922, 0.95]);

    // 6. Translucent Passes (depth mask off so overlapping planes blend cleanly)
    gl.depthMask(false);

    // Subtle void region hint on hover or unfilled blocks when code-highlighted
    if (highlightNode) {
      // Dim non-highlighted void regions gently and highlight target node
      const dimVoidTris = [];
      for (const leaf of leaves) {
        if (!leaf.fill && !this.isInsideHighlight(leaf, highlightNode)) {
          pushSolidBoxTriangles(dimVoidTris, leaf.x, leaf.y, leaf.z, leaf.w, leaf.h, leaf.d, 0.02);
        }
      }
      this.drawFlat(mvp, gl.TRIANGLES, dimVoidTris, [0.06, 0.09, 0.16, 0.24 * highlightP]);

      const hlTris = [];
      pushSolidBoxTriangles(hlTris, highlightNode.x, highlightNode.y, highlightNode.z, highlightNode.w, highlightNode.h, highlightNode.d, 0.01);
      this.drawFlat(mvp, gl.TRIANGLES, hlTris, [0.220, 0.741, 0.973, 0.18 * highlightP]);

      const hlEdges = [];
      pushBoxWireEdges(hlEdges, highlightNode.x, highlightNode.y, highlightNode.z, highlightNode.w, highlightNode.h, highlightNode.d, -0.018);
      this.drawFlat(mvp, gl.LINES, hlEdges, [0.220, 0.741, 0.973, 0.98 * highlightP]);
    }

    // Move Mode hover region
    if (hoverRegion) {
      const hrTris = [];
      pushSolidBoxTriangles(hrTris, hoverRegion.x, hoverRegion.y, hoverRegion.z, hoverRegion.w, hoverRegion.h, hoverRegion.d, 0.015);
      this.drawFlat(mvp, gl.TRIANGLES, hrTris, [0.008, 0.518, 0.780, 0.22]);

      const hrEdges = [];
      pushBoxWireEdges(hrEdges, hoverRegion.x, hoverRegion.y, hoverRegion.z, hoverRegion.w, hoverRegion.h, hoverRegion.d, -0.012);
      this.drawFlat(mvp, gl.LINES, hrEdges, [0.008, 0.518, 0.780, 0.95]);
    }

    // Slice Mode hover cut plane + target region outline
    if (hoverCut) {
      const { axis, coord, region } = hoverCut;
      const col = AXIS_COLORS[axis];

      // Subtle outline around target region being sliced
      const regEdges = [];
      pushBoxWireEdges(regEdges, region.x, region.y, region.z, region.w, region.h, region.d, 0.01);
      this.drawFlat(mvp, gl.LINES, regEdges, [col.edge[0], col.edge[1], col.edge[2], 0.45]);

      const planeTris = [];
      const planeEdges = [];
      const rx0 = region.x, rx1 = region.x + region.w;
      const ry0 = region.y, ry1 = region.y + region.h;
      const rz0 = region.z, rz1 = region.z + region.d;

      if (axis === 'X') {
        planeTris.push(
          coord, ry0, rz0, coord, ry1, rz0, coord, ry1, rz1,
          coord, ry0, rz0, coord, ry1, rz1, coord, ry0, rz1
        );
        planeEdges.push(
          coord, ry0, rz0, coord, ry1, rz0,
          coord, ry1, rz0, coord, ry1, rz1,
          coord, ry1, rz1, coord, ry0, rz1,
          coord, ry0, rz1, coord, ry0, rz0
        );
      } else if (axis === 'Y') {
        planeTris.push(
          rx0, coord, rz0, rx1, coord, rz0, rx1, coord, rz1,
          rx0, coord, rz0, rx1, coord, rz1, rx0, coord, rz1
        );
        planeEdges.push(
          rx0, coord, rz0, rx1, coord, rz0,
          rx1, coord, rz0, rx1, coord, rz1,
          rx1, coord, rz1, rx0, coord, rz1,
          rx0, coord, rz1, rx0, coord, rz0
        );
      } else {
        planeTris.push(
          rx0, ry0, coord, rx1, ry0, coord, rx1, ry1, coord,
          rx0, ry0, coord, rx1, ry1, coord, rx0, ry1, coord
        );
        planeEdges.push(
          rx0, ry0, coord, rx1, ry0, coord,
          rx1, ry0, coord, rx1, ry1, coord,
          rx1, ry1, coord, rx0, ry1, coord,
          rx0, ry1, coord, rx0, ry0, coord
        );
      }

      this.drawFlat(mvp, gl.TRIANGLES, planeTris, col.fill);
      this.drawFlat(mvp, gl.LINES, planeEdges, col.edge);
    }

    gl.depthMask(true);

    // 7. 2D HUD Overlay: crisp X/Y/Z axis badges & live slice split measurement badge
    this.renderHud(mvp, w, h, hoverCut);
  }

  renderHud(mvp, w, h, hoverCut) {
    const ctx = this.hudCtx;
    ctx.clearRect(0, 0, w, h);

    const S = GRID_SIZE_3D;
    const axisExtend = 0.92;
    const labels = [
      { text: 'X', pos: [S + axisExtend, 0, 0], color: '#dc2626' },
      { text: 'Y', pos: [0, S + axisExtend, 0], color: '#16a34a' },
      { text: 'Z', pos: [0, 0, S + axisExtend], color: '#2563eb' }
    ];

    ctx.font = '700 11px "Nunito Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const lbl of labels) {
      const p = this.projectPoint(lbl.pos[0], lbl.pos[1], lbl.pos[2], mvp, w, h);
      if (!p) continue;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = lbl.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = lbl.color;
      ctx.fillText(lbl.text, p.x, p.y + 0.5);
    }

    if (hoverCut) {
      const { axis, coord, region } = hoverCut;
      const cx = axis === 'X' ? coord : region.x + region.w / 2;
      const cy = axis === 'Y' ? coord : region.y + region.h / 2;
      const cz = axis === 'Z' ? coord : region.z + region.d / 2;
      const s1 = axis === 'X' ? coord - region.x : axis === 'Y' ? coord - region.y : coord - region.z;
      const total = axis === 'X' ? region.w : axis === 'Y' ? region.h : region.d;
      const s2 = total - s1;
      const badgeText = `${axis}: [${s1}, ${s2}]`;

      const p = this.projectPoint(cx, cy, cz, mvp, w, h);
      if (p) {
        ctx.font = '700 11px "JetBrains Mono", monospace';
        const tw = ctx.measureText(badgeText).width + 14;
        const bx = Math.max(8, Math.min(w - tw - 8, p.x - tw / 2));
        const by = Math.max(8, Math.min(h - 32, p.y - 11));

        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.beginPath();
        ctx.roundRect(bx, by, tw, 22, 6);
        ctx.fill();

        ctx.strokeStyle = AXIS_COLORS[axis].hex;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(badgeText, bx + tw / 2, by + 11.5);
      }
    }
  }
}
