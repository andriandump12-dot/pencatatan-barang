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

const $ = (id) => document.getElementById(id);
let authMode = 'login';
let entries = [];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function num(id) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : 0;
}

function fmt(value) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(Number(value || 0));
}

function getCategory(name) {
  return CATEGORIES.find(c => c.name === name) || CATEGORIES[0];
}

function setMessage(el, text = '', type = '') {
  el.textContent = text;
  el.className = `message ${type}`.trim();
}

function fillCategorySelects() {
  $('entryCategory').innerHTML = CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  $('categoryFilter').innerHTML = '<option value="">Semua kategori</option>' +
    CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
}

function updatePreview() {
  const cat = getCategory($('entryCategory').value);
  if (cat.mode === 'flow') {
    $('closingPreview').textContent = fmt(num('opening') + num('incoming') - num('usage'));
  } else {
    $('meterUsagePreview').textContent = fmt(num('meterClosing') - num('meterOpening'));
  }
}

function updateModeUI() {
  const cat = getCategory($('entryCategory').value);
  const flow = cat.mode === 'flow';
  $('flowFields').classList.toggle('hidden', !flow);
  $('meterFields').classList.toggle('hidden', flow);
  $('modeHelp').textContent = flow
    ? 'Saldo akhir = saldo awal + pemasukan − pemakaian.'
    : 'Pemakaian = saldo akhir − saldo awal.';
  updatePreview();
}

async function getPreviousBalance(category, item, date, excludeId = '') {
  let query = db.from('stock_entries')
    .select('id,tanggal,saldo_akhir')
    .eq('kategori', category)
    .eq('nama_item', item)
    .lt('tanggal', date)
    .order('tanggal', { ascending: false })
    .limit(1);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return data?.[0]?.saldo_akhir ?? null;
}

async function syncOpeningBalance() {
  const id = $('entryId').value;
  const category = $('entryCategory').value;
  const item = $('entryItem').value.trim();
  const date = $('entryDate').value;
  if (!category || !item || !date || id) return;

  try {
    const previous = await getPreviousBalance(category, item, date);
    if (previous !== null) {
      const cat = getCategory(category);
      if (cat.mode === 'flow') $('opening').value = previous;
      else $('meterOpening').value = previous;
      updatePreview();
    }
  } catch (e) {
    console.warn('Gagal mengambil saldo sebelumnya:', e.message);
  }
}

async function loadEntries() {
  const { data, error } = await db.from('stock_entries')
    .select('*')
    .order('tanggal', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    setMessage($('authMsg'), `Gagal mengambil data: ${error.message}`, 'error');
    return;
  }
  entries = data || [];
  renderEntries();
  updateStats();
}

function filteredEntries() {
  const category = $('categoryFilter').value;
  const date = $('dateFilter').value;
  return entries.filter(e => (!category || e.kategori === category) && (!date || e.tanggal === date));
}

function renderEntries() {
  const rows = filteredEntries();
  $('entriesBody').innerHTML = rows.map(e => `
    <tr>
      <td>${e.tanggal}</td>
      <td>${e.kategori}</td>
      <td>${e.nama_item}</td>
      <td>${fmt(e.saldo_awal)}</td>
      <td>${fmt(e.pemasukan)}</td>
      <td>${fmt(e.pemakaian)}</td>
      <td><strong>${fmt(e.saldo_akhir)}</strong></td>
      <td class="actions">
        <button class="small" onclick="editEntry('${e.id}')">Edit</button>
        <button class="small danger" onclick="deleteEntry('${e.id}')">Hapus</button>
      </td>
    </tr>`).join('');
  $('emptyState').classList.toggle('hidden', rows.length > 0);
}

function updateStats() {
  const t = today();
  $('todayCount').textContent = entries.filter(e => e.tanggal === t).length;
  $('categoryCount').textContent = new Set(entries.map(e => e.kategori)).size;
  $('entryCount').textContent = entries.length;
}

function openModal(entry = null) {
  $('entryForm').reset();
  $('entryId').value = entry?.id || '';
  $('entryDate').value = entry?.tanggal || today();
  $('entryCategory').value = entry?.kategori || CATEGORIES[0].name;
  $('entryItem').value = entry?.nama_item || '';
  $('opening').value = entry?.saldo_awal ?? 0;
  $('incoming').value = entry?.pemasukan ?? 0;
  $('usage').value = entry?.pemakaian ?? 0;
  $('meterOpening').value = entry?.saldo_awal ?? 0;
  $('meterClosing').value = entry?.saldo_akhir ?? 0;
  $('notes').value = entry?.catatan || '';
  $('modalTitle').textContent = entry ? 'Edit Pencatatan' : 'Input Pencatatan';
  $('formMsg').textContent = '';
  updateModeUI();
  $('entryModal').classList.remove('hidden');
}

