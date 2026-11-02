const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const rooms = new Map();

const server = http.createServer((req,res)=>{
  let pathname = decodeURIComponent((req.url||'/').split('?')[0]);
  if(pathname === '/') pathname='/index.html';
  const file = path.join(ROOT, pathname.replace(/^\/+/,''));
  if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end('Not found');}
    const ext=path.extname(file);
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json'};
    res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  });
});
const wss = new WebSocketServer({server});
function send(ws,obj){if(ws.readyState===1)ws.send(JSON.stringify(obj));}
function broadcast(room,obj){for(const p of room.players.values())send(p.ws,obj);}
function state(room){
  return {type:'state',chasing:room.chasing,hector:room.hector,
    players:[...room.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,z:p.z,dead:p.dead}))};
}
function removePlayer(p){
  const room=rooms.get(p.room);if(!room)return;
  room.players.delete(p.id);
  if(room.players.size===0)rooms.delete(p.room);else broadcast(room,state(room));
}
wss.on('connection',ws=>{
  let current=null;
  ws.on('message',raw=>{
    let msg;try{msg=JSON.parse(raw.toString())}catch{return;}
    if(msg.type==='join'){
      const roomCode=String(msg.room||'CHILOE1').toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,12);
      let room=rooms.get(roomCode);
      if(!room){room={players:new Map(),chasing:false,hector:{x:5,z:5}};rooms.set(roomCode,room);}
      if(room.players.size>=8){send(ws,{type:'room_full'});return;}
      const id=randomUUID();
      current={id,room:roomCode,ws,name:String(msg.name||'Jugador').slice(0,16),x:0,z:16,yaw:0,dead:false};
      room.players.set(id,current);
      send(ws,{type:'joined',id,player:{x:current.x,z:current.z},hector:room.hector});
      broadcast(room,state(room));
      return;
    }
    if(!current)return;
    const room=rooms.get(current.room);if(!room)return;
    if(msg.type==='move'){
      current.x=Math.max(-115,Math.min(115,Number(msg.x)||0));
      current.z=Math.max(-115,Math.min(115,Number(msg.z)||0));
      current.yaw=Number(msg.yaw)||0;
    }
    if(msg.type==='startChase'&&!room.chasing){
      room.chasing=true;broadcast(room,{type:'chase'});broadcast(room,state(room));
    }
    if(msg.type==='restart'){
      current.dead=false;current.x=0;current.z=16;
      room.chasing=false;room.hector={x:5,z:5};
      for(const p of room.players.values())p.dead=false;
      broadcast(room,{type:'restarted'});broadcast(room,state(room));
    }
  });
  ws.on('close',()=>{if(current)removePlayer(current);});
});

// Authoritative shared Hector movement and player catches.
setInterval(()=>{
  for(const room of rooms.values()){
    if(room.chasing){
      const alive=[...room.players.values()].filter(p=>!p.dead);
      if(alive.length){
        let target=alive[0],best=Infinity;
        for(const p of alive){const d=Math.hypot(p.x-room.hector.x,p.z-room.hector.z);if(d<best){best=d;target=p;}}
        if(best>1.35){
          const step=7.2*.05;
          room.hector.x+=(target.x-room.hector.x)/best*step;
          room.hector.z+=(target.z-room.hector.z)/best*step;
        }else{
          target.dead=true;
          for(const p of room.players.values())send(p.ws,{type:'death',id:target.id});
        }
      }
    }
    broadcast(room,state(room));
  }
},50);

server.listen(PORT,()=>console.log(`Parque Chiloé multijugador en http://localhost:${PORT}`));
