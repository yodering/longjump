#!/usr/bin/env python3
"""Convert CS:GO's third-person ST6 (CT) and Phoenix (T) players, holding their default knives, to animated GLB files.

Usage: python import_players.py path/to/csgo/pak01_dir.vpk output-directory
Requires Pillow and vpk (pip install pillow vpk). Only reads the VPK; nothing from it is executed.

Needs VPK chunks 003, 005, 007, 010, 014, 020, 081, 126 and 140 plus pak01_dir.vpk from Steam depot 731
(see research/viewmodels/README.md for the anonymous download).

Players include animset_ct.mdl / animset_t.mdl, whose sequences store per-bone run-length-encoded
animation (mstudioanim_t, bone_decode.cpp). CS:GO layers them at runtime (csgo_playeranimstate.cpp):
a full-body knife aim pose (knife_aim_*), then the nine-direction movement cycle (move_knife_r/w/c) and
jump/fall/land sequences through each sequence's per-bone weight list. This script bakes those combinations
into straight glTF clips; the game blends between them with three.js.
"""
import argparse, math, pathlib, re, struct
import vpk
from PIL import Image
import import_viewmodels as iv
from import_viewmodels import Model, i32, cstr, quat48, quat48s, vec48

TEAMS = {
    'ct': {'body': 'models/player/custom_player/legacy/ctm_st6.mdl', 'knife': 'models/weapons/w_knife_default_ct.mdl'},
    't': {'body': 'models/player/custom_player/legacy/tm_phoenix.mdl', 'knife': 'models/weapons/w_knife_default_t.mdl'},
}
RAWPOS, RAWROT, ANIMPOS, ANIMROT, DELTA, RAWROT2 = 0x01, 0x02, 0x04, 0x08, 0x10, 0x20
FRAMEANIM, ANIM_DELTA = 0x40, 0x04
# Remote players are seen at a distance; larger textures only add download size.
COLOR_SIZE, NORMAL_SIZE, MASK_SIZE = 1024, 512, 256
DIRECTIONS = ['n', 'nw', 'w', 'sw', 's', 'se', 'e', 'ne']  # move_yaw blend cells 0-7 (cell 8 repeats north)

def quat64(d, o):
    v = struct.unpack_from('<Q', d, o)[0]
    x, y, z = ((v >> s) & 0x1fffff for s in (0, 21, 42))
    q = [(x - 1048576) / 1048576.5, (y - 1048576) / 1048576.5, (z - 1048576) / 1048576.5]
    w = math.sqrt(max(0.0, 1 - sum(c * c for c in q)))
    return q + [-w if v >> 63 else w]

def euler_quat(a):
    """Source AngleQuaternion(RadianEuler): x roll, y pitch, z yaw."""
    sr, cr = math.sin(a[0] / 2), math.cos(a[0] / 2)
    sp, cp = math.sin(a[1] / 2), math.cos(a[1] / 2)
    sy, cy = math.sin(a[2] / 2), math.cos(a[2] / 2)
    return [sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy]

def anim_value(d, o, frame, scale):
    """ExtractAnimValue: run-length encoded shorts (valid, total) followed by values."""
    k = frame
    while True:
        valid, total = d[o], d[o + 1]
        if total == 0: return 0.0
        if total > k: break
        k -= total; o += (valid + 1) * 2
    index = k + 1 if valid > k else valid
    return struct.unpack_from('<h', d, o + index * 2)[0] * scale

def slerp(a, b, t):
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0: b, dot = [-x for x in b], -dot
    if dot > 0.9995:
        q = [x + (y - x) * t for x, y in zip(a, b)]
    else:
        theta = math.acos(dot); s = math.sin(theta)
        q = [x * math.sin((1 - t) * theta) / s + y * math.sin(t * theta) / s for x, y in zip(a, b)]
    n = math.sqrt(sum(x * x for x in q)) or 1.0
    return [x / n for x in q]

