"""Static props of a CS:GO map for import_full_map.py.

Each prop's LOD0 meshes (MDL/VVD/VTX, as public/studio.h and public/optimize.h lay them out) are placed in world space
with the per-vertex lighting VRAD baked for it (sp_hdr_<prop>.vhv in the map pak) and batched by material, so the browser
draws them like the world. Collision comes from the model's PHY: its IVP compact ledges (convex hulls) become triangles,
converted from IVP metres to Source units as vphysics' ConvertPositionToHL does; SOLID_BBOX props use their hull box.
"""
import collections, gzip, hashlib, math, struct
import numpy as np

SPRP = 0x73707270
METERS_TO_INCHES = 1 / 0.0254
SOLID_BBOX, SOLID_VPHYSICS = 2, 6
FLAG_NO_DRAW = 0x4


def i32(d, o): return struct.unpack_from('<i', d, o)[0]
def cstr(d, o): return d[o:d.index(b'\0', o)].decode('latin1')


def read_static_props(bsp):
    """The sprp game lump: model names, the leaf list, and every prop's placement (version 10/11 records)."""
    lump = bsp.lump(35)
    for k in range(i32(lump, 0)):
        gid, _flags, version, offset, length = struct.unpack_from('<iHHii', lump, 4 + k * 16)
        if gid != SPRP: continue
        blob = bsp.data[offset:offset + length]
        if blob[:4] == b'LZMA': raise ValueError('Compressed static prop lump unsupported')
        n = i32(blob, 0); names = [blob[4 + i * 128:4 + (i + 1) * 128].split(b'\0')[0].decode().lower() for i in range(n)]
        o = 4 + n * 128; leaf_count = i32(blob, o); leaves = struct.unpack_from(f'<{leaf_count}H', blob, o + 4); o += 4 + leaf_count * 2
        count = i32(blob, o); o += 4; size = (len(blob) - o) // count if count else 0
        props = []
        for i in range(count):
            r = o + i * size
            origin = struct.unpack_from('<3f', blob, r); angles = struct.unpack_from('<3f', blob, r + 12)
            model, first_leaf, leafs = struct.unpack_from('<3H', blob, r + 24)
            solid, flags = blob[r + 30], blob[r + 31]; skin = i32(blob, r + 32)
            scale = struct.unpack_from('<f', blob, r + 76)[0] if version >= 11 and size >= 80 else 1.0
            props.append({'index': i, 'model': names[model], 'origin': origin, 'angles': angles, 'solid': solid, 'flags': flags, 'skin': skin,
                          'scale': scale or 1.0, 'leaves': leaves[first_leaf:first_leaf + leafs]})
        return props
    return []


