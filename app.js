const SUPABASE_URL = 'https://awxppuonjntuwcskxowg.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_BJnrTdTgkxforyHZbAqHuw_cMa7pymB';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const CATEGORIES = [
  { name: 'Garam', mode: 'flow' },
  { name: 'Chemical Boiler', mode: 'flow' },
  { name: 'Chemical Limbah - P.A.C', mode: 'flow' },
  { name: 'Chemical Limbah - KATFLOCK', mode: 'flow' },
  { name: 'Gas - CNG', mode: 'meter' },
  { name: 'Gas - Boiler', mode: 'meter' },
  { name: 'Air PAM', mode: 'meter' }
];

const $ = id => document.getElementById(id);
let authMode = 'login', entries = [], limits = [], activities = [], profiles = [], currentRole = 'operator', realtimeChannel = null, currentUser = null, notificationsReadAt = localStorage.getItem('stocklog_notifications_read_at') || '';
let authBusy = false, savingEntry = false, savingLimit = false, activeSessionId = null;

function today(){ return new Date().toISOString().slice(0,10); }
function num(id){ const v=parseFloat($(id).value); return Number.isFinite(v)?v:0; }
function fmt(v){ return new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(Number(v||0)); }
function getCategory(name){ return CATEGORIES.find(c=>c.name===name)||CATEGORIES[0]; }
function setMessage(el,text='',type=''){ el.textContent=text; el.className=`message ${type}`.trim(); }
function setConnectionState(){ const b=$('connectionBanner'); if(!b)return; const offline=!navigator.onLine; b.classList.toggle('hidden',!offline); b.textContent=offline?'⚠️ Koneksi internet terputus. Jangan tutup aplikasi. Setelah koneksi kembali, coba simpan lagi.':'🟢 Koneksi kembali. Aplikasi siap digunakan.'; if(!offline){ clearTimeout(setConnectionState._timer); setConnectionState._timer=setTimeout(()=>b.classList.add('hidden'),1800); } }

function setPage(page='home'){
  const allowedAdmin=['stock','report','notifications','settings'];
  if(allowedAdmin.includes(page) && currentRole!=='admin') page='home';
  document.querySelectorAll('.nav-item').forEach(btn=>btn.classList.toggle('active',btn.dataset.page===page));
  document.body.dataset.page=page;
  document.querySelectorAll('.page-section').forEach(el=>{
    const classes=[...el.classList];
    const show=classes.includes(`page-${page}`);
    el.classList.toggle('page-off',!show);
  });
  const navBadge=$('navNotificationBadge');
  if(navBadge && $('notificationBadge')) navBadge.textContent=$('notificationBadge').textContent||'0';
  if(page==='history') renderEntries();
  if(page==='stock'){renderDashboard();renderAlerts();}
  if(page==='report') renderReport();
  if(page==='notifications') { $('notificationPanel')?.classList.remove('hidden'); renderNotifications(); }
}
function setupNavigation(){
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
    const page=btn.dataset.page;
    if(page==='input'){ openModal(); return; }
    if(page==='settings'){ openSettings(); return; }
    setPage(page);
  }));
  setPage('home');
}
function renderCategoryCards(){
  const icons=['🧂','🧪','🧴','🧪','🔥','♨️','💧'];
  $('categoryCards').innerHTML=CATEGORIES.map((c,i)=>`<button class="category-card" data-category="${c.name}"><div class="cat-icon">${icons[i]}</div><div class="cat-name">${c.name}</div><div class="cat-type">${c.mode==='flow'?'Stok bahan':'Meter 24 jam'}</div></button>`).join('');
  document.querySelectorAll('.category-card').forEach(btn=>btn.addEventListener('click',()=>{
    if(currentRole==='operator'){
      setPage('input');
      openModal();
      $('entryCategory').value=btn.dataset.category;
      updateModeUI();
    } else {
      $('categoryFilter').value=btn.dataset.category;
      setPage('history');
      renderEntries();
    }
  }));
}
function fillCategorySelects(){
  $('entryCategory').innerHTML=CATEGORIES.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
  $('categoryFilter').innerHTML='<option value="">Semua kategori</option>'+CATEGORIES.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
  $('settingCategory').innerHTML=CATEGORIES.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
}
function updatePreview(){
  const cat=getCategory($('entryCategory').value);
  if(cat.mode==='flow') $('closingPreview').textContent=fmt(num('opening')+num('incoming')-num('usage'));
  else $('meterUsagePreview').textContent=fmt(num('meterClosing')-num('meterOpening'));
}
function updateModeUI(){
  const flow=getCategory($('entryCategory').value).mode==='flow';
  $('flowFields').classList.toggle('hidden',!flow); $('meterFields').classList.toggle('hidden',flow);
  $('modeHelp').textContent=flow?'Saldo akhir = saldo awal + pemasukan − pemakaian.':'Pemakaian = saldo akhir − saldo awal.'; updatePreview();
}

async function getPreviousBalance(category,item,date,excludeId=''){
  let q=db.from('stock_entries').select('id,tanggal,saldo_akhir').eq('kategori',category).eq('nama_item',item).lt('tanggal',date).order('tanggal',{ascending:false}).limit(1);
  if(excludeId) q=q.neq('id',excludeId);
  const {data,error}=await q; if(error) throw error; return data?.[0]?.saldo_akhir??null;
}
function syncItemFromCategory(){
  const category=$('entryCategory').value;
  const item=getCategory(category).name;
  $('entryItem').value=item;
  $('entryItemDisplay').textContent=item;
}

async function syncOpeningBalance(){
  const id=$('entryId').value, category=$('entryCategory').value, date=$('entryDate').value;
  syncItemFromCategory();
  if(!category||!date||id)return;
  try{
    const item=getCategory(category).name;
    const previous=await getPreviousBalance(category,item,date);
    const target=getCategory(category).mode==='flow' ? $('opening') : $('meterOpening');
    target.value=previous!==null ? previous : 0;
    updatePreview();
  }catch(e){console.warn(e.message);}
}