class AnimSet(Model):
    """Animation-only model: sequences, blend grids, weight lists and per-frame bone poses."""
    def seq(self, name):
        d = self.d
        for s in range(i32(d, 188)):
            o = i32(d, 192) + s * 212
            if cstr(d, o + i32(d, o + 4)) == name: return o
        raise KeyError(name)
    def blend(self, name, x, y=0):
        """Animation index for grid cell (x, y) of a sequence's blend grid."""
        o = self.seq(name)
        return struct.unpack_from('<h', self.d, o + i32(self.d, o + 60) + (y * i32(self.d, o + 68) + x) * 2)[0]
    def weights(self, name):
        o = self.seq(name)
        return struct.unpack_from(f'<{len(self.bones)}f', self.d, o + i32(self.d, o + 156))
    def info(self, anim):
        a = i32(self.d, 184) + anim * 100
        return {'name': cstr(self.d, a + i32(self.d, a + 4)), 'fps': struct.unpack_from('<f', self.d, a + 8)[0],
                'flags': i32(self.d, a + 12), 'frames': i32(self.d, a + 16), 'movements': i32(self.d, a + 20), 'movementindex': i32(self.d, a + 24)}
    def speed(self, anim):
        """Ground speed from the animation's movement record (units per second)."""
        a = i32(self.d, 184) + anim * 100
        info = self.info(anim)
        if not info['movements']: return 0.0
        m = a + info['movementindex']
        endframe, _, v0, v1, _ = struct.unpack_from('<iifff', self.d, m)
        position = struct.unpack_from('<3f', self.d, m + 32)
        duration = max(1, endframe) / info['fps']
        return math.hypot(position[0], position[1]) / duration
    def pose(self, anim, frame):
        """Local (pos, quat) for every bone at an integer frame. Delta animations leave unlisted bones at identity."""
        d, a = self.d, i32(self.d, 184) + anim * 100
        info = self.info(anim)
        if info['flags'] & FRAMEANIM: return self.anim_frame(anim, frame)[0]
        frames, block, index, sectionframes = info['frames'], i32(d, a + 52), i32(d, a + 56), i32(d, a + 84)
        local = frame
        if sectionframes:
            if frames > sectionframes and frame == frames - 1: section, local = (frames - 1) // sectionframes + 1, 0
            else: section, local = frame // sectionframes, frame % sectionframes
            block, index = struct.unpack_from('<ii', d, a + i32(d, a + 80) + section * 8)
        if block != 0: raise ValueError(f'{self.path}: external animation blocks are not supported')
        if info['flags'] & ANIM_DELTA: pose = [([0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]) for _ in self.bones]
        else: pose = [(list(b['pos']), list(b['quat'])) for b in self.bones]
        o = a + index
        while True:
            bone, flags, next_offset = d[o], d[o + 1], struct.unpack_from('<h', d, o + 2)[0]
            b, p = self.bones[bone], o + 4
            delta = flags & DELTA
            if flags & RAWROT: q = quat48(d, p); p += 6
            elif flags & RAWROT2: q = quat64(d, p); p += 8
            elif flags & ANIMROT:
                offsets = struct.unpack_from('<3h', d, p)
                angle = [anim_value(d, p + offsets[k], local, b['rotscale'][k]) if offsets[k] else 0.0 for k in range(3)]
                if not delta: angle = [angle[k] + b['rot'][k] for k in range(3)]
                q = euler_quat(angle); p += 6
            else: q = [0.0, 0.0, 0.0, 1.0] if delta else b['quat']
            if flags & RAWPOS: v = vec48(d, p)
            elif flags & ANIMPOS:
                offsets = struct.unpack_from('<3h', d, p)
                v = [anim_value(d, p + offsets[k], local, b['posscale'][k]) if offsets[k] else 0.0 for k in range(3)]
                if not delta: v = [v[k] + b['pos'][k] for k in range(3)]
            else: v = [0.0, 0.0, 0.0] if delta else b['pos']
            pose[bone] = (list(v), list(q))
            if not next_offset: break
            o += next_offset
        return pose

def with_euler(model):
    """Adds each bone's default Euler rotation and scales (needed to decode animated rotations)."""
    for k, b in enumerate(model.bones):
        o = i32(model.d, 160) + k * 216
        b['rot'] = list(struct.unpack_from('<3f', model.d, o + 60))
        b['posscale'] = list(struct.unpack_from('<3f', model.d, o + 72))
        b['rotscale'] = list(struct.unpack_from('<3f', model.d, o + 84))
    return model

def layer(base, over, weights, amount=1.0):
    """A non-delta layer: per-bone slerp toward the layer by its weight list, as Source's SlerpBones does."""
    out = []
    for k, (p, q) in enumerate(base):
        w = weights[k] * amount
        if w <= 0: out.append((p, q)); continue
        op, oq = over[k]
        out.append(([a + (b - a) * w for a, b in zip(p, op)], slerp(q, oq, w)))
    return out