class PropModel:
    def __init__(self, read, path):
        d = read(path)
        if d is None or d[:4] != b'IDST': raise ValueError(f'{path}: missing or not a model')
        base = path[:-4]
        self.d = d; self.vvd = read(base + '.vvd') or b''; self.vtx = read(base + '.dx90.vtx') or b''; self.phy = read(base + '.phy')
        self.hull = (struct.unpack_from('<3f', d, 104), struct.unpack_from('<3f', d, 116))
        self.names = [cstr(d, i32(d, 208) + k * 64 + i32(d, i32(d, 208) + k * 64)) for k in range(i32(d, 204))]
        self.dirs = [cstr(d, i32(d, i32(d, 216) + k * 4)).replace('\\', '/') for k in range(i32(d, 212))]
        refs, families = i32(d, 220), i32(d, 224)
        table = struct.unpack_from(f'<{refs * families}h', d, i32(d, 228))
        self.skins = [table[f * refs:(f + 1) * refs] for f in range(families)]

    def lods(self):
        """VTX LOD switch distances (body part 0, model 0)."""
        vtx = self.vtx
        if not vtx or i32(vtx, 0) != 7: return [0.0]
        model = i32(vtx, 32) + i32(vtx, i32(vtx, 32) + 4); count, offset = i32(vtx, model), model + i32(vtx, model + 4)
        return [struct.unpack_from('<f', vtx, offset + k * 12 + 8)[0] for k in range(count)]

    def meshes(self, level=0):
        """Meshes of model 0 in every body part at VTX LOD `level`, vertices in strip-group order (the order VRAD's .vhv
        lighting uses; every LOD indexes the full LOD0 vertex pool). `color_mesh` is the mesh's position among that LOD's
        lighting meshes (all models of every body part)."""
        d, vvd, vtx = self.d, self.vvd, self.vtx
        if vvd[:4] != b'IDSV' or not vtx or i32(vtx, 0) != 7: return []
        fixups, fixstart, vstart = i32(vvd, 48), i32(vvd, 52), i32(vvd, 56)
        raw = list(range(i32(vvd, 16)))
        if fixups:
            raw = []
            for k in range(fixups):
                lod, src, n = struct.unpack_from('<iii', vvd, fixstart + k * 12)
                if lod >= 0: raw += range(src, src + n)
        out = []; color_mesh = 0
        for part in range(i32(d, 232)):
            bp = i32(d, 236) + part * 16
            nmodels = i32(d, bp + 4)
            vtxpart = i32(vtx, 32) + part * 8; vtxmodel0 = vtxpart + i32(vtx, vtxpart + 4)
            for model_index in range(nmodels):
                model = bp + i32(d, bp + 12) + model_index * 148
                nmesh, meshoff = i32(d, model + 72), model + i32(d, model + 76)
                stride = next((s for s in (116, 108) if nmesh < 2 or meshoff + s + i32(d, meshoff + s + 4) == model), 116)
                if model_index:
                    color_mesh += nmesh; continue
                vbase = i32(d, model + 84) // 48
                lod = vtxmodel0 + i32(vtx, vtxmodel0 + 4) + min(level, i32(vtx, vtxmodel0) - 1) * 12
                vmesh = lod + i32(vtx, lod + 4)
                for m in range(nmesh):
                    mo = meshoff + m * stride
                    material, voff, lod_vertices = i32(d, mo), i32(d, mo + 12), i32(d, mo + 52)
                    vm = vmesh + m * 9; groups, goff = i32(vtx, vm), vm + i32(vtx, vm + 4)
                    def valid(sg):
                        nv, vo, ni, io = struct.unpack_from('<iiii', vtx, sg)
                        return nv > 0 and ni > 0 and ni % 3 == 0 and 0 < sg + vo < len(vtx) and 0 < sg + io + ni * 2 <= len(vtx)
                    size = 25 if groups < 2 or valid(goff + 25) and not valid(goff + 33) else 33
                    positions, uvs, ids, indices = [], [], [], []
                    for g in range(groups):
                        sg = goff + g * size
                        nverts, voffs, nidx, ioffs = struct.unpack_from('<iiii', vtx, sg)
                        start = len(ids)
                        for k in range(nverts):
                            orig = struct.unpack_from('<H', vtx, sg + voffs + k * 9 + 4)[0]
                            r = vstart + raw[vbase + voff + orig] * 48
                            positions.append(struct.unpack_from('<3f', vvd, r + 16)); uvs.append(struct.unpack_from('<2f', vvd, r + 40)); ids.append(orig)
                        indices += [start + v for v in struct.unpack_from(f'<{nidx}H', vtx, sg + ioffs)]
                    out.append({'material': material, 'positions': positions, 'uvs': uvs, 'ids': ids, 'indices': indices,
                                'color_mesh': color_mesh, 'lod_vertices': lod_vertices, 'level': min(level, i32(vtx, vtxmodel0) - 1)})
                    color_mesh += 1
        return out

    def hulls(self):
        """Convex hull triangles (model space, Source units) from the PHY's IVP compact ledges."""
        phy = self.phy
        if not phy: return []
        header, _id, solids, _checksum = struct.unpack_from('<4i', phy, 0)
        o = header; triangles = []
        for _ in range(solids):
            size = i32(phy, o); start = o + 4
            surface = start + 28 if phy[start:start + 4] == b'VPHY' else start
            ledges = []
            def walk(node, depth=0):
                if depth > 64: return
                right, ledge = struct.unpack_from('<ii', phy, node)
                if right == 0: ledges.append(node + ledge); return
                walk(node + 28, depth + 1); walk(node + right, depth + 1)
            walk(surface + i32(phy, surface + 32))
            for ledge in ledges:
                points_at = ledge + i32(phy, ledge); count = struct.unpack_from('<h', phy, ledge + 12)[0]
                for t in range(count):
                    tri = ledge + 16 + t * 16
                    corners = []
                    for e in range(3):
                        index = struct.unpack_from('<I', phy, tri + 4 + e * 4)[0] & 0xffff
                        x, y, z = struct.unpack_from('<3f', phy, points_at + index * 16)
                        corners.append((x * METERS_TO_INCHES, z * METERS_TO_INCHES, -y * METERS_TO_INCHES))
                    triangles.append(corners)
            o = start + size
        return triangles

    def box(self):
        lo, hi = self.hull; c = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        return [[c[f[0]], c[f[i]], c[f[i + 1]]] for f in faces for i in (1, 2)]