async function loadProfiles(){
  if(currentRole!=='admin'){profiles=[];return;}
  const {data,error}=await db.from('profiles').select('id,nama,role,aktif,created_at').order('created_at',{ascending:true});
  if(error){console.warn('Profiles:',error.message);profiles=[];return;}
  profiles=data||[]; renderProfiles();
}
function renderProfiles(){
  if(currentRole!=='admin'||!$('profilesBody'))return;
  $('profileCount').textContent=`${profiles.length} user`;
  $('profilesBody').innerHTML=profiles.length?profiles.map(p=>{
    const isMe=p.id===currentUser?.id, active=p.aktif!==false;
    return `<tr><td><strong>${esc(p.nama||'Belum diisi')}</strong><small class="table-sub">${esc(p.id)}</small></td><td><span class="actor">${esc(p.id.slice(0,8))}…</span></td><td><span class="badge">${String(p.role||'operator').toUpperCase()}</span></td><td><span class="status-pill ${active?'on':'off'}">${active?'AKTIF':'NONAKTIF'}</span></td><td>${isMe?'<span class="muted">Akun saya</span>':`<button class="small" onclick="toggleProfile('${p.id}',${active})">${active?'Nonaktifkan':'Aktifkan'}</button><button class="small" onclick="toggleRole('${p.id}','${p.role==='admin'?'operator':'admin'}')">Jadikan ${p.role==='admin'?'Operator':'Admin'}</button>`}</td></tr>`;
  }).join(''):'<tr><td colspan="5">Belum ada user.</td></tr>';
}
window.toggleProfile=async(id,active)=>{
  if(id===currentUser?.id)return alert('Akun admin yang sedang dipakai tidak bisa dinonaktifkan.');
  const {error}=await db.from('profiles').update({aktif:!active}).eq('id',id);
  if(error)return alert(`Gagal mengubah status: ${error.message}`);
  await loadProfiles();
};
window.toggleRole=async(id,role)=>{
  if(id===currentUser?.id)return alert('Role akun admin yang sedang dipakai tidak diubah dari sini.');
  if(!confirm(`Ubah role user ini menjadi ${role.toUpperCase()}?`))return;
  const {error}=await db.from('profiles').update({role}).eq('id',id);
  if(error)return alert(`Gagal mengubah role: ${error.message}`);
  await loadProfiles();
};

async function loadLimits(){
  const {data,error}=await db.from('stock_limits').select('*').order('kategori').order('nama_item');
  if(error){console.warn('Batas minimum:',error.message);limits=[];return;}
  limits=data||[]; renderAlerts(); if(currentRole==='admin'){renderSettings();loadProfiles();}
}
async function loadEntries(){
  const {data,error}=await db.from('stock_entries').select('*').order('tanggal',{ascending:false}).order('created_at',{ascending:false});
  if(error){ console.warn('Entries:',error.message); const b=$('connectionBanner'); if(b){b.textContent='⚠️ Gagal mengambil data. Periksa koneksi lalu coba lagi.';b.classList.remove('hidden');} return;}
  entries=data||[];renderEntries();updateStats();renderAlerts();renderDashboard();initReportFilters();renderReport();
}
function latestByItem(){
  const map=new Map();
  [...entries].sort((a,b)=>`${b.tanggal}${b.created_at||''}`.localeCompare(`${a.tanggal}${a.created_at||''}`)).forEach(e=>{const k=`${e.kategori}|||${e.nama_item}`;if(!map.has(k))map.set(k,e);});
  return map;
}
function getItemPrediction(kategori,item){
  const cat=getCategory(kategori);
  if(cat.mode!=='flow')return null;
  const now=new Date();
  const cutoff=new Date(now); cutoff.setDate(cutoff.getDate()-30);
  const history=entries.filter(e=>e.kategori===kategori&&e.nama_item===item&&getCategory(e.kategori).mode==='flow'&&new Date(e.tanggal+'T23:59:59')>=cutoff);
  if(!history.length)return {avg:0,days:null,usage30:0,daysCount:0};
  const usage30=history.reduce((s,e)=>s+Math.max(0,Number(e.pemakaian||0)),0);
  const daysCount=new Set(history.map(e=>e.tanggal)).size;
  const avg=daysCount?usage30/daysCount:0;
  const latest=latestByItem().get(`${kategori}|||${item}`);
  const saldo=latest?Number(latest.saldo_akhir||0):0;
  const days=avg>0?Math.max(0,saldo/avg):null;
  return {avg,days,usage30,daysCount};
}
function predictionState(days,minimum,saldo){
  if(days===null)return 'unknown';
  if(days<=3)return 'critical';
  if(days<=7)return 'warning';
  if(minimum!==null && saldo<=minimum)return 'critical';
  return 'normal';
}
function renderPredictions(){
  const latest=latestByItem();
  const rows=[...latest.values()].filter(e=>getCategory(e.kategori).mode==='flow').map(e=>{
    const l=limits.find(x=>x.kategori===e.kategori&&x.nama_item===e.nama_item);
    const saldo=Number(e.saldo_akhir||0), min=l?Number(l.minimum):null, p=getItemPrediction(e.kategori,e.nama_item);
    const state=predictionState(p?.days,min,saldo);
    return {...e,limit:l,p,state};
  });
  const attention=rows.filter(x=>x.state==='critical'||x.state==='warning'||(x.limit&&x.saldo<=Number(x.limit.minimum)));
  $('predictionCount').textContent=`${attention.length} perlu perhatian`;
  $('predictionGrid').innerHTML=rows.length?rows.map(x=>{
    const p=x.p, unit=x.limit?.satuan||'';
    let estimate='Belum cukup histori', sub=p?.daysCount?`${p.daysCount} hari data • rata-rata ${fmt(p.avg)} ${unit}/hari`:'Butuh data pemakaian';
    if(p?.days!==null){estimate=p.days<=0?'Habis / tidak ada saldo':`± ${Math.ceil(p.days)} hari`;}
    const label=x.state==='critical'?'KRITIS':x.state==='warning'?'WASPADA':x.state==='unknown'?'BELUM CUKUP DATA':'AMAN';
    return `<div class="prediction-card ${x.state}"><div class="prediction-top"><span>${esc(x.kategori)}</span><b>${label}</b></div><strong>${esc(x.nama_item)}</strong><div class="prediction-main"><div><small>Stok saat ini</small><b>${fmt(x.saldo)} ${esc(unit)}</b></div><div><small>Estimasi habis</small><b>${estimate}</b></div></div><div class="prediction-meta">${sub}${x.limit?` • min ${fmt(x.limit.minimum)} ${esc(unit)}`:''}</div></div>`;
  }).join(''):'<div class="dashboard-empty">Belum ada data stok bahan untuk diprediksi.</div>';
}

