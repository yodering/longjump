#!/usr/bin/env python3
"""Convert CS:GO's default knife viewmodels (CT and T) with their default arms to animated GLB files.

Usage: python import_viewmodels.py path/to/csgo/pak01_dir.vpk output-directory
Requires Pillow and vpk (pip install pillow vpk). Only reads the VPK; nothing from it is executed.

The VPK chunks needed (001, 005, 081, 126, 127, 140 plus pak01_dir.vpk) come from Steam depot 731,
downloadable anonymously through the legacy CS:GO dedicated server (app 740); see research/viewmodels/README.md.

Layouts follow CS:GO's public/studio.h, public/optimize.h and bonesetup/bone_decode.cpp:
- the knife model has no animations of its own; it includes v_ct_knife_anim.mdl / v_t_knife_anim.mdl,
  whose sequences use STUDIO_FRAMEANIM (frame x bone) data stored in .ani anim blocks and split into sections;
- the arms are separate models bone-merged onto the knife skeleton by bone name.
"""
import argparse, io, json, math, pathlib, re, struct
import vpk
from PIL import Image

# Which arms CS:GO gives its classic community-map player models (viewmodel_arm_config.inc).
TEAMS = {
    'ct': {'knife': 'models/weapons/v_knife_default_ct.mdl',
           'arms': ['models/weapons/v_models/arms/glove_hardknuckle/v_glove_hardknuckle.mdl',
                    'models/weapons/v_models/arms/st6/v_sleeve_st6.mdl']},
    't': {'knife': 'models/weapons/v_knife_default_t.mdl',
          'arms': ['models/weapons/v_models/arms/glove_fullfinger/v_glove_fullfinger.mdl']},
}
SEQUENCES = ['draw', 'idle1', 'idle2', 'lookat01', 'light_miss1', 'light_miss2', 'heavy_miss1']
FRAMEANIM = 0x40
CONST_POS, CONST_ROT, ANIM_POS, ANIM_ROT, ANIM_POS2, CONST_POS2, CONST_ROT2, ANIM_ROT2 = (1 << i for i in range(8))

def cstr(d, o): return d[o:d.index(b'\0', o)].decode('latin1')
def i32(d, o): return struct.unpack_from('<i', d, o)[0]

def quat48(d, o):
    x, y, zw = struct.unpack_from('<HHH', d, o)
    q = [(x - 32768) / 32768.5, (y - 32768) / 32768.5, ((zw & 0x7fff) - 16384) / 16384.5]
    w = math.sqrt(max(0.0, 1 - sum(v * v for v in q)))
    return q + [-w if zw & 0x8000 else w]

def quat48s(d, o):
    sa, sb, sc = struct.unpack_from('<HHH', d, o)
    ia = (sb >> 15) + (sa >> 15) * 2
    q = [0.0] * 4
    for k, raw in enumerate((sa & 0x7fff, sb & 0x7fff, sc & 0x7fff)):
        q[(ia + k) % 4] = (raw - 16384) / 23168.0
    w = math.sqrt(max(0.0, 1 - sum(v * v for v in q)))
    q[(ia + 3) % 4] = -w if sc & 0x8000 else w
    return q

def vec48(d, o): return list(struct.unpack_from('<3e', d, o))