function closeModal() {
  $('entryModal').classList.add('hidden');
}

async function saveEntry(event) {
  event.preventDefault();
  const id = $('entryId').value;
  const kategori = $('entryCategory').value;
  const cat = getCategory(kategori);
  const nama_item = $('entryItem').value.trim();
  const tanggal = $('entryDate').value;
  const catatan = $('notes').value.trim() || null;

  if (!nama_item || !tanggal) return;

  let saldo_awal, pemasukan, pemakaian, saldo_akhir;
  if (cat.mode === 'flow') {
    saldo_awal = num('opening');
    pemasukan = num('incoming');
    pemakaian = num('usage');
    saldo_akhir = saldo_awal + pemasukan - pemakaian;
    if (saldo_akhir < 0) {
      setMessage($('formMsg'), 'Saldo akhir tidak boleh negatif.', 'error');
      return;
    }
  } else {
    saldo_awal = num('meterOpening');
    saldo_akhir = num('meterClosing');
    pemasukan = 0;
    pemakaian = saldo_akhir - saldo_awal;
    if (pemakaian < 0) {
      setMessage($('formMsg'), 'Saldo akhir tidak boleh lebih kecil dari saldo awal untuk meter.', 'error');
      return;
    }
  }

  setMessage($('formMsg'), 'Menyimpan...');
  const payload = { tanggal, kategori, nama_item, saldo_awal, pemasukan, pemakaian, saldo_akhir, catatan };
  let result;
  if (id) {
    result = await db.from('stock_entries').update(payload).eq('id', id);
  } else {
    result = await db.from('stock_entries').insert(payload);
  }

  if (result.error) {
    setMessage($('formMsg'), `Gagal menyimpan: ${result.error.message}`, 'error');
    return;
  }

  closeModal();
  await loadEntries();
}

window.editEntry = (id) => {
  const entry = entries.find(e => e.id === id);
  if (entry) openModal(entry);
};

window.deleteEntry = async (id) => {
  const entry = entries.find(e => e.id === id);
  if (!entry || !confirm(`Hapus pencatatan ${entry.nama_item} tanggal ${entry.tanggal}?`)) return;
  const { error } = await db.from('stock_entries').delete().eq('id', id);
  if (error) return alert(`Gagal menghapus: ${error.message}`);
  await loadEntries();
};

async function handleAuth(event) {
  event.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  setMessage($('authMsg'), authMode === 'login' ? 'Memproses login...' : 'Membuat akun...');

  const result = authMode === 'login'
    ? await db.auth.signInWithPassword({ email, password })
    : await db.auth.signUp({ email, password });

  if (result.error) {
    setMessage($('authMsg'), result.error.message, 'error');
    return;
  }

  if (authMode === 'signup' && !result.data.session) {
    setMessage($('authMsg'), 'Akun berhasil dibuat. Silakan login.', 'success');
    authMode = 'login';
    $('authSubmit').textContent = 'Login';
    return;
  }
  showApp(result.data.session);
}

function showApp(session) {
  if (!session) return;
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('userEmail').textContent = session.user.email || '';
  loadEntries();
}

function showAuth() {
  $('appView').classList.add('hidden');
  $('authView').classList.remove('hidden');
}

$('loginTab').addEventListener('click', () => {
  authMode = 'login';
  $('loginTab').classList.add('active');
  $('signupTab').classList.remove('active');
  $('authSubmit').textContent = 'Login';
  setMessage($('authMsg'));
});

$('signupTab').addEventListener('click', () => {
  authMode = 'signup';
  $('signupTab').classList.add('active');
  $('loginTab').classList.remove('active');
  $('authSubmit').textContent = 'Daftar';
  setMessage($('authMsg'));
});

$('authForm').addEventListener('submit', handleAuth);
$('logoutBtn').addEventListener('click', async () => { await db.auth.signOut(); showAuth(); });
$('newEntryBtn').addEventListener('click', () => openModal());
$('closeModal').addEventListener('click', closeModal);
$('cancelBtn').addEventListener('click', closeModal);
$('entryForm').addEventListener('submit', saveEntry);
$('entryCategory').addEventListener('change', updateModeUI);
$('categoryFilter').addEventListener('change', renderEntries);
$('dateFilter').addEventListener('change', renderEntries);
['opening','incoming','usage','meterOpening','meterClosing'].forEach(id => $(id).addEventListener('input', updatePreview));
$('entryItem').addEventListener('blur', syncOpeningBalance);
$('entryDate').addEventListener('change', syncOpeningBalance);
$('entryCategory').addEventListener('change', syncOpeningBalance);

fillCategorySelects();
$('entryDate').value = today();

db.auth.getSession().then(({ data }) => {
  if (data.session) showApp(data.session);
});

db.auth.onAuthStateChange((_event, session) => {
  if (session) showApp(session);
  else showAuth();
});