def qmul(a, b):
    """Hamilton product a * b with (x, y, z, w) components, as Source's QuaternionMult."""
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]

def add(base, delta, weights, amount=1.0):
    """A delta layer, as Source's QuaternionSM: rotation = delta^w * base, position = base + w * delta."""
    out = []
    for k, (p, q) in enumerate(base):
        w = weights[k] * amount
        if w <= 0: out.append((p, q)); continue
        dp, dq = delta[k]
        out.append(([a + b * w for a, b in zip(p, dp)], qmul(slerp([0.0, 0.0, 0.0, 1.0], dq, w), q)))
    return out

def sample(animset, anim, frames):
    """The animation resampled to a fixed frame count by cycle, so every direction in a set loops together."""
    total = animset.info(anim)['frames']
    return [animset.pose(anim, min(total - 1, round(f * (total - 1) / max(1, frames - 1)))) for f in range(frames)]

def clips(animset):
    """name -> (fps, frames of poses, ground speed). Aim poses look straight ahead (grid centre)."""
    aim = {state: animset.pose(animset.blend(f'knife_aim_{state}', 1, 1), 0) for state in ('idle', 'walk', 'run', 'crouch_idle', 'crouch_moving')}
    out = {'idle': (30.0, [aim['idle']], 0.0), 'crouch_idle': (30.0, [aim['crouch_idle']], 0.0)}
    for kind, sequence, base in (('run', 'move_knife_r', 'run'), ('walk', 'move_knife_w', 'walk'), ('crouch', 'move_knife_c', 'crouch_moving')):
        weights = animset.weights(sequence)
        reference = animset.blend(sequence, 0)  # north
        frames, fps = animset.info(reference)['frames'], animset.info(reference)['fps']
        for k, direction in enumerate(DIRECTIONS):
            anim = animset.blend(sequence, k)
            poses = [layer(aim[base], p, weights) for p in sample(animset, anim, frames)]
            out[f'{kind}_{direction}'] = (fps, poses, animset.speed(anim))
    # Reference poses the game applies additively: aim pitch and yaw at the ends of the aim grid
    # (yaw +-60, pitch +-90; CS:GO's negative pitch looks up), standing and crouched, and the four leans.
    for state, prefix in (('idle', ''), ('crouch_idle', 'crouch_')):
        for name, (x, y) in {'aim_up': (1, 0), 'aim_down': (1, 2), 'aim_right': (0, 1), 'aim_left': (2, 1)}.items():
            out[prefix + name] = (30.0, [animset.pose(animset.blend(f'knife_aim_{state}', x, y), 0)], 0.0)
    for k, direction in enumerate(('s', 'w', 'n', 'e')):
        out[f'lean_{direction}'] = (30.0, [layer(aim['idle'], animset.pose(animset.blend('lean', k), 0), animset.weights('lean'))], 0.0)
    # The idle pose breaker (CS:GO's alive loop) is a delta animation; bake it onto the idle pose.
    alive = animset.blend('additive_posebreaker_knife', 0); info = animset.info(alive)
    out['alive'] = (info['fps'], [add(aim['idle'], animset.pose(alive, f), animset.weights('additive_posebreaker_knife')) for f in range(info['frames'])], 0.0)
    for name, base in (('jump', 'idle'), ('fall', 'idle'), ('land_light', 'idle'), ('land_heavy', 'idle')):
        anim = animset.blend(name, 0); info = animset.info(anim); weights = animset.weights(name)
        out[name] = (info['fps'], [layer(aim[base], animset.pose(anim, f), weights) for f in range(info['frames'])], 0.0)
    return out

