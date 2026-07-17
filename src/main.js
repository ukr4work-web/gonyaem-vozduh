import './style.css';
import { io } from 'socket.io-client';
import headUrl from '../assets/head.png';

const $ = (s) => document.querySelector(s);
const canvas = $('#game'), ctx = canvas.getContext('2d');
const scoreEls = [$('#score1'), $('#score2')], timerEl = $('#timer');
const startPanel = $('#startPanel'), endPanel = $('#endPanel'), lobbyActions = $('#lobbyActions'), waitingPanel = $('#waitingPanel');
const winnerText = $('#winnerText'), finalScore = $('#finalScore'), goalFlash = $('#goalFlash'), soundButton = $('#soundButton');
const roomInput = $('#roomInput'), lobbyError = $('#lobbyError'), networkStatus = $('#networkStatus');
const W = 1000, H = 600, goalSize = 220, wall = 24, keys = new Set();
let state = 'menu', playerIndex = null, room = '', soundOn = true, audioCtx, pointerId = null, lastSend = 0;
let game = { score:[0,0], timeLeft:90, pause:0, paddles:[{x:210,y:300,vx:0,vy:0},{x:790,y:300,vx:0,vy:0}], puck:{x:500,y:300,vx:0,vy:0,spin:0} };
const visual = structuredClone(game), particles = [];
const head = new Image(); head.src = headUrl;
const socket = io({ transports: ['websocket', 'polling'] });
const requestedRoom = new URLSearchParams(location.search).get('room')?.toUpperCase();
let autoJoinAttempted = false;

