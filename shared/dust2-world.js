// The same triangle world runs on the server and in browser prediction.
(function (root) {
'use strict';
const node = typeof module !== 'undefined' && module.exports;
const THREE = node ? require('three') : root.THREE;
const { MeshBVH } = node ? require('three-mesh-bvh') : root.MeshBVHLib;
const data = node ? require('./dust2-data') : root.Dust2Data;
let tree = null, mapMeta = null, alpha = null, surfaceIds = null;
const ray = new THREE.Ray(), box = new THREE.Box3(), segment = new THREE.Line3();
const onTriangle = new THREE.Vector3(), onSegment = new THREE.Vector3(), normal = new THREE.Vector3();
const nodes = data.nav, byId = new Map(nodes.map((n, i) => [n.id, i]));
const api = { data, ready: false };
api.init = function (geometry) {
  const collision = new THREE.BufferGeometry();
  collision.setAttribute('position', geometry.attributes.position);
  collision.setAttribute('uv', geometry.attributes.uv);
  collision.setIndex(geometry.index.clone());
  mapMeta = geometry.userData.dust2.meta; alpha = geometry.userData.dust2.opacity;
  surfaceIds = geometry.attributes.surface;
  tree = new MeshBVH(collision, { maxLeafTris: 10 });
  api.ready = true;
};
function materialAt(triangleIndex) {
  return mapMeta.materials[surfaceIds.getX(tree.geometry.index.getX(triangleIndex * 3))];
}
function visibleHit(hit, solidOnly) {
  const m = materialAt(hit.faceIndex);
  if (!m.visible || m.overlay || (solidOnly && !m.collidable)) return false;
  if (m.mask < 0 || !alpha || !hit.uv) return true;
  const info = mapMeta.opacity.tiles[m.mask];
  const wrap = (n, mode) => mode === 33071 ? Math.min(1, Math.max(0, n)) : mode === 33648 ? 1 - Math.abs(((n % 2) + 2) % 2 - 1) : n - Math.floor(n);
  const x = Math.min(info.width - 1, Math.floor(wrap(hit.uv.x, m.wrapS) * info.width));
  const y = Math.min(info.height - 1, Math.floor(wrap(hit.uv.y, m.wrapT) * info.height));
  return alpha[info.offset + y * info.width + x] / 255 >= m.cutoff;
}
api.raycast = function (origin, direction, distance, solidOnly = false) {
  if (!tree) return null;
  ray.origin.fromArray(origin); ray.direction.fromArray(direction);
  let hit = tree.raycastFirst(ray, THREE.DoubleSide);
  if (!hit || hit.distance > distance) return null;
  if (!visibleHit(hit, solidOnly)) hit = tree.raycast(ray, THREE.DoubleSide).filter(h => h.distance <= distance && visibleHit(h, solidOnly)).sort((a,b) => a.distance-b.distance)[0];
  if (!hit) return null;
  const n = hit.face.normal, components = [n.x, n.y, n.z];
  let axis = 0; for (let i = 1; i < 3; i++) if (Math.abs(components[i]) > Math.abs(components[axis])) axis = i;
  return { t: hit.distance, axis, sign: components[axis] >= 0 ? 1 : -1, normal: n, point: hit.point };
};
api.floor = function (x, z, top = 20, depth = 60) {
  const hit = api.raycast([x, top, z], [0, -1, 0], depth, true);
  return hit && Math.abs(hit.normal.y) > .5 ? hit.point.y : null;
};
function resolve(x, y, z, height, radius = .34) {
  segment.start.set(x, y + radius, z); segment.end.set(x, y + height - radius, z);
  for (let pass = 0; pass < 3; pass++) {
    box.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(radius);
    let touched = false;
    tree.shapecast({
      intersectsBounds: b => b.intersectsBox(box),
      intersectsTriangle: (triangle, index) => {
        if (!materialAt(index).collidable) return false;
        const distance = triangle.closestPointToSegment(segment, onTriangle, onSegment);
        if (distance >= radius - .0001) return false;
        normal.subVectors(onSegment, onTriangle);
        if (distance < 1e-8) triangle.getNormal(normal); else normal.multiplyScalar(1 / distance);
        normal.multiplyScalar(radius - distance + .0001);
        segment.start.add(normal); segment.end.add(normal); touched = true;
        return false;
      },
    });
    if (!touched) break;
  }
  return { x: segment.start.x, y: segment.start.y - radius, z: segment.start.z };
}
api.blocked = function (x, y, z, height) {
  if (!tree) return false;
  segment.start.set(x, y + .34, z); segment.end.set(x, y + height - .34, z);
  box.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(.34);
  return tree.shapecast({
    intersectsBounds: bounds => bounds.intersectsBox(box),
    intersectsTriangle: (triangle, index) => materialAt(index).collidable && triangle.closestPointToSegment(segment, onTriangle, onSegment) < .338,
  });
};
const RADIUS = .34, STEP_HEIGHT = .45, GROUND_SNAP = .3, SKIN = .001;
const supportBox = new THREE.Box3(), supportNormal = new THREE.Vector3(), supportCenter = new THREE.Vector3(), supportPoint = new THREE.Vector3();
// Find the height of the capsule's bottom sphere, including triangle edges.
// A ray under its centre is lower than the sphere's actual support on a slope.
api.support = function (x, z, feet, up = STEP_HEIGHT, down = GROUND_SNAP) {
  if (!tree) return null;
  const low = feet - down, high = feet + up;
  supportBox.min.set(x - RADIUS, low - RADIUS, z - RADIUS);
  supportBox.max.set(x + RADIUS, high + RADIUS, z + RADIUS);
  let best = null;
  const accept = height => { if (height >= low - SKIN && height <= high + SKIN && (best === null || height > best)) best = height; };
  tree.shapecast({
    intersectsBounds: bounds => bounds.intersectsBox(supportBox),
    intersectsTriangle: (triangle, index) => {
      if (!materialAt(index).collidable) return false;
      triangle.getNormal(supportNormal);
      if (supportNormal.y < 0) supportNormal.negate();
      if (supportNormal.y < .7) return false;
      const n = supportNormal, d = n.dot(triangle.a);
      const height = (d - n.x * x - n.z * z + RADIUS) / n.y - RADIUS;
      if (height >= low - SKIN && height <= high + SKIN) {
        supportCenter.set(x, height + RADIUS, z);
        triangle.closestPointToPoint(supportCenter, supportPoint);
        if (supportCenter.distanceToSquared(supportPoint) <= RADIUS * RADIUS + 1e-7) accept(height);
      }
      for (const [a, b] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
        const ex = b.x - a.x, ez = b.z - a.z, ey = b.y - a.y, length2 = ex * ex + ez * ez;
        if (length2 < 1e-12) continue;
        const dx = a.x - x, dz = a.z - z, centre = -(dx * ex + dz * ez) / length2;
        const closest2 = dx * dx + dz * dz - centre * centre * length2, remaining = RADIUS * RADIUS - closest2;
        if (remaining < 0) continue;
        const t = Math.max(0, Math.min(1, centre + ey * Math.sqrt(remaining / (length2 * (length2 + ey * ey)))));
        const qx = dx + t * ex, qz = dz + t * ez, vertical2 = RADIUS * RADIUS - qx * qx - qz * qz;
        if (vertical2 >= 0) accept(a.y + t * ey + Math.sqrt(vertical2) - RADIUS);
      }
      return false;
    },
  });
  return best === null ? null : best + SKIN;
};
api.move = function (e, dt, height) {
  if (!tree || dt <= 0) return;
  const steps = Math.max(1, Math.ceil(dt * 60), Math.ceil(Math.hypot(e.vel.x, e.vel.y, e.vel.z) * dt / .1));
  const step = dt / steps;
  for (let i = 0; i < steps; i++) {
    const p = e.pos, nx = p.x + e.vel.x * step, nz = p.z + e.vel.z * step;
    const grounded = e.onGround && e.vel.y <= 0;
    if (grounded) {
      const support = api.support(nx, nz, p.y);
      if (support !== null && !api.blocked(nx, support, nz, height)) {
        p.x = nx; p.y = support; p.z = nz; e.vel.y = 0; e.onGround = true;
        continue;
      }
    }
    const horizontal = resolve(nx, p.y, nz, height);
    const blockedX = nx - horizontal.x, blockedZ = nz - horizontal.z, blocked2 = blockedX * blockedX + blockedZ * blockedZ;
    if (blocked2 > 1e-8) {
      const into = (e.vel.x * blockedX + e.vel.z * blockedZ) / blocked2;
      if (into > 0) { e.vel.x -= blockedX * into; e.vel.z -= blockedZ * into; }
    }
    p.x = horizontal.x; p.y = horizontal.y; p.z = horizontal.z;
    if (grounded) {
      const support = api.support(p.x, p.z, p.y, .08, GROUND_SNAP);
      if (support !== null && !api.blocked(p.x, support, p.z, height)) {
        p.y = support; e.vel.y = 0; e.onGround = true; continue;
      }
    }
    e.onGround = false; e.vel.y -= 20 * step;
    const ny = p.y + e.vel.y * step, falling = e.vel.y < 0;
    const vertical = resolve(p.x, ny, p.z, height);
    const touched = Math.abs(vertical.y - ny) > .0001;
    Object.assign(p, vertical);
    if (touched) {
      if (falling) {
        const support = api.support(p.x, p.z, p.y, .04, .04);
        if (support !== null && !api.blocked(p.x, support, p.z, height)) { p.y = support; e.onGround = true; }
      }
      e.vel.y = 0;
    }
  }
};
api.nearest = function (x, z, y) {
  let best = nodes[0], score = Infinity;
  for (const n of nodes) {
    const d = (x - n.x) ** 2 + (z - n.z) ** 2 + (y === undefined ? 0 : 4 * (y - n.y) ** 2);
    if (d < score) { best = n; score = d; }
  }
  return best;
};
// Probe the same capsule and support surfaces as movement before skipping nav corners.
api.canWalk = function (from, to, height = 1.8) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / .1));
  let feet = from.y;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * i / steps, z = from.z + (to.z - from.z) * i / steps;
    const support = api.support(x, z, feet, .45, .3);
    if (support === null || api.blocked(x, support, z, height)) return false;
    feet = support;
  }
  return to.y === undefined || Math.abs(feet - to.y) < .65;
};
api.path = function (x, z, tx, tz, y, ty, options = {}) {
  function anchor(px, pz, py) {
    if (!options.reachableAnchors || py === undefined) return api.nearest(px, pz, py);
    const point = { x:px, y:py, z:pz };
    const candidates = nodes.map(n=>({n,d:(n.x-px)**2+(n.z-pz)**2+4*(n.y-py)**2})).sort((a,b)=>a.d-b.d).slice(0,12);
    return candidates.find(({n})=>api.canWalk(point,n))?.n || api.nearest(px,pz,py);
  }
  const first=anchor(x,z,y),last=api.nearest(tx,tz,ty);
  if (!first || !last) return null;
  const start = byId.get(first.id), end = byId.get(last.id);
  const cost = new Float64Array(nodes.length).fill(Infinity), previous = new Int32Array(nodes.length).fill(-1);
  const closed = new Uint8Array(nodes.length), open = new Set([start]); cost[start] = 0;
  const target = nodes[end];
  while (open.size) {
    let current = -1, best = Infinity;
    for (const i of open) { const n = nodes[i], f = cost[i] + Math.hypot(n.x - target.x, n.z - target.z); if (f < best) { best = f; current = i; } }
    open.delete(current);
    if (current === end) {
      const path = []; for (let i = end; i !== -1; i = previous[i]) path.push({ id: nodes[i].id, x: nodes[i].x, y: nodes[i].y, z: nodes[i].z });
      path.reverse();
      return path;
    }
    closed[current] = 1;
    const n = nodes[current];
    for (const id of n.neighbors) {
      const i = byId.get(id); if (i === undefined || closed[i]) continue;
      if (options.avoid && options.avoid.has(n.id + ':' + id)) continue;
      const next = nodes[i], rise = next.y - n.y;
      // The original navigation includes crate jumps as well as walking links.
      if (rise > 1.35) continue;
      const nextCost = cost[current] + Math.hypot(next.x - n.x, next.z - n.z, rise) + (rise > .45 ? 2 : 0);
      if (nextCost < cost[i]) { cost[i] = nextCost; previous[i] = current; open.add(i); }
    }
  }
  return null;
};
if (node) {
  const fs = require('node:fs'), path = require('node:path');
  const bytes = require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname, '../public/maps/dust2.mesh.gz')));
  const meta = require('../public/maps/dust2.json');
  const opacity = require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname, '../public/maps/dust2-opacity.gz')));
  api.init(require('./dust2-mesh').geometry(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), meta, opacity, true));
  module.exports = api;
} else root.Dust2World = api;
})(typeof window !== 'undefined' ? window : globalThis);
