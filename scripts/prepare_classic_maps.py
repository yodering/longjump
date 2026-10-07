"""Prepare the two researched Workshop imports. Run after import_source_map.py.
The selection of practice pads comes from BSP brush coordinates, not recreated spacing.
Also packs the compiled lightmaps of the faces that are kept into one atlas per map (Source's LDR
lightmap format: 8-bit (L/2)^(1/2.2)), and prunes the BSP tree and leaf ambient samples to the kept area.
"""
import argparse,json,math,pathlib,shutil,struct
from PIL import Image

def intersects(b,lo,hi):return all(b['max'][a]>lo[i] and b['min'][a]<hi[i] for i,a in enumerate(('x','y','z')))
def round3(xs):return [round(x,4) for x in xs]
def clip(poly,axis,value,keepGreater):
    out=[]
    for i,p in enumerate(poly):
        previous=poly[i-1]; inside=(p[axis]>=value) if keepGreater else (p[axis]<=value)
        previousInside=(previous[axis]>=value) if keepGreater else (previous[axis]<=value)
        if inside!=previousInside:
            t=(value-previous[axis])/(p[axis]-previous[axis]);out.append([previous[k]+t*(p[k]-previous[k]) for k in range(len(p))])
        if inside:out.append(p)
    return out

def clip_meshes(meshes,lo,hi):
    result=[]
    for mesh in meshes:
        new={'material':mesh['material'],'positions':[],'normals':[],'uvs':[],'lm':[]}
        for i in range(0,len(mesh['positions'])//3,3):
            poly=[mesh['positions'][k*3:k*3+3]+mesh['normals'][k*3:k*3+3]+mesh['uvs'][k*2:k*2+2]+mesh['lm'][k*3:k*3+3] for k in range(i,i+3)]
            for axis in range(3):
                if not poly:break
                poly=clip(poly,axis,lo[axis],True);poly=clip(poly,axis,hi[axis],False) if poly else []
            for j in range(1,len(poly)-1):
                for p in [poly[0],poly[j],poly[j+1]]:
                    new['positions'].extend(round3(p[:3]));new['normals'].extend(round3(p[3:6]));new['uvs'].extend([round(v,5) for v in p[6:8]])
                    new['lm'].extend([round(p[8]),round(p[9],4),round(p[10],4)])
        if new['positions']:result.append(new)
    return result

def prepare(name,origin):
    path=pathlib.Path(origin);data=json.loads((path/'map.json').read_text());boxes=data['boxes'];lanes=[]
    if name=='longjump_source_go':
        pads=[b for b in boxes if b['max']['z']==96 and b['min']['z']==64 and b['max']['x']-b['min']['x']>100 and b['max']['y']-b['min']['y']==128]
        for start in pads:
            for end in pads:
                if start['min']['y']==end['min']['y'] and start['max']['y']==end['max']['y']:
                    gap=end['min']['x']-start['max']['x']
                    if 225<=gap<=260:
                        lanes.append({'gap':gap,'startId':start['id'],'endId':end['id'],'spawn':{'x':start['min']['x']+32,'y':(start['min']['y']+start['max']['y'])/2,'z':start['max']['z']},'yaw':1.5707963267948966})
        data['preview']={'position':{'x':700,'y':-2000,'z':540},'target':{'x':-320,'y':-1400,'z':96}}
        original=data['spawns'][0]
        data['entry']={'position':{**original['position'],'z':64},'yaw':1.5707963267948966-original['angles'][1]*3.141592653589793/180}
        data['resetFloor']=64
    else:
        lo=(-1450,740,-290);hi=(-410,3670,300)
        omitted=[b for b in data['nonAxial'] if intersects(b,lo,hi)]
        print('Non-axial brushes intersecting GO long-jump wing:',len(omitted),omitted[:3])
        data['boxes']=[b for b in boxes if intersects(b,lo,hi) and b['entityClass']=='worldspawn']
        # Keep players inside this cropped wing; the rest of the map is not imported.
        for axis in ('x','y'):
            i=('x','y','z').index(axis)
            for edge,direction in [(lo[i],-1),(hi[i],1)]:
                minimum=dict(zip(('x','y','z'),lo));maximum=dict(zip(('x','y','z'),hi))
                minimum[axis]=edge-16 if direction<0 else edge
                maximum[axis]=edge if direction<0 else edge+16
                data['boxes'].append({'id':f'wing-boundary-{axis}-{direction}','min':minimum,'max':maximum,'entityClass':'browser_boundary'})
        pads=[b for b in data['boxes'] if b['max']['z']==-192 and b['max']['y']-b['min']['y']==160 and b['max']['x']-b['min']['x']>100]
        for start in pads:
            for end in pads:
                gap=end['min']['x']-start['max']['x']
                if start['min']['y']==end['min']['y'] and 200<=gap<=280:
                    lanes.append({'gap':gap,'startId':start['id'],'endId':end['id'],'spawn':{'x':start['min']['x']+28,'y':(start['min']['y']+start['max']['y'])/2,'z':-192},'yaw':1.5707963267948966})
        # Clip triangles (and decals) and interpolate their attributes to retain only the original, static LJ wing.
        clipped=clip_meshes(data['meshes'],lo,hi);data['decals']['meshes']=clip_meshes(data['decals']['meshes'],lo,hi)
        data['meshes']=clipped;data['skippedNonAxialBrushes']=len(omitted)
        data['preview']={'position':{'x':-1320,'y':3370,'z':0},'target':{'x':-800,'y':2200,'z':-160}}
        data['entry']={'position':{'x':-1320,'y':850,'z':-192},'yaw':0}
        data['resetFloor']=-268
    lanes.sort(key=lambda x:x['gap']);data['lanes']=lanes
    crop=(lo,hi) if name!='longjump_source_go' else None
    target=pathlib.Path('public/maps')/name;target.mkdir(parents=True,exist_ok=True)
    data['lightmap']=pack_lightmaps(path,data['meshes']+data['decals']['meshes'],target)
    for mesh in data['decals']['meshes']:del mesh['normals']
    # Keep only decal materials that still have geometry (the GO wing crop contains no infodecals).
    keep=sorted({m['material'] for m in data['decals']['meshes']});remap={old:new for new,old in enumerate(keep)}
    data['decals']['materials']=[data['decals']['materials'][i] for i in keep]
    for mesh in data['decals']['meshes']:mesh['material']=remap[mesh['material']]
    if data['decals']['meshes']:
        (target/'decals').mkdir(exist_ok=True)
        for material in data['decals']['materials']:shutil.copyfile(path/material['texture'],target/material['texture'])
    data['lighting']=model_lighting(path,crop,target)
    for key in ['numericFaces','nonAxial','spawns']:data.pop(key,None)
    texturePaths={data['materials'][m['material']].get(key) for m in data['meshes'] for key in ('texture','normalMap')}
    for texture in texturePaths:
        if texture:
            (target/'textures').mkdir(exist_ok=True);shutil.copyfile(path/texture,target/texture)
    if data.get('sky'):
        (target/'sky').mkdir(exist_ok=True)
        for face in data['sky']['faces'].values():shutil.copyfile(path/face,target/face)
    (target/'map.json').write_text(json.dumps(data,separators=(',',':')))
    print(name,'lanes',[l['gap'] for l in lanes],'triangles',sum(len(m['positions'])//9 for m in data['meshes']))

def pack_lightmaps(path,meshes,target):
    """Shelf-pack each kept face's style-0 lightmap (with a 1-luxel replicated border) and add per-vertex uv2.
    Bumped faces get their four lightmaps side by side, as Source lays them out in a lightmap page; lmStep is the
    uv offset from one to the next (0 for unbumped faces)."""
    info=json.loads((path/'lighting.json').read_text());faces=info['faces'];blob=(path/'lightmaps.bin').read_bytes()
    used=sorted({int(m['lm'][k]) for m in meshes for k in range(0,len(m['lm']),3) if int(m['lm'][k])>=0},key=lambda f:-faces[str(f)][2])
    blocks=lambda f:4 if faces[str(f)][3] else 1
    def place(width):
        x=y=shelf=0;spots={}
        for f in used:
            w,h=(faces[str(f)][1]+2)*blocks(f),faces[str(f)][2]+2
            if x+w>width:x,y,shelf=0,y+shelf,0
            spots[f]=(x+1,y+1);x+=w;shelf=max(shelf,h)
        return spots,y+shelf
    width=256
    while True:
        spots,height=place(width)
        if height<=width:break
        width*=2
    height=max(4,1<<math.ceil(math.log2(max(height+2,1))))
    # One white luxel block for faces without a lightmap (fullbright in Source).
    white=(width-2,height-2)
    image=Image.new('RGB',(width,height),(255,255,255))
    pixels=image.load()
    def encode(o):
        r,g,b,e=struct.unpack_from('<BBBb',blob,o*4);scale=2.0**e/255.0
        return tuple(min(255,round(255*min(1.0,c*scale/2)**(1/2.2))) for c in (r,g,b))
    for f in used:
        start,w,h,_=faces[str(f)];x0,y0=spots[f]
        for block in range(blocks(f)):
            bx=x0+block*(w+2);base=start+block*w*h
            for t in range(-1,h+1):
                for s in range(-1,w+1):
                    pixels[bx+s,y0+t]=encode(base+min(h-1,max(0,t))*w+min(w-1,max(0,s)))
    image.save(target/'lightmap.webp',lossless=True,quality=100,method=6)
    for mesh in meshes:
        uv2=[];step=[]
        for k in range(0,len(mesh['lm']),3):
            f,s,t=int(mesh['lm'][k]),mesh['lm'][k+1],mesh['lm'][k+2]
            x0,y0=spots.get(f,white);s,t=(s,t) if f in spots else (0.5,0.5)
            uv2+= [round((x0+s+0.5)/width,5),round((y0+t+0.5)/height,5)]
            step.append(round((faces[str(f)][1]+2)/width,6) if f in spots and blocks(f)==4 else 0)
        mesh['uv2']=uv2;del mesh['lm']
        if any(step):mesh['lmStep']=step
    print(target.name,'lightmap atlas',width,'x',height,'faces',len(used),'bumped',sum(1 for f in used if blocks(f)==4))
    return {'texture':'lightmap.webp','width':width,'height':height}

def model_lighting(path,crop,target):
    """BSP tree, leaf ambient cubes and world lights for lighting the viewmodel, pruned to the kept area."""
    info=json.loads((path/'lighting.json').read_text())
    def inside(mins,maxs):return crop is None or all(maxs[a]>=crop[0][a]-64 and mins[a]<=crop[1][a]+64 for a in range(3))
    nodes=info['nodes'];leaves=info['leaves']
    keepLeaves={i for i,l in enumerate(leaves) if inside(l['mins'],l['maxs'])}
    def prune(n):
        if n<0:return n if (-n-1) in keepLeaves else -1  # leaf 0 is the solid leaf: no samples
        node=nodes[n];return [node[0],prune(node[1]),prune(node[2])] if inside(node[3:6],node[6:9]) else -1
    planeIds=set();flat=[]
    def flatten(t):
        if isinstance(t,int):return t
        index=len(flat);flat.append(None);planeIds.add(t[0])
        flat[index]=[t[0],flatten(t[1]),flatten(t[2])];return index
    root=flatten(prune(0))
    planeMap={p:i for i,p in enumerate(sorted(planeIds))}
    # lighting.bin: per sample, int16 x/y/z then six ColorRGBExp32 cube sides (+x -x +y -y +z -z, Source axes).
    blob=bytearray();leafSamples={}
    byLeaf={}
    for sample in info['samples']:
        if sample['leaf'] in keepLeaves:byLeaf.setdefault(sample['leaf'],[]).append(sample)
    for leaf,items in sorted(byLeaf.items()):
        leafSamples[str(leaf)]=[len(blob)//30,len(items)]
        for sample in items:blob+=struct.pack('<3h6I',*(round(v) for v in sample['position']),*sample['cube'])
    (target/'lighting.bin').write_bytes(bytes(blob))
    lights=[w for w in info['worldlights'] if w['type'] in (1,2,3) and (w['type']==3 or inside(w['origin'],w['origin']))]
    return {'root':root,'nodes':[[planeMap[n[0]],n[1],n[2]] for n in flat],'planes':[[round(v,4) for v in info['planes'][p]] for p in sorted(planeIds)],
            'samples':'lighting.bin','leafSamples':leafSamples,'lights':[{k:w[k] for k in ('type','origin','intensity','normal','stopdot','stopdot2','exponent','attenuation')} for w in lights]}

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source',required=True,help='Converted longjump_source_go directory')
parser.add_argument('--go',required=True,help='Converted kz_longjumps_go directory')
args=parser.parse_args()
prepare('longjump_source_go',args.source)
prepare('kz_longjumps_go',args.go)