function renderAlerts(){
  const latest=latestByItem();
  const alerts=limits.map(l=>{const e=latest.get(`${l.kategori}|||${l.nama_item}`);const saldo=e?Number(e.saldo_akhir):0;return {...l,saldo,entry:e};}).filter(x=>x.saldo<=Number(x.minimum));
  $('alertCount').textContent=alerts.length;
  $('alertPanel').classList.toggle('hidden',alerts.length===0);
  $('alertList').innerHTML=alerts.map(a=>`<div class="alert-item"><div><strong>🔴 ${esc(a.kategori)} • ${esc(a.nama_item)}</strong><span>Minimum ${fmt(a.minimum)} ${esc(a.satuan||'')} • terakhir ${esc(a.entry?.tanggal||'belum ada data')}</span></div><div class="alert-value">${fmt(a.saldo)} ${esc(a.satuan||'')}</div></div>`).join('');
  renderPredictions();
  renderNotifications();
}
function notificationItems(){
  if(currentRole!=='admin') return [];
  const items=[];
  const latest=latestByItem();
  limits.forEach(l=>{
    const e=latest.get(`${l.kategori}|||${l.nama_item}`); const saldo=e?Number(e.saldo_akhir):0; const min=Number(l.minimum||0);
    if(saldo<=min) items.push({kind:'critical',title:`Stok kritis • ${l.nama_item}`,meta:`${l.kategori} • stok ${fmt(saldo)} ${l.satuan||''} • minimum ${fmt(min)} ${l.satuan||''}`,time:e?.updated_at||e?.created_at||null,actor:e?.updated_by_email||e?.created_by_email||''});
  });
  activities.slice(0,40).forEach(a=>items.push({kind:a.action==='DELETE'?'danger':a.action==='UPDATE'?'update':'activity',title:`${a.action==='INSERT'?'Input baru':a.action==='UPDATE'?'Data diperbarui':'Data dihapus'} • ${a.nama_item}`,meta:`${a.kategori} • ${a.user_email||'Operator'} • saldo akhir ${fmt(a.saldo_akhir)}`,time:a.created_at,actor:a.user_email||''}));
  return items.sort((a,b)=>new Date(b.time||0)-new Date(a.time||0)).slice(0,60);
}
function renderNotifications(){
  const btn=$('notificationBtn'), panel=$('notificationPanel'); if(!btn||!panel)return;
  if(currentRole!=='admin'){btn.classList.add('hidden');panel.classList.add('hidden');return;}
  btn.classList.remove('hidden');
  const items=notificationItems(); const unread=notificationsReadAt?items.filter(x=>new Date(x.time||0)>new Date(notificationsReadAt)).length:items.length;
  $('notificationBadge').textContent=unread>99?'99+':unread;
  if($('navNotificationBadge')) $('navNotificationBadge').textContent=$('notificationBadge').textContent;
  $('notificationSummary').textContent=`${items.length} notifikasi`;
  $('notificationList').innerHTML=items.map(x=>`<div class="notification-item ${x.kind}"><div class="notification-icon">${x.kind==='critical'?'⚠️':x.kind==='danger'?'🗑️':x.kind==='update'?'✏️':'📝'}</div><div class="notification-copy"><strong>${esc(x.title)}</strong><span>${esc(x.meta)}</span><small>${formatDateTime(x.time)}</small></div></div>`).join('');
  $('notificationEmpty').classList.toggle('hidden',items.length>0);
  panel.classList.toggle('hidden',items.length===0 && !panel.dataset.open);
}
function formatDateTime(v){if(!v)return 'Waktu tidak tersedia'; const d=new Date(v); return isNaN(d)?String(v):d.toLocaleString('id-ID',{dateStyle:'short',timeStyle:'short'});}
function filteredEntries(){const c=$('categoryFilter').value,d=$('dateFilter').value;return entries.filter(e=>(!c||e.kategori===c)&&(!d||e.tanggal===d));}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function actorLabel(e){return e.created_by_email||e.updated_by_email||'Belum tercatat';}
function renderEntries(){
  const rows=filteredEntries(),meter=$('categoryFilter').value&&getCategory($('categoryFilter').value).mode==='meter';
  if(meter){
    $('entriesHead').innerHTML='<tr><th>Tanggal</th><th>Kategori</th><th>Item</th><th>Saldo Awal · 00:00</th><th>Saldo Akhir · 00:00</th><th>DF</th><th>Diinput oleh</th><th>Aksi</th></tr>';
    $('entriesBody').innerHTML=rows.map(e=>`<tr><td>${e.tanggal} <span class="badge">24 JAM</span></td><td>${esc(e.kategori)}</td><td><strong>${esc(e.nama_item)}</strong></td><td>${fmt(e.saldo_awal)}</td><td><strong>${fmt(e.saldo_akhir)}</strong></td><td><strong>${fmt(e.saldo_akhir-e.saldo_awal)}</strong></td><td><span class="actor">${esc(actorLabel(e))}</span></td><td class="actions"><button class="small" onclick="editEntry('${e.id}')">Edit</button><button class="small danger" onclick="deleteEntry('${e.id}')">Hapus</button></td></tr>`).join('');
  } else {
    $('entriesHead').innerHTML='<tr><th>Tanggal</th><th>Kategori</th><th>Item</th><th>Saldo Awal</th><th>Pemasukan</th><th>Pemakaian</th><th>Saldo Akhir</th><th>Diinput oleh</th><th>Aksi</th></tr>';
    $('entriesBody').innerHTML=rows.map(e=>`<tr><td>${e.tanggal}</td><td>${esc(e.kategori)}</td><td><strong>${esc(e.nama_item)}</strong></td><td>${fmt(e.saldo_awal)}</td><td>${fmt(e.pemasukan)}</td><td>${fmt(e.pemakaian)}</td><td><strong>${fmt(e.saldo_akhir)}</strong></td><td><span class="actor">${esc(actorLabel(e))}</span></td><td class="actions"><button class="small" onclick="editEntry('${e.id}')">Edit</button><button class="small danger" onclick="deleteEntry('${e.id}')">Hapus</button></td></tr>`).join('');
  }
  $('emptyState').classList.toggle('hidden',rows.length>0);
}
async function loadActivities(){
  if(currentRole!=='admin'){activities=[];return;}
  const {data,error}=await db.from('stock_activity_logs').select('*').order('created_at',{ascending:false}).limit(80);
  if(error){console.error(error);return;}
  activities=data||[]; renderActivities(); renderNotifications();
}
function renderActivities(){
  if(currentRole!=='admin')return;
  $('activityPanel').classList.remove('hidden');
  $('activityCount').textContent=`${activities.length} aktivitas`;
  $('activityBody').innerHTML=activities.map(a=>{
    const action=a.action==='INSERT'?'INPUT':a.action==='UPDATE'?'UBAH':'HAPUS';
    const cls=a.action==='INSERT'?'success':a.action==='DELETE'?'danger':'';
    const waktu=new Date(a.created_at).toLocaleString('id-ID',{dateStyle:'short',timeStyle:'short'});
    return `<tr><td>${waktu}</td><td><span class="badge ${cls}">${action}</span></td><td><span class="actor">${esc(a.user_email||'Tidak diketahui')}</span></td><td>${esc(a.kategori)}</td><td><strong>${esc(a.nama_item)}</strong></td><td>${esc(a.tanggal)}</td><td>${fmt(a.saldo_akhir)}</td></tr>`;
  }).join('');
  $('activityEmpty').classList.toggle('hidden',activities.length>0);
}