def vertex_colors(vhv, mesh):  # noqa: E302
    """A mesh's baked lighting from the .vhv: RGB per hardware vertex, in the VTX strip-group order VRAD lit them
    (averaging the three bump-basis colours when the file stores them), or None when the file does not match the mesh."""
    if not vhv or i32(vhv, 0) != 2: return None
    vertex_size, meshes = struct.unpack_from('<I', vhv, 12)[0], i32(vhv, 20)
    lod0 = [struct.unpack_from('<3I', vhv, 40 + k * 28) for k in range(meshes)]
    lod0 = [m for m in lod0 if m[0] == mesh['level']]
    if mesh['color_mesh'] >= len(lod0): return None
    _lod, count, offset = lod0[mesh['color_mesh']]
    if count != len(mesh['ids']) or vertex_size not in (4, 12): return None
    data = np.frombuffer(vhv, np.uint8, count * vertex_size, offset).reshape(count, vertex_size // 4, 4)[:, :, :3].astype(np.float32)
    return data.mean(axis=1)


def import_props(read, bsp, rotation, in_sky, ambient_at, save_texture, material_info, output):
    """props.bin.gz: each model's LOD0 geometry once in model space (positions as int16 over the model's bounds, uvs as
    float16) and u16 indices local to each mesh; prop-colors.bin.gz: every instance's baked colours (u8 RGB per vertex,
    meshes in model order). map.json gets the
    models, materials and instances (model, 3x4 transform, colour offset). Also returns collision triangles."""
    props = read_static_props(bsp)
    loaded = {}; missing = collections.Counter(); materials = []; material_index = {}
    models = []; model_index = {}; instances = []; collision = []; skipped_sky = unlit = 0
    positions, uvs, indices, colors = [], [], [], []
    vertex_total = index_total = color_total = 0

    def material_for(model, skin, mesh):
        texture = model.names[skin[mesh['material']]] if mesh['material'] < len(skin) else None
        vmt = next((f'{d}{texture}'.lower() for d in model.dirs if texture and read(f'materials/{d}{texture}.vmt'.lower())), None)
        if vmt is None: return None
        if vmt not in material_index:
            _shader, params = material_info(read, vmt)
            entry = {'name': vmt, 'alpha': params.get('$alphatest') == '1' or params.get('$translucent') == '1'}
            if params.get('$basetexture'):
                path = 'materials/' + params['$basetexture'].replace('\\', '/').lower() + '.vtf'
                texture_file = save_texture(read, path, output, 'prop#' + vmt, size=256, alpha=entry['alpha'])
                if texture_file: entry['texture'] = texture_file
            material_index[vmt] = len(materials); materials.append(entry)
        return material_index[vmt]

    for prop in props:
        if prop['leaves'] and in_sky(prop['leaves']): skipped_sky += 1; continue
        name = prop['model']
        if name not in loaded:
            try:
                model = PropModel(read, name); loaded[name] = (model, model.meshes())
            except Exception as error: loaded[name] = None; missing[str(error)[:60]] += 1
        if loaded[name] is None: continue
        model, meshes = loaded[name]
        rot = rotation(prop['angles']) * prop['scale']; origin = np.array(prop['origin'])
        place = lambda points: (np.asarray(points, np.float64) @ rot.T + origin)
        if prop['solid'] == SOLID_VPHYSICS: collision += [place(t).ravel().tolist() for t in model.hulls()]
        elif prop['solid'] == SOLID_BBOX: collision += [place(t).ravel().tolist() for t in model.box()]
        if prop['flags'] & FLAG_NO_DRAW or not meshes: continue
        skin = model.skins[prop['skin']] if prop['skin'] < len(model.skins) else model.skins[0]
        key = (name, tuple(skin))
        if key not in model_index:
            parts = []
            for mesh in meshes:
                material = material_for(model, skin, mesh)
                if material is None: missing['material'] += 1; continue
                parts.append({'material': material, 'vertexStart': vertex_total, 'vertexCount': len(mesh['positions']),
                              'indexStart': index_total, 'indexCount': len(mesh['indices']), 'mesh': meshes.index(mesh)})
                positions.append(np.asarray(mesh['positions'], np.float32).ravel()); uvs.append(np.asarray([(u, -v) for u, v in mesh['uvs']], np.float32).ravel())
                if len(mesh['positions']) > 65535: raise ValueError(f'{name}: mesh too large for 16-bit indices')
                indices.append(np.asarray(mesh['indices'], np.uint16)); vertex_total += len(mesh['positions']); index_total += len(mesh['indices'])
            if parts:
                block = np.concatenate(positions[-len(parts):]).reshape(-1, 3); lo = block.min(axis=0); span = np.maximum(block.max(axis=0) - lo, 1e-3)
                for k in range(len(parts)):
                    positions[-len(parts) + k] = np.round((positions[-len(parts) + k].reshape(-1, 3) - lo) / span * 65535 - 32768).astype(np.int16).ravel()
                bounds = {'offset': [round(float(v), 4) for v in lo + span / 2], 'scale': [float(v) / 65535 for v in span]}
            else: bounds = {}
            model_index[key] = len(models); models.append({'name': name, 'meshes': parts, **bounds})
        entry = models[model_index[key]]
        if not entry['meshes']: continue
        vhv = read(f'sp_hdr_{prop["index"]}.vhv') or read(f'sp_{prop["index"]}.vhv')
        instance_colors = []
        for part in entry['meshes']:
            mesh = meshes[part['mesh']]; baked = vertex_colors(vhv, mesh)
            if baked is None:
                unlit += 1; baked = np.tile(ambient_at(prop['origin']), (len(mesh['ids']), 1))
            instance_colors.append(np.clip(baked, 0, 255).round().astype(np.uint8).ravel())
        block = np.concatenate(instance_colors); colors.append(block)
        instances.append({'model': model_index[key], 'matrix': [round(float(v), 5) for row in np.c_[rot, origin] for v in row], 'colorStart': color_total})
        color_total += len(block) // 3
    for model in models:
        for part in model['meshes']: del part['mesh']
    blob = b''.join(a.astype(np.int16).tobytes() for a in positions) + bytes((-vertex_total * 6) % 4)
    blob += b''.join(a.astype(np.float16).tobytes() for a in uvs) + b''.join(a.tobytes() for a in indices)
    (output / 'props.bin.gz').write_bytes(gzip.compress(blob, compresslevel=9, mtime=0))
    (output / 'prop-colors.bin.gz').write_bytes(gzip.compress(b''.join(a.tobytes() for a in colors), compresslevel=9, mtime=0))
    print(f'props: {len(instances)} drawn of {len(props)} ({skipped_sky} in the 3D skybox), {len(models)} models with {vertex_total} vertices and '
          f'{index_total // 3} triangles, {color_total} instance vertices, {unlit} meshes without baked lighting; '
          f'collision triangles {len(collision)}; problems {dict(missing)}')
    return {'file': 'props.bin.gz', 'colorFile': 'prop-colors.bin.gz', 'vertices': vertex_total, 'indices': index_total, 'colors': color_total, 'materials': materials,
            'models': models, 'instances': instances}, collision
