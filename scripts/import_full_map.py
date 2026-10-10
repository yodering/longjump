#!/usr/bin/env python3
"""Import a whole CS:GO map (de_mirage, de_nuke) as walkable browser geometry, collision and baked lighting.

Usage: python import_full_map.py file.bsp public/maps/<id> --vpk path/to/csgo/pak01_dir.vpk
Requires Pillow, numpy and vpk. Layouts: ValveSoftware/source-sdk-2013 src/public/bspfile.h; displacement surfaces
follow CCoreDispInfo::GenerateDispSurf and its triangulation; brush collision keeps vbsp's bevel planes so the browser
can clip the player's box against each brush as CM_ClipBoxToBrush does.

Outputs, beside map.json: world.bin.gz (indexed world and displacement geometry), collision.bin.gz (see src/collision.ts),
props.bin.gz (see static_props.py), lightmap.webp, textures/, sky/, lighting.bin. The 3D skybox area is left out.
Binaries are gzipped (static hosts rarely compress octet streams); the browser and the server inflate them.
"""
import argparse, collections, gzip, hashlib, io, json, math, pathlib, re, struct, sys, zipfile
import numpy as np
from PIL import Image
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from import_source_map import decode_vtf, export_sky, project_decals, vec  # noqa: E402
import static_props  # noqa: E402

PLAYER_SOLID = 0x1 | 0x2 | 0x8 | 0x10000  # CONTENTS_SOLID | WINDOW | GRATE | PLAYERCLIP
SURF_SKIP_DRAW = 0x2 | 0x4 | 0x40 | 0x80 | 0x100 | 0x200  # sky2d, sky, trigger, nodraw, hint, skip
SURF_BUMPLIGHT = 0x800
DISPTRI_TAG_REMOVE = 1 << 5
NOT_SOLID_CLASSES = ('trigger_', 'func_illusionary', 'func_buyzone', 'func_bomb_target', 'func_clip_vphysics', 'func_areaportal',
                     'func_occluder', 'func_precipitation', 'func_dustmotes', 'func_dustcloud', 'func_smokevolume', 'env_')
HIDDEN_CLASSES = ('trigger_', 'func_buyzone', 'func_bomb_target', 'func_clip_vphysics', 'func_areaportal', 'func_occluder',
                  'func_precipitation', 'func_dustmotes', 'func_dustcloud', 'func_smokevolume', 'func_hostage_rescue')