function monthKey(d){return String(d||'').slice(0,7);}
function renderDashboard(){
  const latest=latestByItem();
  const cards=[...latest.values()].sort((a,b)=>`${a.kategori}${a.nama_item}`.localeCompare(`${b.kategori}${b.nama_item}`));
  const byCat=CATEGORIES.map(c=>({cat:c,items:cards.filter(e=>e.kategori===c.name)}));
  const stockCards=cards.map(e=>{
    const l=limits.find(x=>x.kategori===e.kategori&&x.nama_item===e.nama_item);
    const saldo=Number(e.saldo_akhir||0), min=l?Number(l.minimum):null;
    const status=min===null?'normal':saldo<=min?'critical':saldo<=min*1.5?'low':'normal';
    return `<div class="stock-card ${status}"><div class="stock-card-top"><span class="stock-cat">${esc(e.kategori)}</span><span class="status-dot"></span></div><strong>${esc(e.nama_item)}</strong><div class="stock-value">${fmt(saldo)} <small>${esc(l?.satuan||'')}</small></div><div class="stock-meta">Terakhir ${esc(e.tanggal)}${min!==null?` • min ${fmt(min)}`:''}</div></div>`;
  }).join('');
  $('stockGrid').innerHTML=stockCards||'<div class="dashboard-empty">Belum ada data stok. Input pencatatan pertama untuk melihat ringkasan.</div>';
  const mk=monthKey(today()), monthly=entries.filter(e=>monthKey(e.tanggal)===mk), total=monthly.reduce((sum,e)=>sum+Number(e.pemakaian||0),0);
  $('monthLabel').textContent=new Date(today()+'T00:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'});
  $('monthUsage').textContent=fmt(total);
  const totals=CATEGORIES.map(c=>({name:c.name,total:monthly.filter(e=>e.kategori===c.name).reduce((s,e)=>s+Number(e.pemakaian||0),0)})).filter(x=>x.total>0).sort((a,b)=>b.total-a.total);
  const max=Math.max(1,...totals.map(x=>x.total));
  $('usageBars').innerHTML=totals.length?totals.map(x=>`<div class="usage-row"><div><span>${esc(x.name)}</span><b>${fmt(x.total)}</b></div><div class="bar"><i style="width:${Math.max(4,(x.total/max)*100)}%"></i></div></div>`).join(''):'<div class="muted">Belum ada pemakaian bulan ini.</div>';
  $('categoryStatus').innerHTML=byCat.map(x=>{const has=x.items.length;const bad=x.items.some(e=>{const l=limits.find(l=>l.kategori===e.kategori&&l.nama_item===e.nama_item);return l&&Number(e.saldo_akhir)<=Number(l.minimum)});return `<div class="status-row"><span class="status-icon ${bad?'bad':has?'good':'empty-status'}">${bad?'!':has?'✓':'–'}</span><div><strong>${esc(x.cat.name)}</strong><small>${has?`${x.items.length} item aktif`:'Belum ada data'}</small></div><span class="status-text ${bad?'bad-text':has?'good-text':''}">${bad?'Kritis':has?'Aman':'Kosong'}</span></div>`;}).join('');
  $('dashboardUpdated').textContent='Realtime • '+new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
}

