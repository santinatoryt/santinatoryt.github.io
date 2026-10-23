import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), replayCanvas = $('replay');
let renderer, scene, camera, replayRenderer, replayScene, replayCamera;
let running = true, started = false, matchSeconds = 0, score = [0,0], currentCam = 0;
let eventLog = [], cards = {yellow:0,red:0}, frameHistory = [], replayIndex = 0, replayPlaying = false, replayCameraMode = 2, offsideLines = false;
let lastTick = performance.now(), accumulator = 0, selectedPlayer = null, pendingDecision = 'Sin decisión', reviewEvent = null;
const MATCH_DURATION = 90*60;
const pitch = {w:68,h:105};
const players = [], officials = [];
const mat = (color, roughness=.82) => new THREE.MeshStandardMaterial({color,roughness});
const materials = {
 grass: mat(0x247c43), stripe1: mat(0x2b874a), stripe2: mat(0x237640),
 line: new THREE.MeshStandardMaterial({color:0xf2f5e9,roughness:.9}),
 home: mat(0x1c70df), homeShort: mat(0x102c75), away: mat(0xf1eee1), awayShort: mat(0x20252b),
 ref: mat(0xf2b51c), skin: mat(0xc58b68), boots: mat(0x11171a), ball: mat(0xf7f7f2,.45),
 stand: mat(0x263d49), crowd1: mat(0x8caaa8), crowd2: mat(0xd5b67a), crowd3: mat(0x5076a4)
};
function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),1900)}
function logEvent(text, type='decision'){eventLog.unshift({time:formatClock(matchSeconds),text,type});if(eventLog.length>80)eventLog.pop();toast(text);updateLog()}
function formatClock(sec){const s=Math.floor(sec);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function makeBox(w,h,d,material,x,y,z,parent=scene){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
function makeLine(points, material=materials.line, radius=.055, parent=scene){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(8,points.length*3),radius,5,false),material);parent.add(mesh);return mesh}
function createPitch(){
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(190,220),mat(0x122b2a));ground.rotation.x=-Math.PI/2;ground.position.y=-.25;ground.receiveShadow=true;scene.add(ground);
  const field=new THREE.Mesh(new THREE.PlaneGeometry(pitch.w,pitch.h),materials.grass);field.rotation.x=-Math.PI/2;field.receiveShadow=true;scene.add(field);
  for(let i=0;i<10;i++){const stripe=new THREE.Mesh(new THREE.PlaneGeometry(pitch.w,pitch.h/10),i%2?materials.stripe1:materials.stripe2);stripe.rotation.x=-Math.PI/2;stripe.position.y=.006;stripe.position.z=-pitch.h/2+pitch.h/20+i*pitch.h/10;scene.add(stripe)}
  const y=.035, x=pitch.w/2, z=pitch.h/2;
  makeLine([[-x,y,-z],[x,y,-z],[x,y,z],[-x,y,z],[-x,y,-z]]);
  makeLine([[-x,y,0],[x,y,0]]);
  const circle=[];for(let i=0;i<=64;i++){let a=i/64*Math.PI*2;circle.push([9.15*Math.cos(a),y,9.15*Math.sin(a)])}makeLine(circle);
  for(const sign of [-1,1]){
    const end=sign*z;
    makeLine([[-20.16,y,end-sign*16.5],[20.16,y,end-sign*16.5],[20.16,y,end],[-20.16,y,end],[-20.16,y,end-sign*16.5]]);
    makeLine([[-9.16,y,end-sign*5.5],[9.16,y,end-sign*5.5],[9.16,y,end],[-9.16,y,end],[-9.16,y,end-sign*5.5]]);
    const small=[];for(let i=0;i<=32;i++){let a=i/32*Math.PI*2;small.push([1.0*Math.cos(a),y,end-sign*11+1*Math.sin(a)])}makeLine(small);
    // Goal frame
    const gz=end-sign*2.4, goalW=7.32, goalH=2.44;
    for(const gx of [-goalW/2,goalW/2]){makeLine([[gx,.08,end],[gx,goalH,end],[gx,goalH,gz],[gx,.08,gz]],new THREE.MeshStandardMaterial({color:0xffffff}),.09)}
    makeLine([[-goalW/2,goalH,end],[goalW/2,goalH,end]],new THREE.MeshStandardMaterial({color:0xffffff}),.09);
    const net=new THREE.Mesh(new THREE.BoxGeometry(goalW,goalH,2.4),new THREE.MeshBasicMaterial({color:0xe5f2ed,wireframe:true,transparent:true,opacity:.26}));net.position.set(0,goalH/2,gz);scene.add(net);
  }
  // Stands and floodlight towers
  for(const side of [-1,1]){
    const stand=makeBox(16,8,130,materials.stand,side*43,3,-1);stand.rotation.z=side*.04;
    for(let row=0;row<5;row++)for(let i=0;i<55;i++){
      const m=[materials.crowd1,materials.crowd2,materials.crowd3][(i*7+row*3+side+3)%3];
      const person=new THREE.Mesh(new THREE.BoxGeometry(.45,.6,.4),m);
      person.position.set(side*(35+row*2.7),7+row*.8,-63+i*2.3);scene.add(person);
    }
  }
  for(const z of [-58,58]){makeBox(1,22,1,mat(0x5c6b6e),-39,11,z);makeBox(1,22,1,mat(0x5c6b6e),39,11,z);makeBox(9,1,1,mat(0x7e8d8e),-39,22,z);makeBox(9,1,1,mat(0x7e8d8e),39,22,z)}
  // Electronic scoreboard
  makeBox(18,3,.6,mat(0x09171b),0,13,-63);
  const signCanvas=document.createElement('canvas');signCanvas.width=512;signCanvas.height=128;const ctx=signCanvas.getContext('2d');ctx.fillStyle='#081a20';ctx.fillRect(0,0,512,128);ctx.fillStyle='#53e0cf';ctx.font='bold 38px sans-serif';ctx.fillText('ATL NORTE   0 - 0   UNION SUR',18,77);const tex=new THREE.CanvasTexture(signCanvas);const screen=new THREE.Mesh(new THREE.PlaneGeometry(17.5,2.7),new THREE.MeshBasicMaterial({map:tex}));screen.position.set(0,13,-62.65);scene.add(screen);
}
function makePlayer(team,index,official=false){
  const group=new THREE.Group();
  const jersey=official?materials.ref:(team===0?materials.home:materials.away);
  const shorts=official?materials.ref:(team===0?materials.homeShort:materials.awayShort);
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.38,.55,4,8),jersey);torso.position.y=1.22;torso.castShadow=true;group.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.23,10,8),materials.skin);head.position.y=2.02;head.castShadow=true;group.add(head);
  const hair=new THREE.Mesh(new THREE.SphereGeometry(.235,8,6),mat(0x29201c));hair.scale.y=.42;hair.position.set(0,2.17,0);group.add(hair);
  const shortsMesh=new THREE.Mesh(new THREE.BoxGeometry(.62,.35,.42),shorts);shortsMesh.position.y=.79;shortsMesh.castShadow=true;group.add(shortsMesh);
  const limbs=[];
  for(const side of [-1,1]){
    const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.12,.48,3,6),mat(0x202a31));leg.position.set(side*.19,.42,0);leg.castShadow=true;group.add(leg);limbs.push(leg);
    const boot=new THREE.Mesh(new THREE.BoxGeometry(.19,.12,.32),materials.boots);boot.position.set(side*.19,.12,.08);group.add(boot);
    const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.09,.42,3,6),jersey);arm.position.set(side*.46,1.25,0);arm.rotation.z=side*.16;group.add(arm);limbs.push(arm);
  }
  scene.add(group);
  let x,z;
  if(official){x=index===0?0:(index===1?-25:25);z=index===0?0:(index===1?-3:3)}
  else{
    const formations=[[-22,-35],[-7,-39],[7,-39],[22,-35],[-26,-18],[-9,-21],[9,-21],[26,-18],[-12,-5],[12,-5],[0,-1]];
    const p=formations[index%formations.length];x=p[0]*(team===0?1:-1);z=p[1]*(team===0?1:-1);
  }
  group.position.set(x,.05,z);group.rotation.y=team===0?0:Math.PI;
  const obj={group,team,index,official,limbs,homeX:x,homeZ:z,phase:Math.random()*6.28,red:false};
  if(official)officials.push(obj);else players.push(obj);
  return obj;
}
let ball, ballVel=new THREE.Vector3(), referee;
function initThree(){
  scene=new THREE.Scene();scene.background=new THREE.Color(0x8cb5c3);scene.fog=new THREE.Fog(0x8cb5c3,90,180);
  camera=new THREE.PerspectiveCamera(43,1,.1,300);camera.position.set(0,64,88);camera.lookAt(0,0,0);
  renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;
  scene.add(new THREE.HemisphereLight(0xd7f2ff,0x1a2b21,2.1));
  const sun=new THREE.DirectionalLight(0xfff3dc,2.3);sun.position.set(-35,65,22);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-75;sun.shadow.camera.right=75;sun.shadow.camera.top=90;sun.shadow.camera.bottom=-90;scene.add(sun);
  createPitch();
  for(let t=0;t<2;t++)for(let i=0;i<11;i++)makePlayer(t,i);
  referee=makePlayer(2,0,true);
  const ballMesh=new THREE.Mesh(new THREE.SphereGeometry(.38,16,12),materials.ball);ballMesh.castShadow=true;ballMesh.position.set(0,.42,0);scene.add(ballMesh);
  const patches=new THREE.Mesh(new THREE.IcosahedronGeometry(.27,1),mat(0x1a2426));ballMesh.add(patches);patches.scale.set(1,.98,1);
  ball={mesh:ballMesh,pos:ballMesh.position};
  // officials at touchlines
  const a1=makePlayer(2,1,true),a2=makePlayer(2,2,true);a1.group.position.set(-34,.05,-20);a2.group.position.set(34,.05,20);
  resize();
  initReplay();
}
function resize(){
  if(renderer){const w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
  if(replayRenderer){const w=replayCanvas.clientWidth||320,h=replayCanvas.clientHeight||180;replayRenderer.setSize(w,h,false);replayCamera.aspect=w/h;replayCamera.updateProjectionMatrix()}
}
function initReplay(){
  replayScene=new THREE.Scene();replayScene.background=new THREE.Color(0x91b8c4);replayScene.fog=new THREE.Fog(0x91b8c4,100,190);
  replayCamera=new THREE.PerspectiveCamera(43,1,.1,300);
  replayRenderer=new THREE.WebGLRenderer({canvas:replayCanvas,antialias:false,alpha:false,powerPreference:'low-power'});replayRenderer.setPixelRatio(Math.min(devicePixelRatio,1.2));
  replayScene.add(new THREE.HemisphereLight(0xd7f2ff,0x1a2b21,2.3));const sun=new THREE.DirectionalLight(0xfff3dc,2);sun.position.set(-35,65,22);replayScene.add(sun);
  // Independent lightweight replay pitch and actors
  const field=new THREE.Mesh(new THREE.PlaneGeometry(pitch.w,pitch.h),materials.grass);field.rotation.x=-Math.PI/2;replayScene.add(field);
  for(let i=0;i<10;i++){const stripe=new THREE.Mesh(new THREE.PlaneGeometry(pitch.w,pitch.h/10),i%2?materials.stripe1:materials.stripe2);stripe.rotation.x=-Math.PI/2;stripe.position.y=.006;stripe.position.z=-pitch.h/2+pitch.h/20+i*pitch.h/10;replayScene.add(stripe)}
  makeLine([[-34,.035,-52.5],[34,.035,-52.5],[34,.035,52.5],[-34,.035,52.5],[-34,.035,-52.5]],materials.line,.055,replayScene);
  makeLine([[-34,.035,0],[34,.035,0]],materials.line,.055,replayScene);
  const circle=[];for(let i=0;i<=64;i++){let a=i/64*Math.PI*2;circle.push([9.15*Math.cos(a),.035,9.15*Math.sin(a)])}makeLine(circle,materials.line,.055,replayScene);
  replayActors=[];
  for(let t=0;t<2;t++)for(let i=0;i<11;i++){
    const g=new THREE.Group();const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.38,.55,3,6),t===0?materials.home:materials.away);torso.position.y=1.2;g.add(torso);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.22,8,6),materials.skin);head.position.y=2;g.add(head);
    const shorts=new THREE.Mesh(new THREE.BoxGeometry(.6,.32,.4),t===0?materials.homeShort:materials.awayShort);shorts.position.y=.75;g.add(shorts);
    replayScene.add(g);replayActors.push(g);
  }
  replayRef=new THREE.Group();const rt=new THREE.Mesh(new THREE.CapsuleGeometry(.38,.55,3,6),materials.ref);rt.position.y=1.2;replayRef.add(rt);const rh=new THREE.Mesh(new THREE.SphereGeometry(.22,8,6),materials.skin);rh.position.y=2;replayRef.add(rh);replayScene.add(replayRef);
  replayBall=new THREE.Mesh(new THREE.SphereGeometry(.38,12,8),materials.ball);replayScene.add(replayBall);
  replayLines=new THREE.Group();replayScene.add(replayLines);
}
let replayActors=[],replayRef,replayBall,replayLines;
function frameState(){
  return {time:matchSeconds,ball:[ball.pos.x,ball.pos.y,ball.pos.z],players:players.map(p=>[p.group.position.x,p.group.position.y,p.group.position.z,p.group.rotation.y]),ref:[referee.group.position.x,referee.group.position.y,referee.group.position.z,referee.group.rotation.y]};
}
function capture(){frameHistory.push(frameState());if(frameHistory.length>750)frameHistory.shift()}
let simulationTime=0, nextEventAt=8, lastEventTime=0;
function simulate(dt){
  if(!running||!started)return;
  simulationTime+=dt;matchSeconds+=dt*12; // accelerated game clock: 1 real second = 12 match seconds
  if(matchSeconds>=MATCH_DURATION){matchSeconds=MATCH_DURATION;running=false;logEvent('Final del partido.','system')}
  const bx=ball.pos.x,bz=ball.pos.z;
  players.forEach((p,i)=>{
    if(p.red)return;
    const dx=bx-p.group.position.x,dz=bz-p.group.position.z,dist=Math.hypot(dx,dz);
    const seek=dist<23?1:0;
    const targetX=THREE.MathUtils.clamp(p.homeX+(seek?dx*.24:Math.sin(simulationTime*.32+p.phase)*2),-31,31);
    const targetZ=THREE.MathUtils.clamp(p.homeZ+(seek?dz*.24:Math.cos(simulationTime*.27+p.phase)*2),-50,50);
    const speed=(seek?.85:.36)*dt*4;
    p.group.position.x+=THREE.MathUtils.clamp(targetX-p.group.position.x,-speed,speed);
    p.group.position.z+=THREE.MathUtils.clamp(targetZ-p.group.position.z,-speed,speed);
    if(dist>0.5&&seek)p.group.rotation.y=Math.atan2(dx,dz);
    p.limbs.forEach((limb,j)=>limb.rotation.x=Math.sin(simulationTime*7+p.phase+j*2)*.24);
    if(dist<1.6&&Math.random()<dt*.22){ballVel.x+=(Math.random()-.5)*8;ballVel.z+=(Math.random()-.5)*8;if(Math.random()<.06)maybeIncident(p)}
  });
  ballVel.multiplyScalar(Math.pow(.985,dt*60));ball.pos.x+=ballVel.x*dt;ball.pos.z+=ballVel.z*dt;
  if(Math.abs(ball.pos.x)>33){ball.pos.x=Math.sign(ball.pos.x)*33;ballVel.x*=-.55}
  if(Math.abs(ball.pos.z)>51){if(Math.abs(ball.pos.x)<4){score[ball.pos.z<0?0:1]++;updateScore();logEvent('¡GOOOOL! El balón entra en la portería.','goal');ball.pos.z=Math.sign(ball.pos.z)*48;ballVel.set(0,0,0)}else{ball.pos.z=Math.sign(ball.pos.z)*51;ballVel.z*=-.5}}
  ball.pos.y=.38+Math.abs(Math.sin(simulationTime*3))*Math.min(.8,Math.hypot(ballVel.x,ballVel.z)*.02);
  ball.mesh.rotation.x+=ballVel.z*dt;ball.mesh.rotation.z-=ballVel.x*dt;
  const rx=ball.pos.x-referee.group.position.x,rz=ball.pos.z-referee.group.position.z;
  const tx=THREE.MathUtils.clamp(ball.pos.x*.5,-27,27),tz=THREE.MathUtils.clamp(ball.pos.z*.5,-45,45);
  referee.group.position.x+=(tx-referee.group.position.x)*dt*.45;referee.group.position.z+=(tz-referee.group.position.z)*dt*.45;
  referee.group.rotation.y=Math.atan2(rx,rz);
  // Dynamic, plausible incidents are generated and stored for VAR review.
  if(simulationTime>nextEventAt){generateIncident();nextEventAt=simulationTime+8+Math.random()*14}
  if(Math.floor(simulationTime*5)%2===0)capture();
}
function maybeIncident(p){if(Math.random()<.2)generateIncident(p)}
function generateIncident(pick){
  const p=pick||players[Math.floor(Math.random()*players.length)];
  const type=['CONTACTO DUDOSO','POSIBLE MANO','POSIBLE FUERA DE JUEGO','ENTRADA EN EL ÁREA'][Math.floor(Math.random()*4)];
  const state=frameState();state.incident=type;state.actor=p?players.indexOf(p):0;
  // keep an actual sequence around the incident, from captured gameplay state
  frameHistory.push(state);if(frameHistory.length>750)frameHistory.shift();
  reviewEvent={type,initial:'JUEGO CONTINÚA',time:matchSeconds,actor:state.actor,states:frameHistory.slice(Math.max(0,frameHistory.length-95),frameHistory.length).map(s=>JSON.parse(JSON.stringify(s)))};
  $('var-chip').textContent='VAR · JUGADA REVISABLE';$('var-chip').style.background='#ffcc67';
  logEvent(`Jugada revisable: ${type.toLowerCase()}. Puedes abrir el VAR.`,'incident');
}
function updateScore(){$('score').textContent=`${score[0]} - ${score[1]}`}
function updateClock(){$('clock').textContent=formatClock(matchSeconds);$('period').textContent=matchSeconds<2700?'1.ª PARTE':matchSeconds<5400?'2.ª PARTE':'FINAL'}
function updateLog(){
  $('log-score').textContent=`${score[0]} - ${score[1]}`;$('log-minute').textContent=`${Math.floor(matchSeconds/60)}'`;$('yellow-count').textContent=cards.yellow;$('red-count').textContent=cards.red;
  $('event-list').innerHTML=eventLog.map(e=>`<div class="event"><time>${e.time}</time><span>${escapeHTML(e.text)}</span></div>`).join('')||'<p class="hint">Todavía no hay decisiones registradas.</p>';
}
function escapeHTML(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function playTone(freq=900,duration=.15,type='sine',volume=.13){try{const ac=playTone.ac||(playTone.ac=new (window.AudioContext||window.webkitAudioContext)());const osc=ac.createOscillator(),gain=ac.createGain();osc.type=type;osc.frequency.value=freq;gain.gain.value=volume;osc.connect(gain);gain.connect(ac.destination);osc.start();gain.gain.exponentialRampToValueAtTime(.001,ac.currentTime+duration);osc.stop(ac.currentTime+duration)}catch(e){}}
function whistle(){playTone(2300,.12,'square',.08);setTimeout(()=>playTone(1900,.18,'square',.08),130)}
function doAction(action){
  switch(action){
    case 'whistle':whistle();logEvent('Silbato: atención de los jugadores.');break;
    case 'stop':running=false;whistle();logEvent('Partido detenido por el árbitro.');break;
    case 'resume':if(matchSeconds>=MATCH_DURATION){toast('El partido ha terminado.');break}running=true;started=true;logEvent('Juego reanudado.');break;
    case 'foul':running=false;whistle();pendingDecision='Falta señalada';logEvent('Falta señalada. Reanuda con tiro libre.');break;
    case 'yellow':cards.yellow++;playTone(650,.2,'triangle');pendingDecision='Tarjeta amarilla';logEvent('Tarjeta amarilla mostrada por conducta antideportiva.');break;
    case 'red':cards.red++;playTone(380,.28,'triangle');pendingDecision='Tarjeta roja';logEvent('Tarjeta roja mostrada: expulsión. Un jugador se retira del campo.');{const p=players.find(x=>!x.red);if(p){p.red=true;p.group.visible=false}}break;
    case 'penalty':running=false;whistle();pendingDecision='Penalti';logEvent('Penalti señalado. Reanuda desde el punto de penalti.');ball.pos.set(0,.38,42);break;
    case 'offside':running=false;whistle();pendingDecision='Fuera de juego';logEvent('Fuera de juego señalado. Tiro libre indirecto.');break;
    case 'corner':running=false;whistle();pendingDecision='Saque de esquina';logEvent('Saque de esquina señalado.');ball.pos.set(-32,.38,50);break;
    case 'var':openVAR();break;
    case 'camera':currentCam=(currentCam+1)%4;toast(['Cámara TV','Cámara árbitro','Cámara lateral','Detrás de portería'][currentCam]);break;
    case 'log':$('log-modal').classList.remove('hidden');updateLog();break;
  }
}
function cameraUpdate(dt){
  let target=new THREE.Vector3(0,0,0),pos=new THREE.Vector3(0,64,88);
  if(currentCam===0){target.set(ball.pos.x*.3,0,ball.pos.z*.3);pos.set(ball.pos.x*.5,49,ball.pos.z+64)}
  if(currentCam===1){target.copy(referee.group.position);pos.set(referee.group.position.x+6,5,referee.group.position.z+8)}
  if(currentCam===2){target.set(ball.pos.x,0,ball.pos.z);pos.set(38,27,ball.pos.z+8)}
  if(currentCam===3){target.set(ball.pos.x,0,ball.pos.z);pos.set(0,9,ball.pos.z<0?-54:54)}
  camera.position.lerp(pos,.035);camera.lookAt(target);
  $('camera-label').textContent=['CÁMARA TV','CÁMARA ÁRBITRO','CÁMARA LATERAL','DETRÁS DE PORTERÍA'][currentCam];
}
function renderReplay(){
  if(!replayScene)return;
  if(reviewEvent&&reviewEvent.states.length){
    const states=reviewEvent.states;replayIndex=THREE.MathUtils.clamp(replayIndex,0,states.length-1);const s=states[replayIndex];
    replayActors.forEach((g,i)=>{const p=s.players[i];if(p){g.position.set(p[0],p[1],p[2]);g.rotation.y=p[3]||0}});
    replayRef.position.set(...s.ref.slice(0,3));replayRef.rotation.y=s.ref[3]||0;replayBall.position.set(...s.ball);
    if(replayCameraMode===0){replayCamera.position.set(s.ball[0]+45,24,s.ball[2]+4);replayCamera.lookAt(s.ball[0],0,s.ball[2])}
    if(replayCameraMode===1){const sign=s.ball[2]<0?-1:1;replayCamera.position.set(0,8,sign*58);replayCamera.lookAt(s.ball[0],1,s.ball[2])}
    if(replayCameraMode===2){replayCamera.position.set(0,68,86);replayCamera.lookAt(0,0,0)}
    replayLines.clear();
    if(offsideLines){const x=s.ball[0];const l=makeLine([[x,.08,-52],[x,.08,52]],new THREE.MeshStandardMaterial({color:0xff3333}),.11,replayLines);const l2=makeLine([[x+3,.08,-52],[x+3,.08,52]],new THREE.MeshStandardMaterial({color:0x44ffae}),.11,replayLines)}
    $('replay-status').textContent=`${reviewEvent.type} · FOTOGRAMA ${replayIndex+1}/${states.length}`;
  }else{$('replay-status').textContent='SIN JUGADA GUARDADA · ESPERA UNA JUGADA'}
  replayRenderer.render(replayScene,replayCamera);
}
function openVAR(){
  if(!reviewEvent){reviewEvent={type:'REVISIÓN GENERAL',initial:pendingDecision,time:matchSeconds,actor:0,states:frameHistory.slice(-95).map(s=>JSON.parse(JSON.stringify(s)))}}
  replayIndex=Math.max(0,reviewEvent.states.length-1);$('var-modal').classList.remove('hidden');$('var-hint').textContent=reviewEvent.states.length?`Revisando: ${reviewEvent.type}. El reloj y el estado del partido quedan pausados visualmente mientras consultas la repetición.`:'Aún no hay fotogramas guardados. Vuelve al partido y espera a que se desarrolle una jugada.';renderReplay();
}
function closeModal(id){$(id).classList.add('hidden');if(id==='var-modal')replayPlaying=false}
function resolveVAR(change){
  if(change){pendingDecision='Decisión cambiada por VAR';logEvent(`VAR: decisión cambiada tras revisar ${reviewEvent?.type||'la jugada'}.`,'var');running=false}
  else{logEvent(`VAR: decisión inicial mantenida (${reviewEvent?.initial||pendingDecision}).`,'var')}
  $('var-chip').textContent=change?'VAR · DECISIÓN CAMBIADA':'VAR · DECISIÓN CONFIRMADA';$('var-chip').style.background=change?'#6bd4a4':'#e7eef0';
  closeModal('var-modal');reviewEvent=null;
}
function setupUI(){
  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>doAction(b.dataset.action)));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
  $('prev-frame').addEventListener('click',()=>{replayIndex=Math.max(0,replayIndex-1);renderReplay()});
  $('next-frame').addEventListener('click',()=>{replayIndex=Math.min((reviewEvent?.states.length||1)-1,replayIndex+1);renderReplay()});
  $('play-replay').addEventListener('click',()=>{replayPlaying=!replayPlaying;$('play-replay').textContent=replayPlaying?'⏸ Pausar':'▶ Reproducir'});
  document.querySelectorAll('[data-replay-camera]').forEach(b=>b.addEventListener('click',()=>{replayCameraMode=+b.dataset.replayCamera;renderReplay()}));
  $('offside-lines').addEventListener('click',()=>{offsideLines=!offsideLines;$('offside-lines').textContent=`Líneas de fuera de juego: ${offsideLines?'ON':'OFF'}`;renderReplay()});
  $('keep-decision').addEventListener('click',()=>resolveVAR(false));$('change-decision').addEventListener('click',()=>resolveVAR(true));
  $('start-game').addEventListener('click',()=>{closeModal('menu-modal');started=true;running=true;logEvent('Comienza el partido entre Atlético Norte y Unión Sur.','system')});
  $('training').addEventListener('click',()=>showInfo('ENTRENAMIENTO ARBITRAL',`<h3>Situación 1: contacto en el área</h3><p>Un defensor llega tarde y derriba a un atacante dentro de su propia área. ¿Qué decisión corresponde?</p><button class="wide-button" id="train-pen">Señalar penalti</button><button class="wide-button secondary" id="train-play">Dejar seguir</button><div id="train-feedback"></div>` ,()=>{const a=$('train-pen'),b=$('train-play');if(a)a.onclick=()=>{$('train-feedback').innerHTML='<p><b>Correcto.</b> Si la infracción de tiro libre directo ocurre dentro del área del defensor, se concede penalti.</p>'};if(b)b.onclick=()=>{$('train-feedback').innerHTML='<p>No es la mejor decisión: un derribo imprudente que impide una ocasión en el área se sanciona con penalti.</p>'}}));
  $('settings').addEventListener('click',()=>showInfo('CONFIGURACIÓN',`<h3>Rendimiento</h3><p>El juego limita la resolución del renderizado para favorecer móviles. Puedes usar los botones de cámara para alternar las vistas.</p><label><input type="checkbox" id="sound-toggle" checked> Sonidos de silbato y tarjetas</label><p>El audio se activa al tocar un control por las restricciones de los navegadores móviles.</p>`,()=>{$('sound-toggle')?.addEventListener('change',e=>{window.soundsEnabled=e.target.checked})}));
  $('rules').addEventListener('click',()=>showInfo('REGLAS DEL FÚTBOL',`<h3>Decisiones básicas</h3><ul><li><b>Falta:</b> se sanciona una infracción de tiro libre directo o indirecto.</li><li><b>Penalti:</b> infracción de tiro libre directo cometida por un defensor dentro de su propia área.</li><li><b>Fuera de juego:</b> estar en posición de fuera de juego no es infracción por sí solo; debe intervenir activamente en el juego.</li><li><b>Tarjeta amarilla:</b> amonestación por conducta antideportiva u otras infracciones disciplinarias.</li><li><b>Tarjeta roja:</b> expulsión por una infracción de expulsión.</li><li><b>VAR:</b> ayuda en gol/no gol, penalti/no penalti, roja directa e identidad equivocada; solo interviene ante un error claro y manifiesto o un incidente grave inadvertido.</li></ul><p>Resumen orientativo, no sustituye el reglamento oficial completo.</p>`));
}
function showInfo(title,html,after){$('info-title').textContent=title;$('info-content').innerHTML=html;$('info-modal').classList.remove('hidden');if(after)setTimeout(after,0)}
function animate(now){
  requestAnimationFrame(animate);const dt=Math.min(.05,(now-lastTick)/1000||0);lastTick=now;
  simulate(dt);updateClock();cameraUpdate(dt);
  renderer.render(scene,camera);
  if(!$('var-modal').classList.contains('hidden')){if(replayPlaying&&reviewEvent){replayIndex++;if(replayIndex>=reviewEvent.states.length){replayIndex=0}}renderReplay()}
}
async function boot(){
  try{initThree();setupUI();window.addEventListener('resize',resize);window.addEventListener('orientationchange',()=>setTimeout(resize,200));
    if('serviceWorker'in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
    $('loading').style.opacity='0';setTimeout(()=>$('loading').remove(),450);$('menu-modal').classList.remove('hidden');
    // A small opening sequence is recorded so the replay monitor is immediately usable.
    for(let i=0;i<12;i++)capture();
    requestAnimationFrame(animate);
  }catch(err){console.error(err);$('loading').innerHTML=`<b>No se pudo iniciar el motor 3D</b><p style="max-width:300px;text-align:center">Comprueba que tienes conexión a internet y que el navegador permite WebGL y módulos JavaScript.</p><small>${String(err.message||err)}</small>`}
}
boot();