class Model:
    def __init__(self, pak, path):
        self.path = path
        self.d = d = pak.get_file(path).read()
        if d[:4] != b'IDST' or i32(d, 4) != 49: raise ValueError(f'{path}: expected MDL v49')
        base = path[:-4]
        self.ani = pak.get_file(base + '.ani').read() if i32(d, 352) else b''
        self.vvd = pak.get_file(base + '.vvd').read() if i32(d, 232) else b''
        self.vtx = pak.get_file(base + '.dx90.vtx').read() if self.vvd else b''
        self.bones = []
        for b in range(i32(d, 156)):
            o = i32(d, 160) + b * 216
            m = struct.unpack_from('<12f', d, o + 96)
            self.bones.append({'name': cstr(d, o + i32(d, o)), 'parent': i32(d, o + 4),
                               'pos': list(struct.unpack_from('<3f', d, o + 32)), 'quat': list(struct.unpack_from('<4f', d, o + 44)),
                               'poseToBone': [m[0:4], m[4:8], m[8:12]]})
        self.includes = [cstr(d, i32(d, 340) + k * 8 + i32(d, i32(d, 340) + k * 8 + 4)) for k in range(i32(d, 336))]

    def textures(self):
        d = self.d
        names = [cstr(d, i32(d, 208) + k * 64 + i32(d, i32(d, 208) + k * 64)) for k in range(i32(d, 204))]
        dirs = [cstr(d, i32(d, i32(d, 216) + k * 4)).replace('\\', '/') for k in range(i32(d, 212))]
        skins = struct.unpack_from(f'<{i32(d, 220)}h', d, i32(d, 228))  # skin family 0
        return names, dirs, skins

    def sequences(self):
        d = self.d
        out = {}
        for s in range(i32(d, 188)):
            o = i32(d, 192) + s * 212
            out[cstr(d, o + i32(d, o + 4))] = struct.unpack_from('<h', d, o + i32(d, o + 60))[0]
        return out

    def anim_frame(self, anim, frame):
        """Local (pos, quat) per bone for one frame of a STUDIO_FRAMEANIM animation, as bone_decode.cpp does."""
        d = self.d
        a = i32(d, 184) + anim * 100
        flags, frames = i32(d, a + 12), i32(d, a + 16)
        if not flags & FRAMEANIM: raise ValueError(f'{self.path}: only frame animations are supported')
        block, index, sectionframes = i32(d, a + 52), i32(d, a + 56), i32(d, a + 84)
        local = frame
        if sectionframes:
            if frames > sectionframes and frame == frames - 1: section, local = frames // sectionframes + 1, 0
            else: section, local = frame // sectionframes, frame % sectionframes
            block, index = struct.unpack_from('<ii', d, a + i32(d, a + 80) + section * 8)
        if block == 0: data, o = d, a + index
        else: data, o = self.ani, i32(d, i32(d, 356) + block * 8) + index
        constants, frameoffset, framelength = struct.unpack_from('<iii', data, o)
        cp, fp = o + constants, o + frameoffset + local * framelength
        pose = []
        for b, bone in enumerate(self.bones):
            f = data[o + 24 + b]
            q, p = bone['quat'], bone['pos']
            if f & ANIM_ROT: q = quat48(data, fp); fp += 6
            elif f & ANIM_ROT2: q = quat48s(data, fp); fp += 6
            elif f & CONST_ROT: q = quat48(data, cp); cp += 6
            elif f & CONST_ROT2: q = quat48s(data, cp); cp += 6
            if f & ANIM_POS: p = vec48(data, fp); fp += 6
            elif f & CONST_POS: p = vec48(data, cp); cp += 6
            elif f & ANIM_POS2: p = list(struct.unpack_from('<3f', data, fp)); fp += 12
            elif f & CONST_POS2: p = list(struct.unpack_from('<3f', data, cp)); cp += 12
            pose.append((p, q))
        return pose, frames, struct.unpack_from('<f', d, a + 8)[0]

    def meshes(self):
        """Body part 0 / model 0 / LOD 0 triangles with VVD vertices and the model's skin-0 texture index."""
        d, vvd, vtx = self.d, self.vvd, self.vtx
        if vvd[:4] != b'IDSV' or i32(vtx, 0) != 7: raise ValueError(f'{self.path}: unexpected VVD/VTX')
        fixups, fixstart, vstart = i32(vvd, 48), i32(vvd, 52), i32(vvd, 56)
        raw = [vstart + k * 48 for k in range(i32(vvd, 16))]
        if fixups:  # LOD 0 order comes from every fixup range
            order = []
            for k in range(fixups):
                lod, src, n = struct.unpack_from('<iii', vvd, fixstart + k * 12)
                if lod >= 0: order += range(src, src + n)
            raw = [vstart + v * 48 for v in order]
        names, dirs, skins = self.textures()
        out = []
        for part in range(i32(d, 232)):
            bp = i32(d, 236) + part * 16
            model = bp + i32(d, bp + 12)  # model 0
            vtxpart = i32(vtx, 32) + part * 8
            vtxmodel = vtxpart + i32(vtx, vtxpart + 4)
            lod = vtxmodel + i32(vtx, vtxmodel + 4)
            nmesh, meshoff = i32(d, model + 72), model + i32(d, model + 76)
            # CS:GO changed the trailing padding; find the stride whose second mesh points back at its model.
            stride = next((s for s in (116, 108) if nmesh < 2 or meshoff + s + i32(d, meshoff + s + 4) == model), 116)
            vbase = i32(d, model + 84) // 48
            vmesh = lod + i32(vtx, lod + 4)
            for m in range(nmesh):
                mo = meshoff + m * stride
                material, voff = i32(d, mo), i32(d, mo + 12)
                vm = vmesh + m * 9
                groups, goff = i32(vtx, vm), vm + i32(vtx, vm + 4)
                positions, normals, uvs, joints, weights, indices = [], [], [], [], [], []
                # Strip group headers are 25 bytes in the 2013 SDK and 33 (topology fields added) in newer branches.
                def valid(sg):
                    nv, vo, ni, io = struct.unpack_from('<iiii', vtx, sg)
                    return nv > 0 and ni > 0 and ni % 3 == 0 and 0 < sg + vo < len(vtx) and 0 < sg + io + ni * 2 <= len(vtx)
                size = 25 if groups < 2 or valid(goff + 25) and not valid(goff + 33) else 33
                for g in range(groups):
                    sg = goff + g * size
                    nverts, voffs, nidx, ioffs = struct.unpack_from('<iiii', vtx, sg)
                    start = len(positions)
                    for k in range(nverts):
                        orig = struct.unpack_from('<H', vtx, sg + voffs + k * 9 + 4)[0]
                        r = raw[vbase + voff + orig]
                        w = struct.unpack_from('<3f', vvd, r); bones = struct.unpack_from('<3B', vvd, r + 12); count = vvd[r + 15]
                        positions.append(struct.unpack_from('<3f', vvd, r + 16)); normals.append(struct.unpack_from('<3f', vvd, r + 28))
                        uvs.append(struct.unpack_from('<2f', vvd, r + 40))
                        joints.append([bones[j] if j < count else 0 for j in range(3)] + [0])
                        weights.append([w[j] if j < count else 0.0 for j in range(3)] + [0.0])
                    idx = struct.unpack_from(f'<{nidx}H', vtx, sg + ioffs)
                    indices += [start + v for v in idx]
                texture = names[skins[material]]
                folder = next(f for f in dirs if f'materials/{f}{texture}.vmt'.lower() in VMTS)
                out.append({'positions': positions, 'normals': normals, 'uvs': uvs, 'joints': joints, 'weights': weights,
                            'indices': indices, 'material': f'materials/{folder}{texture}'.lower()})
        return out