function getReportRows(){
  const year=$('reportYear').value, month=$('reportMonth').value, cat=$('reportCategory').value, item=$('reportItem').value;
  return entries.filter(e=>{
    const ym=monthKey(e.tanggal), y=ym.slice(0,4), m=ym.slice(5,7);
    return (!year||y===year)&&(!month||m===month)&&(!cat||e.kategori===cat)&&(!item||e.nama_item===item);
  }).sort((a,b)=>`${a.tanggal}${a.kategori}${a.nama_item}`.localeCompare(`${b.tanggal}${b.kategori}${b.nama_item}`));
}
function initReportFilters(){
  const prevYear=$('reportYear').value, prevCat=$('reportCategory').value, prevItem=$('reportItem').value;
  const years=new Set(entries.map(e=>String(e.tanggal||'').slice(0,4)).filter(Boolean));
  const current=String(new Date().getFullYear()); years.add(current);
  $('reportYear').innerHTML=[...years].sort((a,b)=>b.localeCompare(a)).map(y=>`<option value="${y}">${y}</option>`).join('');
  $('reportYear').value=years.has(prevYear)?prevYear:current;
  $('reportCategory').innerHTML='<option value="">Semua kategori</option>'+CATEGORIES.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
  $('reportCategory').value=CATEGORIES.some(c=>c.name===prevCat)?prevCat:'';
  updateReportItems();
  if([...$('reportItem').options].some(o=>o.value===prevItem))$('reportItem').value=prevItem;
}
function updateReportItems(){
  const cat=$('reportCategory').value;
  const items=[...new Set(entries.filter(e=>!cat||e.kategori===cat).map(e=>e.nama_item))].sort((a,b)=>a.localeCompare(b));
  const old=$('reportItem').value;
  $('reportItem').innerHTML='<option value="">Semua Item</option>'+items.map(i=>`<option value="${esc(i)}">${esc(i)}</option>`).join('');
  if(items.includes(old))$('reportItem').value=old;
}
function renderReport(){
  if(!$('reportBody'))return;
  const rows=getReportRows();
  $('reportTotal').textContent=`${rows.length} baris`;
  const flow=rows.filter(e=>getCategory(e.kategori).mode==='flow');
  const meter=rows.filter(e=>getCategory(e.kategori).mode==='meter');
  const totalIncoming=flow.reduce((s,e)=>s+Number(e.pemasukan||0),0);
  const totalUsage=rows.reduce((s,e)=>s+Number(e.pemakaian||0),0);
  const latest=rows.length?rows[rows.length-1]:null;
  $('reportSummary').innerHTML=`<div class="report-card"><span>Total Pemasukan</span><strong>${fmt(totalIncoming)}</strong></div><div class="report-card"><span>Total Pemakaian</span><strong>${fmt(totalUsage)}</strong></div><div class="report-card"><span>Data Flow</span><strong>${flow.length}</strong></div><div class="report-card"><span>Data Meter</span><strong>${meter.length}</strong></div><div class="report-card"><span>Saldo Akhir Terakhir</span><strong>${latest?fmt(latest.saldo_akhir):'0'}</strong></div>`;
  $('reportBody').innerHTML=rows.map(e=>{const c=getCategory(e.kategori);return `<tr><td>${esc(new Date(e.tanggal+'T00:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'}))}</td><td>${esc(e.kategori)}</td><td><strong>${esc(e.nama_item)}</strong></td><td>${fmt(e.saldo_awal)}</td><td>${fmt(e.pemasukan)}</td><td>${fmt(e.pemakaian)}</td><td><strong>${fmt(e.saldo_akhir)}</strong></td><td><span class="badge">${c.mode==='flow'?'FLOW':'METER'}</span></td></tr>`;}).join('');
  $('reportEmpty').classList.toggle('hidden',rows.length>0);
}