def material_for(pak, glb, g, images, mesh):
    """Source phong material: base, normal and packed mask textures plus the VMT constants."""
    shader, params = iv.parse_vmt(pak, mesh['material'])
    path = lambda key: re.sub('/+', '/', iv.vtf_path(params[key])) if key in params else None
    base_path, bump_path = path('$basetexture'), path('$bumpmap')
    def image(p, normal):
        if p not in images:
            picture, limit = iv.decode_vtf(pak.get_file(p).read()), NORMAL_SIZE if normal else COLOR_SIZE
            if normal: picture = iv.flat_empty_normals(picture)  # before resizing, so empty texels do not bleed into islands
            if max(picture.size) > limit: picture = picture.resize((picture.size[0] * limit // max(picture.size), picture.size[1] * limit // max(picture.size)), Image.LANCZOS)
            data = iv.jpeg(picture, normal)
            g['images'].append({'bufferView': glb.view(data), 'mimeType': 'image/jpeg', 'name': p.split('/')[-1]})
            g['textures'].append({'source': len(g['images']) - 1, 'sampler': 0}); images[p] = len(g['textures']) - 1
        return images[p]
    source = iv.phong_params(shader, params)
    material = {'name': mesh['material'].split('/')[-1], 'pbrMetallicRoughness': {'baseColorTexture': {'index': image(base_path, False)},
                'metallicFactor': 0.0, 'roughnessFactor': 0.6}, 'extras': {'source': source}}
    if '$translucent' in params and params['$translucent'] not in ('0', ''): material['alphaMode'] = 'BLEND'
    if bump_path: material['normalTexture'] = {'index': image(bump_path, True)}
    # Source phong masks: R = phong mask, G/B/A = exponent map red (exponent), green (albedo tint), alpha (rim mask),
    # as the viewmodel importer packs them, at a small size since players are seen at a distance.
    exp_path, masks1_path = path('$phongexponenttexture'), path('$masks1')
    size = (MASK_SIZE, MASK_SIZE)
    phong_mask = iv.decode_vtf(pak.get_file(base_path if source['baseAlphaPhongMask'] or not bump_path else bump_path).read()).split()[3]
    channels = [phong_mask.resize(size, Image.LANCZOS)]
    if exp_path:
        r, gch, _, a = iv.decode_vtf(pak.get_file(exp_path).read()).resize(size, Image.LANCZOS).split(); channels += [r, gch, a]
    elif masks1_path:
        r, gch, _, _ = iv.decode_vtf(pak.get_file(masks1_path).read()).resize(size, Image.LANCZOS).split(); channels += [Image.new('L', size, 0), gch, r]
    else:
        channels += [Image.new('L', size, 0), Image.new('L', size, 0), Image.new('L', size, 255)]
    g['images'].append({'bufferView': glb.view(iv.png(Image.merge('RGBA', channels))), 'mimeType': 'image/png', 'name': material['name'] + '_masks'})
    g['textures'].append({'source': len(g['images']) - 1, 'sampler': 0})
    source['maskTexture'] = len(g['textures']) - 1
    g['materials'].append(material)
    return len(g['materials']) - 1

def build(pak, team, output):
    spec = TEAMS[team]
    body = with_euler(Model(pak, spec['body']))
    animset = with_euler(AnimSet(pak, body.includes[0].replace('\\', '/')))
    knife = Model(pak, spec['knife'])
    glb = iv.Glb(); glb.json['asset']['generator'] = 'vnl-lj import_players.py'; g = glb.json
    # One skeleton: the body's bones, plus any knife-only bones under their body parents (bone merge by name).
    nodes, index = [], {}
    for b in body.bones:
        index[b['name']] = len(nodes); nodes.append({'name': b['name'], 'pos': b['pos'], 'quat': b['quat'], 'parent': b['parent']})
    for b in knife.bones:
        if b['name'] in index: continue
        parent = index.get(knife.bones[b['parent']]['name'], -1) if b['parent'] >= 0 else -1
        index[b['name']] = len(nodes); nodes.append({'name': b['name'], 'pos': b['pos'], 'quat': b['quat'], 'parent': parent})
    g['nodes'] = [{'name': n['name'], 'translation': n['pos'], 'rotation': n['quat']} for n in nodes]
    for k, n in enumerate(nodes):
        if n['parent'] >= 0: g['nodes'][n['parent']].setdefault('children', []).append(k)
    # Source model space is x forward, y left, z up; glTF faces -z with y up.
    root = len(g['nodes'])
    g['nodes'].append({'name': f'player_{team}', 'rotation': [-0.5, 0.5, 0.5, 0.5], 'children': [k for k, n in enumerate(nodes) if n['parent'] < 0]})
    g['scenes'] = [{'nodes': [root]}]; g['scene'] = 0
    g['meshes'], g['skins'], g['materials'], g['textures'], g['images'], g['samplers'] = [], [], [], [], [], [{'wrapS': 10497, 'wrapT': 10497}]
    images = {}
    for model in (body, knife):
        joints = [index[b['name']] for b in model.bones]
        ibm = [[x for c in range(4) for x in (m[0][c], m[1][c], m[2][c], 0.0 if c < 3 else 1.0)] for m in (b['poseToBone'] for b in model.bones)]
        g['skins'].append({'joints': joints, 'inverseBindMatrices': glb.accessor(ibm, 'MAT4', 5126), 'skeleton': root})
        skin = len(g['skins']) - 1
        for mesh in model.meshes():
            material = material_for(pak, glb, g, images, mesh)
            tri, pos, nrm = mesh['indices'], mesh['positions'], mesh['normals']
            score = 0.0
            for t in range(0, len(tri), 3):
                a, b, c = (pos[v] for v in tri[t:t + 3])
                face = [(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]), (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]), (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])]
                score += sum(face[k] * nrm[tri[t]][k] for k in range(3))
            if score < 0: tri = [v for t in range(0, len(tri), 3) for v in (tri[t], tri[t + 2], tri[t + 1])]
            prim = {'attributes': {'POSITION': glb.accessor(pos, 'VEC3', 5126, 34962, True), 'NORMAL': glb.accessor(nrm, 'VEC3', 5126, 34962),
                                   'TEXCOORD_0': glb.accessor(mesh['uvs'], 'VEC2', 5126, 34962), 'JOINTS_0': glb.accessor(mesh['joints'], 'VEC4', 5123, 34962),
                                   'WEIGHTS_0': glb.accessor(mesh['weights'], 'VEC4', 5126, 34962)},
                    'indices': glb.accessor(tri, 'SCALAR', 5125 if len(pos) > 65535 else 5123, 34963), 'material': material}
            name = g['materials'][material]['name']
            g['meshes'].append({'name': name, 'primitives': [prim]})
            g['nodes'].append({'name': name, 'mesh': len(g['meshes']) - 1, 'skin': skin})
            g['scenes'][0]['nodes'].append(len(g['nodes']) - 1)
    # Baked clips drive every animset bone the body shares; others keep their bind pose.
    g['animations'], speeds = [], {}
    names = [b['name'] for b in animset.bones]
    for name, (fps, poses, speed) in clips(animset).items():
        if speed: speeds[name] = round(speed, 2)
        frames = len(poses)
        times = glb.accessor([f / fps for f in range(frames)], 'SCALAR', 5126)
        g['accessors'][times]['min'] = [0.0]; g['accessors'][times]['max'] = [(frames - 1) / fps]
        samplers, channels = [], []
        single = glb.accessor([0.0], 'SCALAR', 5126); g['accessors'][single]['min'] = [0.0]; g['accessors'][single]['max'] = [0.0]
        for k, bone in enumerate(names):
            if bone not in index: continue
            node = g['nodes'][index[bone]]
            for path, values in (('translation', [p[k][0] for p in poses]), ('rotation', [p[k][1] for p in poses])):
                # Size: drop tracks that never move and match the node, and store unchanging ones as one key.
                rest = node['translation'] if path == 'translation' else node['rotation']
                constant = all(max(abs(a - b) for a, b in zip(v, values[0])) < 1e-4 for v in values)
                if constant and max(abs(a - b) for a, b in zip(values[0], rest)) < 1e-4: continue
                if constant: values, input_ = values[:1], single
                else: input_ = times
                if path == 'rotation':
                    # Normalized 16-bit quaternions (glTF allows normalized integer rotation outputs).
                    flat = [max(-32767, min(32767, round(c * 32767))) for v in values for c in (v if v[3] >= 0 else [-x for x in v])]
                    accessor = {'bufferView': glb.view(struct.pack(f'<{len(flat)}h', *flat)), 'componentType': 5122, 'normalized': True, 'count': len(values), 'type': 'VEC4'}
                    g['accessors'].append(accessor); values_accessor = len(g['accessors']) - 1
                else: values_accessor = glb.accessor(values, 'VEC3', 5126)
                samplers.append({'input': input_, 'output': values_accessor, 'interpolation': 'LINEAR' if len(values) > 1 else 'STEP'})
                channels.append({'sampler': len(samplers) - 1, 'target': {'node': index[bone], 'path': path}})
        g['animations'].append({'name': name, 'samplers': samplers, 'channels': channels})
    g['scenes'][0]['extras'] = {'groundSpeed': speeds}
    output.mkdir(parents=True, exist_ok=True)
    path = output / f'player_{team}.glb'
    glb.write(path)
    return path

def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('vpk'); parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    pak = vpk.open(args.vpk)
    iv.VMTS.update(n.lower() for n in pak if n.endswith('.vmt'))
    for team in TEAMS:
        path = build(pak, team, args.output)
        print(f'{path} {path.stat().st_size} bytes')

if __name__ == '__main__':
    main()
