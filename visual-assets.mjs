/** Presentation assets only. Never reads or writes climate coefficients or scene records. */
export function createIllustratedAssets(THREE,{textureUrls={},onTextureReady=()=>{}}={}) {
  const ramps=new Map(),textures=new Map(),animated=new Set();let lastFrame=0;
  const palette={leaf:['#79ad83','#8ab98a','#a1c58c','#72a98b','#8fbf93'],needle:['#619b87','#76aa90','#88b69a','#58947f'],wall:'#f4f3eb',roof:'#9eafa9',wood:'#a57b52',paving:'#d9d5bc',asphalt:'#8c9999'};
  function ramp(){
    if(ramps.has('soft'))return ramps.get('soft');
    const texture=new THREE.DataTexture(new Uint8Array([108,147,184,215,240]),5,1,THREE.RedFormat);
    texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;ramps.set('soft',texture);return texture;
  }
  function paint(source,color){
    const material=new THREE.MeshToonMaterial({color:color||source.color,gradientMap:ramp(),side:source.side,
      transparent:source.transparent,opacity:source.opacity,depthWrite:source.depthWrite,depthTest:source.depthTest,
      vertexColors:source.vertexColors,map:source.map||null});
    material.name=source.name;material.polygonOffset=source.polygonOffset;material.polygonOffsetFactor=source.polygonOffsetFactor;
    material.userData={...source.userData,illustrated:true};return material;
  }
  function texture(kind){
    if(textures.has(kind))return textures.get(kind);
    const n=128,pixels=new Uint8Array(n*n*4),base=new THREE.Color('#ffffff');
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const noise=((Math.imul(x+11,374761393)^Math.imul(y+29,668265263))>>>0)%101/100;
      let tone=.97+noise*.03;
      if(kind==='paving'){
        const row=Math.floor(y/32),offset=row%2?32:0;
        if(y%32<1||(x+offset)%64<1)tone=.86;
        else if(y%32===2||(x+offset)%64===2)tone=1;
      } else if(kind==='grass'){
        const blade=((x+Math.floor(y/7)*19)%31<2&&y%17<5);tone=blade?.87:.95+noise*.05;
      } else if(kind==='wood') tone=.87+.10*Math.abs(Math.sin((y+.6*Math.sin(x*.12))*.28))+noise*.03;
      else if(kind==='water')tone=.88+.12*Math.pow(Math.max(0,Math.sin(y*.2+Math.sin(x*.11)*.7)),14);
      else if(kind==='asphalt')tone=.94+noise*.06;
      const i=(y*n+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=Math.round(tone*255);pixels[i+3]=255;
    }
    const map=new THREE.DataTexture(pixels,n,n,THREE.RGBAFormat);map.colorSpace=THREE.SRGBColorSpace;
    map.wrapS=map.wrapT=THREE.RepeatWrapping;map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;
    map.generateMipmaps=true;map.anisotropy=4;map.needsUpdate=true;textures.set(kind,map);return map;
  }
  function surface(mesh,kind,color){
    if(!mesh.geometry?.attributes.position||mesh.isInstancedMesh)return;
    // World-space metre-sized pattern: resizing never stretches its texels.
    mesh.updateWorldMatrix(true,false);const geometry=mesh.geometry.clone(),p=geometry.attributes.position,uv=[],v=new THREE.Vector3();
    const period={paving:3.2,grass:2.8,asphalt:2,water:2.4,wood:2}[kind]||2;
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);uv.push(v.x/period,-v.z/period);}
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));mesh.geometry=geometry;
    const source=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
    const material=paint(source,color);material.map=texture(kind);material.vertexColors=false;
    mesh.material=material;mesh.receiveShadow=true;
  }
  function paintedFoliage(material,conifer){
    const key=conifer?'conifer':'broadleaf',url=textureUrls[key];if(!url)return;
    if(!textures.has(key)){
      const map=new THREE.TextureLoader().load(url,()=>onTextureReady());map.colorSpace=THREE.SRGBColorSpace;
      map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=4;textures.set(key,map);
    }
    material.map=textures.get(key);material.userData.paintedFoliage=key;
    // Triplanar brush texture avoids a vertical spherical UV seam and polar pinching.
    // Muted pigment modulation keeps the reference's soft palette under the common scene sun.
    material.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec3 vPaintPosition;varying vec3 vPaintNormal;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPaintPosition=position;vPaintNormal=normal;');
      shader.fragmentShader='varying vec3 vPaintPosition;varying vec3 vPaintNormal;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
        #ifdef USE_MAP
          vec3 w=pow(abs(normalize(vPaintNormal)),vec3(4.0));w/=max(dot(w,vec3(1.0)),0.0001);
          vec3 p=vPaintPosition*0.24+vec3(0.5);
          vec3 ink=texture2D(map,p.yz).rgb*w.x+texture2D(map,p.xz).rgb*w.y+texture2D(map,p.xy).rgb*w.z;
          float value=dot(ink,vec3(0.2126,0.7152,0.0722));
          vec3 pigment=mix(vec3(value),ink,0.42);
          diffuseColor.rgb*=mix(vec3(1.0),vec3(0.53)+pigment*0.95,0.78);
        #endif
      `);
    };
    material.customProgramCacheKey=()=> 'illustrated-pigment-triplanar-v1';
  }
  function organicGeometry(conifer=false,variant=0){
    if(conifer){
      // Rounded branch tips and swept, overlapping skirts, within the original unit cone.
      const g=new THREE.CylinderGeometry(.015,.94,1,36,12,false),p=g.attributes.position,colors=[];
      for(let i=0;i<p.count;i++){
        const x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=Math.atan2(z,x),t=.5-y;
        const tips=.5+.5*Math.cos(a*(7+variant%2)+variant*.6);
        const shape=(.82+.17*Math.pow(tips,.45))*(.88+.12*t);
        const curledY=y+.045*(1-tips)*Math.pow(t,3);
        p.setXYZ(i,x*shape,curledY,z*shape);
        const tint=new THREE.Color('#edf1cc').lerp(new THREE.Color('#c3decf'),t*.52);
        tint.multiplyScalar(.86+.14*Math.pow(tips,.6));colors.push(tint.r,tint.g,tint.b);
      }
      g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
    }
    // A continuous cloud-shaped skin, with broad overlapping painted patches.
    // No separate leaf sprites, facets, or enlarged analytical canopy.
    const g=new THREE.SphereGeometry(1,28,20),p=g.attributes.position,colors=[];
    const pillows=[];
    const petals=[6,7,5,8,6][variant%5];
    for(let row=0;row<3;row++)for(let k=0;k<petals;k++){
      const a=k*Math.PI*2/petals+row*.43+variant*.37,y=-.58+row*.57;
      const reach=Math.sqrt(1-y*y);pillows.push(new THREE.Vector3(Math.cos(a)*reach,y,Math.sin(a)*reach));
    }
    const upper=new THREE.Color('#fff6cd'),lower=new THREE.Color('#b5d9c4');
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),direction=new THREE.Vector3(x,y,z).normalize();
      let bump=0;for(const pillow of pillows)bump=Math.max(bump,Math.exp((direction.dot(pillow)-1)*24));
      const brushing=.5+.5*Math.sin(x*11+y*5+variant)*Math.cos(z*9-y*4);
      const r=.83+.145*bump+.018*brushing;
      p.setXYZ(i,x*r,y*r,z*r);
      const tint=lower.clone().lerp(upper,Math.min(1,Math.max(0,(y+.7)*.6+bump*.18)));
      tint.multiplyScalar(.88+.08*bump+.04*brushing);colors.push(tint.r,tint.g,tint.b);
    }
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
  }
  function broadleafWood(root,variant){
    const spec=root.userData,h=spec.height,r=spec.crownRadius,s=h/10,base=spec.trunkHeight;
    const removed=root.children.filter(o=>['trunk','branch','snow'].includes(o.userData.component));
    const identity={...removed[0].userData};delete identity.component;
    const materials=new Set();
    for(const o of removed){root.remove(o);o.geometry.dispose();materials.add(o.material);}
    for(const m of materials)if(!root.children.some(o=>o.material===m))m.dispose();
    const up=new THREE.Vector3(0,1,0),phase=variant*.73;
    // One continuous leader: straight lower trunk, gently wandering upper stem.
    // The radius is a smooth function of height, with a small root flare, not stacked cylinders.
    const leader={
      getPoint(t){const bend=Math.max(0,(t-base/h)/(1-base/h));return new THREE.Vector3(r*.045*Math.sin(bend*4+phase)*bend,h*t,r*.035*Math.sin(bend*5-phase)*bend);},
      getTangent(t){return this.getPoint(Math.min(1,t+.0001)).sub(this.getPoint(Math.max(0,t-.0001))).normalize();}
    };
    const trunkRadius=t=>s*(.235*Math.pow(1-t,1.12)+.035*Math.exp(-t*50));
    const buffers=()=>({positions:[],indices:[]}),trunkData=buffers(),branchData=buffers(),snowData=buffers();
    function sweep(data,path,radius,steps=18,sides=10,snow=false){
      const offset=data.positions.length/3;
      for(let i=0;i<=steps;i++){
        const t=i/steps,c=path.getPoint(t),tangent=path.getTangent(t);
        const ref=Math.abs(tangent.y)>(snow?.9999:.93)?new THREE.Vector3(1,0,0):up;
        const a=ref.clone().addScaledVector(tangent,-ref.dot(tangent)).normalize(),b=new THREE.Vector3().crossVectors(tangent,a).normalize();
        const rad=radius(t),endFade=Math.pow(Math.sin(Math.PI*t),.45);
        for(let j=0;j<=sides;j++){
          const angle=j/sides*Math.PI*2,flute=1+.035*Math.sin(angle*5+t*3+phase);
          const p=c.clone();
          if(snow){
            // A rounded, tapering blanket resting on the upper face of the branch.
            p.addScaledVector(a,rad+.022*s+Math.cos(angle)*.065*s*endFade);
            p.addScaledVector(b,Math.sin(angle)*(rad*1.3+.045*s)*endFade);
          }else p.addScaledVector(a,Math.cos(angle)*rad*flute).addScaledVector(b,Math.sin(angle)*rad*flute);
          data.positions.push(p.x,p.y,p.z);
        }
      }
      for(let i=0;i<steps;i++)for(let j=0;j<sides;j++){
        const a=offset+i*(sides+1)+j,b=a+sides+1;data.indices.push(a,a+1,b,b,a+1,b+1);
      }
    }
    sweep(trunkData,leader,trunkRadius,64,14);
    const branches=[];
    function branch(points,radius){
      const path=new THREE.CubicBezierCurve3(...points);
      const taper=t=>radius*Math.pow(1-t,1.05);
      sweep(branchData,path,taper,18,9);branches.push({path,radius});
      if(spec.season==='winter'){
        const begin=.13,end=.88;
        const snowPath={getPoint:t=>path.getPoint(begin+(end-begin)*t),getTangent:t=>path.getTangent(begin+(end-begin)*t)};
        sweep(snowData,snowPath,t=>taper(begin+(end-begin)*t),15,8,true);
      }
      return path;
    }
    function radial(angle,reach,y){return new THREE.Vector3(Math.cos(angle)*r*reach,y,Math.sin(angle)*r*reach);}
    for(let i=0;i<10;i++){
      const level=i/9,angle=phase+i*2.39996+.13*Math.sin(i*2.1+variant);
      const y=base+(h-base)*(.08+level*.64),start=leader.getPoint(y/h);
      const reach=(.76-.26*level)*(1+.06*Math.sin(i*1.7+variant));
      const endY=y+(h-y)*(.36+.08*Math.sin(i+phase));
      const end=radial(angle+.12,reach,endY);
      const p=branch([start,start.clone().add(radial(angle,.17,(h-y)*.025)),radial(angle-.12,reach*.85,y+(endY-y)*.31),end],s*(.085-.035*level));
      for(let fork=0;fork<2;fork++){
        const t=.46+fork*.22,origin=p.getPoint(t),direction=p.getTangent(t),sign=fork?1:-1;
        const forkEnd=radial(angle+sign*(.34+.05*Math.sin(i)),reach*(.91-fork*.06),Math.min(h*.96,endY+(h-endY)*(.23+fork*.13)));
        branch([origin,origin.clone().addScaledVector(direction,r*.15),forkEnd.clone().lerp(origin,.32).add(new THREE.Vector3(0,-h*.035,0)),forkEnd],s*(.034-.012*level)*(1-fork*.15));
      }
    }
    function mesh(data,component,color){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));g.setIndex(data.indices);g.computeVertexNormals();
      const o=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color,roughness:1}));o.name=component==='snow'?'Снег на ветвях':component==='trunk'?'Плавный ствол липы':'Изогнутые ветви липы';
      o.userData={...identity,component};root.add(o);return o;
    }
    mesh(trunkData,'trunk','#a18361');mesh(branchData,'branch','#a18361');
    if(spec.season==='winter'){
      const snow=mesh(snowData,'snow','#eef3ee');snow.userData.visualOnly=true;snow.userData.climateOcclusion=false;snow.raycast=()=>{};
    }
    root.userData.illustratedWood={continuousLeader:true,curvedBranches:branches.length,snowCoveredBranches:spec.season==='winter'?branches.length:0};
  }
  function tree(root){
    const conifer=root.userData.conifer;
    let seed=2166136261;for(const letter of root.name)seed=Math.imul(seed^letter.charCodeAt(0),16777619)>>>0;
    const variant=seed%(conifer?2:5);root.userData.illustratedVariant=variant;
    root.userData.illustratedAsset=conifer?['spruce-soft','spruce-scalloped'][variant]:['park-round','park-cloud','park-upright','park-spreading','park-asymmetric'][variant];
    if(!conifer)broadleafWood(root,variant);
    root.traverse(o=>{
      if(!o.isMesh)return;
      o.material=paint(o.material);o.castShadow=o.receiveShadow=true;
      if(o.userData.component==='foliage'){
        o.geometry.dispose();o.geometry=organicGeometry(conifer,variant);o.material.vertexColors=true;
        // Distinct layered silhouettes share exactly the same physical crown envelope.
        const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(),vertex=new THREE.Vector3();
        const profiles=[[1.03,.97,1.01],[.98,1.03,.98],[.92,1.08,.94],[1.08,.92,1.04],[1.02,1,.98]];
        for(let i=0;i<o.count;i++){
          o.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
          if(!conifer){
            const profile=profiles[variant];scale.multiply(new THREE.Vector3(...profile));
            if(variant===4)position.x+=root.userData.crownRadius*.045*Math.sin(i*1.9);
          }else if(variant===1){scale.x*=.94;scale.z*=.94;}
          // Refit visual lobes only; dimensions and climate input records never change.
          for(let attempt=0;attempt<60;attempt++){
            matrix.compose(position,rotation,scale);let fits=true;
            for(let j=0;j<o.geometry.attributes.position.count;j++){
              vertex.fromBufferAttribute(o.geometry.attributes.position,j).applyMatrix4(matrix);
              const q=(vertex.x/root.userData.crownRadius)**2+((vertex.y-root.userData.crownCenter)/root.userData.crownVerticalRadius)**2+(vertex.z/root.userData.crownRadius)**2;
              if(q>.998){fits=false;break;}
            }
            if(fits)break;scale.multiplyScalar(.98);
          }
          matrix.compose(position,rotation,scale);o.setMatrixAt(i,matrix);
        }
        o.instanceMatrix.needsUpdate=true;
        const colors=conifer?palette.needle:palette.leaf;
        for(let i=0;i<o.count;i++)o.setColorAt(i,new THREE.Color(colors[(i*3+variant)%colors.length]));
        if(root.userData.kind!=='project_tree'||root.userData.projectObjectId)paintedFoliage(o.material,conifer);
        o.instanceColor.needsUpdate=true;o.computeBoundingBox();o.computeBoundingSphere();
      }else if(['trunk','branch'].includes(o.userData.component)){
        o.material.color.set('#a18361');o.material.vertexColors=true;
        const g=o.geometry.clone(),p=g.attributes.position,colors=[];
        for(let i=0;i<p.count;i++){
          const angle=Math.atan2(p.getZ(i),p.getX(i)),streak=.94+.035*Math.sin(angle*3+p.getY(i)*.7);
          colors.push(streak,streak*.985,streak*.965);
        }
        g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));o.geometry=g;
      }
    });
    root.userData.visualStyle='illustrated_canopy';return root;
  }
  function edge(mesh,opacity=.23){
    if(mesh.isInstancedMesh||!mesh.geometry)return;
    const line=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,38),new THREE.LineBasicMaterial({color:'#536a63',transparent:true,opacity,depthWrite:false}));
    line.userData.visualOnly=true;line.raycast=()=>{};mesh.add(line);
  }
  function zone(root,season='summer'){
    root.updateMatrixWorld(true);
    const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});
    for(const o of meshes){
      const c=o.userData.component||'',name=o.material.name||'';
      o.material=paint(o.material);o.castShadow=o.receiveShadow=true;
      if(c==='project_lawn')surface(o,'grass',season==='winter'?'#dce6d7':'#a9c985');
      if(c==='project_shrub_foliage'){
        o.material.color.set('#82b47b');o.material.vertexColors=false;o.material.flatShading=false;
      }
      if(c==='project_canopy_roof'){
        surface(o,'wood',season==='winter'?'#e9eee5':'#c8a572');edge(o,.3);
      }
      if(c==='project_canopy_post'){o.material.color.set(palette.wood);edge(o,.18);}
      if(c==='project_fountain_rim'){o.material.color.set(season==='winter'?'#ecf0e8':'#e3d8b8');edge(o,.25);}
      if(c==='project_water_surface'){
        surface(o,'water',season==='winter'?'#c7e3e6':'#6dbfc9');o.material.opacity=.94;o.castShadow=false;
      }
      if(c==='project_fountain_jets'){
        o.material.color.set('#d9f8f6');o.castShadow=false;o.userData.illustratedJet=true;
        animated.add(new WeakRef(o));
      }
    }
    return root;
  }
  function world(groups,ground,details){
    const painted=new Map();
    for(const kind of ['building','road','railway','landcover','water','site']){
      const nodes=[];groups[kind].traverse(o=>{if(o.isMesh)nodes.push(o);});
      for(const o of nodes){
        const source=Array.isArray(o.material)?o.material[0]:o.material;if(!source?.color)continue;
        const name=source.name||'',feature=o.userData.feature;
        if(kind==='landcover'&&name==='existing_lawn_gradient'){surface(o,'grass','#a9c985');o.userData.illustratedGrass=true;continue;}
        let color;
        if(kind==='building'){
          if(/glass|window|lobby|shop/i.test(name))color='#85aeb4';
          else if(/roof|terrace|rim/i.test(name))color='#a3b3ac';
          else if(/wood/i.test(name))color='#b79671';
          else color=palette.wall;
          // Keep the requested facade pigment exact; lighting still supplies natural shading.
          if(color!==palette.wall)color=new THREE.Color(color).lerp(new THREE.Color('#fffdf8'),/glass|window|lobby|shop/i.test(name)?.10:.32);
        } else if(kind==='water')color='#83c5ce';
        else if(kind==='landcover')color='#b4cb99';
        if(!painted.has(source))painted.set(source,paint(source,color));o.material=painted.get(source);
        if(kind==='building'){o.castShadow=o.receiveShadow=true;if(!o.isInstancedMesh&&o.geometry?.attributes.position?.count<8000)edge(o,.18);}
        const surfaceName=feature?.tags?.surface||'';
        const luminance=source.color.r+source.color.g+source.color.b;
        if(kind==='site'||/paving|walkway|platform/.test(name)||surfaceName==='paving_stones')surface(o,'paving',palette.paving);
        else if(kind==='road'&&o.geometry?.attributes.position?.count>5&&o.userData.illustratedSurface)surface(o,o.userData.illustratedSurface,o.userData.illustratedSurface==='asphalt'?palette.asphalt:palette.paving);
        o.receiveShadow=true;
        if(o.userData.baseColor)o.userData.baseColor.copy(o.material.color);
      }
    }
    surface(ground,'paving','#d4d8c5');
    details.traverse(o=>{if(o.isMesh){const name=o.material.name||'';o.material=paint(o.material,/windows/.test(name)?'#83a6ac':/sills|roof/.test(name)?'#c9c9b4':/rails/.test(name)?'#778982':'#afa99a');}});
  }
  function season(groups,next){
    groups.landcover.traverse(o=>{if(o.userData.illustratedGrass)o.material.color.set(next==='winter'?'#dce6d7':'#a9c985');});
  }
  function animate(scene,time){
    if(time-lastFrame<40)return false;lastFrame=time;let active=false;
    for(const ref of animated){const o=ref.deref();if(!o){animated.delete(ref);continue;}
      let p=o,visible=true;while(p&&p!==scene){visible=visible&&p.visible;p=p.parent;}
      if(p===scene&&visible){o.material.opacity=.76+.08*Math.sin(time*.002);active=true;}
      else if(!p)animated.delete(ref);
    }
    if(active&&textures.has('water'))textures.get('water').offset.set(time*.000009,time*.000004);
    return active;
  }
  return {tree,zone,world,season,paint,surface,palette,texture,animate,paintedFoliage};
}