VMTS: set = set()

def parse_vmt(pak, material):
    """Shader name and lower-cased $parameters of a flat VMT."""
    text = pak.get_file(material + '.vmt').read().decode('latin1')
    shader = text.strip().split()[0].strip('"').lower()
    params = {}
    for line in text.splitlines():
        match = re.match(r'\s*"?(\$[^"\s]+)"?\s+"?([^"]*?)"?\s*(//.*)?$', line)
        if match: params[match[1].lower()] = match[2].strip()
    return shader, params

def vtf_path(name): return 'materials/' + name.replace('\\', '/').lower() + '.vtf'

def decode_vtf(data):
    """Largest mip of a single-frame VTF as RGBA (the largest mip is stored last)."""
    width, height = struct.unpack_from('<HH', data, 16); fmt = struct.unpack_from('<I', data, 52)[0]
    if fmt in (13, 15):  # DXT1 / DXT5, via Pillow's DDS decoder (same blocks)
        size = max(1, (width + 3) // 4) * max(1, (height + 3) // 4) * (8 if fmt == 13 else 16)
        header = struct.pack('<7I', 124, 0x81007, height, width, size, 0, 1) + bytes(44)
        header += struct.pack('<II4s5I', 32, 4, b'DXT1' if fmt == 13 else b'DXT5', 0, 0, 0, 0, 0) + struct.pack('<5I', 0x1000, 0, 0, 0, 0)
        return Image.open(io.BytesIO(b'DDS ' + header + data[-size:])).convert('RGBA')
    raw = {0: ('RGBA', 4, 'RGBA'), 2: ('RGB', 3, 'RGB'), 3: ('RGB', 3, 'BGR'), 12: ('RGBA', 4, 'BGRA'), 5: ('L', 1, 'L')}
    if fmt not in raw: raise ValueError(f'Unsupported VTF format {fmt}')
    mode, bpp, order = raw[fmt]
    return Image.frombytes(mode, (width, height), data[-width * height * bpp:], 'raw', order).convert('RGBA')

def flat_empty_normals(image):
    """Some CS:GO normal maps leave regions the model's UVs still use as all-zero DXT blocks; z = 2b - 1 <= 0 is no
    valid tangent-space normal and would light those surfaces from inside, so they become flat (128, 128, 255)."""
    r, g, b, a = image.convert('RGBA').split()
    empty = b.point(lambda v: 255 if v < 128 else 0)
    for channel, value in ((r, 128), (g, 128), (b, 255)): channel.paste(value, mask=empty)
    return Image.merge('RGBA', (r, g, b, a))

def jpeg(image, normal=False):
    image = image.convert('RGB')
    if normal:  # Source normal maps are DirectX (Y down); glTF expects Y up.
        r, g, b = image.split(); image = Image.merge('RGB', (r, g.point(lambda v: 255 - v), b))
    buffer = io.BytesIO(); image.save(buffer, 'JPEG', quality=90); return buffer.getvalue()

def png(image):
    buffer = io.BytesIO(); image.save(buffer, 'PNG', optimize=True); return buffer.getvalue()

def floats(value, count):
    numbers = [float(x) for x in value.strip('[]{}').split()]
    return numbers + [numbers[-1]] * (count - len(numbers)) if numbers else None

def phong_params(shader, params):
    """The pixel-shader constants phong_dx9_helper.cpp derives from a VMT (CS:GO forces half-lambert off)."""
    flag = lambda key: params.get(key, '0') not in ('0', '')
    number = lambda key, default: float(params[key]) if key in params else default
    has_exponent_map = '$phongexponenttexture' in params
    tint = floats(params['$phongtint'], 3) if '$phongtint' in params else [1.0, 1.0, 1.0]
    if tint == [0.0, 0.0, 0.0]: tint = [-1.0, 0.0, 0.0] if has_exponent_map and flag('$phongalbedotint') else [1.0, 1.0, 1.0]
    rim = flag('$rimlight') or shader == 'character'  # the character shader always compiles RIMLIGHT
    if shader == 'character':
        # Approximation: CS:GO's character shader adds a specular warp and fresnel-ranges texture lookups that are not ported.
        return {'shader': shader, 'phongBoost': number('$phongboost', 1.0), 'albedoBoost': number('$phongalbedoboost', 1.0),
                'fresnelRanges': [0.0, 0.5, 1.0], 'exponent': number('$phongexponent', 10.0), 'tint': [1.0, 1.0, 1.0], 'rim': True,
                'rimExponent': max(1.0, number('$rimlightexponent', 4.0)), 'rimBoost': number('$rimlightboost', 1.0), 'rimMaskControl': 1.0,
                'baseAlphaPhongMask': 1.0 if flag('$basealphaphongmask') else 0.0}
    return {'shader': shader, 'phongBoost': number('$phongboost', 1.0), 'albedoBoost': number('$phongalbedoboost', 1.0),
            'fresnelRanges': floats(params['$phongfresnelranges'], 3) if '$phongfresnelranges' in params else [0.0, 0.5, 1.0],
            # 0 means "read the exponent texture"; Source maps its red channel to 1..150.
            'exponent': number('$phongexponent', 0.0) if '$phongexponent' in params else (0.0 if has_exponent_map else 5.0),
            'tint': tint, 'rim': rim, 'rimExponent': max(1.0, number('$rimlightexponent', 4.0)) if rim else 4.0,
            'rimBoost': number('$rimlightboost', 1.0) if rim else 0.0,
            'rimMaskControl': number('$rimmask', 0.0) if rim and has_exponent_map else 0.0,
            'baseAlphaPhongMask': 1.0 if flag('$basemapalphaphongmask') else 0.0}

def mat_mul(a, b):
    return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]