def rotation(angles):
    """Source AngleMatrix (pitch, yaw, roll in degrees) as rows of the local->world rotation."""
    p, y, r = (math.radians(a) for a in angles)
    sp, cp, sy, cy, sr, cr = math.sin(p), math.cos(p), math.sin(y), math.cos(y), math.sin(r), math.cos(r)
    return np.array([[cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
                     [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
                     [-sp, sr * cp, cr * cp]])


class Bsp:
    def __init__(self, path):
        self.data = data = path.read_bytes()
        if data[:4] != b'VBSP' or struct.unpack_from('<i', data, 4)[0] != 21: raise ValueError('Expected Source BSP v21')
        self.lumps = [struct.unpack_from('<4i', data, 8 + i * 16) for i in range(64)]

    def lump(self, i):
        offset, length, _, uncompressed = self.lumps[i]
        raw = self.data[offset:offset + length]
        if uncompressed and raw[:4] == b'LZMA': raise ValueError(f'LZMA lump {i} unsupported')
        return raw

    def records(self, i, fmt): return list(struct.iter_unpack(fmt, self.lump(i)))


def material_info(read, name):
    """Shader and texture parameters of a VMT, following `patch` includes."""
    def parse(path, depth=0):
        raw = read(path)
        if raw is None: return None, {}
        text = raw.decode('latin1'); shader = text.strip().split()[0].strip('"').lower(); params = {}
        for m in re.finditer(r'"?(\$[A-Za-z0-9_]+)"?\s+"?([^"\n{}]*?)"?\s*(?://[^\n]*)?\n', text): params[m[1].lower()] = m[2].strip()
        if shader == 'patch':
            include = re.search(r'"?include"?\s+"?([^"\s]+)"?', text, re.I)
            if include and depth < 4:
                base_shader, base = parse(include[1].replace('\\', '/').lower(), depth + 1)
                base.update(params); return base_shader, base
        return shader, params
    return parse(f'materials/{name}.vmt')


def save_texture(read, path, output, key, size=512, alpha=False, normal=False):
    """A VTF's largest mip as lossy WebP. Base-texture alpha is usually a specular or blend mask, so it is kept only for
    alpha-tested and translucent materials."""
    data = read(path)
    if data is None: return None
    try: image = decode_vtf(data)
    except ValueError: return None
    image = image.convert('RGBA' if alpha else 'RGB'); image.thumbnail((size, size))
    if alpha and image.getextrema()[3][0] == 255: image = image.convert('RGB')
    filename = hashlib.sha1(key.encode()).hexdigest()[:12] + '.webp'
    image.save(output / 'textures' / filename, quality=92 if normal else 85, method=4, alpha_quality=90)
    return 'textures/' + filename


def convert(source, output, vpk_path):
    bsp = Bsp(source); data = bsp.data
    planes = bsp.records(1, '<4fi'); texdata = bsp.records(2, '<3f5i'); vertices = bsp.records(3, '<3f')
    texinfo = bsp.records(6, '<16f2i'); edges = bsp.records(12, '<2H'); surfedges = [r[0] for r in bsp.records(13, '<i')]
    strings = bsp.lump(43); offsets = [r[0] for r in bsp.records(44, '<i')]
    names = [strings[o:strings.find(b'\0', o)].decode().lower() for o in offsets]
    entities = [dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]*)"', e)) for e in re.findall(r'\{([^{}]*)\}', bsp.lump(0).decode(errors='replace'))]
    models = bsp.records(14, '<9f3i'); nodes = bsp.records(5, '<3i6h3H2x'); leaves = bsp.records(10, '<ihH6h4Hh2x')
    leafbrushes = [r[0] for r in bsp.records(17, '<H')]; leaffaces = [r[0] for r in bsp.records(16, '<H')]
    pak = zipfile.ZipFile(io.BytesIO(bsp.lump(40))); paknames = {n.lower(): n for n in pak.namelist()}
    import vpk
    store = vpk.open(str(vpk_path), read_header_only=False)  # index once; header-only lookups rescan it

    def read(path):
        path = path.lower()
        if path in paknames: return pak.read(paknames[path])
        if path in store: return store.get_file(path).read()
        return None

    output.mkdir(parents=True, exist_ok=True); (output / 'textures').mkdir(exist_ok=True)

    # --- 3D skybox area: faces and brushes only reachable from the sky_camera's area are left out. ---
    def leaf_at(point):
        node = 0
        while node >= 0:
            plane = planes[nodes[node][0]]
            node = nodes[node][1] if sum(point[a] * plane[a] for a in range(3)) - plane[3] >= 0 else nodes[node][2]
        return -node - 1
    # The skybox room is sealed, so the clusters visible from the sky_camera (its PVS) are the skybox itself.
    camera = next((e for e in entities if e.get('classname') == 'sky_camera'), None)
    sky_clusters = set()
    if camera:
        vis = bsp.lump(4); count = struct.unpack_from('<i', vis, 0)[0]
        cluster = leaves[leaf_at(tuple(map(float, camera['origin'].split())))][1]
        o = struct.unpack_from('<i', vis, 4 + cluster * 8)[0]; c = 0
        while c < count:
            byte = vis[o]; o += 1
            if byte == 0: c += 8 * vis[o]; o += 1; continue
            for bit in range(8):
                if byte >> bit & 1 and c + bit < count: sky_clusters.add(c + bit)
            c += 8
    face_areas = collections.defaultdict(set); brush_areas = collections.defaultdict(set)
    for li, leaf in enumerate(leaves):
        if leaf[1] < 0: continue  # solid leaves belong to no cluster
        for k in range(leaf[9], leaf[9] + leaf[10]): face_areas[leaffaces[k]].add(leaf[1])
        for k in range(leaf[11], leaf[11] + leaf[12]): brush_areas[leafbrushes[k]].add(leaf[1])
    in_sky = lambda clusters: bool(sky_clusters) and bool(clusters) and clusters <= sky_clusters

    # --- brush entities: origin/angles transform, visibility and solidity ---
    def model_brushes(node):
        if node < 0:
            leaf = leaves[-node - 1]; return set(leafbrushes[leaf[11]:leaf[11] + leaf[12]])
        return model_brushes(nodes[node][1]) | model_brushes(nodes[node][2])
    face_entity = {}; brush_entity = {}
    for e in entities:
        if not e.get('model', '').startswith('*'): continue
        model = models[int(e['model'][1:])]
        for f in range(model[10], model[10] + model[11]): face_entity[f] = e
        for b in model_brushes(model[9]): brush_entity[b] = e
    def transform(e):
        origin = np.array([float(v) for v in e.get('origin', '0 0 0').split()]) if e else np.zeros(3)
        angles = [float(v) for v in e.get('angles', '0 0 0').split()] if e else [0, 0, 0]
        return rotation(angles), origin
    def hidden(e):
        if not e: return False
        c = e.get('classname', '')
        return c.startswith(HIDDEN_CLASSES) or e.get('StartDisabled') == '1' or e.get('rendermode') == '10'
    def solid(e):
        if not e: return True
        c = e.get('classname', '')
        if c.startswith(NOT_SOLID_CLASSES) or e.get('StartDisabled') == '1': return False
        if c == 'func_brush' and e.get('Solidity') == '1': return False
        return True

    # --- materials ---
    materials = []
    for td in texdata:
        name = names[td[3]]; result = {'name': name, 'color': [round(v, 3) for v in td[:3]], 'width': td[4], 'height': td[5]}
        if not name.startswith('tools/'):
            shader, params = material_info(read, name)
            result['shader'] = shader
            result['alpha'] = params.get('$alphatest') == '1' or params.get('$translucent') == '1'
            base = params.get('$basetexture')
            if base:
                texture = save_texture(read, 'materials/' + base.replace('\\', '/').lower() + '.vtf', output, name, alpha=result['alpha'])
                if texture: result['texture'] = texture
            if shader in ('worldvertextransition', 'lightmapped_4wayblend') and params.get('$basetexture2'):
                texture2 = save_texture(read, 'materials/' + params['$basetexture2'].replace('\\', '/').lower() + '.vtf', output, name + '#2')
                if texture2: result['texture2'] = texture2
            elif params.get('$bumpmap'):
                normal = save_texture(read, 'materials/' + params['$bumpmap'].replace('\\', '/').lower() + '.vtf', output, name + '#normal', normal=True)
                if normal: result['normalMap'] = normal; result['ssbump'] = params.get('$ssbump') == '1'
        materials.append(result)

    # --- world faces and displacements ---
    hdr = len(bsp.lump(53)) > 0
    lighting = bsp.lump(53 if hdr else 8)
    faces = bsp.records(58 if hdr else 7, '<HBBihhhh4Bif5iHHI')
    dispinfo = [struct.unpack_from('<3fiiiifiH2xii', bsp.lump(26), k * 176) for k in range(len(bsp.lump(26)) // 176)]
    dispverts = bsp.records(33, '<5f'); disptris = [r[0] for r in bsp.records(48, '<H')]
    groups = collections.defaultdict(lambda: {'positions': [], 'uvs': [], 'lm': [], 'blend': [], 'indices': []})
    lightmap_faces = {}; world_faces = []; collision_tris = []; skipped_sky = 0
    for fi, face in enumerate(faces):
        planeid, side, _, first, num, ti, disp, _fog, style0, _s1, _s2, _s3, lightofs, _area, lmMinS, lmMinT, lmW, lmH, *_ = face
        if ti < 0 or num < 3: continue
        info = texinfo[ti]; mat = info[17]; name = materials[mat]['name']
        entity = face_entity.get(fi)
        if fi >= models[0][10] + models[0][11] and entity is None: continue  # faces of unreferenced models
        if entity is None and (in_sky(face_areas.get(fi, set())) or disp >= 0 and in_sky({leaves[leaf_at(dispinfo[disp][:3])][1]})):
            skipped_sky += 1; continue
        if hidden(entity): continue
        rot, origin = transform(entity)
        local = [vertices[edges[abs(surfedges[first + i])][0 if surfedges[first + i] >= 0 else 1]] for i in range(num)]
        points = [tuple(rot @ np.array(p) + origin) for p in local]
        lit = style0 != 255 and lightofs >= 0
        drawn = not (name.startswith('tools/') or info[16] & SURF_SKIP_DRAW)
        if disp >= 0:
            d = dispinfo[disp]; start = d[:3]; vstart, tstart, power = d[3], d[4], d[5]; size = (1 << power) + 1
            # Corners start at the one nearest the displacement's start position.
            k0 = min(range(4), key=lambda k: sum((local[k][a] - start[a]) ** 2 for a in range(3)))
            corners = [np.array(local[(k0 + k) % 4], dtype=float) for k in range(4)]
            grid = []; base = []
            for i in range(size):
                left = corners[0] + (corners[1] - corners[0]) * i / (size - 1)
                right = corners[3] + (corners[2] - corners[3]) * i / (size - 1)
                for j in range(size):
                    b = left + (right - left) * j / (size - 1)
                    v = dispverts[vstart + i * size + j]
                    grid.append(rot @ (b + np.array(v[:3]) * v[3]) + origin); base.append((b, v[4] / 255.0))
            tris = []
            for i in range(size - 1):
                for j in range(size - 1):
                    n = i * size + j
                    if n % 2: tris += [(n, n + size, n + 1), (n + 1, n + size, n + size + 1)]
                    else: tris += [(n, n + size, n + size + 1), (n, n + size + 1, n + 1)]
            tris = [t for k, t in enumerate(tris) if not disptris[tstart + k] & DISPTRI_TAG_REMOVE]
            entity_solid = solid(entity)
            if entity_solid:
                for t in tris: collision_tris.append([c for k in t for c in grid[k]])
            if not drawn: continue
            g = groups[mat]; offset = len(g['positions']) // 3
            for (b, alpha), p in zip(base, grid):
                g['positions'] += [round(float(c), 3) for c in p]
                u = (sum(b[a] * info[a] for a in range(3)) + info[3]) / max(1, materials[mat]['width'])
                v = -(sum(b[a] * info[a + 4] for a in range(3)) + info[7]) / max(1, materials[mat]['height'])
                g['uvs'] += [round(u, 5), round(v, 5)]
                g['lm'] += [fi if lit else -1, sum(b[a] * info[8 + a] for a in range(3)) + info[11] - lmMinS,
                            sum(b[a] * info[12 + a] for a in range(3)) + info[15] - lmMinT]
                g['blend'].append(round(alpha, 4))
            g['indices'] += [offset + k for t in tris for k in t]
        else:
            if not drawn: continue
            g = groups[mat]; offset = len(g['positions']) // 3
            for p, l in zip(points, local):
                g['positions'] += [round(float(c), 3) for c in p]
                u = (sum(l[a] * info[a] for a in range(3)) + info[3]) / max(1, materials[mat]['width'])
                v = -(sum(l[a] * info[a + 4] for a in range(3)) + info[7]) / max(1, materials[mat]['height'])
                g['uvs'] += [round(u, 5), round(v, 5)]
                g['lm'] += [fi if lit else -1, sum(l[a] * info[8 + a] for a in range(3)) + info[11] - lmMinS,
                            sum(l[a] * info[12 + a] for a in range(3)) + info[15] - lmMinT]
                g['blend'].append(0.0)
            g['indices'] += [offset + k for j in range(1, num - 1) for k in (0, j, j + 1)]
            if entity is None and not info[16] & 0x2000:
                world_faces.append({'face': fi, 'points': points, 'normal': tuple(planes[planeid][:3]), 'dist': planes[planeid][3],
                                    'info': info, 'lit': lit, 'lmMins': (lmMinS, lmMinT)})
        if lit and fi not in lightmap_faces:
            bumped = bool(info[16] & SURF_BUMPLIGHT)
            lightmap_faces[fi] = (lightofs, lmW + 1, lmH + 1, bumped)

    # --- collision brushes: axial ones as boxes, the rest as bevelled plane sets ---
    brushes = bsp.records(18, '<3i'); sides = bsp.records(19, '<Hhhh')
    boxes = []; hulls = []; skipped_sky_brushes = 0
    for index, (first, num, contents) in enumerate(brushes):
        if not contents & PLAYER_SOLID: continue
        entity = brush_entity.get(index)
        if not solid(entity): continue
        if entity is None and in_sky(brush_areas.get(index, set())): skipped_sky_brushes += 1; continue
        rot, origin = transform(entity)
        brush_planes = []
        for i in range(first, first + num):
            nx, ny, nz, d, _ = planes[sides[i][0]]
            n = rot @ np.array((nx, ny, nz)); brush_planes.append((*n, d + float(n @ origin)))
        lo, hi = [-math.inf] * 3, [math.inf] * 3; axial = True
        for n, side in zip(brush_planes, sides[first:first + num]):
            axis = max(range(3), key=lambda a: abs(n[a]))
            if abs(n[axis]) < 0.99999:
                if not side[3] & 0xff: axial = False  # bevel planes alone leave a box a box (the high byte is `thin`)
                continue
            if n[axis] > 0: hi[axis] = min(hi[axis], n[3])
            else: lo[axis] = max(lo[axis], -n[3])
        if not all(math.isfinite(v) for v in lo + hi): continue
        if axial: boxes.append(lo + hi)
        else:
            corners = brush_corners(brush_planes)
            if corners is None: continue
            hulls.append((brush_planes, corners.min(axis=0).tolist() + corners.max(axis=0).tolist()))

    # --- static props: batched geometry with baked vertex lighting, and their hulls for collision ---
    ambient_index = bsp.records(51 if hdr else 52, '<2H'); ambient = bsp.lump(55 if hdr else 56)
    def ambient_at(point):
        """Flat colour from the leaf's ambient cubes, in the lightmap encoding, for props VRAD did not light per vertex."""
        count, first = ambient_index[leaf_at(point)] if leaf_at(point) < len(ambient_index) else (0, 0)
        if not count: return np.array([128.0, 128.0, 128.0])
        cubes = np.frombuffer(ambient, np.uint8, count * 28, first * 28).reshape(count, 28)[:, :24].reshape(-1, 4)
        linear = cubes[:, :3] * np.ldexp(1.0, cubes[:, 3].view(np.int8).astype(np.int32))[:, None] / 255
        return np.clip(linear.mean(axis=0) / 2, 0, 1) ** (1 / 2.2) * 255
    props, prop_tris = static_props.import_props(read, bsp, rotation, lambda ids: in_sky({leaves[l][1] for l in ids if leaves[l][1] >= 0}),
                                                 ambient_at, save_texture, material_info, output)
    collision_tris += prop_tris
    collision_bytes = write_collision(output / 'collision.bin.gz', boxes, hulls, collision_tris)

    # --- lightmap atlas (HDR ColorRGBExp32 -> Source's LDR lightmap encoding) and per-vertex uv2 ---
    atlas, spots, (width, height), white = pack_lightmaps(lighting, lightmap_faces, output)
    vertex_count = sum(len(g['positions']) // 3 for g in groups.values()); index_count = sum(len(g['indices']) for g in groups.values())
    positions = np.empty(vertex_count * 3, np.float32); uvs = np.empty(vertex_count * 2, np.float32); uv2 = np.empty(vertex_count * 2, np.float32)
    steps = np.zeros(vertex_count, np.float32); blend = np.empty(vertex_count, np.float32); indices = np.empty(index_count, np.uint32)
    meshes = []; v0 = i0 = 0
    for mat, g in sorted(groups.items()):
        n = len(g['positions']) // 3; m = len(g['indices'])
        positions[v0 * 3:(v0 + n) * 3] = g['positions']; uvs[v0 * 2:(v0 + n) * 2] = g['uvs']; blend[v0:v0 + n] = g['blend']
        indices[i0:i0 + m] = g['indices']
        lm = g['lm']
        for k in range(n):
            f, s, t = lm[k * 3], lm[k * 3 + 1], lm[k * 3 + 2]
            if f in spots:
                x, y = spots[f]; uv2[(v0 + k) * 2] = (x + s + 0.5) / width; uv2[(v0 + k) * 2 + 1] = (y + t + 0.5) / height
                if lightmap_faces[f][3] and 'normalMap' in materials[mat]: steps[v0 + k] = (lightmap_faces[f][1] + 2) / width
            else: uv2[(v0 + k) * 2] = (white[0] + 0.5) / width; uv2[(v0 + k) * 2 + 1] = (white[1] + 0.5) / height
        meshes.append({'material': mat, 'vertexStart': v0, 'vertexCount': n, 'indexStart': i0, 'indexCount': m,
                       'bumped': bool(steps[v0:v0 + n].any()), 'blend': 'texture2' in materials[mat]})
        v0 += n; i0 += m
    blob = positions.tobytes() + uvs.tobytes() + uv2.tobytes() + steps.tobytes() + blend.tobytes() + indices.tobytes()
    write_gzip(output / 'world.bin.gz', blob)

    decals = project_decals(entities, world_faces, read, output)
    for mesh in decals['meshes']:
        mesh['uv2'] = []
        for k in range(0, len(mesh['lm']), 3):
            f, s, t = int(mesh['lm'][k]), mesh['lm'][k + 1], mesh['lm'][k + 2]
            x, y = spots.get(f, white); s, t = (s, t) if f in spots else (0.5, 0.5)
            mesh['uv2'] += [round((x + s + 0.5) / width, 5), round((y + t + 0.5) / height, 5)]
        del mesh['lm']; del mesh['normals']
    skyname = next((e.get('skyname') for e in entities if e.get('classname') == 'worldspawn'), None)
    sky = export_sky(skyname.lower(), pak, paknames, vpk_path, output) if skyname else None
    spawns = [{'team': e['classname'][len('info_player_'):], 'position': [float(v) for v in e['origin'].split()],
               'yaw': float(e.get('angles', '0 0 0').split()[1])} for e in entities if e.get('classname') in ('info_player_counterterrorist', 'info_player_terrorist')]
    bounds = np.array([b for b in boxes] + [h[1] for h in hulls]).reshape(-1, 6)
    result = {'format': 2, 'sourceFile': source.name, 'sha256': hashlib.sha256(data).hexdigest(), 'hdr': hdr,
              'materials': materials, 'meshes': meshes,
              'geometry': {'file': 'world.bin.gz', 'vertices': vertex_count, 'indices': index_count},
              'lightmap': {'texture': 'lightmap.webp', 'width': width, 'height': height},
              'collision': {'file': 'collision.bin.gz', 'sha256': hashlib.sha256(collision_bytes).hexdigest(),
                            'boxes': len(boxes), 'hulls': len(hulls), 'triangles': len(collision_tris),
                            'min': bounds[:, :3].min(axis=0).tolist(), 'max': bounds[:, 3:].max(axis=0).tolist()},
              'decals': decals, 'sky': sky, 'spawns': spawns, 'boxes': [], 'props': props}
    result['lighting'] = model_lighting(bsp, hdr, planes, nodes, leaves, output)
    result.update(placement(entities, spawns, result['collision']['min'][2]))
    (output / 'map.json').write_text(json.dumps(result, separators=(',', ':')))
    (output / 'entities.json').write_text(json.dumps(entities, indent=1))
    print(f'{source.name}: {len(meshes)} materials, {index_count // 3} triangles, {vertex_count} vertices; collision {len(boxes)} boxes, '
          f'{len(hulls)} brushes, {len(collision_tris)} displacement and prop triangles; 3D skybox faces/brushes left out: {skipped_sky}/{skipped_sky_brushes}')


def placement(entities, spawns, floor):
    """Entry at the first CT spawn, the menu preview from the map's first scripted camera, no fixed lanes: long jumps
    count anywhere flat."""
    spawn = next((s for s in spawns if s['team'] == 'counterterrorist'), spawns[0])
    x, y, z = spawn['position']
    entry = {'position': {'x': x, 'y': y, 'z': z}, 'yaw': math.pi / 2 - math.radians(spawn['yaw'])}
    # The map's own showcase cameras: dev-shot cameras first, then scripted ones that are aimed by their angles.
    cameras = [e for e in entities if e.get('classname') == 'point_devshot_camera'] + \
              [e for e in entities if e.get('classname') == 'point_viewcontrol' and e.get('angles', '0 0 0').split() != ['0', '0', '0']]
    camera = next((e for e in cameras if 'origin' in e), None)
    if camera:
        cx, cy, cz = (float(v) for v in camera['origin'].split()); pitch, yaw, _ = (math.radians(float(v)) for v in camera.get('angles', '0 0 0').split())
        target = {'x': cx + 512 * math.cos(pitch) * math.cos(yaw), 'y': cy + 512 * math.cos(pitch) * math.sin(yaw), 'z': cz - 512 * math.sin(pitch)}
        preview = {'position': {'x': cx, 'y': cy, 'z': cz}, 'target': target}
    else: preview = {'position': {'x': x, 'y': y - 600, 'z': z + 300}, 'target': {'x': x, 'y': y, 'z': z}}
    return {'entry': entry, 'preview': preview, 'lanes': [], 'resetFloor': floor}


def model_lighting(bsp, hdr, planes, nodes, leaves, output):
    """BSP tree, leaf ambient cubes and world lights for lighting the viewmodel and players (see src/map-lighting.ts)."""
    ambient_index = bsp.records(51 if hdr else 52, '<2H'); ambient = bsp.lump(55 if hdr else 56)
    blob = bytearray(); leaf_samples = {}
    for li, leaf in enumerate(leaves):
        count, first = ambient_index[li] if li < len(ambient_index) else (0, 0)
        if not count: continue
        mins, maxs = leaf[3:6], leaf[6:9]; leaf_samples[str(li)] = [len(blob) // 30, count]
        for k in range(first, first + count):
            o = k * 28; cube = struct.unpack_from('<6I', ambient, o); x, y, z = ambient[o + 24:o + 27]
            position = [mins[0] + (maxs[0] - mins[0]) * x / 255, mins[1] + (maxs[1] - mins[1]) * y / 255, mins[2] + (maxs[2] - mins[2]) * z / 255]
            blob += struct.pack('<3h6I', *(round(v) for v in position), *cube)
    (output / 'lighting.bin').write_bytes(bytes(blob))
    used = sorted({n[0] for n in nodes}); remap = {p: i for i, p in enumerate(used)}
    lump = bsp.lump(54 if hdr else 15); size = 100 if len(lump) % 100 == 0 else 88; lights = []
    for k in range(len(lump) // size):
        o = k * size; origin = struct.unpack_from('<3f', lump, o); intensity = struct.unpack_from('<3f', lump, o + 12)
        normal = struct.unpack_from('<3f', lump, o + 24); t = o + 36 + (12 if size == 100 else 0)
        _cluster, kind, _style, stopdot, stopdot2, exponent, _radius, c, l, q, *_ = struct.unpack_from('<3i7f3i', lump, t)
        if kind in (1, 2, 3):
            lights.append({'type': kind, 'origin': list(origin), 'intensity': list(intensity), 'normal': list(normal), 'stopdot': stopdot,
                           'stopdot2': stopdot2, 'exponent': exponent, 'attenuation': [c, l, q]})
    return {'root': 0, 'nodes': [[remap[n[0]], n[1], n[2]] for n in nodes], 'planes': [[round(v, 4) for v in planes[p][:4]] for p in used],
            'samples': 'lighting.bin', 'leafSamples': leaf_samples, 'lights': lights}


def brush_corners(brush_planes):
    """Vertices of a convex brush (intersections of plane triples inside every plane)."""
    n = np.array([p[:3] for p in brush_planes]); d = np.array([p[3] for p in brush_planes]); points = []
    for i in range(len(n)):
        for j in range(i + 1, len(n)):
            for k in range(j + 1, len(n)):
                m = np.array([n[i], n[j], n[k]])
                if abs(np.linalg.det(m)) < 1e-6: continue
                p = np.linalg.solve(m, np.array([d[i], d[j], d[k]]))
                if np.all(n @ p - d <= 0.01): points.append(p)
    return np.array(points) if points else None


def write_gzip(path, data):
    path.write_bytes(gzip.compress(data, compresslevel=9, mtime=0))


def write_collision(path, boxes, hulls, triangles):
    """collision.bin (little-endian): 'LJC1', counts (boxes, brushes, planes, triangles), then boxes as min/max f32x6,
    brushes as (first plane u32, plane count u32), brush bounds f32x6, planes f32x4 (normal, dist), triangles f32x9."""
    plane_list = []; brush_index = []
    for brush_planes, _ in hulls:
        brush_index.append((len(plane_list), len(brush_planes))); plane_list += brush_planes
    header = b'LJC1' + struct.pack('<4I', len(boxes), len(hulls), len(plane_list), len(triangles))
    data = (header + np.array(boxes, np.float32).tobytes() + np.array(brush_index, np.uint32).tobytes()
            + np.array([h[1] for h in hulls], np.float32).tobytes() + np.array(plane_list, np.float32).tobytes()
            + np.array(triangles, np.float32).tobytes())
    write_gzip(path, data)
    return data


def pack_lightmaps(lighting, faces, output):
    """Shelf-pack each face's style-0 lightmap (four side by side when bumped) with a 1-luxel replicated border."""
    raw = np.frombuffer(lighting, np.uint8).reshape(-1, 4)
    scale = np.ldexp(1.0, raw[:, 3].view(np.int8).astype(np.int32)) / 255.0
    encoded = (np.clip(raw[:, :3] * scale[:, None] / 2, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)
    order = sorted(faces, key=lambda f: -faces[f][2])
    blocks = lambda f: 4 if faces[f][3] else 1
    def place(width):
        x = y = shelf = 0; spots = {}
        for f in order:
            w, h = (faces[f][1] + 2) * blocks(f), faces[f][2] + 2
            if x + w > width: x, y, shelf = 0, y + shelf, 0
            spots[f] = (x + 1, y + 1); x += w; shelf = max(shelf, h)
        return spots, y + shelf
    width = 512
    while True:
        spots, height = place(width)
        if height + 4 <= width: break
        width *= 2
    height = 1 << math.ceil(math.log2(height + 4))
    atlas = np.full((height, width, 3), 255, np.uint8); white = (width - 2, height - 2)
    for f in order:
        offset, w, h, _ = faces[f]; x0, y0 = spots[f]; start = offset // 4
        for block in range(blocks(f)):
            luxels = encoded[start + block * w * h:start + (block + 1) * w * h].reshape(h, w, 3)
            bx = x0 + block * (w + 2)
            atlas[y0 - 1:y0 + h + 1, bx - 1:bx + w + 1] = np.pad(luxels, ((1, 1), (1, 1), (0, 0)), mode='edge')
    Image.fromarray(atlas).save(output / 'lightmap.webp', lossless=True, quality=100, method=4)
    print('lightmap atlas', width, 'x', height, 'faces', len(order), 'bumped', sum(1 for f in order if faces[f][3]))
    return atlas, spots, (width, height), white


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('bsp', type=pathlib.Path); parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('--vpk', type=pathlib.Path, required=True, help='CS:GO pak01_dir.vpk')
    args = parser.parse_args(); convert(args.bsp, args.output, args.vpk)
