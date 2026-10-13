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
  const y = Math.min(info.height - 1, Math.floor((1 - wrap(hit.uv.y, m.wrapT)) * info.height));
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
  const p = resolve(x, y + .008, z, height);
  return Math.hypot(p.x - x, p.z - z) > .035 || Math.abs(p.y - y - .008) > .035;
};
api.move = function (e, dt, height) {
  if (!tree) return;
  const steps = Math.max(1, Math.ceil(Math.hypot(e.vel.x, e.vel.y, e.vel.z) * dt / .14));
  const step = dt / steps;
  for (let i = 0; i < steps; i++) {
    const p = e.pos, nx = p.x + e.vel.x * step, nz = p.z + e.vel.z * step;
    let y = p.y;
    if (e.onGround && e.vel.y <= 0) {
      const floor = api.floor(nx, nz, p.y + .46, .75);
      if (floor !== null && floor >= p.y - .26 && !api.blocked(nx, floor + .005, nz, height)) y = floor + .005;
    }
    let horizontal = resolve(nx, y, nz, height);
    if (e.onGround && Math.hypot(horizontal.x - nx, horizontal.z - nz) > .005) {
      const raised = resolve(nx, p.y + .42, nz, height);
      if (Math.hypot(raised.x - nx, raised.z - nz) < .005 && Math.abs(raised.y - p.y - .42) < .01) {
        horizontal = raised; e.onGround = false;
      }
    }
    p.x = horizontal.x; p.y = horizontal.y; p.z = horizontal.z;
    e.vel.y -= 20 * step;
    const ny = p.y + e.vel.y * step;
    const vertical = resolve(p.x, ny, p.z, height);
    if (Math.abs(vertical.y - ny) > .001) e.vel.y = 0;
    Object.assign(p, vertical);
    const floor = api.floor(p.x, p.z, p.y + .08, .16);
    e.onGround = e.vel.y <= 0 && floor !== null && Math.abs(p.y - floor) < .085;
    if (e.onGround) { p.y = floor + .003; e.vel.y = 0; }
    if (p.y < -30) { const n = api.nearest(p.x, p.z); Object.assign(p, { x: n.x, y: n.y + .1, z: n.z }); e.vel.y = 0; }
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
api.path = function (x, z, tx, tz, y, ty) {
  const start = byId.get(api.nearest(x, z, y).id), end = byId.get(api.nearest(tx, tz, ty).id);
  const cost = new Float64Array(nodes.length).fill(Infinity), previous = new Int32Array(nodes.length).fill(-1);
  const closed = new Uint8Array(nodes.length), open = new Set([start]); cost[start] = 0;
  const target = nodes[end];
  while (open.size) {
    let current = -1, best = Infinity;
    for (const i of open) { const n = nodes[i], f = cost[i] + Math.hypot(n.x - target.x, n.z - target.z); if (f < best) { best = f; current = i; } }
    open.delete(current);
    if (current === end) {
      const path = []; for (let i = end; i !== -1; i = previous[i]) path.push({ x: nodes[i].x, y: nodes[i].y, z: nodes[i].z });
      path.reverse();
      return path;
    }
    closed[current] = 1;
    const n = nodes[current];
    for (const id of n.neighbors) {
      const i = byId.get(id); if (i === undefined || closed[i]) continue;
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
  api.init(require('./dust2-mesh').geometry(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), meta, opacity));
  module.exports = api;
} else root.Dust2World = api;
})(typeof window !== 'undefined' ? window : globalThis);