function tone(freq=220,duration=.08,type='square',volume=.035){
  if(!soundOn)return; audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
  const osc=audioCtx.createOscillator(), gain=audioCtx.createGain(); osc.type=type;osc.frequency.setValueAtTime(freq,audioCtx.currentTime);
  gain.gain.setValueAtTime(volume,audioCtx.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+duration);
  osc.connect(gain).connect(audioCtx.destination);osc.start();osc.stop(audioCtx.currentTime+duration);
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function setNetwork(ok,label){networkStatus.classList.toggle('online',ok);networkStatus.lastChild.textContent=` ${label}`;}
function showError(text){lobbyError.textContent=text;}
function enterRoom(result){
  room=result.code;playerIndex=result.player;roomInput.value=room;$('#roomCode').textContent=room;lobbyActions.hidden=true;waitingPanel.hidden=false;showError('');
  const url=new URL(location.href);url.searchParams.set('room',room);history.replaceState(null,'',url);setNetwork(true,`КОМНАТА ${room}`);
}
function beginMatch(snapshot){game=snapshot;Object.assign(visual,structuredClone(snapshot));state='playing';startPanel.hidden=true;endPanel.hidden=true;tone(440,.12,'square',.04);}
function finish(snapshot){game=snapshot;state='ended';const s=snapshot.score;winnerText.textContent=s[0]===s[1]?'НИЧЬЯ!':`ИГРОК ${s[0]>s[1]?1:2} ПОБЕДИЛ`;finalScore.textContent=`${s[0]} : ${s[1]}`;endPanel.hidden=false;tone(110,.35,'sawtooth',.04);}
function copyLink(){
  const url=new URL(location.href);url.searchParams.set('room',room);navigator.clipboard.writeText(url.toString()).then(()=>{$('#copyButton').textContent='ССЫЛКА СКОПИРОВАНА';setTimeout(()=>$('#copyButton').textContent='СКОПИРОВАТЬ ССЫЛКУ',1800)});
}
socket.on('connect',()=>{
  setNetwork(true,'В СЕТИ');
  if(requestedRoom && !room && !autoJoinAttempted){
    autoJoinAttempted=true;
    roomInput.value=requestedRoom;
    $('#connectionLabel').textContent=`ПОДКЛЮЧАЕМ К КОМНАТЕ ${requestedRoom}`;
    joinRoom();
  }
});
socket.on('disconnect',()=>setNetwork(false,'НЕТ СВЯЗИ'));
socket.on('match:start',beginMatch);
socket.on('state',snapshot=>{game=snapshot;scoreEls.forEach((el,i)=>el.textContent=snapshot.score[i]);const t=snapshot.timeLeft;timerEl.textContent=`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.ceil(t%60)).padStart(2,'0')}`;});
socket.on('match:goal',({player,score})=>{goalFlash.classList.remove('show');void goalFlash.offsetWidth;goalFlash.classList.add('show');scoreEls.forEach((el,i)=>el.textContent=score[i]);const p=visual.puck;for(let i=0;i<55;i++)particles.push({x:p.x,y:p.y,vx:(Math.random()-.5)*650,vy:(Math.random()-.5)*650,life:1,color:player?'#34a7ff':'#ff3154'});tone(130,.35,'sawtooth',.07);setTimeout(()=>tone(260,.2,'square',.04),90)});
socket.on('match:end',finish);
socket.on('room:left',()=>{state='menu';startPanel.hidden=false;endPanel.hidden=true;lobbyActions.hidden=false;waitingPanel.hidden=true;showError('Второй игрок отключился. Создайте новую комнату.');setNetwork(true,'В СЕТИ');room='';playerIndex=null;history.replaceState(null,'',location.pathname)});

function createRoom(){socket.emit('room:create',result=>{if(result.ok)enterRoom(result);else showError(result.error)})}
function joinRoom(){const code=roomInput.value.trim().toUpperCase();if(code.length!==5)return showError('Введите пятизначный код');socket.emit('room:join',code,result=>{if(result.ok)enterRoom(result);else showError(result.error)})}
function updateLocalInput(now){
  if(state!=='playing'||playerIndex==null)return;const p=visual.paddles[playerIndex];let dx=0,dy=0;
  dx=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);dy=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0);
  if(dx&&dy){dx*=.707;dy*=.707}if(pointerId==null){p.x+=dx*8;p.y+=dy*8}
  p.x=clamp(p.x,wall+50,playerIndex===0?W/2-68:W-wall-50);if(playerIndex===1)p.x=Math.max(p.x,W/2+68);p.y=clamp(p.y,wall+50,H-wall-50);
  if(now-lastSend>16){socket.emit('paddle:move',{x:p.x,y:p.y});lastSend=now}
}
function interpolate(dt){
  const a=1-Math.pow(.0005,dt);visual.puck.x+=(game.puck.x-visual.puck.x)*a;visual.puck.y+=(game.puck.y-visual.puck.y)*a;visual.puck.spin=game.puck.spin;
  visual.paddles.forEach((p,i)=>{if(i===playerIndex)return;p.x+=(game.paddles[i].x-p.x)*a;p.y+=(game.paddles[i].y-p.y)*a});
  particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=200*dt;p.life-=dt*1.5});for(let i=particles.length-1;i>=0;i--)if(particles[i].life<=0)particles.splice(i,1);
}
function roundedRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function draw(){
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#0a101d';ctx.fillRect(0,0,W,H);const glow=ctx.createRadialGradient(W/2,H/2,20,W/2,H/2,480);glow.addColorStop(0,'#1a2a3a');glow.addColorStop(1,'#080c17');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
  ctx.save();ctx.globalAlpha=.055;ctx.strokeStyle='#fff';ctx.lineWidth=1;for(let x=20;x<W;x+=28){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}for(let y=20;y<H;y+=28){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}ctx.restore();
  ctx.strokeStyle='#ffffff18';ctx.lineWidth=3;roundedRect(wall,wall,W-wall*2,H-wall*2,24);ctx.stroke();ctx.beginPath();ctx.moveTo(W/2,wall);ctx.lineTo(W/2,H-wall);ctx.strokeStyle='#ffffff2b';ctx.lineWidth=2;ctx.setLineDash([8,12]);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(W/2,H/2,104,0,Math.PI*2);ctx.strokeStyle='#ffffff1d';ctx.lineWidth=3;ctx.stroke();ctx.beginPath();ctx.arc(W/2,H/2,7,0,Math.PI*2);ctx.fillStyle='#ffffff35';ctx.fill();
  [[0,'#ff3154'],[W,'#34a7ff']].forEach(([x,c],i)=>{const gy=H/2-goalSize/2;ctx.fillStyle=c+'22';ctx.fillRect(i?W-wall:0,gy,wall,goalSize);ctx.strokeStyle=c;ctx.lineWidth=5;ctx.shadowColor=c;ctx.shadowBlur=18;ctx.beginPath();ctx.moveTo(x,gy);ctx.lineTo(i?W-wall:wall,gy);ctx.lineTo(i?W-wall:wall,gy+goalSize);ctx.lineTo(x,gy+goalSize);ctx.stroke();ctx.shadowBlur=0});
  ctx.font='700 10px Unbounded';ctx.textAlign='center';ctx.fillStyle='#ff315455';ctx.fillText(playerIndex===0?'ТВОЯ ЗОНА':'ИГРОК 1',W*.25,54);ctx.fillStyle='#34a7ff55';ctx.fillText(playerIndex===1?'ТВОЯ ЗОНА':'ИГРОК 2',W*.75,54);
  particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,5,5)});ctx.globalAlpha=1;
  visual.paddles.forEach((p,i)=>{const color=i?'#34a7ff':'#ff3154';ctx.save();ctx.translate(p.x,p.y);ctx.shadowColor=color;ctx.shadowBlur=28;ctx.fillStyle=color+'55';ctx.beginPath();ctx.arc(0,0,55,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;const g=ctx.createRadialGradient(-14,-15,4,0,0,50);g.addColorStop(0,'#fff');g.addColorStop(.16,color);g.addColorStop(1,'#111829');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,50,0,Math.PI*2);ctx.fill();ctx.strokeStyle=i===playerIndex?'#cbff4a':'#fff8';ctx.lineWidth=i===playerIndex?5:3;ctx.stroke();ctx.beginPath();ctx.arc(0,0,24,0,Math.PI*2);ctx.strokeStyle='#0008';ctx.lineWidth=7;ctx.stroke();ctx.restore()});
  const puck=visual.puck;ctx.save();ctx.translate(puck.x,puck.y);ctx.rotate(puck.spin);ctx.shadowColor='#cbff4a';ctx.shadowBlur=30;ctx.fillStyle='#111';ctx.beginPath();ctx.arc(0,0,50,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.beginPath();ctx.arc(0,0,45,0,Math.PI*2);ctx.clip();if(head.complete){const size=Math.min(head.naturalWidth,head.naturalHeight)*.58,sx=(head.naturalWidth-size)/2,sy=head.naturalHeight*.2;ctx.drawImage(head,sx,sy,size,size,-45,-45,90,90)}ctx.restore();ctx.beginPath();ctx.arc(puck.x,puck.y,48,0,Math.PI*2);ctx.strokeStyle='#cbff4a';ctx.lineWidth=5;ctx.stroke();
}
let last=performance.now();function loop(now){const dt=Math.min((now-last)/1000,.05);last=now;updateLocalInput(now);interpolate(dt);draw();requestAnimationFrame(loop)}
function pointerPos(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height}}
canvas.addEventListener('pointerdown',e=>{if(state!=='playing')return;pointerId=e.pointerId;const p=pointerPos(e);visual.paddles[playerIndex].x=p.x;visual.paddles[playerIndex].y=p.y;canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(e.pointerId!==pointerId)return;const p=pointerPos(e);visual.paddles[playerIndex].x=p.x;visual.paddles[playerIndex].y=p.y});
const release=e=>{if(e.pointerId===pointerId)pointerId=null};canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
window.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();keys.add(e.code)});window.addEventListener('keyup',e=>keys.delete(e.code));
$('#createButton').addEventListener('click',createRoom);$('#joinButton').addEventListener('click',joinRoom);roomInput.addEventListener('keydown',e=>{if(e.key==='Enter')joinRoom()});roomInput.addEventListener('input',()=>roomInput.value=roomInput.value.toUpperCase().replace(/[^A-Z2-9]/g,''));
$('#copyButton').addEventListener('click',copyLink);$('#restartButton').addEventListener('click',()=>socket.emit('match:rematch'));$('#resetButton').addEventListener('click',()=>location.href=location.pathname);
soundButton.addEventListener('click',()=>{soundOn=!soundOn;soundButton.setAttribute('aria-pressed',String(soundOn));soundButton.setAttribute('aria-label',soundOn?'Выключить звук':'Включить звук');if(soundOn)tone(440)});
if(requestedRoom){roomInput.value=requestedRoom;$('#connectionLabel').textContent=`ПОДКЛЮЧАЕМ К КОМНАТЕ ${requestedRoom}`;}
requestAnimationFrame(loop);
