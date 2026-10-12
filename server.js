const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
app.use(express.static("."));
app.get("/", (req, res) => res.sendFile(__dirname + "/index.html"));

const regionSeed = [
  ["Волинь",17,26],["Львівщина",18,43],["Закарпаття",13,58],["Івано-Франківщина",22,59],
  ["Тернопільщина",27,46],["Рівненщина",28,30],["Житомирщина",39,35],["Київщина",48,38],
  ["Чернігівщина",53,23],["Сумщина",67,26],["Харківщина",75,39],["Луганщина",86,42],
  ["Донеччина",82,54],["Запоріжжя",72,64],["Херсонщина",60,75],["Крим",67,89],
  ["Одещина",40,76],["Миколаївщина",51,68],["Дніпропетровщина",65,54],["Полтавщина",62,43],
  ["Черкащина",48,52],["Кіровоградщина",46,62],["Вінниччина",34,57],["Хмельниччина",31,47],
  ["Чернівеччина",27,68],["Черкащина-Північ",51,47],["Київ",49,41]
];
const regions = regionSeed.map((r,i)=>({id:"r"+i,name:r[0],x:r[1],y:r[2],owner:(i>=11&&i<=15)?"red":"blue",progress:0}));
const cities = [
  {id:"kyiv",name:"Київ",x:49,y:41,hp:100,region:"r26"},
  {id:"lviv",name:"Львів",x:18,y:43,hp:100,region:"r1"},
  {id:"odesa",name:"Одеса",x:40,y:76,hp:100,region:"r16"},
  {id:"dnipro",name:"Дніпро",x:66,y:55,hp:100,region:"r18"},
  {id:"kharkiv",name:"Харків",x:76,y:39,hp:100,region:"r10"},
  {id:"zaporizhzhia",name:"Запоріжжя",x:72,y:64,hp:100,region:"r13"},
  {id:"chernihiv",name:"Чернігів",x:53,y:23,hp:100,region:"r8"},
  {id:"mykolaiv",name:"Миколаїв",x:51,y:68,hp:100,region:"r17"}
];
const players = {};
const units = {};
let nextUnit = 1;
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
function snapshot(){return {players,units,regions,cities,online:Object.keys(players).length};}
function emitState(){io.emit("state",snapshot());}
function nearestRegion(x,y){return regions.reduce((best,r)=>Math.hypot(r.x-x,r.y-y)<Math.hypot(best.x-x,best.y-y)?r:best,regions[0]);}

io.on("connection",socket=>{
  const name="Гравець-"+socket.id.slice(0,4);
  players[socket.id]={id:socket.id,name,team:"blue",x:48+Math.random()*5,y:46+Math.random()*5,score:0};
  socket.emit("welcome",{id:socket.id,state:snapshot()});
  io.emit("notice",`${name} приєднався до захисту.`);
  emitState();

  socket.on("move",pos=>{
    const p=players[socket.id]; if(!p||!pos)return;
    p.x=clamp(Number(pos.x)||p.x,5,94);p.y=clamp(Number(pos.y)||p.y,8,91);
    emitState();
  });

  socket.on("launch",data=>{
    const p=players[socket.id];if(!p||!data)return;
    const type=["drone","fighter","shield"].includes(data.type)?data.type:"drone";
    const tx=clamp(Number(data.x)||p.x,5,95),ty=clamp(Number(data.y)||p.y,8,92);
    const id="u"+(nextUnit++);
    units[id]={id,owner:socket.id,team:"blue",type,x:p.x,y:p.y,tx,ty,
      speed:type==="fighter"?1.35:type==="drone"?0.9:0.58,hp:100};
    p.score+=1;
    io.emit("notice",`${p.name} відправив ${type==="fighter"?"літак":type==="drone"?"дрон":"щит"} на завдання.`);
    emitState();
  });

  socket.on("capture",id=>{
    const p=players[socket.id],r=regions.find(z=>z.id===id);if(!p||!r)return;
    const d=Math.hypot(p.x-r.x,p.y-r.y);
    if(d>18){socket.emit("notice","Перемістися ближче до сектора, щоб допомогти команді.");return;}
    r.progress+=25;
    if(r.progress>=100){r.owner="blue";r.progress=0;p.score+=50;io.emit("notice",`${p.name} допоміг захистити сектор «${r.name}»!`);}
    emitState();
  });

  socket.on("chat",text=>{
    const p=players[socket.id];if(!p||typeof text!=="string")return;
    const msg=text.trim().slice(0,180);if(msg)io.emit("chat",{name:p.name,text:msg,at:Date.now()});
  });

  socket.on("disconnect",()=>{
    delete players[socket.id];
    for(const [id,u] of Object.entries(units))if(u.owner===socket.id)delete units[id];
    io.emit("notice",`${name} вийшов із гри.`);emitState();
  });
});

setInterval(()=>{
  let changed=false;
  for(const [id,u] of Object.entries(units)){
    const dx=u.tx-u.x,dy=u.ty-u.y,d=Math.hypot(dx,dy)||1;
    if(d<1.6){
      const r=nearestRegion(u.tx,u.ty);
      if(u.type==="shield"){
        const city=cities.reduce((best,c)=>Math.hypot(c.x-u.tx,c.y-u.ty)<Math.hypot(best.x-u.tx,best.y-u.ty)?c:best,cities[0]);
        city.hp=Math.min(100,city.hp+20);
        io.emit("notice",`Щит посилив захист міста «${city.name}».`);
      } else {
        const owner=players[u.owner];if(owner)owner.score+=10;
      }
      delete units[id];changed=true;continue;
    }
    u.x+=dx/d*u.speed;u.y+=dy/d*u.speed;changed=true;
  }
  if(changed)emitState();
},100);

server.listen(PORT,()=>console.log(`Небесний щит працює на порту ${PORT}`));
