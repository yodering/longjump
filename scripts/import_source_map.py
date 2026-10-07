#!/usr/bin/env python3
"""Convert a locally supplied Source BSP v21 to browser geometry, axial collision and packed textures.

Usage: python import_source_map.py file.bsp output-directory [--vpk path/to/csgo/pak01_dir.vpk]
Requires Pillow. No decompiler/executable or map entity script is executed.
Layouts: ValveSoftware/source-sdk-2013 src/public/bspfile.h.
Also exports the compiled lighting: each drawn face's style-0 lightmap (lightmaps.bin, raw ColorRGBExp32 luxels),
per-vertex lightmap coordinates, and lighting.json with the BSP tree, per-leaf ambient cubes and world lights.
The 2D skybox named by worldspawn's skyname is exported from the map's pak, or from the CS:GO VPK (--vpk, needs `pip install vpk`).
"""
import argparse, collections, hashlib, io, json, math, pathlib, re, struct, zipfile
from PIL import Image

def vec(values): return dict(zip(('x', 'y', 'z'), (round(v, 4) for v in values)))

def decode_vtf(data):
    if data[:4] != b'VTF\0': raise ValueError('Not VTF')
    width, height = struct.unpack_from('<HH', data, 16)
    frames = struct.unpack_from('<H', data, 24)[0]
    flags = struct.unpack_from('<I', data, 20)[0]
    fmt = struct.unpack_from('<I', data, 52)[0]
    if frames != 1 or flags & 0x4000: raise ValueError('Animated/cubemap VTF unsupported')
    if fmt in (13, 14, 15):
        block = 8 if fmt == 13 else 16
        size = max(1, (width + 3)//4) * max(1, (height + 3)//4) * block
        pixels = data[-size:]
        fourcc = {13:b'DXT1', 14:b'DXT3', 15:b'DXT5'}[fmt]
        # Pillow's maintained DDS decoder handles the identical BC pixel blocks.
        header = struct.pack('<7I', 124, 0x81007, height, width, size, 0, 1) + bytes(44)
        header += struct.pack('<II4s5I', 32, 4, fourcc, 0, 0, 0, 0, 0)
        header += struct.pack('<5I', 0x1000, 0, 0, 0, 0)
        return Image.open(io.BytesIO(b'DDS '+header+pixels)).convert('RGBA')
    # Uncompressed formats: RGBA8888, RGB888, BGR888, I8, BGRA8888 (largest mip last).
    raw={0:('RGBA',4,'RGBA'),2:('RGB',3,'RGB'),3:('RGB',3,'BGR'),5:('L',1,'L'),12:('RGBA',4,'BGRA')}
    if fmt in raw:
        mode,bpp,order=raw[fmt]
        return Image.frombytes(mode,(width,height),data[-width*height*bpp:],'raw',order).convert('RGBA')
    raise ValueError(f'Unsupported VTF format {fmt}')

SKY_SUFFIXES = ('rt', 'lf', 'bk', 'ft', 'up', 'dn')

def export_sky(name, pak, paknames, vpk_path, output):
    """Six skybox faces as lossy WebP (an unlit background, so small files matter more than exact pixels)."""
    store = None
    if vpk_path:
        import vpk
        store = vpk.open(str(vpk_path))
    def read(path):
        if path in paknames: return pak.read(paknames[path])
        if store is not None:
            try: return store.get_file(path).read()
            except KeyError: return None
        return None
    (output/'sky').mkdir(exist_ok=True); faces = {}
    for suffix in SKY_SUFFIXES:
        vmt = read(f'materials/skybox/{name}{suffix}.vmt'.lower())
        texture = f'skybox/{name}{suffix}'
        if vmt:
            match = re.search(r'\$basetexture"?\s+"?([^"\s]+)', vmt.decode(errors='replace'), re.I)
            if match: texture = match[1].replace('\\', '/').lower()
        data = read(f'materials/{texture}.vtf')
        if data is None: return None
        image = decode_vtf(data).convert('RGB'); image.thumbnail((512, 512))
        image.save(output/'sky'/f'{suffix}.webp', quality=85, method=6)
        faces[suffix] = f'sky/{suffix}.webp'
    return {'name': name, 'faces': faces, 'source': 'map pak' if f'materials/skybox/{name}rt.vtf'.lower() in paknames else 'CS:GO VPK'}

DECAL_DISTANCE = 4.0  # engine/r_decal.cpp
DECAL_NORMAL_OFFSET = 0.1  # decal_clip.cpp offsets clipped verts along the normal to avoid flicker

def decal_basis(normal):
    """R_DecalComputeBasis without an s-axis (static infodecals): S along +X on floors, T straight down on walls."""
    cross=lambda a,b:(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
    unit=lambda v:tuple(x/math.sqrt(sum(c*c for c in v)) for x in v)
    if abs(normal[2])>math.sqrt(0.5):
        t=cross((1,0,0),normal);s=cross(normal,t)
    else:
        s=cross(normal,(0,0,-1));t=cross(s,normal)
    return unit(s),unit(t)

def project_decals(entities,worldFaces,read,output):
    """Static infodecals as the engine places them (R_DecalShoot -> R_DecalSurface -> R_DecalVertsClip): every world
    surface whose plane is within DECAL_DISTANCE of the origin gets the decal quad, sized by the base texture's
    mapping size times $decalscale, clipped to the surface polygon and lit by that surface's lightmap."""
    (output/'decals').mkdir(exist_ok=True)
    materials={};groups=collections.defaultdict(lambda:{'positions':[],'uvs':[],'normals':[],'lm':[]});missing=collections.Counter()
    def material(name):
        if name in materials:return materials[name]
        vmt=read(f'materials/{name}.vmt');result=None
        if vmt:
            text=vmt.decode(errors='replace');shader=text.strip().split()[0].strip('"').lower()
            value=lambda key,default:(re.search(r'"?\$'+key+r'"?\s+"?([^"\s]+)',text,re.I) or [None,default])[1]
            base=value('basetexture',None);vtf=read('materials/'+base.replace('\\','/').lower()+'.vtf') if base else None
            if vtf:
                image=decode_vtf(vtf);width,height=image.size;image.thumbnail((256,256))
                filename=hashlib.sha1(name.encode()).hexdigest()[:12]+'.webp';image.save(output/'decals'/filename,lossless=True)
                result={'name':name,'texture':'decals/'+filename,'width':width,'height':height,'scale':float(value('decalscale',1)),
                        'blend':'modulate' if shader=='decalmodulate' else 'alpha','lit':shader not in ('unlitgeneric','decalmodulate')}
        materials[name]=result;return result
    order=[]
    for e in entities:
        if e.get('classname')!='infodecal' or 'texture' not in e:continue
        m=material(e['texture'].lower())
        if not m:missing[e['texture'].lower()]+=1;continue
        if m['name'] not in order:order.append(m['name'])
        pos=tuple(map(float,e['origin'].split()));W,H=m['width']*m['scale'],m['height']*m['scale']
        for f in worldFaces:
            n=f['normal']
            if abs(sum(pos[a]*n[a] for a in range(3))-f['dist'])>=DECAL_DISTANCE:continue
            S,T=decal_basis(n)
            poly=[list(p)+[sum((p[a]-pos[a])*S[a] for a in range(3))/W+0.5,sum((p[a]-pos[a])*T[a] for a in range(3))/H+0.5] for p in f['points']]
            # Clip to the decal's texture square, u and v in [0, 1] (SHClip top/left/right/bottom).
            for k,bound,greater in ((3,0.0,True),(3,1.0,False),(4,0.0,True),(4,1.0,False)):
                inside=(lambda x:x>=bound) if greater else (lambda x:x<=bound)
                out=[]
                for i,q in enumerate(poly):
                    prev=poly[i-1]
                    if inside(q[k])!=inside(prev[k]):
                        t=(bound-prev[k])/(q[k]-prev[k]);out.append([prev[c]+t*(q[c]-prev[c]) for c in range(5)])
                    if inside(q[k]):out.append(q)
                poly=out
                if not poly:break
            if len(poly)<3:continue
            info=f['info'];g=groups[m['name']]
            for j in range(1,len(poly)-1):
                for q in (poly[0],poly[j],poly[j+1]):
                    g['positions'].extend(round(q[a]+n[a]*DECAL_NORMAL_OFFSET,4) for a in range(3))
                    g['normals'].extend(round(v,4) for v in n);g['uvs'].extend([round(q[3],5),round(1-q[4],5)])
                    ls=sum(q[a]*info[8+a] for a in range(3))+info[11]-f['lmMins'][0];lt=sum(q[a]*info[12+a] for a in range(3))+info[15]-f['lmMins'][1]
                    g['lm'].extend([f['face'] if f['lit'] else -1,round(ls,4),round(lt,4)])
    if missing:print('Decal materials not found:',dict(missing))
    used=[n for n in order if groups[n]['positions']]
    print(f'Decals: {sum(len(groups[n]["positions"])//9 for n in used)} triangles across {len(used)} materials')
    return {'materials':[materials[n] for n in used],'meshes':[dict(material=i,**groups[n]) for i,n in enumerate(used)]}

def convert(source, output, vpk_path=None):
    data = source.read_bytes()
    if data[:4] != b'VBSP' or struct.unpack_from('<i',data,4)[0] != 21: raise ValueError('Expected uncompressed Source BSP v21')
    lumps = [struct.unpack_from('<4i',data,8+i*16) for i in range(64)]
    def lump(i):
        offset, length, _, compression = lumps[i]
        if compression: raise ValueError(f'Compressed lump {i} unsupported')
        return data[offset:offset+length]
    def records(i, fmt): return list(struct.iter_unpack(fmt,lump(i)))
    planes = records(1,'<4fi'); texdata = records(2,'<3f5i'); vertices = records(3,'<3f')
    texinfo = records(6,'<16f2i'); edges = records(12,'<2H'); surfedges = [r[0] for r in records(13,'<i')]
    strings = lump(43); offsets = [r[0] for r in records(44,'<i')]
    names = [strings[o:strings.find(b'\0',o)].decode().lower() for o in offsets]
    entities = [dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]*)"',e)) for e in re.findall(r'\{([^{}]*)\}',lump(0).decode(errors='replace'))]
    models=records(14,'<9f3i'); nodes=records(5,'<3i6h3H2x'); leaves=records(10,'<ihH6h4Hh2x')
    leafbrushes=[r[0] for r in records(17,'<H')]
    modelEntities={int(e['model'][1:]):e for e in entities if e.get('model','').startswith('*')}
    faceOrigins={}; brushEntities={}
    def modelBrushes(node):
        if node<0:
            leaf=leaves[-node-1];return set(leafbrushes[leaf[11]:leaf[11]+leaf[12]])
        return modelBrushes(nodes[node][1]) | modelBrushes(nodes[node][2])
    for index,entity in modelEntities.items():
        model=models[index];origin=tuple(map(float,entity.get('origin','0 0 0').split()))
        if any(float(v) for v in entity.get('angles','0 0 0').split()):raise ValueError('Rotated brush entity unsupported')
        for f in range(model[10],model[10]+model[11]):faceOrigins[f]=origin
        for b in modelBrushes(model[9]):brushEntities[b]=entity
    pak = zipfile.ZipFile(io.BytesIO(lump(40))); paknames={n.lower():n for n in pak.namelist()}
    store=None
    if vpk_path:
        import vpk
        store=vpk.open(str(vpk_path))
    def read(path):
        """A file from the map's pak, else from the CS:GO VPK (stock content the map does not pack)."""
        path=path.lower()
        if path in paknames:return pak.read(paknames[path])
        if store is not None and path in store:
            try:return store.get_file(path).read()
            except FileNotFoundError:print('VPK chunk missing for',path)
        return None
    output.mkdir(parents=True,exist_ok=True); (output/'textures').mkdir(exist_ok=True)
    materials = []
    for td in texdata:
        name=names[td[3]]; result={'name':name,'width':td[4],'height':td[5],'color':[round(v,3) for v in td[:3]]}
        vtfname=f'materials/{name}.vtf'
        vmtdata=read(f'materials/{name}.vmt')
        if vmtdata:
            vmt=vmtdata.decode(errors='replace')
            match=re.search(r'\$basetexture"?\s+"?([^"\s]+)',vmt,re.I)
            if match: vtfname='materials/'+match[1].replace('\\','/').lower()+'.vtf'
            result['alpha']=bool(re.search(r'\$(?:translucent|alphatest)"?\s+"?1',vmt,re.I))
            bump=re.search(r'\$bumpmap"?\s+"?([^"\s]+)',vmt,re.I)
            if bump:
                # Normal map for bumped lightmaps; stored raw (Source's tangent convention matches VRAD's bump basis).
                normal=read('materials/'+bump[1].replace('\\','/').lower()+'.vtf')
                try:image=decode_vtf(normal).convert('RGB') if normal else None
                except ValueError as error:image=None;print('Skipping normal map for',name,'-',error)
                if image:
                    image.thumbnail((512,512))
                    filename=hashlib.sha1((name+'#normal').encode()).hexdigest()[:12]+'.webp'
                    # Normal maps only steer lighting, so near-lossless WebP is plenty and keeps downloads small.
                    image.save(output/'textures'/filename,quality=92,method=6)
                    result['normalMap']='textures/'+filename
                    result['ssbump']=bool(re.search(r'\$ssbump"?\s+"?1',vmt,re.I))
        vtfdata=None if name.startswith('tools/') else read(vtfname)
        if vtfdata:
            if vtfname not in paknames:result['source']='CS:GO VPK'
            try:
                image=decode_vtf(vtfdata); image.thumbnail((512,512))
                filename=hashlib.sha1(name.encode()).hexdigest()[:12]+'.webp'
                # Stock VPK textures are already DXT-compressed; near-lossless WebP keeps them small.
                image.save(output/'textures'/filename,**({'lossless':True} if vtfname in paknames else {'quality':90,'method':6}))
                result['texture']='textures/'+filename
            except ValueError as error: result['fallback']=str(error)
        materials.append(result)
    groups=collections.defaultdict(lambda:{'positions':[],'uvs':[],'normals':[],'lm':[]})
    # LDR lightmaps (lump 8); CS:GO prefers HDR (lump 53) when the map was compiled with it.
    hdr=len(lump(53))>0; lighting=lump(53 if hdr else 8); lightmapFaces={}; lightmapBlob=bytearray()
    numeric=[]; worldFaces=[]
    worldFirst,worldCount=models[0][10],models[0][11]
    for faceIndex,face in enumerate(records(58 if hdr else 7,'<HBBihhhh4Bif5iHHI')):
        planeid,side,_,first,num,ti,disp,_fog,style0,_s1,_s2,_s3,lightofs,_area,lmMinS,lmMinT,lmW,lmH,*_=face
        if ti < 0 or num<3:continue
        info=texinfo[ti]; mat=info[17]; name=materials[mat]['name']
        if name.startswith('tools/') or info[16]&0x80:continue  # nodraw, trigger, sky and other tool faces
        points=[vertices[edges[abs(surfedges[first+i])][0 if surfedges[first+i]>=0 else 1]] for i in range(num)]
        origin=faceOrigins.get(faceIndex,(0,0,0))
        localPoints=points;points=[tuple(p[a]+origin[a] for a in range(3)) for p in points]
        if name.rsplit('/',1)[-1].isdigit():numeric.append({'label':name.rsplit('/',1)[-1],'center':vec([sum(p[a] for p in points)/len(points) for a in range(3)]),'points':[vec(p) for p in points]})
        normal=planes[planeid][:3];normal=tuple(-v if side else v for v in normal)
        if worldFirst<=faceIndex<worldFirst+worldCount and not info[16]&0x2000:  # world model, not SURF_NODECALS
            # The engine keeps the unflipped plane for a surface (side only sets SURFDRAW_PLANEBACK), and decal
            # basis and offset use that plane normal (R_DecalVertsClip -> MSurf_Plane( surfID ).normal).
            worldFaces.append({'face':faceIndex,'points':points,'normal':tuple(planes[planeid][:3]),'dist':planes[planeid][3],'info':info,'lit':style0!=255 and lightofs>=0,'lmMins':(lmMinS,lmMinT)})
        # Style-0 luxels. Bumped faces (SURF_BUMPLIGHT) store four lightmaps per style: the flat one, then one per
        # bump basis direction; all four are kept, consecutively, for LightmappedGeneric's bump combine.
        lit=style0!=255 and lightofs>=0
        if lit and faceIndex not in lightmapFaces:
            count=(lmW+1)*(lmH+1);bumped=1 if info[16]&0x800 else 0
            lightmapFaces[faceIndex]=[len(lightmapBlob)//4,lmW+1,lmH+1,bumped]
            lightmapBlob+=lighting[lightofs:lightofs+count*4*(4 if bumped else 1)]
        group=groups[mat]; w,h=max(1,materials[mat]['width']),max(1,materials[mat]['height'])
        for j in range(1,num-1):
            indices=[0,j,j+1]
            a=[points[j][k]-points[0][k] for k in range(3)]
            b=[points[j+1][k]-points[0][k] for k in range(3)]
            cross=(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
            if sum(cross[k]*normal[k] for k in range(3))<0:indices=[0,j+1,j]
            for index in indices:
                p=points[index];local=localPoints[index]
                group['positions'].extend(round(v,4) for v in p)
                group['normals'].extend(round(v,4) for v in normal)
                u=(sum(local[a]*info[a] for a in range(3))+info[3])/w
                v=-(sum(local[a]*info[a+4] for a in range(3))+info[7])/h
                group['uvs'].extend([round(u,6),round(v,6)])
                # Lightmap coordinates in luxels relative to the face's lightmap block (texinfo lightmapVecs).
                ls=sum(local[a]*info[8+a] for a in range(3))+info[11]-lmMinS
                lt=sum(local[a]*info[12+a] for a in range(3))+info[15]-lmMinT
                group['lm'].extend([faceIndex if lit else -1,round(ls,4),round(lt,4)])
    brushes=records(18,'<3i'); sides=records(19,'<Hhhh')
    collision=[]; skipped=0; nonAxial=[]
    for index,(first,num,contents) in enumerate(brushes):
        if not contents&0x1000b:continue
        entity=brushEntities.get(index,{})
        if entity.get('classname','').startswith(('trigger_','func_illusionary','func_buyzone')):continue
        origin=tuple(map(float,entity.get('origin','0 0 0').split()))
        lo=[-math.inf]*3; hi=[math.inf]*3; axial=True
        for i in range(first,first+num):
            nx,ny,nz,d,_=planes[sides[i][0]];normal=(nx,ny,nz)
            axis=max(range(3),key=lambda a:abs(normal[a]))
            if abs(normal[axis]) < .99999:
                if not sides[i][3]:axial=False
                continue
            if normal[axis]>0:hi[axis]=min(hi[axis],d)
            else:lo[axis]=max(lo[axis],-d)
        if axial and all(math.isfinite(v) for v in lo+hi) and all(lo[a]<hi[a] for a in range(3)):
            collision.append({'id':f'bsp-{index}','min':vec([lo[a]+origin[a] for a in range(3)]),'max':vec([hi[a]+origin[a] for a in range(3)]),'entityClass':entity.get('classname','worldspawn')})
        else:
            skipped+=1
            if all(math.isfinite(v) for v in lo+hi):nonAxial.append({'min':vec([lo[a]+origin[a] for a in range(3)]),'max':vec([hi[a]+origin[a] for a in range(3)])})
    spawns=[{'position':vec(map(float,e['origin'].split())),'angles':list(map(float,e.get('angles','0 0 0').split()))} for e in entities if e.get('classname','').startswith('info_player') and 'origin' in e]
    triggers=[e for e in entities if e.get('classname','').startswith('trigger_')]
    # Model lighting inputs: BSP tree (planes, nodes), per-leaf ambient samples and compiled world lights.
    ambientIndex=records(51 if hdr else 52,'<2H'); ambientLighting=lump(55 if hdr else 56)
    samples=[]
    for li,leaf in enumerate(leaves):
        count,firstSample=ambientIndex[li] if li<len(ambientIndex) else (0,0)
        mins,maxs=leaf[3:6],leaf[6:9]
        for k in range(firstSample,firstSample+count):
            # Cube sides stay packed as ColorRGBExp32 (r | g<<8 | b<<16 | exponent<<24), Source's own lossless format.
            o=k*28;cube=list(struct.unpack_from('<6I',ambientLighting,o));x,y,z=ambientLighting[o+24:o+27]
            samples.append({'leaf':li,'position':[mins[0]+(maxs[0]-mins[0])*x/255,mins[1]+(maxs[1]-mins[1])*y/255,mins[2]+(maxs[2]-mins[2])*z/255],'cube':cube})
    worldlightLump=lump(54 if hdr else 15);size=100 if len(worldlightLump)%100==0 else 88
    worldlights=[]
    for k in range(len(worldlightLump)//size):
        o=k*size;origin=struct.unpack_from('<3f',worldlightLump,o);intensity=struct.unpack_from('<3f',worldlightLump,o+12);direction=struct.unpack_from('<3f',worldlightLump,o+24)
        t=o+36+(12 if size==100 else 0);_cluster,kind,_style,stopdot,stopdot2,exponent,radius,c,l,q,_flags,_texinfo,_owner=struct.unpack_from('<3i7f3i',worldlightLump,t)
        worldlights.append({'type':kind,'origin':list(origin),'intensity':list(intensity),'normal':list(direction),'stopdot':stopdot,'stopdot2':stopdot2,'exponent':exponent,'radius':radius,'attenuation':[c,l,q]})
    (output/'lightmaps.bin').write_bytes(bytes(lightmapBlob))
    (output/'lighting.json').write_text(json.dumps({'hdr':hdr,'planes':[list(p[:4]) for p in planes],'nodes':[[n[0],n[1],n[2],*n[3:9]] for n in nodes],
        'leaves':[{'contents':l[0],'mins':list(l[3:6]),'maxs':list(l[6:9])} for l in leaves],'samples':samples,'worldlights':worldlights,
        'faces':{str(k):v for k,v in lightmapFaces.items()}},separators=(',',':')))
    decals=project_decals(entities,worldFaces,read,output)
    skyname=next((e.get('skyname') for e in entities if e.get('classname')=='worldspawn'),None)
    sky=export_sky(skyname.lower(),pak,paknames,vpk_path,output) if skyname else None
    result={'sourceFile':source.name,'sky':sky,'decals':decals,'sha256':hashlib.sha256(data).hexdigest(),'materials':materials,'meshes':[dict(material=i,**g) for i,g in groups.items()],'boxes':collision,'spawns':spawns,'numericFaces':numeric,'skippedNonAxialBrushes':skipped,'nonAxial':nonAxial,'triggerCount':len(triggers)}
    (output/'map.json').write_text(json.dumps(result,separators=(',',':')))
    (output/'entities.json').write_text(json.dumps(entities,indent=2))
    print(f'{source.name}: {len(groups)} materials, {sum(len(g["positions"])//9 for g in groups.values())} triangles, {len(collision)} axial brushes, {skipped} omitted non-axial brushes')
    print('Numeric faces:', [(p['label'],p['center']) for p in numeric if p['label'] in ['240','245','246','250']][:35])

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('bsp',type=pathlib.Path);parser.add_argument('output',type=pathlib.Path)
    parser.add_argument('--vpk',type=pathlib.Path,help='CS:GO pak01_dir.vpk, for stock skyboxes the map does not pack')
    args=parser.parse_args();convert(args.bsp,args.output,args.vpk)
