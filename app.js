/* ═══════════ 极简 Markdown 渲染 ═══════════ */
function escH(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

/* ═══════════ 离线流程图渲染（纯内嵌 SVG，无外部依赖）═══════════
   DSL：flow({dir:"LR"|"TB", nodes:[{id,t,type}], edges:[[from,to,label?]]})
   type: start(圆角绿) / decision(菱形橙) / io(平行四边形紫) / end(圆角灰) / 默认(矩形蓝)
   在 learn 的 Markdown 中用占位符 {{flow:base64(JSON)}} 引用，渲染时替换为 SVG。 */
const FLOW_PAL = {
  def:{fill:"#4d6bfe",stroke:"#3a55d6",txt:"#ffffff"},
  start:{fill:"#16a34a",stroke:"#12803c",txt:"#ffffff"},
  end:{fill:"#64748b",stroke:"#475569",txt:"#ffffff"},
  decision:{fill:"#d97706",stroke:"#b45309",txt:"#ffffff"},
  io:{fill:"#7c3aed",stroke:"#6d28d9",txt:"#ffffff"}
};
function flow(def){
  const dir = def.dir||"TB";
  const nodes = def.nodes||[], edges = def.edges||[];
  const byId = {}; nodes.forEach(n=>byId[n.id]=n);
  const meas = t=>{ const s=String(t||""); let w=0; for(const ch of s) w += (ch.charCodeAt(0)>255? 15.5 : 8.5); return w; };
  // 1) 尺寸
  nodes.forEach(n=>{
    n.type = n.type||"def";
    n.lines = String(n.t).split("\n");
    const wtext = Math.max(...n.lines.map(meas));
    if(n.type==="decision"){ n.w = Math.max(120, wtext+58); n.h = Math.max(64, n.lines.length*22+34); }
    else { n.w = Math.max(96, wtext+34); n.h = Math.max(46, n.lines.length*22+24); }
  });
  // 2) 发现式分层：节点只分配一次，反馈边不再把节点移回另一层。
  const indeg = {}, outEdges = {};
  nodes.forEach(n=>{ indeg[n.id]=0; outEdges[n.id]=[]; });
  edges.forEach(e=>{
    if(byId[e[0]]&&byId[e[1]]){ indeg[e[1]]++; outEdges[e[0]].push(e[1]); }
  });
  const depth = {}, queue = [];
  const discover = (id, level)=>{
    if(depth[id] !== undefined) return;
    depth[id] = level; queue.push(id);
  };
  nodes.forEach(n=>{ if(indeg[n.id]===0) discover(n.id,0); });
  let cursor = 0;
  while(true){
    while(cursor<queue.length){
      const id = queue[cursor++];
      outEdges[id].forEach(next=>discover(next,depth[id]+1));
    }
    const disconnected = nodes.find(n=>depth[n.id]===undefined);
    if(!disconnected) break;
    discover(disconnected.id,0);
  }
  const layers = [];
  nodes.forEach(n=>{
    const level = depth[n.id];
    if(!layers[level]) layers[level] = [];
    layers[level].push(n);
  });
  const horiz = dir==="LR", PAD=28, GX=70, GY=34;
  const mainOf = n=>horiz?n.w:n.h;
  const crossOf = n=>horiz?n.h:n.w;
  const mainPos = [];
  let mainOffset = PAD, maxCross = 0;
  layers.forEach(layer=>{
    let mainSize = 0, crossSize = GY*(layer.length-1);
    layer.forEach(n=>{
      mainSize = Math.max(mainSize,mainOf(n));
      crossSize += crossOf(n);
    });
    mainPos.push({start:mainOffset,size:mainSize});
    mainOffset += mainSize+GX;
    maxCross = Math.max(maxCross,crossSize);
  });
  layers.forEach((layer,level)=>{
    const crossSize = layer.reduce((sum,n)=>sum+crossOf(n),0)+GY*(layer.length-1);
    let crossOffset = PAD+(maxCross-crossSize)/2;
    layer.forEach(n=>{
      if(horiz){
        n.x = mainPos[level].start+(mainPos[level].size-n.w)/2;
        n.y = crossOffset;
      }else{
        n.x = crossOffset;
        n.y = mainPos[level].start+(mainPos[level].size-n.h)/2;
      }
      crossOffset += crossOf(n)+GY;
    });
  });
  const graphRight = Math.max(...nodes.map(n=>n.x+n.w));
  const backEdges = edges.filter(e=>{
    const a=byId[e[0]], b=byId[e[1]];
    return a&&b&&(horiz?b.x+b.w/2<a.x+a.w/2:b.y+b.h/2<a.y+a.h/2);
  });
  const backLabelWidth = Math.max(0,...backEdges.map(e=>e[2]?meas(e[2])+14:0));
  const feedbackWidth = !horiz&&backEdges.length
    ? (backEdges.length-1)*20+backLabelWidth/2+PAD/2
    : 0;
  const W = graphRight+PAD+feedbackWidth;
  const H = Math.max(...nodes.map(n=>n.y+n.h))+PAD;
  const cx = n=>n.x+n.w/2, cy = n=>n.y+n.h/2;
  // 出边锚点：决策节点按目标方位选菱形顶点/边，其余用右侧或下侧
  function anchor(a,b){
    if(a.type==="decision"){
      const dx = cx(b)-cx(a), dy = cy(b)-cy(a);
      if(horiz){ return Math.abs(dx)>Math.abs(dy)? (dx>0? {x:a.x+a.w,y:cy(a)} : {x:a.x,y:cy(a)}) : (dy>0? {x:cx(a),y:a.y+a.h} : {x:cx(a),y:a.y}); }
      else { return Math.abs(dy)>=Math.abs(dx)? (dy>0? {x:cx(a),y:a.y+a.h} : {x:cx(a),y:a.y}) : (dx>0? {x:a.x+a.w,y:cy(a)} : {x:a.x,y:cy(a)}); }
    }
    return horiz? {x:a.x+a.w, y:cy(a)} : {x:cx(a), y:a.y+a.h};
  }
  function inAnchor(b,a){ return horiz? {x:b.x, y:cy(b)} : {x:cx(b), y:b.y}; }
  // 4) 边
  let edgeSvg = "", feedbackIndex = 0;
  edges.forEach(e=>{
    const a=byId[e[0]], b=byId[e[1]]; if(!a||!b) return;
    const back = horiz? cx(b)<cx(a) : cy(b)<cy(a);
    let d, labelX, labelY;
    if(back){
      const laneIndex = feedbackIndex++;
      let x1,y1,x2,y2;
      if(horiz){
        x1=cx(a); y1=a.y; x2=cx(b); y2=b.y;
        const laneY=PAD/2+laneIndex*20;
        d=`M ${x1} ${y1} V ${laneY} H ${x2} V ${y2}`;
        labelX=(x1+x2)/2; labelY=laneY;
      }else{
        x1=a.x+a.w; y1=cy(a); x2=b.x+b.w; y2=cy(b);
        const laneX=graphRight+PAD/2+laneIndex*20;
        d=`M ${x1} ${y1} H ${laneX} V ${y2} H ${x2}`;
        labelX=laneX; labelY=(y1+y2)/2;
      }
    }else{
      const p1=anchor(a,b), p2=inAnchor(b,a);
      const x1=p1.x,y1=p1.y,x2=p2.x,y2=p2.y;
      if(horiz){ const mx=(x1+x2)/2; d=`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`; }
      else { const my=(y1+y2)/2; d=`M ${x1} ${y1} C ${x1} ${my} ${x2} ${my} ${x2} ${y2}`; }
      labelX=(x1+x2)/2; labelY=(y1+y2)/2-6;
    }
    edgeSvg += `<path d="${d}" fill="none" stroke="var(--text2)" stroke-width="1.6" marker-end="url(#fw-ar)" opacity="0.85"/>`;
    if(e[2]){
      const lw = meas(e[2])+14;
      edgeSvg += `<rect x="${labelX-lw/2}" y="${labelY-11}" width="${lw}" height="20" rx="10" fill="var(--panel)" stroke="var(--border)"/><text x="${labelX}" y="${labelY+4}" text-anchor="middle" font-size="12" fill="var(--text2)">${escH(e[2])}</text>`;
    }
  });
  // 5) 节点
  let nodeSvg = "";
  nodes.forEach(n=>{
    const c = FLOW_PAL[n.type]||FLOW_PAL.def;
    const tx = cx(n);
    const ty = i => cy(n) - (n.lines.length-1)*11 + i*22 + 5;
    const text = n.lines.map((ln,i)=>`<text x="${tx}" y="${ty(i)}" text-anchor="middle" font-size="13" font-weight="600" fill="${c.txt}">${escH(ln)}</text>`).join("");
    if(n.type==="decision"){
      const p = `${cx(n)},${n.y} ${n.x+n.w},${cy(n)} ${cx(n)},${n.y+n.h} ${n.x},${cy(n)}`;
      nodeSvg += `<polygon points="${p}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/>${text}`;
    } else if(n.type==="io"){
      const sk=14;
      const p = `${n.x+sk},${n.y} ${n.x+n.w},${n.y} ${n.x+n.w-sk},${n.y+n.h} ${n.x},${n.y+n.h}`;
      nodeSvg += `<polygon points="${p}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/>${text}`;
    } else {
      const rx = (n.type==="start"||n.type==="end")? n.h/2 : 10;
      nodeSvg += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${rx}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.6"/>${text}`;
    }
  });
  return `<svg class="flow-svg" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" width="100%" style="max-width:${Math.ceil(W)}px" xmlns="http://www.w3.org/2000/svg" role="img"><defs><marker id="fw-ar" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L8,4.5 L0,9 Z" fill="var(--text2)"/></marker></defs>${edgeSvg}${nodeSvg}</svg>`;
}
function b64decode(b){
  const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let bits=0, val=0, bytes=[];
  for(const ch of b){ if(ch==="=") break; const v=chars.indexOf(ch); if(v<0) continue; val=(val<<6)|v; bits+=6; if(bits>=8){ bits-=8; bytes.push((val>>bits)&0xff); } }
  return new Uint8Array(bytes);
}
function flowRender(token){
  try{
    const bytes = b64decode(token);
    const text = (typeof TextDecoder!=="undefined")? new TextDecoder("utf-8").decode(bytes) : decodeURIComponent(escape(String.fromCharCode(...bytes)));
    return flow(JSON.parse(text));
  }catch(e){ return `<div class="trap-box">流程图渲染失败：${escH(e.message)}</div>`; }
}
function md(src){
  if(!src) return "";
  src = src.replace(/~~~/g,"```");
  // 流程图占位符 {{flow:BASE64}} → SVG（先替换，避免内部字符被段落处理破坏）
  src = src.replace(/\{\{flow:([A-Za-z0-9+/=]+)\}\}/g, (m,t)=>"\n\n<!--FLOW-->"+t+"<!--/FLOW-->\n\n");
  const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g,"<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
  const lines = src.replace(/\r/g,"").split("\n");
  let html="", i=0;
  while(i<lines.length){
    const ln = lines[i];
    if(/^<!--FLOW-->([A-Za-z0-9+/=]+)<!--\/FLOW-->$/.test(ln.trim())){  // 流程图
      html += flowRender(ln.trim().replace(/^<!--FLOW-->/,"").replace(/<!--\/FLOW-->$/,""));
      i++; continue;
    }
    if(/^\s*```/.test(ln)){           // 代码块
      let code=[]; i++;
      while(i<lines.length && !/^\s*```/.test(lines[i])){ code.push(lines[i]); i++; }
      i++;
      html += "<pre><code>"+esc(code.join("\n"))+"</code></pre>"; continue;
    }
    if(/^\s*\|.*\|\s*$/.test(ln)){    // 表格
      let rows=[];
      while(i<lines.length && /^\s*\|.*\|\s*$/.test(lines[i])){ rows.push(lines[i]); i++; }
      rows = rows.filter(r=>!/^\s*\|[\s:|-]+\|\s*$/.test(r));
      html += "<table>"+rows.map((r,ri)=>{
        const cells = r.trim().replace(/^\||\|$/g,"").split("|").map(c=>inline(c.trim()));
        const tag = ri===0 ? "th" : "td";
        return "<tr>"+cells.map(c=>`<${tag}>${c}</${tag}>`).join("")+"</tr>";
      }).join("")+"</table>"; continue;
    }
    if(/^\s*####\s/.test(ln)){ html+="<h4>"+inline(ln.replace(/^\s*####\s*/,""))+"</h4>"; i++; continue; }
    if(/^\s*###\s/.test(ln)){ html+="<h3>"+inline(ln.replace(/^\s*###\s*/,""))+"</h3>"; i++; continue; }
    if(/^\s*##\s/.test(ln)){ html+="<h3 class=\"h2\">"+inline(ln.replace(/^\s*##\s*/,""))+"</h3>"; i++; continue; }
    if(/^\s*[-*]\s/.test(ln)){        // 无序列表
      let items=[];
      while(i<lines.length && /^\s*[-*]\s/.test(lines[i])){ items.push(inline(lines[i].replace(/^\s*[-*]\s*/,""))); i++; }
      html+="<ul>"+items.map(x=>"<li>"+x+"</li>").join("")+"</ul>"; continue;
    }
    if(/^ {4}\S/.test(ln)){           // 缩进代码块（连续缩进行）
      let code=[];
      while(i<lines.length && (/^ {4}\S/.test(lines[i]) || (/^\s*$/.test(lines[i]) && i+1<lines.length && /^ {4}\S/.test(lines[i+1])))){ code.push(lines[i].replace(/^ {4}/,"")); i++; }
      html += "<pre><code>"+esc(code.join("\n").replace(/\n\s*$/,""))+"</code></pre>"; continue;
    }
    if(/^\s*\d+\.\s/.test(ln)){       // 有序列表
      let items=[];
      while(i<lines.length && /^\s*\d+\.\s/.test(lines[i])){ items.push(inline(lines[i].replace(/^\s*\d+\.\s*/,""))); i++; }
      html+="<ol>"+items.map(x=>"<li>"+x+"</li>").join("")+"</ol>"; continue;
    }
    if(/^\s*$/.test(ln)){ i++; continue; }
    // 普通段落（合并连续行）
    let para=[ln]; i++;
    while(i<lines.length && !/^\s*$/.test(lines[i]) && !/^\s*(```|#{3,4}\s|[-*]\s|\d+\.\s|\|)/.test(lines[i])){ para.push(lines[i]); i++; }
    html+="<p>"+inline(para.join(" "))+"</p>";
  }
  return html;
}

/* ═══════════ 状态与数据 ═══════════ */
const store = {
  get mastered(){ try{ return new Set(JSON.parse(localStorage.getItem("aip_mastered")||"[]")); }catch(e){ return new Set(); } },
  set mastered(s){ localStorage.setItem("aip_mastered", JSON.stringify([...s])); },
  get theme(){ return localStorage.getItem("aip_theme")||"light"; },
  set theme(v){ localStorage.setItem("aip_theme", v); }
};
let DIMS = [];            // 维度数据
let TOPIC_INDEX = [];     // 扁平考点索引 {topic, mod, dim}
let ALL_QA = [];          // 全部面试题
let filterUnmastered = false;

function buildIndex(){
  const merged = {};
  (window.CONTENT_PARTS||[]).forEach(p=>{
    (merged[p.dimension] = merged[p.dimension] || {dimension:p.dimension, modules:[]}).modules.push(...p.modules);
  });
  DIMS = Object.values(merged);
  TOPIC_INDEX = []; ALL_QA = [];
  DIMS.forEach((d,di)=>d.modules.forEach((m,mi)=>m.topics.forEach((t,ti)=>{
    TOPIC_INDEX.push({topic:t, mod:m, dim:d, di, mi, ti});
    (t.qa||[]).forEach((q,qi)=>ALL_QA.push({q:q.q, points:q.points, topicTitle:t.title, topicId:t.id, modTitle:m.title, dimTitle:d.dimension}));
  })));
}

/* ═══════════ 侧栏导航 ═══════════ */
function renderNav(){
  const mastered = store.mastered;
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  DIMS.forEach((d,di)=>{
    const dimEl = document.createElement("div");
    dimEl.className = "nav-dim"; dimEl.textContent = d.dimension;
    nav.appendChild(dimEl);
    d.modules.forEach((m,mi)=>{
      const visTopics = m.topics.filter(t=>!filterUnmastered || !mastered.has(t.id));
      if(filterUnmastered && visTopics.length===0) return;
      const done = m.topics.filter(t=>mastered.has(t.id)).length;
      const mod = document.createElement("div");
      mod.className = "nav-mod";
      mod.innerHTML = `<div class="nav-mod-head"><span>${m.title}</span><span class="mod-badge">${done}/${m.topics.length}</span><span class="arrow">▶</span></div>`;
      const list = document.createElement("div"); list.className="nav-topics";
      visTopics.forEach(t=>{
        const te = document.createElement("div");
        te.className = "nav-topic"+(mastered.has(t.id)?" done":"");
        te.dataset.tid = t.id;
        te.innerHTML = `<span class="dot"></span><span>${t.title}</span>`;
        te.onclick = ()=>showTopic(t.id);
        list.appendChild(te);
      });
      mod.appendChild(list);
      mod.querySelector(".nav-mod-head").onclick = ()=>mod.classList.toggle("open");
      nav.appendChild(mod);
    });
  });
}

function updateStats(){
  const mastered = store.mastered;
  const total = TOPIC_INDEX.length, done = mastered.size;
  const pct = total? Math.round(done/total*100) : 0;
  document.getElementById("ring-num").textContent = pct+"%";
  document.getElementById("ring-fg").style.strokeDashoffset = 138.2*(1-pct/100);
  document.getElementById("stat-mastered").textContent = `${done} / ${total}`;
  document.getElementById("stat-qa").textContent = `共 ${ALL_QA.length} 道面试题`;
}

/* ═══════════ 页面切换 ═══════════ */
function showPage(id, preserveScroll=false){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("show"));
  document.getElementById(id).classList.add("show");
  document.body.classList.remove("nav-open");
  if(id!=="page-topic"){
    document.dispatchEvent(new Event("topicchange"));
    currentTopicId = null;
    clearTimeout(readingScrollTimer);
    const url = new URL(location.href);
    url.searchParams.delete("topic");
    history.replaceState(null, "", url);
  }
  if(!preserveScroll) window.scrollTo({top:0});
}

/* ── 总览 ── */
function renderHome(){
  const mastered = store.mastered;
  const total = TOPIC_INDEX.length, done = mastered.size;
  let html = `<h2 class="page-title">📊 学习总览</h2>
  <p class="page-desc">覆盖 Agent 开发工程师面试三大维度 · ${DIMS.reduce((s,d)=>s+d.modules.length,0)} 个模块 · ${total} 个考点 · ${ALL_QA.length} 道高频面试题。建议按「🗺️ 学习路线」推进，逐个考点精读 → 勾选掌握 → 用「🎤 模拟面试」检验。</p>
  <div class="stat-grid">
    <div class="stat"><div class="v">${Math.round(done/total*100||0)}%</div><div class="k">整体掌握进度</div></div>
    <div class="stat"><div class="v">${done}<span style="font-size:15px;color:var(--text2)"> / ${total}</span></div><div class="k">已掌握考点</div></div>
    <div class="stat"><div class="v">${ALL_QA.length}</div><div class="k">面试题库总量</div></div>
    <div class="stat"><div class="v">6 周</div><div class="k">建议备考周期</div></div>
  </div>`;
  DIMS.forEach(d=>{
    const dTotal = d.modules.reduce((s,m)=>s+m.topics.length,0);
    const dDone = d.modules.reduce((s,m)=>s+m.topics.filter(t=>mastered.has(t.id)).length,0);
    html += `<div class="card dim-block">
      <div class="dim-head"><h3>${d.dimension}</h3><span class="pct">${dDone}/${dTotal} 考点</span></div>
      <div class="bar"><i style="width:${dTotal?dDone/dTotal*100:0}%"></i></div>
      <div class="mod-chips">${d.modules.map(m=>{
        const md = m.topics.filter(t=>mastered.has(t.id)).length;
        return `<div class="chip ${md===m.topics.length?'full':''}" data-tid="${m.topics[0].id}">${m.title}<span class="c">${md}/${m.topics.length}</span></div>`;
      }).join("")}</div></div>`;
  });
  document.getElementById("page-home").innerHTML = html;
  document.querySelectorAll("#page-home .chip").forEach(c=>c.onclick=()=>showTopic(c.dataset.tid));
  showPage("page-home");
}

/* ── 学习路线 ── */
function topicRef(id){ const e = TOPIC_INDEX.find(x=>x.topic.id===id); return e? `<span data-tid="${id}">${e.topic.title}</span>` : ""; }
function renderRoadmap(){
  const phases = [
    { name:"第 1 阶段 · 打地基", time:"第 1–2 周", desc:"吃透 Agent 本质与经典范式，能徒手画出单 Agent 全链路；理解工具调用与 Function Calling 的底层原理。这是所有面试的必问区。", ids:["m1t1","m1t2","m2t1","m2t2"] },
    { name:"第 2 阶段 · 核心深水区", time:"第 2–3 周", desc:"攻克记忆系统与规划推理——Agent 区别于普通对话机器人的核心，也是中高级岗位的分水岭。", ids:["m3t1","m3t2","m3t3","m4t1","m4t2","m4t3"] },
    { name:"第 3 阶段 · 复杂架构与工程化", time:"第 3–4 周", desc:"多智能体协作、异常兜底、框架原理与服务化落地，体现架构设计与工程底盘。", ids:["m1t3","m2t3","m5t1","m5t2","m5t3"] },
    { name:"第 4 阶段 · 效果闭环与基础素养", time:"第 4–5 周", desc:"评测体系、失败迭代、风险防控——展现「凭数据说话」的优化方法论；补齐计算机基础。", ids:["m6t1","m6t2","m6t3","m7t1","m7t2"] },
    { name:"第 5 阶段 · 项目梳理", time:"第 5 周", desc:"用 STAR 法则重写项目叙述，准备量化数据与难题复盘故事，反复演练至脱口而出。", ids:["p1t1","p1t2","p2t1","p2t2","p3t1","p3t2"] },
    { name:"第 6 阶段 · 冲刺模拟", time:"第 6 周", desc:"软技能话术准备 + 每天至少一轮模拟面试，自评薄弱点回炉重学。", ids:["s1t1","s1t2","s2t1","s2t2","s3t1","s3t2"] }
  ];
  let html = `<h2 class="page-title">🗺️ 六周学习路线图</h2>
  <p class="page-desc">按"理论 → 深水区 → 工程化 → 效果闭环 → 项目梳理 → 冲刺"推进。点击阶段标签可直达考点。</p><div class="card"><div class="road">`;
  phases.forEach(p=>{
    html += `<div class="phase"><h4>${p.name}</h4><div class="ph-time">${p.time}</div><p>${p.desc}</p>
      <div class="targets">${p.ids.map(topicRef).join("")}</div></div>`;
  });
  html += `</div></div>
  <div class="card"><h3 style="margin-top:0">📌 学习方法建议</h3>
  <ul style="font-size:14px">
    <li><b>三步走</b>：每个考点先精读"核心知识" → 对照"面试官想听什么"自查理解 → 用面试题自测，答不出要点即未掌握。</li>
    <li><b>费曼输出</b>：合上讲义，用自己的话把 ReAct、记忆架构、评测体系讲出来——能讲清才算会。</li>
    <li><b>动手验证</b>：理论考点配合小实验（如用 LangGraph 写一个 ReAct Agent），面试时有代码细节可讲。</li>
    <li><b>善用模拟面试</b>：随机抽题 + 计时作答，训练高压下的表达结构（结论先行 → 分层展开 → 量化收尾）。</li>
  </ul></div>`;
  document.getElementById("page-roadmap").innerHTML = html;
  document.querySelectorAll("#page-roadmap .targets span").forEach(s=>s.onclick=()=>showTopic(s.dataset.tid));
  showPage("page-roadmap");
}

/* ── 考点详情 ── */
let currentTopicId = null;
let readingScrollTimer = null;
function saveReadingPosition(){
  if(currentTopicId) sessionStorage.setItem("aip_reading_position", JSON.stringify({
    topicId:currentTopicId, scrollY:window.scrollY
  }));
}
window.addEventListener("scroll", ()=>{
  if(!currentTopicId) return;
  clearTimeout(readingScrollTimer);
  readingScrollTimer = setTimeout(saveReadingPosition, 100);
}, {passive:true});
window.addEventListener("pagehide", saveReadingPosition);
function showTopic(tid, restorePosition=false){
  const idx = TOPIC_INDEX.findIndex(x=>x.topic.id===tid);
  if(idx<0) return;
  currentTopicId = tid;
  document.dispatchEvent(new Event("topicchange"));
  const url = new URL(location.href);
  url.searchParams.set("topic", tid);
  history.replaceState(null, "", url);
  const {topic:t, mod:m, dim:d} = TOPIC_INDEX[idx];
  const mastered = store.mastered.has(tid);
  const prev = TOPIC_INDEX[idx-1], next = TOPIC_INDEX[idx+1];
  let html = `
  <div class="crumb">${d.dimension} / ${m.title}</div>
  <div class="topic-head">
    <h2>${t.title}</h2>
    <div class="topic-actions">
      <button class="master-btn ${mastered?'done':''}" id="master-btn">${mastered?'已掌握':'标记为已掌握'}</button>
    </div>
  </div>
  <div class="what-box"><b>🎯 面试官想听什么：</b>${escH(t.what)}</div>
  <div class="card"><h3 style="margin-top:0">📖 核心知识详解</h3><div class="learn-body">${md(t.learn)}</div></div>
  ${t.traps&&t.traps.length?`<div class="trap-box"><div class="t-title">⚠️ 常见陷阱与追问</div><ul>${t.traps.map(x=>`<li>${escH(x)}</li>`).join("")}</ul></div>`:""}
  <div class="card"><h3 style="margin-top:0">💬 高频面试题（${(t.qa||[]).length}）</h3>
    ${(t.qa||[]).map((q,i)=>`
    <div class="qa-item">
      <div class="qa-q"><span class="qn">Q${i+1}</span><span>${escH(q.q)}</span><span class="toggle">展开答案 ▾</span></div>
      <div class="qa-a"><div class="a-label">✅ 参考答案要点</div><ul>${q.points.map(p=>`<li>${escH(p)}</li>`).join("")}</ul></div>
    </div>`).join("")}
  </div>
  <div class="topic-nav">
    ${prev?`<button data-tid="${prev.topic.id}"><span class="tn-dir">← 上一考点</span>${prev.topic.title}</button>`:"<span></span>"}
    ${next?`<button data-tid="${next.topic.id}" style="text-align:right"><span class="tn-dir">下一考点 →</span>${next.topic.title}</button>`:""}
  </div>
  `;
  document.getElementById("page-topic").innerHTML = html;
  document.getElementById("master-btn").onclick = ()=>{
    const s = store.mastered;
    s.has(tid)? s.delete(tid) : s.add(tid);
    store.mastered = s;
    refreshAfterProgress(); showTopic(tid);
  };
  document.querySelectorAll("#page-topic .qa-q").forEach(el=>el.onclick=()=>el.parentElement.classList.toggle("open"));
  document.querySelectorAll("#page-topic .topic-nav button").forEach(b=>b.onclick=()=>showTopic(b.dataset.tid));
  document.querySelectorAll(".nav-topic").forEach(e=>e.classList.toggle("active", e.dataset.tid===tid));
  // 展开所在模块
  const navTopic = document.querySelector(`.nav-topic[data-tid="${tid}"]`);
  if(navTopic){ navTopic.closest(".nav-mod").classList.add("open"); }
  showPage("page-topic", restorePosition);
  document.dispatchEvent(new CustomEvent("topicready", {detail:{topicId:tid}}));
}

function refreshAfterProgress(){ renderNav(); updateStats(); }

/* ═══════════ 模拟面试 ═══════════ */
const mock = { list:[], idx:0, results:[], seconds:0, timer:null, count:10 };
function renderMockSetup(){
  clearInterval(mock.timer);
  document.getElementById("page-mock").innerHTML = `
  <h2 class="page-title">🎤 模拟面试</h2>
  <p class="page-desc">从 ${ALL_QA.length} 道题库中随机抽题，计时作答。先在草稿区写下/说出你的回答，再展开答案要点对照自评。</p>
  <div class="card mock-setup">
    <div class="big">🎙️</div>
    <h3 style="margin:4px 0">选择本场题目数量</h3>
    <div class="count-opts">
      ${[5,10,15].map(n=>`<button class="${mock.count===n?'sel':''}" data-n="${n}">${n} 题</button>`).join("")}
    </div>
    <button class="primary-btn" id="mock-start">开始面试 →</button>
  </div>`;
  document.querySelectorAll(".count-opts button").forEach(b=>b.onclick=()=>{
    mock.count = +b.dataset.n;
    document.querySelectorAll(".count-opts button").forEach(x=>x.classList.toggle("sel",x===b));
  });
  document.getElementById("mock-start").onclick = startMock;
  showPage("page-mock");
}
function startMock(){
  const pool = [...ALL_QA];
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  mock.list = pool.slice(0, Math.min(mock.count, pool.length));
  mock.idx = 0; mock.results = []; mock.seconds = 0;
  clearInterval(mock.timer);
  mock.timer = setInterval(()=>{ mock.seconds++;
    const el=document.getElementById("mock-timer");
    if(el) el.textContent = fmtTime(mock.seconds);
  },1000);
  renderMockQ();
}
function fmtTime(s){ return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }
function renderMockQ(){
  const item = mock.list[mock.idx];
  document.getElementById("page-mock").innerHTML = `
  <div class="mock-bar">
    <span class="mi">第 <b>${mock.idx+1}</b> / ${mock.list.length} 题</span>
    <span class="timer" id="mock-timer">${fmtTime(mock.seconds)}</span>
    <span class="mi">来源：${item.modTitle} · ${item.topicTitle}</span>
    <button class="ghost-btn" style="margin-left:auto" id="mock-quit">✕ 结束本场</button>
  </div>
  <div class="card mock-q-card">
    <div class="mock-src">💬 面试官提问</div>
    <div class="mock-q-text">${escH(item.q)}</div>
    <textarea id="mock-notes" placeholder="✍️ 先在这里写下你的答题思路（结论 → 分层要点 → 量化/案例），再展开答案对照…"></textarea>
    <div style="margin-top:12px"><button class="ghost-btn" id="mock-reveal">📖 对照答案要点</button></div>
    <div class="mock-answer" id="mock-answer">
      <div class="a-label" style="font-size:12px;font-weight:700;color:var(--ok);margin-bottom:4px">✅ 参考答案要点</div>
      <ul style="font-size:14px;padding-left:20px">${item.points.map(p=>`<li>${escH(p)}</li>`).join("")}</ul>
      <div class="self-rate">
        <button data-r="2">😎 答得不错</button>
        <button data-r="1">😐 部分命中</button>
        <button data-r="0">😅 完全不会</button>
      </div>
    </div>
  </div>
  <div style="font-size:12.5px;color:var(--text2)">关联考点：<a href="javascript:void(0)" id="mock-goto">${item.topicTitle}</a>（结束面试后可回炉重学）</div>`;
  showPage("page-mock");
  document.getElementById("mock-reveal").onclick = ()=>document.getElementById("mock-answer").classList.add("show");
  document.getElementById("mock-quit").onclick = renderMockResult;
  document.getElementById("mock-goto").onclick = ()=>{ if(confirm("确定结束本场面试并跳转到该考点？")) showTopic(item.topicId); };
  document.querySelectorAll(".self-rate button").forEach(b=>b.onclick=()=>{
    mock.results.push({item, rating:+b.dataset.r});
    mock.idx++;
    mock.idx < mock.list.length ? renderMockQ() : renderMockResult();
  });
}
function renderMockResult(){
  clearInterval(mock.timer);
  const answered = mock.results;
  const good = answered.filter(r=>r.rating===2).length;
  const mid = answered.filter(r=>r.rating===1).length;
  const bad = answered.filter(r=>r.rating===0).length;
  const score = answered.length? Math.round((good*100+mid*60)/mock.list.length) : 0;
  let html = `
  <h2 class="page-title">📋 本场面试报告</h2>
  <div class="card">
    <div class="score-big">${answered.length? score : "—"}<span style="font-size:18px;color:var(--text2)"> 分</span></div>
    <div class="score-label">用时 ${fmtTime(mock.seconds)} · 作答 ${answered.length}/${mock.list.length} 题 · 😎${good} 😐${mid} 😅${bad}</div>
    ${mock.results.map(r=>`
    <div class="result-row">
      <span class="badge ${r.rating===2?'good':r.rating===1?'mid':'bad'}">${r.rating===2?'掌握':r.rating===1?'一般':'薄弱'}</span>
      <span class="rq">${escH(r.item.q)}</span>
      <button class="ghost-btn" data-tid="${r.item.topicId}">回炉</button>
    </div>`).join("")}
    <div style="display:flex;gap:10px;margin-top:18px;justify-content:center">
      <button class="primary-btn" id="mock-again">🔄 再来一场</button>
      <button class="ghost-btn" id="mock-home">回到总览</button>
    </div>
  </div>
  ${bad>0?`<div class="trap-box"><div class="t-title">💡 备考建议</div><ul><li>本场有 ${bad} 道薄弱题，点击"回炉"回到对应考点精读，掌握后再次模拟验证。</li><li>面试表达遵循：结论先行 → 分层展开（原理/方案/权衡）→ 量化收尾（数据/案例）。</li></ul></div>`:""}`;
  document.getElementById("page-mock").innerHTML = html;
  document.querySelectorAll("#page-mock .result-row button").forEach(b=>b.onclick=()=>showTopic(b.dataset.tid));
  document.getElementById("mock-again").onclick = renderMockSetup;
  document.getElementById("mock-home").onclick = renderHome;
  showPage("page-mock");
}

/* ═══════════ 搜索 ═══════════ */
let searchTimer = null;
function doSearch(kw){
  kw = kw.trim();
  if(kw.length<1){ if(currentTopicId) showTopic(currentTopicId); else renderHome(); return; }
  const hits = [];
  TOPIC_INDEX.forEach(({topic:t,mod:m,dim:d})=>{
    const hay = [t.title, t.what, t.learn, (t.traps||[]).join(" ")].join(" ");
    if(hay.toLowerCase().includes(kw.toLowerCase()))
      hits.push({type:"考点", title:t.title, path:`${d.dimension} / ${m.title}`, tid:t.id});
    (t.qa||[]).forEach(q=>{
      if((q.q+" "+q.points.join(" ")).toLowerCase().includes(kw.toLowerCase()))
        hits.push({type:"面试题", title:q.q, path:`${d.dimension} / ${m.title} / ${t.title}`, tid:t.id});
    });
  });
  const hl = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi"), m=>`<mark>${m}</mark>`);
  document.getElementById("page-search").innerHTML = `
    <h2 class="page-title">🔍 搜索「${hl(kw)}」</h2>
    <p class="page-desc">共 ${hits.length} 条结果</p>
    ${hits.length? hits.map(h=>`
      <div class="hit" data-tid="${h.tid}">
        <div class="h-type">${h.type}</div>
        <div class="h-title">${hl(h.title.slice(0,120))}</div>
        <div class="h-path">${h.path}</div>
      </div>`).join("") : `<div class="card" style="text-align:center;color:var(--text2)">未找到相关内容，换个关键词试试（如 ReAct、向量、评测、LangGraph）</div>`}`;
  document.querySelectorAll("#page-search .hit").forEach(el=>el.onclick=()=>showTopic(el.dataset.tid));
  showPage("page-search");
}

/* ═══════════ 事件绑定与初始化 ═══════════ */
function init(){
  document.documentElement.dataset.theme = store.theme;
  document.getElementById("btn-theme").textContent = store.theme==="dark" ? "☀️" : "🌙";
  document.getElementById("btn-home").onclick = renderHome;
  document.getElementById("btn-roadmap").onclick = renderRoadmap;
  document.getElementById("btn-mock").onclick = renderMockSetup;
  document.getElementById("btn-theme").onclick = ()=>{
    const t = store.theme==="dark" ? "light" : "dark";
    store.theme = t;
    document.documentElement.dataset.theme = t;
    document.getElementById("btn-theme").textContent = t==="dark" ? "☀️" : "🌙";
  };
  document.getElementById("btn-filter").onclick = function(){
    filterUnmastered = !filterUnmastered;
    this.classList.toggle("on", filterUnmastered);
    this.textContent = filterUnmastered ? "● 未掌握" : "◎ 筛选";
    renderNav();
  };
  document.getElementById("btn-reset").onclick = ()=>{
    if(confirm("确定清空所有学习进度？此操作不可撤销。")){
      localStorage.removeItem("aip_mastered");
      refreshAfterProgress();
      if(currentTopicId) showTopic(currentTopicId); else renderHome();
    }
  };
  document.getElementById("search").addEventListener("input", e=>{
    clearTimeout(searchTimer);
    searchTimer = setTimeout(()=>doSearch(e.target.value), 250);
  });
  document.getElementById("menu-fab").onclick = ()=>document.body.classList.toggle("nav-open");
  renderNav(); updateStats();
  const topicId = new URLSearchParams(location.search).get("topic");
  let savedPosition = null;
  try{
    savedPosition = JSON.parse(sessionStorage.getItem("aip_reading_position")||"null");
  }catch(error){
    console.warn("无法恢复上次阅读位置。",error);
  }
  if(topicId && TOPIC_INDEX.some(entry=>entry.topic.id===topicId)){
    showTopic(topicId, true);
    if(savedPosition?.topicId===topicId && Number.isFinite(savedPosition.scrollY)){
      requestAnimationFrame(()=>window.scrollTo({top:savedPosition.scrollY}));
    }
  }else{
    renderHome();
  }
}
document.addEventListener("DOMContentLoaded", ()=>{ buildIndex(); init(); });
