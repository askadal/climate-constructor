/** Freehand input produces ordinary metre-based project polygons, never a visual-only decal. */
export function smoothFreehandContour(input) {
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  let points=[];
  for(const p of input)if(p.every(Number.isFinite)&&(!points.length||distance(p,points.at(-1))>.12))points.push([...p]);
  if(points.length>2&&distance(points[0],points.at(-1))<.5)points.pop();
  if(points.length<3)return points;
  // Bounded sampling followed by corner cutting avoids spline overshoot at kerbs.
  let perimeter=0;for(let i=0;i<points.length;i++)perimeter+=distance(points[i],points[(i+1)%points.length]);
  const count=Math.min(96,Math.max(12,Math.ceil(perimeter/.7))),sampled=[];
  let edge=0,start=0;
  for(let i=0;i<count;i++){
    const target=i*perimeter/count;
    while(edge<points.length-1&&start+distance(points[edge],points[(edge+1)%points.length])<target){start+=distance(points[edge],points[(edge+1)%points.length]);edge++;}
    const a=points[edge],b=points[(edge+1)%points.length],t=(target-start)/Math.max(1e-9,distance(a,b));sampled.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
  }
  points=sampled;
  for(let pass=0;pass<2;pass++){
    const next=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];next.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);}points=next;
  }
  return points;
}

export function installFreehandZones({canvas,getMode,isBusy,pickGround,preview,commit,clear,message,controls}) {
  let pencil=false,stroke=null;
  const eligible=()=>['lawn','shrubs'].includes(getMode());
  const active=()=>eligible()&&pencil;
  const consume=e=>{e.preventDefault?.();e.stopImmediatePropagation?.();e.stopPropagation?.();};
  function cancel(){
    if(!stroke)return;const id=stroke.id;stroke=null;
    if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);clear();
  }
  function sync(){
    if(stroke&&(!active()||isBusy()))cancel();
    if(controls.group)controls.group.hidden=!eligible();
    controls.pencil?.setAttribute('aria-pressed',String(pencil));controls.points?.setAttribute('aria-pressed',String(!pencil));
    if(controls.pencil)controls.pencil.disabled=isBusy();if(controls.points)controls.points.disabled=isBusy();
  }
  function choose(value){if(isBusy())return;cancel();clear();pencil=value;sync();message(pencil?'Зажмите мышь и обведите зону. Отпустите — контур сгладится.':'Нажмите точки контура и замкните его.');}
  controls.pencil?.addEventListener('click',()=>choose(true));controls.points?.addEventListener('click',()=>choose(false));
  function move(e){
    if(!stroke||e.pointerId!==stroke.id)return;
    const p=pickGround(e.clientX,e.clientY);if(!p){stroke.outside=true;return;}stroke.outside=false;
    const last=stroke.points.at(-1);
    if(Math.hypot(p.x-last[0],p.y-last[1])<.2)return;
    stroke.points.push([p.x,p.y]);
    if(stroke.points.length>2048)stroke.points=stroke.points.filter((_,i)=>i%2===0);
    preview(smoothFreehandContour(stroke.points));
  }
  canvas.addEventListener('pointerdown',e=>{
    if(stroke&&e.button===2){consume(e);cancel();return;}
    if(!active()||isBusy()||e.button!==0)return;consume(e);const p=pickGround(e.clientX,e.clientY);if(!p)return;
    clear();stroke={id:e.pointerId,points:[[p.x,p.y]],outside:false};canvas.setPointerCapture?.(e.pointerId);preview(stroke.points);
  },{capture:true});
  canvas.addEventListener('pointermove',e=>{if(stroke&&e.pointerId===stroke.id){consume(e);if(isBusy()){cancel();return;}move(e);}},{capture:true});
  canvas.addEventListener('pointerup',e=>{
    if(!stroke||e.pointerId!==stroke.id)return;consume(e);move(e);const draft=stroke,coords=smoothFreehandContour(draft.points);cancel();
    if(draft.outside||isBusy())return;
    if(draft.points.length<4||coords.length<3){message('Обведите участок, удерживая кнопку мыши.');return;}
    commit(coords);
  },{capture:true});
  for(const event of ['pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{if(stroke&&e.pointerId===stroke.id){consume(e);cancel();}},{capture:true});
  canvas.addEventListener('click',e=>{if(active())consume(e);},{capture:true});
  return {cancel,sync,active};
}