class Glb:
    def __init__(self): self.json = {'asset': {'version': '2.0', 'generator': 'vnl-lj import_viewmodels.py'}, 'buffers': [{}], 'bufferViews': [], 'accessors': []}; self.bin = bytearray()
    def view(self, data, target=None):
        while len(self.bin) % 4: self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target: v['target'] = target
        self.bin += data; self.json['bufferViews'].append(v); return len(self.json['bufferViews']) - 1
    def accessor(self, values, kind, component, target=None, minmax=False):
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[kind]
        code = {5126: 'f', 5123: 'H', 5125: 'I'}[component]
        flat = [x for v in values for x in (v if width > 1 else [v])]
        a = {'bufferView': self.view(struct.pack(f'<{len(flat)}{code}', *flat), target), 'componentType': component, 'count': len(values), 'type': kind}
        if minmax: a['min'] = [min(v[k] for v in values) for k in range(width)]; a['max'] = [max(v[k] for v in values) for k in range(width)]
        self.json['accessors'].append(a); return len(self.json['accessors']) - 1
    def write(self, path):
        while len(self.bin) % 4: self.bin.append(0)
        self.json['buffers'][0]['byteLength'] = len(self.bin)
        text = json.dumps(self.json, separators=(',', ':')).encode()
        text += b' ' * (-len(text) % 4)
        path.write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(text) + len(self.bin)) + struct.pack('<I4s', len(text), b'JSON') + text
                         + struct.pack('<I4s', len(self.bin), b'BIN\0') + bytes(self.bin))