function renderCngReconciliation(){
  const box=$('meterReconciliation');
  if(!box)return;
  const year=$('reportYear').value, month=$('reportMonth').value, cat=$('reportCategory').value;
  const show=year&&month&&(!cat||cat==='Gas - CNG');
  box.classList.toggle('hidden',!show);
  if(!show)return;

  const monthRows=entries.filter(e=>e.kategori==='Gas - CNG' && monthKey(e.tanggal)===`${year}-${month}`).sort((a,b)=>{
    const d=a.tanggal.localeCompare(b.tanggal);
    return d || String(a.created_at||'').localeCompare(String(b.created_at||''));
  });
  const periodLabel=new Date(`${year}-${month}-01T00:00:00`).toLocaleDateString('id-ID',{month:'long',year:'numeric'});
  $('reconPeriod').textContent=periodLabel;
  $('reconStatus').className='recon-status';
  $('reconMessage').className='recon-message';

  if(!monthRows.length){
    $('reconOpening').textContent='0';$('reconClosing').textContent='0';$('reconPeriodResult').textContent='0';$('reconDailyTotal').textContent='0';$('reconDifference').textContent='0';$('reconDays').textContent='0 hari tercatat';
    $('reconStatus').textContent='BELUM ADA DATA';$('reconStatus').classList.add('recon-neutral');
    $('reconMessage').textContent='Belum ada data CNG untuk periode ini.';
    return;
  }

  const byDay=new Map();
  monthRows.forEach(e=>{if(!byDay.has(e.tanggal))byDay.set(e.tanggal,[]);byDay.get(e.tanggal).push(e);});
  const dates=[...byDay.keys()].sort();
  const firstDay=byDay.get(dates[0])[0];
  const lastDayRows=byDay.get(dates[dates.length-1]);
  const lastDay=lastDayRows[lastDayRows.length-1];
  const opening=Number(firstDay.saldo_awal||0);
  const closing=Number(lastDay.saldo_akhir||0);
  const periodResult=closing-opening;
  const dailyTotal=monthRows.reduce((s,e)=>s+Number(e.pemakaian||0),0);
  const difference=periodResult-dailyTotal;
  const daysInMonth=new Date(Number(year),Number(month),0).getDate();
  const completeDays=dates.length===daysInMonth && dates.every((d,i)=>Number(d.slice(8,10))===i+1);
  let continuity=true;
  for(let i=1;i<dates.length;i++){
    const prev=byDay.get(dates[i-1]);
    const curr=byDay.get(dates[i]);
    const prevClosing=Number(prev[prev.length-1].saldo_akhir||0);
    const currOpening=Number(curr[0].saldo_awal||0);
    if(Math.abs(prevClosing-currOpening)>0.0005){continuity=false;break;}
  }

  $('reconOpening').textContent=fmt(opening);
  $('reconClosing').textContent=fmt(closing);
  $('reconPeriodResult').textContent=fmt(periodResult);
  $('reconDailyTotal').textContent=fmt(dailyTotal);
  $('reconDifference').textContent=fmt(difference);
  $('reconDays').textContent=`${dates.length}/${daysInMonth} hari tercatat`;

  const synced=Math.abs(difference)<=0.0005 && completeDays && continuity;
  const incomplete=!completeDays;
  if(synced){
    $('reconStatus').textContent='SINKRON';$('reconStatus').classList.add('recon-good');
    $('reconMessage').innerHTML='🟢 <strong>SINKRON</strong> — hasil periode sama dengan total pemakaian harian dan saldo harian tersambung.';
    $('reconMessage').classList.add('good');
  }else if(incomplete){
    $('reconStatus').textContent='BELUM LENGKAP';$('reconStatus').classList.add('recon-warning');
    $('reconMessage').innerHTML=`🟡 <strong>BELUM LENGKAP</strong> — baru ${dates.length} dari ${daysInMonth} hari tercatat. Rekonsiliasi final dilakukan setelah data satu bulan lengkap.`;
    $('reconMessage').classList.add('warning');
  }else{
    $('reconStatus').textContent='TIDAK SINKRON';$('reconStatus').classList.add('recon-bad');
    const reasons=[];
    if(Math.abs(difference)>0.0005)reasons.push(`selisih ${fmt(difference)}`);
    if(!continuity)reasons.push('saldo awal/akhir antar hari tidak tersambung');
    $('reconMessage').innerHTML=`🔴 <strong>TIDAK SINKRON</strong> — ${reasons.join(' dan ')}.`;
    $('reconMessage').classList.add('bad');
  }
}
function exportReportCsv(){
  const rows=getReportRows();
  const header=['Bulan','Tanggal','Kategori','Item','Saldo Awal','Pemasukan','Pemakaian','Saldo Akhir','Mode'];
  const data=rows.map(e=>[new Date(e.tanggal+'T00:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'}),e.tanggal,e.kategori,e.nama_item,e.saldo_awal,e.pemasukan,e.pemakaian,e.saldo_akhir,getCategory(e.kategori).mode==='flow'?'FLOW':'METER']);
  const csv='\\ufeff'+[header,...data].map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}), url=URL.createObjectURL(blob), a=document.createElement('a');
  const y=$('reportYear').value||'semua',m=$('reportMonth').value||'semua';a.href=url;a.download=`StockLog-Rekap-${y}-${m}.csv`;a.click();URL.revokeObjectURL(url);
}
function printReport(){
  const rows=getReportRows(); if(!rows.length){alert('Tidak ada data untuk dicetak.');return;}
  const title=`StockLog — Rekap ${$('reportMonth').selectedOptions[0].text} ${$('reportYear').value}`;
  const win=window.open('','_blank');
  win.document.write(`<html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{margin-bottom:4px}p{color:#555}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ccc;padding:8px;font-size:12px;text-align:left}th{background:#eee}.num{text-align:right}</style></head><body><h1>${title}</h1><p>Dicetak ${new Date().toLocaleString('id-ID')}</p><table><thead><tr><th>Bulan</th><th>Tanggal</th><th>Kategori</th><th>Item</th><th>Saldo Awal</th><th>Pemasukan</th><th>Pemakaian</th><th>Saldo Akhir</th><th>Mode</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${new Date(e.tanggal+'T00:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'})}</td><td>${e.tanggal}</td><td>${esc(e.kategori)}</td><td>${esc(e.nama_item)}</td><td class="num">${fmt(e.saldo_awal)}</td><td class="num">${fmt(e.pemasukan)}</td><td class="num">${fmt(e.pemakaian)}</td><td class="num">${fmt(e.saldo_akhir)}</td><td>${getCategory(e.kategori).mode==='flow'?'FLOW':'METER'}</td></tr>`).join('')}</tbody></table></body></html>`);win.document.close();win.focus();setTimeout(()=>win.print(),300);
}

function updateStats(){const t=today();$('todayCount').textContent=entries.filter(e=>e.tanggal===t).length;$('categoryCount').textContent=new Set(entries.map(e=>e.kategori)).size;$('entryCount').textContent=entries.length;}

function openModal(entry=null){
  setPage('input');
  document.body.classList.remove('modal-open');
  $('entryForm').reset();$('entryId').value=entry?.id||'';$('entryDate').value=entry?.tanggal||today();$('entryCategory').value=entry?.kategori||CATEGORIES[0].name;$('entryItem').value=entry?.nama_item||getCategory($('entryCategory').value).name;$('opening').value=entry?.saldo_awal??0;$('incoming').value=entry?.pemasukan??0;$('usage').value=entry?.pemakaian??0;$('meterOpening').value=entry?.saldo_awal??0;$('meterClosing').value=entry?.saldo_akhir??0;$('notes').value=entry?.catatan||'';$('modalTitle').textContent=entry?'Edit Pencatatan':'Input Pencatatan';$('formMsg').textContent='';syncItemFromCategory();updateModeUI();$('entryModal').classList.remove('hidden');if(!entry)syncOpeningBalance();
}
function closeModal(){ $('entryModal').classList.add('hidden'); document.body.classList.remove('modal-open'); setPage('home'); }
async function saveEntry(event){
  event.preventDefault(); if(savingEntry)return; if(!navigator.onLine){setMessage($('formMsg'),'Koneksi internet terputus. Hubungkan internet lalu coba lagi.','error');return;}
  savingEntry=true; const saveBtn=$('saveEntryBtn'); if(saveBtn){saveBtn.disabled=true;saveBtn.dataset.original=saveBtn.textContent;saveBtn.textContent='Menyimpan…';}
  const id=$('entryId').value,kategori=$('entryCategory').value,cat=getCategory(kategori),nama_item=cat.name,tanggal=$('entryDate').value,catatan=$('notes').value.trim()||null;$('entryItem').value=nama_item;if(!nama_item||!tanggal){savingEntry=false;if(saveBtn)saveBtn.disabled=false;return;}
  let saldo_awal,pemasukan,pemakaian,saldo_akhir;
  if(cat.mode==='flow'){saldo_awal=num('opening');pemasukan=num('incoming');pemakaian=num('usage');saldo_akhir=saldo_awal+pemasukan-pemakaian;if(saldo_akhir<0){setMessage($('formMsg'),'Saldo akhir tidak boleh negatif.','error');return;}}
  else{saldo_awal=num('meterOpening');saldo_akhir=num('meterClosing');pemasukan=0;pemakaian=saldo_akhir-saldo_awal;if(pemakaian<0){setMessage($('formMsg'),'Saldo akhir tidak boleh lebih kecil dari saldo awal untuk meter.','error');return;}}
  setMessage($('formMsg'),'Menyimpan...');const email=currentUser?.email||'';const payload={tanggal,kategori,nama_item,saldo_awal,pemasukan,pemakaian,saldo_akhir,catatan};let result;if(id){result=await db.from('stock_entries').update({...payload,updated_by_email:email}).eq('id',id);}else{result=await db.from('stock_entries').insert({...payload,created_by_email:email,updated_by_email:email});}
  if(result.error){setMessage($('formMsg'),`Gagal menyimpan: ${result.error.message}`,'error');savingEntry=false;if(saveBtn){saveBtn.disabled=false;saveBtn.textContent=saveBtn.dataset.original||'Simpan Data';}return;}setMessage($('formMsg'),id?'Laporan berhasil diperbarui.':'Laporan berhasil diterima Admin.','success');await loadEntries();await notifyIfLow(kategori,nama_item,saldo_akhir);savingEntry=false;setTimeout(closeModal,450);
}
window.editEntry=id=>{const e=entries.find(x=>x.id===id);if(e)openModal(e);};
window.deleteEntry=async id=>{const e=entries.find(x=>x.id===id);if(!e||!confirm(`Hapus pencatatan ${e.nama_item} tanggal ${e.tanggal}?`))return;const {error}=await db.from('stock_entries').delete().eq('id',id);if(error)return alert(`Gagal menghapus: ${error.message}`);await loadEntries();};

async function notifyIfLow(kategori,item,saldo){
  const l=limits.find(x=>x.kategori===kategori&&x.nama_item===item); if(!l)return;
  const p=getItemPrediction(kategori,item); const low=Number(saldo)<=Number(l.minimum); const soon=p?.days!==null&&p?.days<=7;
  if(!low&&!soon)return;
  if(!('Notification'in window)||Notification.permission!=='granted')return;
  const key=`stocklog-notified-${kategori}-${item}-${today()}-${low?'low':'soon'}`;
  if(localStorage.getItem(key))return;
  const title=low?'🚨 StockLog: Stok Kritis':'⚠️ StockLog: Stok Diprediksi Menipis';
  const body=low?`${kategori} • ${item} tersisa ${fmt(saldo)} ${l.satuan||''} (minimum ${fmt(l.minimum)}).`: `${kategori} • ${item} diperkirakan habis dalam ±${Math.ceil(p.days)} hari.`;
  new Notification(title,{body}); localStorage.setItem(key,'1');
}
async function enableNotifications(){if(!('Notification'in window)){alert('Browser ini belum mendukung notifikasi.');return;}const p=await Notification.requestPermission();if(p==='granted'){ $('notifyBtn').textContent='🔔 Notifikasi Aktif'; $('notifyBtn').classList.add('active'); }else alert('Izin notifikasi belum diberikan.');}

async function renderSettings(){
  if(currentRole!=='admin')return;$('settingsBody').innerHTML=limits.length?limits.map(l=>`<tr><td>${l.kategori}</td><td><strong>${l.nama_item}</strong></td><td>${fmt(l.minimum)} ${l.satuan||''}</td><td><button class="small danger" onclick="deleteLimit('${l.id}')">Hapus</button></td></tr>`).join(''):'<tr><td colspan="4">Belum ada batas minimum.</td></tr>';
}
async function saveLimit(e){e.preventDefault();if(savingLimit)return;if(!navigator.onLine){setMessage($('settingsMsg'),'Koneksi internet terputus.','error');return;}savingLimit=true;const saveBtn=$('saveLimitBtn');if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='Menyimpan…';}const kategori=$('settingCategory').value,nama_item=$('settingItem').value.trim(),minimum=num('settingMinimum'),satuan=$('settingUnit').value.trim()||null;if(!nama_item){savingLimit=false;if(saveBtn)saveBtn.disabled=false;return;}setMessage($('settingsMsg'),'Menyimpan...');const {error}=await db.from('stock_limits').upsert({kategori,nama_item,minimum,satuan,updated_by:(await db.auth.getUser()).data.user.id},{onConflict:'kategori,nama_item'});if(error){setMessage($('settingsMsg'),`Gagal: ${error.message}`,'error');savingLimit=false;if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Simpan Batas';}return;}setMessage($('settingsMsg'),'Batas minimum tersimpan.','success');$('settingItem').value='';$('settingMinimum').value=0;$('settingUnit').value='';await loadLimits();}
window.deleteLimit=async id=>{if(!confirm('Hapus batas minimum ini?'))return;const {error}=await db.from('stock_limits').delete().eq('id',id);if(error)return alert(error.message);await loadLimits();};
function openSettings(){if(currentRole==='admin'){ setPage('settings'); $('settingsModal').classList.remove('hidden'); document.body.classList.remove('modal-open'); renderSettings(); loadProfiles(); }}
function closeSettings(){ $('settingsModal').classList.add('hidden'); document.body.classList.remove('modal-open'); setPage('home'); }

async function loadProfile(user){
  let {data,error}=await db.from('profiles').select('role,aktif,nama').eq('id',user.id).maybeSingle();
  if(error){console.warn('Profile:',error.message);currentRole='operator';return;}
  if(!data){const r=await db.from('profiles').insert({id:user.id,role:'operator'}).select('role').single();data=r.data;}
  if(data?.aktif===false){await db.auth.signOut();setMessage($('authMsg'),'Akun dinonaktifkan oleh admin.','error');showAuth();return false;}
  currentRole=data?.role==='admin'?'admin':'operator';document.body.classList.toggle('operator-mode',currentRole==='operator');document.body.classList.toggle('admin-mode',currentRole==='admin');$('settingsBtn').classList.toggle('hidden',currentRole!=='admin');
  document.querySelectorAll('.admin-nav').forEach(el=>el.classList.toggle('hidden',currentRole!=='admin'));
  $('roleBadge').textContent=currentRole.toUpperCase();$('newEntryBtn').innerHTML=currentRole==='operator'?'<span class="plus">+</span> Buat Laporan':'<span class="plus">+</span> Input Pencatatan';return true;
}
function subscribeRealtime(){if(realtimeChannel)db.removeChannel(realtimeChannel);realtimeChannel=db.channel('stocklog-live').on('postgres_changes',{event:'*',schema:'public',table:'stock_entries'},async payload=>{await loadEntries();if(payload.eventType==='INSERT'||payload.eventType==='UPDATE')await notifyIfLow(payload.new.kategori,payload.new.nama_item,payload.new.saldo_akhir);}).on('postgres_changes',{event:'*',schema:'public',table:'stock_limits'},loadLimits).on('postgres_changes',{event:'*',schema:'public',table:'stock_activity_logs'},loadActivities).subscribe();}

async function handleAuth(event){event.preventDefault();if(authBusy)return;authBusy=true;const submit=$('authSubmit');if(submit){submit.disabled=true;submit.dataset.original=submit.textContent;submit.textContent='Memproses…';}const email=$('email').value.trim(),password=$('password').value;setMessage($('authMsg'),authMode==='login'?'Memproses login...':'Membuat akun...');const result=authMode==='login'?await db.auth.signInWithPassword({email,password}):await db.auth.signUp({email,password});if(result.error){setMessage($('authMsg'),result.error.message,'error');authBusy=false;if(submit){submit.disabled=false;submit.textContent=submit.dataset.original||'Masuk';}return;}if(authMode==='signup'&&!result.data.session){setMessage($('authMsg'),'Akun berhasil dibuat. Silakan login.','success');authMode='login';$('authSubmit').textContent='Login';authBusy=false;if(submit){submit.disabled=false;submit.textContent='Login';}return;}authBusy=false;if(submit){submit.disabled=false;submit.textContent=submit.dataset.original||'Masuk';}showApp(result.data.session);}
async function showApp(session){if(!session)return;if(activeSessionId===session.user.id && !$('appView').classList.contains('hidden'))return;activeSessionId=session.user.id;currentUser=session.user;$('authView').classList.add('hidden');$('appView').classList.remove('hidden');$('userEmail').textContent=session.user.email||'';if('Notification'in window&&Notification.permission==='granted'){ $('notifyBtn').textContent='🔔 Notifikasi Aktif'; $('notifyBtn').classList.add('active'); }const profileOk=await loadProfile(session.user);if(!profileOk)return;await loadLimits();await loadEntries();if(currentRole==='admin'){await loadActivities();await loadProfiles();}subscribeRealtime();}
function showAuth(){activeSessionId=null;currentUser=null;entries=[];if(realtimeChannel){db.removeChannel(realtimeChannel);realtimeChannel=null;}$('appView').classList.add('hidden');$('authView').classList.remove('hidden');}

$('loginTab').addEventListener('click',()=>{authMode='login';$('loginTab').classList.add('active');$('signupTab').classList.remove('active');$('authSubmit').textContent='Login';setMessage($('authMsg'));});
$('signupTab').addEventListener('click',()=>{authMode='signup';$('signupTab').classList.add('active');$('loginTab').classList.remove('active');$('authSubmit').textContent='Daftar';setMessage($('authMsg'));});
$('authForm').addEventListener('submit',handleAuth);$('notificationBtn').addEventListener('click',()=>{const p=$('notificationPanel');p.classList.toggle('hidden');p.dataset.open=p.classList.contains('hidden')?'':'1';});$('markNotificationsRead').addEventListener('click',()=>{notificationsReadAt=new Date().toISOString();localStorage.setItem('stocklog_notifications_read_at',notificationsReadAt);renderNotifications();});$('reportYear').addEventListener('change',renderReport);$('reportMonth').addEventListener('change',renderReport);$('reportCategory').addEventListener('change',()=>{updateReportItems();renderReport();});$('reportItem').addEventListener('change',renderReport);$('exportCsvBtn').addEventListener('click',exportReportCsv);$('printReportBtn').addEventListener('click',printReport);$('logoutBtn').addEventListener('click',async()=>{if(realtimeChannel)db.removeChannel(realtimeChannel);await db.auth.signOut();showAuth();});$('newEntryBtn').addEventListener('click',()=>openModal());$('closeModal').addEventListener('click',closeModal);$('cancelBtn').addEventListener('click',closeModal);$('entryForm').addEventListener('submit',saveEntry);$('entryCategory').addEventListener('change',()=>{syncItemFromCategory();updateModeUI();syncOpeningBalance();});$('categoryFilter').addEventListener('change',renderEntries);$('dateFilter').addEventListener('change',renderEntries);['opening','incoming','usage','meterOpening','meterClosing'].forEach(id=>$(id).addEventListener('input',updatePreview));$('entryDate').addEventListener('change',syncOpeningBalance);$('settingsBtn').addEventListener('click',openSettings);$('closeSettings').addEventListener('click',closeSettings);$('cancelSettings').addEventListener('click',closeSettings);$('settingsForm').addEventListener('submit',saveLimit);$('notifyBtn').addEventListener('click',enableNotifications);
fillCategorySelects();renderCategoryCards();setupNavigation();$('entryDate').value=today();setConnectionState();window.addEventListener('online',setConnectionState);window.addEventListener('offline',setConnectionState);

db.auth.getSession().then(({data})=>{if(data.session)showApp(data.session);});
db.auth.onAuthStateChange((_event,session)=>{if(session)showApp(session);else showAuth();});

/* V15: installable PWA */
(() => {
  let deferredPrompt = null;
  const banner = document.getElementById('installBanner');
  const installBtn = document.getElementById('installBtn');
  const dismissBtn = document.getElementById('dismissInstall');
  const dismissedKey = 'stocklog-install-dismissed-v15';

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (!localStorage.getItem(dismissedKey) && banner) banner.classList.remove('hidden');
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    banner?.classList.add('hidden');
  });

  dismissBtn?.addEventListener('click', () => {
    localStorage.setItem(dismissedKey, '1');
    banner?.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    banner?.classList.add('hidden');
  });
})();
