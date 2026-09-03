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
let authMode = 'login', entries = [], limits = [], activities = [], currentRole = 'operator', realtimeChannel = null, currentUser = null;

function today(){ return new Date().toISOString().slice(0,10); }
function num(id){ const v=parseFloat($(id).value); return Number.isFinite(v)?v:0; }
function fmt(v){ return new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(Number(v||0)); }
function getCategory(name){ return CATEGORIES.find(c=>c.name===name)||CATEGORIES[0]; }
function setMessage(el,text='',type=''){ el.textContent=text; el.className=`message ${type}`.trim(); }

function renderCategoryCards(){
  const icons=['▣','⚗','⚗','⚗','◉','◉','≈'];
  $('categoryCards').innerHTML=CATEGORIES.map((c,i)=>`<button class="category-card" data-category="${c.name}"><div class="cat-icon">${icons[i]}</div><div class="cat-name">${c.name}</div><div class="cat-type">${c.mode==='flow'?'Stok bahan':'Meter 24 jam'}</div></button>`).join('');
  document.querySelectorAll('.category-card').forEach(btn=>btn.addEventListener('click',()=>{$('categoryFilter').value=btn.dataset.category;renderEntries();document.querySelector('.history-panel').scrollIntoView({behavior:'smooth',block:'start'});}));
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
async function syncOpeningBalance(){
  const id=$('entryId').value, category=$('entryCategory').value, item=$('entryItem').value.trim(), date=$('entryDate').value;
  if(!category||!item||!date||id)return;
  try{const previous=await getPreviousBalance(category,item,date);if(previous!==null){if(getCategory(category).mode==='flow')$('opening').value=previous;else $('meterOpening').value=previous;updatePreview();}}catch(e){console.warn(e.message);}
}

async function loadLimits(){
  const {data,error}=await db.from('stock_limits').select('*').order('kategori').order('nama_item');
  if(error){console.warn('Batas minimum:',error.message);limits=[];return;}
  limits=data||[]; renderAlerts(); if(currentRole==='admin')renderSettings();
}
async function loadEntries(){
  const {data,error}=await db.from('stock_entries').select('*').order('tanggal',{ascending:false}).order('created_at',{ascending:false});
  if(error){setMessage($('authMsg'),`Gagal mengambil data: ${error.message}`,'error');return;}
  entries=data||[];renderEntries();updateStats();renderAlerts();
}
function latestByItem(){
  const map=new Map();
  [...entries].sort((a,b)=>`${b.tanggal}${b.created_at||''}`.localeCompare(`${a.tanggal}${a.created_at||''}`)).forEach(e=>{const k=`${e.kategori}|||${e.nama_item}`;if(!map.has(k))map.set(k,e);});
  return map;
}
function renderAlerts(){
  const latest=latestByItem();
  const alerts=limits.map(l=>{const e=latest.get(`${l.kategori}|||${l.nama_item}`);const saldo=e?Number(e.saldo_akhir):0;return {...l,saldo,entry:e};}).filter(x=>x.saldo<=Number(x.minimum));
  $('alertCount').textContent=alerts.length;
  $('alertPanel').classList.toggle('hidden',alerts.length===0);
  $('alertList').innerHTML=alerts.map(a=>`<div class="alert-item"><div><strong>🔴 ${a.kategori} • ${a.nama_item}</strong><span>Minimum ${fmt(a.minimum)} ${a.satuan||''} • terakhir ${a.entry?.tanggal||'belum ada data'}</span></div><div class="alert-value">${fmt(a.saldo)} ${a.satuan||''}</div></div>`).join('');
}
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
  if(currentRole!=='admin')return;
  const {data,error}=await db.from('stock_activity_logs').select('*').order('created_at',{ascending:false}).limit(100);
  if(error){console.warn('Activity log:',error.message);return;}
  activities=data||[];renderActivities();
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

function updateStats(){const t=today();$('todayCount').textContent=entries.filter(e=>e.tanggal===t).length;$('categoryCount').textContent=new Set(entries.map(e=>e.kategori)).size;$('entryCount').textContent=entries.length;}

function openModal(entry=null){
  $('entryForm').reset();$('entryId').value=entry?.id||'';$('entryDate').value=entry?.tanggal||today();$('entryCategory').value=entry?.kategori||CATEGORIES[0].name;$('entryItem').value=entry?.nama_item||'';$('opening').value=entry?.saldo_awal??0;$('incoming').value=entry?.pemasukan??0;$('usage').value=entry?.pemakaian??0;$('meterOpening').value=entry?.saldo_awal??0;$('meterClosing').value=entry?.saldo_akhir??0;$('notes').value=entry?.catatan||'';$('modalTitle').textContent=entry?'Edit Pencatatan':'Input Pencatatan';$('formMsg').textContent='';updateModeUI();$('entryModal').classList.remove('hidden');
}
function closeModal(){$('entryModal').classList.add('hidden');}
async function saveEntry(event){
  event.preventDefault();const id=$('entryId').value,kategori=$('entryCategory').value,cat=getCategory(kategori),nama_item=$('entryItem').value.trim(),tanggal=$('entryDate').value,catatan=$('notes').value.trim()||null;if(!nama_item||!tanggal)return;
  let saldo_awal,pemasukan,pemakaian,saldo_akhir;
  if(cat.mode==='flow'){saldo_awal=num('opening');pemasukan=num('incoming');pemakaian=num('usage');saldo_akhir=saldo_awal+pemasukan-pemakaian;if(saldo_akhir<0){setMessage($('formMsg'),'Saldo akhir tidak boleh negatif.','error');return;}}
  else{saldo_awal=num('meterOpening');saldo_akhir=num('meterClosing');pemasukan=0;pemakaian=saldo_akhir-saldo_awal;if(pemakaian<0){setMessage($('formMsg'),'Saldo akhir tidak boleh lebih kecil dari saldo awal untuk meter.','error');return;}}
  setMessage($('formMsg'),'Menyimpan...');const email=currentUser?.email||'';const payload={tanggal,kategori,nama_item,saldo_awal,pemasukan,pemakaian,saldo_akhir,catatan};let result;if(id){result=await db.from('stock_entries').update({...payload,updated_by_email:email}).eq('id',id);}else{result=await db.from('stock_entries').insert({...payload,created_by_email:email,updated_by_email:email});}
  if(result.error){setMessage($('formMsg'),`Gagal menyimpan: ${result.error.message}`,'error');return;}closeModal();await loadEntries();await notifyIfLow(kategori,nama_item,saldo_akhir);
}
window.editEntry=id=>{const e=entries.find(x=>x.id===id);if(e)openModal(e);};
window.deleteEntry=async id=>{const e=entries.find(x=>x.id===id);if(!e||!confirm(`Hapus pencatatan ${e.nama_item} tanggal ${e.tanggal}?`))return;const {error}=await db.from('stock_entries').delete().eq('id',id);if(error)return alert(`Gagal menghapus: ${error.message}`);await loadEntries();};

async function notifyIfLow(kategori,item,saldo){const l=limits.find(x=>x.kategori===kategori&&x.nama_item===item);if(!l||Number(saldo)>Number(l.minimum))return;const title='🚨 StockLog: Stok Menipis';const body=`${kategori} • ${item} tersisa ${fmt(saldo)} ${l.satuan||''} (minimum ${fmt(l.minimum)}).`;if('Notification'in window&&Notification.permission==='granted')new Notification(title,{body});}
async function enableNotifications(){if(!('Notification'in window)){alert('Browser ini belum mendukung notifikasi.');return;}const p=await Notification.requestPermission();if(p==='granted'){ $('notifyBtn').textContent='🔔 Notifikasi Aktif'; $('notifyBtn').classList.add('active'); }else alert('Izin notifikasi belum diberikan.');}

async function renderSettings(){
  if(currentRole!=='admin')return;$('settingsBody').innerHTML=limits.length?limits.map(l=>`<tr><td>${l.kategori}</td><td><strong>${l.nama_item}</strong></td><td>${fmt(l.minimum)} ${l.satuan||''}</td><td><button class="small danger" onclick="deleteLimit('${l.id}')">Hapus</button></td></tr>`).join(''):'<tr><td colspan="4">Belum ada batas minimum.</td></tr>';
}
async function saveLimit(e){e.preventDefault();const kategori=$('settingCategory').value,nama_item=$('settingItem').value.trim(),minimum=num('settingMinimum'),satuan=$('settingUnit').value.trim()||null;if(!nama_item)return;setMessage($('settingsMsg'),'Menyimpan...');const {error}=await db.from('stock_limits').upsert({kategori,nama_item,minimum,satuan,updated_by:(await db.auth.getUser()).data.user.id},{onConflict:'kategori,nama_item'});if(error){setMessage($('settingsMsg'),`Gagal: ${error.message}`,'error');return;}setMessage($('settingsMsg'),'Batas minimum tersimpan.','success');$('settingItem').value='';$('settingMinimum').value=0;$('settingUnit').value='';await loadLimits();}
window.deleteLimit=async id=>{if(!confirm('Hapus batas minimum ini?'))return;const {error}=await db.from('stock_limits').delete().eq('id',id);if(error)return alert(error.message);await loadLimits();};
function openSettings(){if(currentRole==='admin'){$('settingsModal').classList.remove('hidden');renderSettings();}}
function closeSettings(){$('settingsModal').classList.add('hidden');}

async function loadProfile(user){
  let {data,error}=await db.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if(error){console.warn('Profile:',error.message);currentRole='operator';return;}
  if(!data){const r=await db.from('profiles').insert({id:user.id,role:'operator'}).select('role').single();data=r.data;}
  currentRole=data?.role==='admin'?'admin':'operator';$('settingsBtn').classList.toggle('hidden',currentRole!=='admin');$('roleBadge').textContent=currentRole.toUpperCase();
}
function subscribeRealtime(){if(realtimeChannel)db.removeChannel(realtimeChannel);realtimeChannel=db.channel('stocklog-live').on('postgres_changes',{event:'*',schema:'public',table:'stock_entries'},async payload=>{await loadEntries();if(payload.eventType==='INSERT'||payload.eventType==='UPDATE')await notifyIfLow(payload.new.kategori,payload.new.nama_item,payload.new.saldo_akhir);}).on('postgres_changes',{event:'*',schema:'public',table:'stock_limits'},loadLimits).on('postgres_changes',{event:'*',schema:'public',table:'stock_activity_logs'},loadActivities).subscribe();}

async function handleAuth(event){event.preventDefault();const email=$('email').value.trim(),password=$('password').value;setMessage($('authMsg'),authMode==='login'?'Memproses login...':'Membuat akun...');const result=authMode==='login'?await db.auth.signInWithPassword({email,password}):await db.auth.signUp({email,password});if(result.error){setMessage($('authMsg'),result.error.message,'error');return;}if(authMode==='signup'&&!result.data.session){setMessage($('authMsg'),'Akun berhasil dibuat. Silakan login.','success');authMode='login';$('authSubmit').textContent='Login';return;}showApp(result.data.session);}
async function showApp(session){if(!session)return;currentUser=session.user;$('authView').classList.add('hidden');$('appView').classList.remove('hidden');$('userEmail').textContent=session.user.email||'';await loadProfile(session.user);await loadLimits();await loadEntries();if(currentRole==='admin')await loadActivities();subscribeRealtime();}
function showAuth(){$('appView').classList.add('hidden');$('authView').classList.remove('hidden');}

$('loginTab').addEventListener('click',()=>{authMode='login';$('loginTab').classList.add('active');$('signupTab').classList.remove('active');$('authSubmit').textContent='Login';setMessage($('authMsg'));});
$('signupTab').addEventListener('click',()=>{authMode='signup';$('signupTab').classList.add('active');$('loginTab').classList.remove('active');$('authSubmit').textContent='Daftar';setMessage($('authMsg'));});
$('authForm').addEventListener('submit',handleAuth);$('logoutBtn').addEventListener('click',async()=>{if(realtimeChannel)db.removeChannel(realtimeChannel);await db.auth.signOut();showAuth();});$('newEntryBtn').addEventListener('click',()=>openModal());$('closeModal').addEventListener('click',closeModal);$('cancelBtn').addEventListener('click',closeModal);$('entryForm').addEventListener('submit',saveEntry);$('entryCategory').addEventListener('change',updateModeUI);$('categoryFilter').addEventListener('change',renderEntries);$('dateFilter').addEventListener('change',renderEntries);['opening','incoming','usage','meterOpening','meterClosing'].forEach(id=>$(id).addEventListener('input',updatePreview));$('entryItem').addEventListener('blur',syncOpeningBalance);$('entryDate').addEventListener('change',syncOpeningBalance);$('entryCategory').addEventListener('change',syncOpeningBalance);$('settingsBtn').addEventListener('click',openSettings);$('closeSettings').addEventListener('click',closeSettings);$('cancelSettings').addEventListener('click',closeSettings);$('settingsForm').addEventListener('submit',saveLimit);$('notifyBtn').addEventListener('click',enableNotifications);
fillCategorySelects();renderCategoryCards();$('entryDate').value=today();

db.auth.getSession().then(({data})=>{if(data.session)showApp(data.session);});
db.auth.onAuthStateChange((_event,session)=>{if(session)showApp(session);else showAuth();});