def build(pak, team, output):
    spec = TEAMS[team]
    knife = Model(pak, spec['knife'])
    anim = Model(pak, knife.includes[0].replace('\\', '/'))
    arms = [Model(pak, a) for a in spec['arms']]
    glb = Glb(); g = glb.json
    # Merged skeleton: knife bones, then arm-only bones (clavicles, upper arms) under their arm parents.
    nodes, index = [], {}
    for b in knife.bones:
        index[b['name']] = len(nodes); nodes.append({'name': b['name'], 'source': b, 'parent': b['parent']})
    for model in arms:
        if all(b['name'] in index for b in model.bones): continue
        idle = model.anim_frame(model.sequences()['idle'], 0)[0]
        for k, b in enumerate(model.bones):
            if b['name'] in index: continue
            parent = index[model.bones[b['parent']]['name']] if b['parent'] >= 0 else -1
            index[b['name']] = len(nodes)
            nodes.append({'name': b['name'], 'source': {'pos': idle[k][0], 'quat': idle[k][1]}, 'parent': parent})
    g['nodes'] = [{'name': n['name'], 'translation': n['source']['pos'], 'rotation': n['source']['quat']} for n in nodes]
    for k, n in enumerate(nodes):
        if n['parent'] >= 0: g['nodes'][n['parent']].setdefault('children', []).append(k)
    # Source is x forward, y left, z up; glTF is x right, y up, -z forward.
    root = len(g['nodes'])
    g['nodes'].append({'name': f'v_knife_{team}', 'rotation': [-0.5, 0.5, 0.5, 0.5], 'children': [k for k, n in enumerate(nodes) if n['parent'] < 0]})
    g['scenes'] = [{'nodes': [root]}]; g['scene'] = 0
    g['meshes'], g['skins'], g['materials'], g['textures'], g['images'], g['samplers'] = [], [], [], [], [], [{'wrapS': 10497, 'wrapT': 10497}]
    images = {}
    def image(path, normal):
        if path not in images:
            picture = decode_vtf(pak.get_file(path).read())
            data = jpeg(flat_empty_normals(picture) if normal else picture, normal)
            g['images'].append({'bufferView': glb.view(data), 'mimeType': 'image/jpeg', 'name': path.split('/')[-1]})
            g['textures'].append({'source': len(g['images']) - 1, 'sampler': 0}); images[path] = len(g['textures']) - 1
        return images[path]
    for model in [knife] + arms:
        joints = [index[b['name']] for b in model.bones]
        ibm = [[x for c in range(4) for x in (m[0][c], m[1][c], m[2][c], 0.0 if c < 3 else 1.0)] for m in (b['poseToBone'] for b in model.bones)]
        g['skins'].append({'joints': joints, 'inverseBindMatrices': glb.accessor(ibm, 'MAT4', 5126), 'skeleton': root})
        skin = len(g['skins']) - 1
        for mesh in model.meshes():
            shader, params = parse_vmt(pak, mesh['material'])
            base_path = vtf_path(params['$basetexture'])
            bump_path = vtf_path(params['$bumpmap']) if '$bumpmap' in params else None
            exp_path = vtf_path(params['$phongexponenttexture']) if '$phongexponenttexture' in params else None
            masks1_path = vtf_path(params['$masks1']) if '$masks1' in params else None
            source = phong_params(shader, params)
            material = {'name': mesh['material'].split('/')[-1], 'pbrMetallicRoughness': {'baseColorTexture': {'index': image(base_path, False)},
                        'metallicFactor': 0.0, 'roughnessFactor': 0.6}, 'extras': {'source': source}}
            if bump_path: material['normalTexture'] = {'index': image(bump_path, True)}
            # Mask texture: R = phong mask (base or normal-map alpha), G/B/A = exponent map red (exponent), green (albedo tint), alpha (rim mask).
            base_alpha = decode_vtf(pak.get_file(base_path).read()).split()[3]
            size = (512, 512 * base_alpha.size[1] // base_alpha.size[0])
            phong_mask = base_alpha if source['baseAlphaPhongMask'] or not bump_path else decode_vtf(pak.get_file(bump_path).read()).split()[3]
            channels = [phong_mask.resize(size, Image.LANCZOS)]
            if exp_path:
                r, gch, _, a = decode_vtf(pak.get_file(exp_path).read()).resize(size, Image.LANCZOS).split(); channels += [r, gch, a]
            elif masks1_path:  # character masks1: R rim mask, G phong albedo mask
                r, gch, _, _ = decode_vtf(pak.get_file(masks1_path).read()).resize(size, Image.LANCZOS).split(); channels += [Image.new('L', size, 0), gch, r]
            else:
                channels += [Image.new('L', size, 0), Image.new('L', size, 0), Image.new('L', size, 255)]
            mask = Image.merge('RGBA', channels)
            g['images'].append({'bufferView': glb.view(png(mask)), 'mimeType': 'image/png', 'name': material['name'] + '_masks'})
            g['textures'].append({'source': len(g['images']) - 1, 'sampler': 0})
            source['maskTexture'] = len(g['textures']) - 1
            g['materials'].append(material)
            tri = mesh['indices']; pos = mesh['positions']; nrm = mesh['normals']
            # Source draws clockwise front faces; glTF wants counter-clockwise. Decide from the authored normals.
            score = 0.0
            for t in range(0, len(tri), 3):
                a, b, c = (pos[v] for v in tri[t:t + 3])
                face = [(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]), (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]), (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])]
                score += sum(face[k] * nrm[tri[t]][k] for k in range(3))
            if score < 0: tri = [v for t in range(0, len(tri), 3) for v in (tri[t], tri[t + 2], tri[t + 1])]
            prim = {'attributes': {'POSITION': glb.accessor(pos, 'VEC3', 5126, 34962, True), 'NORMAL': glb.accessor(nrm, 'VEC3', 5126, 34962),
                                   'TEXCOORD_0': glb.accessor(mesh['uvs'], 'VEC2', 5126, 34962), 'JOINTS_0': glb.accessor(mesh['joints'], 'VEC4', 5123, 34962),
                                   'WEIGHTS_0': glb.accessor(mesh['weights'], 'VEC4', 5126, 34962)},
                    'indices': glb.accessor(tri, 'SCALAR', 5125 if len(pos) > 65535 else 5123, 34963), 'material': len(g['materials']) - 1}
            g['meshes'].append({'name': material['name'], 'primitives': [prim]})
            g['nodes'].append({'name': material['name'], 'mesh': len(g['meshes']) - 1, 'skin': skin})
            g['scenes'][0]['nodes'].append(len(g['nodes']) - 1)
    # Knife sequences drive the knife bones; arm-only bones keep the arms' idle pose.
    g['animations'] = []
    sequences = anim.sequences()
    names = [b['name'] for b in anim.bones]
    for name in SEQUENCES:
        pose, frames, fps = anim.anim_frame(sequences[name], 0)
        poses = [pose] + [anim.anim_frame(sequences[name], f)[0] for f in range(1, frames)]
        times = glb.accessor([f / fps for f in range(frames)], 'SCALAR', 5126, None, False)
        g['accessors'][times]['min'] = [0.0]; g['accessors'][times]['max'] = [(frames - 1) / fps]
        samplers, channels = [], []
        for k, bone in enumerate(names):
            if bone not in index: continue
            for path, values in (('translation', [p[k][0] for p in poses]), ('rotation', [p[k][1] for p in poses])):
                samplers.append({'input': times, 'output': glb.accessor(values, 'VEC3' if path == 'translation' else 'VEC4', 5126), 'interpolation': 'LINEAR'})
                channels.append({'sampler': len(samplers) - 1, 'target': {'node': index[bone], 'path': path}})
        g['animations'].append({'name': name, 'samplers': samplers, 'channels': channels})
    output.mkdir(parents=True, exist_ok=True)
    glb.write(output / f'knife_{team}.glb')
    return output / f'knife_{team}.glb'

def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('vpk'); parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    pak = vpk.open(args.vpk)
    VMTS.update(n.lower() for n in pak if n.endswith('.vmt'))
    for team in TEAMS:
        path = build(pak, team, args.output)
        print(f'{path} {path.stat().st_size} bytes')

if __name__ == '__main__':
    main()
