(function () {
'use strict';

var CLIENT_ID = '115197862913-8fafdd0okn6n6gi0hj38f04vv9rnan68.apps.googleusercontent.com';
var SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/tasks';
var TASKS = 'https://tasks.googleapis.com/tasks/v1';
var CAL = 'https://www.googleapis.com/calendar/v3';

var REFRESH_MS = 5 * 60 * 1000;

var $ = function (id) { return document.getElementById(id); };
var token = null;          // {value, exp}
var tokenClient = null;
var state = { lists: [], tasks: {}, events: [], at: null, offline: false };
var drafts = {};   // chữ đang gõ dở trong ô thêm việc, giữ lại khi trang tự làm mới
var busy = false;
var renewT = null;

// ---------- tiện ích ----------
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayStr() { return ymd(new Date()); }
function tomorrowStr() { var d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); }
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function setStatus(t) { $('status').textContent = t || ''; }
function banner(msg, isErr) {
  var b = $('banner');
  if (!msg) { b.hidden = true; return; }
  b.textContent = msg;
  b.className = 'banner' + (isErr ? ' err' : '');
  b.hidden = false;
}

// ---------- giao diện: sáng / tối / đen trắng ----------
var THEME_COLORS = { light: '#1f6f58', dark: '#0f1211', bw: '#e8e6df' };
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name=theme-color]');
  if (m) m.setAttribute('content', THEME_COLORS[t] || '#ffffff');
  Array.prototype.forEach.call(document.querySelectorAll('[data-theme-btn]'), function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-theme-btn') === t ? 'true' : 'false');
  });
}
function initThemes() {
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  Array.prototype.forEach.call(document.querySelectorAll('[data-theme-btn]'), function (b) {
    b.onclick = function () {
      var t = b.getAttribute('data-theme-btn');
      try { localStorage.setItem('theme', t); } catch (e) {}
      applyTheme(t);
    };
  });
}

// ---------- đồng hồ ----------
var DAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
function setAuthBtn(out) {
  var b = $('btnAuth'); b.classList.toggle('icon', !!out);
  b.textContent = out ? '⏻' : 'Đăng nhập Google'; b.title = out ? 'Đăng xuất' : 'Đăng nhập Google';
  b.setAttribute('aria-label', b.title);
}
// ---------- âm lịch (múi giờ +7) ----------
function jdFromDate(dd, mm, yy) {
  var a = Math.floor((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
  var jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  return jd < 2299161 ? dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083 : jd;
}
function newMoon(k) {
  var T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = Math.PI / 180;
  var Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  var M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3, Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3, F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  var C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M) - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr) - 0.0004 * Math.sin(dr * 3 * Mpr) + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr)) - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M)) - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr)) + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  var dt = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return Jd1 + C1 - dt;
}
function sunLon(jdn) {
  var T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = Math.PI / 180;
  var M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2, L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  var DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M) + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
  var L = (L0 + DL) * dr; L = L - Math.PI * 2 * Math.floor(L / (Math.PI * 2));
  return Math.floor(L / Math.PI * 6);
}
function newMoonDay(k) { return Math.floor(newMoon(k) + 0.5 + 7 / 24); }
function sunLonDay(jd) { return sunLon(jd - 0.5 - 7 / 24); }
function lunarMonth11(yy) {
  var off = jdFromDate(31, 12, yy) - 2415021, k = Math.floor(off / 29.530588853), nm = newMoonDay(k);
  if (sunLonDay(nm) >= 9) nm = newMoonDay(k - 1);
  return nm;
}
function leapOffset(a11) {
  var k = Math.floor((a11 - 2415021.076998695) / 29.530588853 + 0.5), last, i = 1, arc = sunLonDay(newMoonDay(k + i));
  do { last = arc; i++; arc = sunLonDay(newMoonDay(k + i)); } while (arc !== last && i < 14);
  return i - 1;
}
function lunarOf(dd, mm, yy) {
  var dayNumber = jdFromDate(dd, mm, yy), k = Math.floor((dayNumber - 2415021.076998695) / 29.530588853), monthStart = newMoonDay(k + 1);
  if (monthStart > dayNumber) monthStart = newMoonDay(k);
  var a11 = lunarMonth11(yy), b11 = a11, lunarYear;
  if (a11 >= monthStart) { lunarYear = yy; a11 = lunarMonth11(yy - 1); } else { lunarYear = yy + 1; b11 = lunarMonth11(yy + 1); }
  var lunarDay = dayNumber - monthStart + 1, diff = Math.floor((monthStart - a11) / 29), lunarLeap = false, lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    var lo = leapOffset(a11);
    if (diff >= lo) { lunarMonth = diff + 10; if (diff === lo) lunarLeap = true; }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { d: lunarDay, m: lunarMonth, y: lunarYear, leap: lunarLeap };
}
var CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'], CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
function lunarText(n) {
  var l = lunarOf(n.getDate(), n.getMonth() + 1, n.getFullYear());
  return 'Âm lịch: ' + l.d + '/' + l.m + (l.leap ? ' nhuận' : '') + ' · năm ' + CAN[(l.y + 6) % 10] + ' ' + CHI[(l.y + 8) % 12];
}
var lateSig = null;
function tick() {
  var n = new Date();
  if (state && state.at) {
    var sg = allTaskItems().filter(isLateIt).length;
    if (lateSig !== null && sg !== lateSig) { lateSig = sg; setTimeout(render, 0); } else lateSig = sg;
  }
  $('clock').textContent = pad(n.getHours()) + ':' + pad(n.getMinutes());
  $('date').textContent = DAYS[n.getDay()] + ', ' + pad(n.getDate()) + '/' + pad(n.getMonth() + 1) + '/' + n.getFullYear();
  if ($('lunar')) $('lunar').textContent = lunarText(n);
  if ($('iClock')) {
    $('iClock').textContent = pad(n.getHours()) + ':' + pad(n.getMinutes());
    $('iDate').textContent = DAYS[n.getDay()] + ', ' + pad(n.getDate()) + ' tháng ' + (n.getMonth() + 1) + ', ' + n.getFullYear();
  }
}

// ---------- đăng nhập Google ----------
function tokenValid() { return token && token.exp > Date.now(); }

function restoreToken() {
  var t = load('tok', null);
  if (t && t.exp > Date.now() + 30000) token = t;
}

function onToken(resp) {
  if (!resp || resp.error) {
    onSignedOut(resp && resp.error ? 'Đăng nhập không thành công: ' + resp.error : '');
    return;
  }
  token = { value: resp.access_token, exp: Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000 };
  save('tok', token);
  localStorage.setItem('signedIn', '1');
  scheduleRenew();
  refresh();
}

// Gia hạn đăng nhập trước khi hết hạn (im lặng nếu trình duyệt cho phép cửa sổ nhỏ của Google)
function renewNow() {
  if (!tokenClient) return;
  try { tokenClient.requestAccessToken({ prompt: '' }); } catch (e) {}
}
function scheduleRenew() {
  clearTimeout(renewT);
  if (!token) return;
  var ms = Math.max(5000, token.exp - Date.now() - 4 * 60 * 1000);
  renewT = setTimeout(renewNow, ms);
}

function onSignedOut(msg) {
  token = null;
  try { localStorage.removeItem('tok'); } catch (e) {}
  setAuthBtn(false);
  $('btnAuth').hidden = false;
  if (msg) banner(msg, true);
  else banner('Bấm "Đăng nhập Google" để xem lịch và việc của bạn.', false);
}

function initAuth() {
  if (tokenClient || !window.google || !google.accounts || !google.accounts.oauth2) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: onToken,
    error_callback: function (err) {
      // Gia hạn im lặng thất bại (thường do trình duyệt chặn cửa sổ nhỏ).
      if (tokenValid()) { clearTimeout(renewT); renewT = setTimeout(renewNow, 60000); return; }
      onSignedOut('Phiên đăng nhập đã hết và trình duyệt đang chặn cửa sổ gia hạn tự động. Hãy cho phép pop-up với trang này (biểu tượng ở thanh địa chỉ), hoặc bấm "Đăng nhập Google".');
    }
  });
  if (tokenValid()) { scheduleRenew(); refresh(); }
  else if (localStorage.getItem('signedIn') === '1') { tokenClient.requestAccessToken({ prompt: '' }); }
  else { onSignedOut(); }
}
window.__gsiReady = initAuth;

function signIn() {
  if (!tokenClient) { initAuth(); }
  if (!tokenClient) { banner('Chưa tải được dịch vụ đăng nhập của Google. Kiểm tra kết nối mạng rồi thử lại.', true); return; }
  tokenClient.requestAccessToken({ prompt: '' });
}

function signOut() {
  if (token && window.google && google.accounts && google.accounts.oauth2) {
    google.accounts.oauth2.revoke(token.value, function () {});
  }
  localStorage.removeItem('signedIn');
  localStorage.removeItem('cache');
  state = { lists: [], tasks: {}, events: [], at: null, offline: false };
  onSignedOut('');
  render();
}

// ---------- gọi API ----------
function api(method, url, body) {
  if (!tokenValid()) return Promise.reject({ code: 401 });
  var opt = { method: method, headers: { Authorization: 'Bearer ' + token.value } };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  return fetch(url, opt).then(function (r) {
    if (r.status === 204) return null;
    return r.json().then(function (j) {
      if (!r.ok) { throw { code: r.status, message: (j && j.error && j.error.message) || ('Lỗi ' + r.status) }; }
      return j;
    });
  });
}

// ---------- tải dữ liệu ----------
function selectedCals() { return load('cals', ['primary']); }

function fetchEvents() {
  var start = new Date(); start.setHours(0, 0, 0, 0);
  var end = new Date(start); end.setDate(end.getDate() + 15);
  var q = '?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=' + encodeURIComponent(start.toISOString()) +
          '&timeMax=' + encodeURIComponent(end.toISOString());
  return Promise.all(selectedCals().map(function (id) {
    return api('GET', CAL + '/calendars/' + encodeURIComponent(id) + '/events' + q).then(function (r) {
      return (r.items || []).filter(function (e) { return e.status !== 'cancelled' && !(e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.hdTask); });
    }).catch(function (e) { if (e && e.code === 404) return []; throw e; });
  })).then(function (arr) {
    var seen = {}, out = [];
    [].concat.apply([], arr).forEach(function (e) {
      var k = (e.iCalUID || e.id) + '|' + ((e.start && (e.start.dateTime || e.start.date)) || '');
      if (!seen[k]) { seen[k] = 1; out.push(e); }
    });
    return out;
  });
}

function fetchTasks() {
  return api('GET', TASKS + '/users/@me/lists?maxResults=100').then(function (r) {
    var lists = (r.items || []).map(function (l) { return { id: l.id, title: l.title }; });
    return Promise.all(lists.map(function (l) {
      return api('GET', TASKS + '/lists/' + encodeURIComponent(l.id) + '/tasks?showCompleted=false&showHidden=false&maxResults=100')
        .then(function (t) { return { id: l.id, items: t.items || [] }; });
    })).then(function (all) {
      var tasks = {};
      all.forEach(function (x) { tasks[x.id] = x.items; });
      return { lists: lists, tasks: tasks };
    });
  });
}

function refresh() {
  if (busy) return Promise.resolve();
  if (!tokenValid()) {
    if (tokenClient && localStorage.getItem('signedIn') === '1') tokenClient.requestAccessToken({ prompt: '' });
    else onSignedOut();
    return Promise.resolve();
  }
  busy = true;
  setStatus('Đang cập nhật…');
  return Promise.all([fetchTasks(), fetchEvents()]).then(function (res) {
    state.lists = res[0].lists;
    state.tasks = res[0].tasks;
    state.events = res[1];
    state.at = Date.now();
    state.offline = false;
    save('cache', state);
    banner('');
    setAuthBtn(true);
    render();
  }).catch(function (e) {
    if (e && e.code === 401) {
      onSignedOut('');
      if (tokenClient && localStorage.getItem('signedIn') === '1') tokenClient.requestAccessToken({ prompt: '' });
      return;
    }
    state.offline = true;
    banner('Không cập nhật được' + (e && e.message ? ' (' + e.message + ')' : '') + '. Đang hiện dữ liệu lần trước.', true);
    render();
  }).then(function () { busy = false; });
}

// ---------- hiển thị danh sách việc (mỗi danh sách Google Tasks là một khối) ----------

// ---------- giờ trong tên việc: "HH:MM Tên" ----------
var TM_RE = /^\s*(\d{1,2}):(\d{2})\s+/;
function tParse(t) {
  var s = (t && t.title) || '', m = TM_RE.exec(s);
  if (m && +m[1] < 24 && +m[2] < 60) return { time: pad(+m[1]) + ':' + m[2], text: s.slice(m[0].length) };
  return { time: '', text: s };
}
function tJoin(time, text) { return (time ? time + ' ' : '') + text; }
function tSet(span, task) {
  var p = tParse(task); span.textContent = '';
  if (p.time) span.appendChild(el('b', 'tm', p.time));
  span.appendChild(document.createTextNode((p.time ? ' ' : '') + (p.text || '(không tên)')));
}
function normTime(s) {
  s = String(s || '').trim().replace('h', ':').replace('.', ':'); if (/^\d{1,2}$/.test(s)) s += ':00';
  var m = /^(\d{1,2}):?(\d{2})$/.exec(s); if (!m) return null;
  var h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return null; return pad(h) + ':' + pad(mi);
}

function itemsFor(listId) {
  var out = (state.tasks[listId] || []).map(function (t) { return { list: listId, task: t }; });
  out.sort(function (a, b) {
    var da = a.task.due ? a.task.due.slice(0, 10) : '9999', db = b.task.due ? b.task.due.slice(0, 10) : '9999';
    if (da !== db) return da < db ? -1 : 1;
    var ta = tParse(a.task).time || '99:99', tb = tParse(b.task).time || '99:99';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (a.task.position || '') < (b.task.position || '') ? -1 : 1;
  });
  return out;
}

function nowHM() { var n = new Date(); return pad(n.getHours()) + ':' + pad(n.getMinutes()); }
function isLateIt(it) {
  var d = dueOf(it), t = todayStr(); if (!d) return false;
  if (d < t) return true;
  if (d === t) { var tm = tParse(it.task).time; return !!tm && tm < nowHM(); }
  return false;
}
function chipFor(due, task) {
  if (!due) return null;
  var d = due.slice(0, 10), t = todayStr();
  if (d < t) return el('span', 'chip late', 'Quá hạn');
  if (d === t) { var tm = task && tParse(task).time; if (tm && tm < nowHM()) return el('span', 'chip late', 'Quá giờ'); return el('span', 'chip today', 'Hôm nay'); }
  return el('span', 'chip', d.slice(8, 10) + '/' + d.slice(5, 7));
}

function buildListCard(l) {
  var card = el('section', 'card');
  var items = itemsFor(l.id);
  var h = el('h2');
  h.appendChild(el('span', 'ttl', l.title || '(không tên)'));
  h.appendChild(el('span', 'cnt', items.length ? items.length + ' việc' : ''));
  card.appendChild(h);
  card.classList.add('list-card');
  card.setAttribute('data-key', l.id);
  attachGrip(card, l.id);

  var box = el('div', 'cb');
  if (!items.length) box.appendChild(el('div', 'empty', 'Không có việc nào.'));
  items.forEach(function (it) {
    var row = el('div', 'row');
    var cb = el('input', 'chk'); cb.type = 'checkbox'; cb.title = 'Đánh dấu xong';
    cb.setAttribute('aria-label', 'Đánh dấu xong: ' + it.task.title);
    cb.onchange = function () { completeTask(it, row); };
    row.appendChild(cb);
    var ts = el('span', 't'); tSet(ts, it.task); ts.title = 'Bấm để đổi ngày / giờ'; ts.onclick = function (ev) { ev.stopPropagation(); openEdit(ts, it); }; row.appendChild(ts);
    var chip = chipFor(it.task.due, it.task); if (chip) row.appendChild(chip);
    var del = el('button', 'del', '×'); del.title = 'Xoá việc'; del.setAttribute('aria-label', 'Xoá: ' + it.task.title);
    del.onclick = function () { deleteTask(it, row); };
    row.appendChild(del);
    box.appendChild(row);
  });
  card.appendChild(box);

  var f = el('form', 'add');
  var r1 = el('div', 'arow');
  var ti = el('input'); ti.type = 'text'; ti.required = true; ti.placeholder = 'Thêm việc…'; ti.setAttribute('aria-label', 'Thêm việc vào ' + l.title);
  var bt = el('button', '', 'Thêm');
  var dr = drafts[l.id] || (drafts[l.id] = { t: '', d: '', tm: '' });
  ti.value = dr.t || '';
  ti.oninput = function () { dr.t = ti.value; f.classList.toggle('has', !!(ti.value || dr.d)); };
  r1.appendChild(ti); r1.appendChild(bt); f.appendChild(r1);

  var chips = el('div', 'chips');
  var di = el('input', 'hd'); di.type = 'date'; di.tabIndex = -1; di.setAttribute('aria-label', 'Chọn ngày hạn');
  var quick = [['Hôm nay', 0], ['Ngày mai', 1], ['Ngày kia', 2]].map(function (q) {
    var d = new Date(); d.setDate(d.getDate() + q[1]);
    var b = el('button', 'dchip', q[0]); b.type = 'button'; b.setAttribute('data-date', ymd(d));
    b.onclick = function () { dr.d = dr.d === b.getAttribute('data-date') ? '' : b.getAttribute('data-date'); paint(); };
    chips.appendChild(b); return b;
  });
  var pick = el('button', 'dchip', '📅'); pick.type = 'button'; pick.title = 'Chọn ngày khác'; pick.setAttribute('aria-label', 'Chọn ngày khác');
  pick.onclick = function () {
    if (dr.d && quick.every(function (b) { return b.getAttribute('data-date') !== dr.d; })) { dr.d = ''; paint(); return; }
    try { di.showPicker(); } catch (e) { di.focus(); di.click(); }
  };
  di.onchange = function () { dr.d = di.value; paint(); };
  var tmb = el('button', 'dchip', '🕐'); tmb.type = 'button'; tmb.title = 'Đặt giờ (nhắc trước 15 phút)'; tmb.setAttribute('aria-label', 'Đặt giờ');
  tmb.onclick = function () { openTimePop(tmb, dr.tm, function (v) { dr.tm = v; paint(); }); };
  chips.appendChild(pick); chips.appendChild(tmb); chips.appendChild(di); f.appendChild(chips);
  function paint() {
    var custom = true;
    quick.forEach(function (b) { var on = dr.d === b.getAttribute('data-date'); b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (on) custom = false; });
    var isC = !!dr.d && custom;
    pick.setAttribute('aria-pressed', isC ? 'true' : 'false');
    pick.textContent = isC ? '📅 ' + dr.d.slice(8, 10) + '/' + dr.d.slice(5, 7) : '📅';
    if (isC) di.value = dr.d;
    tmb.setAttribute('aria-pressed', dr.tm ? 'true' : 'false'); tmb.textContent = dr.tm ? '🕐 ' + dr.tm : '🕐';
    f.classList.toggle('has', !!(ti.value || dr.d || dr.tm));
  }
  paint();
  f.onsubmit = function (ev) {
    ev.preventDefault();
    var title = ti.value.trim(); if (!title) return;
    addTask(l.id, title, dr.d, dr.tm).then(function (ok) { if (ok) { drafts[l.id] = { t: '', d: '', tm: '' }; render(); } });
  };
  card.appendChild(f);
  return card;
}

function isNotes(l) { return String(l.title || '').trim().toLowerCase() === 'ghi chú'; }
function realLists() { return state.lists.filter(function (l) { return !isNotes(l); }); }
function notesList() { var r = state.lists.filter(isNotes); return r.length ? r[0] : null; }

function renderLists() {
  var grid = $('grid');
  Array.prototype.forEach.call(grid.querySelectorAll('.list-card, .empty-card'), function (n) { n.remove(); });
  var rl = realLists();
  if (!rl.length && token) {
    var c = el('section', 'card empty-card');
    var h = el('h2'); h.appendChild(el('span', 'ttl', 'Việc cần làm'));
    c.appendChild(h);
    c.appendChild(el('div', 'empty', 'Chưa có danh sách nào trong Google Tasks.'));
    grid.appendChild(c);
  }
  rl.forEach(function (l) { grid.appendChild(buildListCard(l)); });
  applyOrder();
}

// ---------- kéo thả để sắp xếp các ô ----------
var currentKeys = [];
var dragKey = null;

function applyOrder() {
  var grid = $('grid');
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.card[data-key]'));
  var map = {};
  cards.forEach(function (c) { map[c.getAttribute('data-key')] = c; });
  var keys = [];
  load('order', []).forEach(function (k) { if (map[k] && keys.indexOf(k) < 0) keys.push(k); });
  cards.forEach(function (c) { var k = c.getAttribute('data-key'); if (keys.indexOf(k) < 0) keys.push(k); });
  keys.forEach(function (k) { grid.appendChild(map[k]); });
  currentKeys = keys;
}

function moveCard(from, to) {
  var keys = currentKeys.slice();
  var i = keys.indexOf(from), j = keys.indexOf(to);
  if (i < 0 || j < 0 || i === j) return;
  keys.splice(i, 1);
  keys.splice(j, 0, from);
  save('order', keys);
  applyOrder();
}

function nudge(key, d) {
  var i = currentKeys.indexOf(key), j = i + d;
  if (i < 0 || j < 0 || j >= currentKeys.length) return;
  moveCard(key, currentKeys[j]);
}

function attachGrip(card, key) {
  var h = card.querySelector('h2');
  if (!h || h.querySelector('.grip')) return;
  var grip = el('button', 'grip', '⠿');
  grip.type = 'button';
  grip.title = 'Kéo để sắp xếp (hoặc dùng phím mũi tên trái/phải)';
  grip.setAttribute('aria-label', 'Di chuyển ô ' + (h.textContent || '').trim());
  h.insertBefore(grip, h.firstChild);

  grip.addEventListener('mousedown', function () { card.draggable = true; });
  grip.addEventListener('mouseup', function () { card.draggable = false; });
  grip.addEventListener('keydown', function (e) {
    var d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    nudge(key, d);
    var again = document.querySelector('.card[data-key="' + key + '"] .grip');
    if (again) again.focus();
  });
  card.addEventListener('dragstart', function (e) {
    if (!card.draggable) { return; }
    dragKey = key;
    try { e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'move'; } catch (x) {}
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', function () {
    card.draggable = false; dragKey = null;
    Array.prototype.forEach.call(document.querySelectorAll('.dragging, .over'), function (n) { n.classList.remove('dragging'); n.classList.remove('over'); });
  });
  card.addEventListener('dragover', function (e) {
    if (!dragKey || dragKey === key) return;
    e.preventDefault();
    card.classList.add('over');
  });
  card.addEventListener('dragleave', function (e) { if (!card.contains(e.relatedTarget)) card.classList.remove('over'); });
  card.addEventListener('drop', function (e) {
    e.preventDefault();
    card.classList.remove('over');
    if (dragKey && dragKey !== key) moveCard(dragKey, key);
  });
}

function evTimeLabel(e) {
  if (e.start && e.start.date) return 'Cả ngày';
  var d = new Date(e.start.dateTime);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function evOnDay(e, day) {
  if (e.start.date) { return e.start.date <= day && day < (e.end && e.end.date ? e.end.date : e.start.date + '~'); }
  return ymd(new Date(e.start.dateTime)) === day;
}
function evSorted(day) {
  var list = state.events.filter(function (e) { return e.start && evOnDay(e, day); });
  list.sort(function (a, b) {
    var ka = a.start.date ? '0' : '1' + a.start.dateTime, kb = b.start.date ? '0' : '1' + b.start.dateTime;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return list;
}
function allTaskItems() {
  var out = [];
  realLists().forEach(function (l) {
    (state.tasks[l.id] || []).forEach(function (t) { out.push({ list: l.id, listTitle: l.title, task: t }); });
  });
  return out;
}
function dueOf(it) { return it.task.due ? it.task.due.slice(0, 10) : null; }
function daysBetween(a, b) {
  var pa = a.split('-'), pb = b.split('-');
  return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 864e5);
}
function dayLabel(day) {
  var p = day.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
  return (d.getDay() === 0 ? 'Chủ nhật' : 'Thứ ' + (d.getDay() + 1)) + ' · ' + p[2] + '/' + p[1];
}
function abbr(title) {
  var w = String(title || '').trim().split(/\s+/).filter(Boolean);
  if (w.length > 1) return w.map(function (x) { return x.charAt(0); }).join('').toUpperCase().slice(0, 3);
  return (w[0] || '?').slice(0, 3).toUpperCase();
}
function tagEl(listTitle) { var t = el('span', 'tag', abbr(listTitle)); t.title = listTitle; return t; }
function taskRow(it, cls, withChip) {
  var row = el('div', 'ur ' + cls);
  var cb = el('input', 'chk'); cb.type = 'checkbox'; cb.title = 'Đánh dấu xong';
  cb.setAttribute('aria-label', 'Đánh dấu xong: ' + it.task.title);
  cb.onchange = function () { completeTask(it, row); };
  row.appendChild(cb);
  var ut = el('div', 'ut');
  var tt = el('span', 'tt'); tSet(tt, it.task); tt.title = 'Bấm để đổi ngày / giờ'; tt.onclick = function (ev) { ev.stopPropagation(); openEdit(tt, it); };
  ut.appendChild(tt); ut.appendChild(tagEl(it.listTitle));
  row.appendChild(ut);
  if (withChip) {
    var n = daysBetween(dueOf(it), todayStr());
    var dd = dueOf(it);
    row.appendChild(el('span', 'chip', n === 0 ? 'Quá giờ' : n > 60 ? dd.slice(8, 10) + '/' + dd.slice(5, 7) + '/' + dd.slice(0, 4) : 'Quá ' + n + ' ngày'));
  }
  return row;
}

function renderUrgent() {
  var box = $('urgentBody'); box.textContent = '';
  var t = todayStr();
  var items = allTaskItems();
  var late = items.filter(isLateIt)
    .sort(function (a, b) { var da = dueOf(a), db = dueOf(b); if (da !== db) return da < db ? -1 : 1; return (tParse(a.task).time || '') < (tParse(b.task).time || '') ? -1 : 1; });
  var today = items.filter(function (it) { return dueOf(it) === t && !isLateIt(it); });
  var evs = evSorted(t);
  lateSig = late.length;

  var c1 = el('div', 'ucol'); c1.appendChild(el('div', 'uh late', 'Quá hạn · ' + late.length));
  if (!late.length) c1.appendChild(el('div', 'uempty', state.at ? 'Không có việc quá hạn.' : '—'));
  late.forEach(function (it) { c1.appendChild(taskRow(it, 'late', true)); });
  var c2 = el('div', 'ucol'); c2.appendChild(el('div', 'uh today', 'Hôm nay · ' + (today.length + evs.length)));
  if (!today.length && !evs.length) c2.appendChild(el('div', 'uempty', state.at ? 'Hôm nay chưa có việc.' : '—'));
  evs.forEach(function (e) {
    var row = el('div', 'ur today');
    row.appendChild(el('span', 'ico', '🕑'));
    var ut = el('div', 'ut');
    var tt = el('span', 'tt', evTimeLabel(e) + ' ' + (e.summary || '(không tên)')); tt.title = e.summary || '';
    ut.appendChild(tt); var tg = el('span', 'tag', 'LỊCH'); tg.title = 'Lịch Google'; ut.appendChild(tg);
    row.appendChild(ut);
    c2.appendChild(row);
  });
  today.forEach(function (it) { c2.appendChild(taskRow(it, 'today', false)); });
  box.appendChild(c2); box.appendChild(c1);

  var a = $('alert');
  if (!state.at) { a.hidden = true; return; }
  var m = today.length + evs.length;
  a.hidden = false;
  if (late.length) { a.className = 'alert'; a.textContent = '⚠ ' + late.length + ' quá hạn · ' + m + ' hôm nay'; }
  else { a.className = 'alert ok'; a.textContent = '✓ Không quá hạn · ' + m + ' hôm nay'; }
}

function weekRange(mode) {
  var s = new Date(); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() + 1);
  var e = new Date(s);
  if (mode === 'week') { var dow = new Date().getDay(); e = new Date(); e.setHours(0, 0, 0, 0); e.setDate(e.getDate() + (dow === 0 ? 0 : 7 - dow)); }
  else e.setDate(s.getDate() + (mode === '5' ? 4 : 6));
  return [s, e];
}
function renderWeek() {
  var mode = load('weekMode', '7');
  Array.prototype.forEach.call(document.querySelectorAll('#weekTabs button'), function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-mode') === mode ? 'true' : 'false');
  });
  var box = $('weekBody'); box.textContent = '';
  var r = weekRange(mode), items = allTaskItems(), any = false;
  for (var d = new Date(r[0]); d <= r[1]; d.setDate(d.getDate() + 1)) {
    var day = ymd(d);
    var evs = evSorted(day), ts = items.filter(function (it) { return dueOf(it) === day; });
    if (!evs.length && !ts.length) continue;
    any = true;
    var col = el('div', 'wd'); col.appendChild(el('div', 'dh', dayLabel(day)));
    evs.forEach(function (e) {
      var li = el('div', 'li'); li.appendChild(el('span', 'dot'));
      li.appendChild(el('span', 'tm', evTimeLabel(e)));
      li.appendChild(el('span', 't', e.summary || '(không tên)'));
      col.appendChild(li);
    });
    ts.forEach(function (it) {
      var li = el('div', 'li');
      var cb = el('input', 'chk'); cb.type = 'checkbox'; cb.title = 'Đánh dấu xong';
      cb.setAttribute('aria-label', 'Đánh dấu xong: ' + it.task.title);
      cb.onchange = function () { completeTask(it, li); };
      li.appendChild(cb);
      var lt = el('span', 't'); tSet(lt, it.task); lt.title = 'Bấm để đổi ngày / giờ'; lt.onclick = function (ev) { ev.stopPropagation(); openEdit(lt, it); }; li.appendChild(lt);
      li.appendChild(tagEl(it.listTitle));
      col.appendChild(li);
    });
    box.appendChild(col);
  }
  if (!any) box.appendChild(el('div', 'uempty', state.at ? 'Không có việc nào trong khoảng này.' : '—'));
}

// ---------- ghi chú (lưu trong danh sách Google Tasks tên "Ghi chú") ----------
var noteDraft = '';
function notePatch(nl, t, text) {
  return api('PATCH', TASKS + '/lists/' + encodeURIComponent(nl.id) + '/tasks/' + encodeURIComponent(t.id), { title: text })
    .then(function () { t.title = text; save('cache', state); })
    .catch(function (e) { banner('Không lưu được ghi chú: ' + (e && e.message || 'lỗi mạng'), true); });
}
function renderNotes() {
  if (document.querySelector('#notesBody .editing')) return;
  var box = $('notesBody'); box.textContent = '';
  var nl = notesList();
  var items = nl ? (state.tasks[nl.id] || []).slice().sort(function (a, b) { return (a.position || '') < (b.position || '') ? -1 : 1; }) : [];
  if (!items.length && token) box.appendChild(el('div', 'empty', nl ? 'Chưa có ghi chú.' : 'Gõ ghi chú đầu tiên bên dưới — web sẽ tạo danh sách "Ghi chú" trong Google Tasks.'));
  items.forEach(function (t, i) {
    var n = el('div', 'nt n' + (i % 4));
    var tx = el('span', 'nx', t.title || '(trống)');
    n.appendChild(tx);
    var del = el('button', 'del', '×'); del.title = 'Xoá ghi chú'; del.setAttribute('aria-label', 'Xoá ghi chú');
    del.onclick = function (ev) { ev.stopPropagation(); deleteTask({ list: nl.id, task: t }, n); };
    n.appendChild(del);
    n.onclick = function () {
      if (n.querySelector('input')) return;
      var inp = el('input'); inp.type = 'text'; inp.value = t.title || ''; n.classList.add('editing');
      n.replaceChild(inp, tx); inp.focus();
      var done = false;
      function fin(ok) {
        if (done) return; done = true;
        n.classList.remove('editing');
        var v = inp.value.trim();
        if (ok && v && v !== t.title) notePatch(nl, t, v).then(render); else render();
      }
      inp.onkeydown = function (e) { if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); };
      inp.onblur = function () { fin(true); };
    };
    box.appendChild(n);
  });
  var f = el('form', 'addnote');
  var addBox = $('notesAdd'); addBox.textContent = '';
  var ti = el('input'); ti.type = 'text'; ti.placeholder = 'Thêm ghi chú…'; ti.required = true; ti.setAttribute('aria-label', 'Thêm ghi chú');
  ti.value = noteDraft; ti.oninput = function () { noteDraft = ti.value; f.classList.toggle('has', !!ti.value); };
  f.classList.toggle('has', !!noteDraft);
  var bt = el('button', '', 'Thêm');
  f.appendChild(ti); f.appendChild(bt);
  f.onsubmit = function (ev) {
    ev.preventDefault();
    var v = ti.value.trim(); if (!v) return;
    addNote(v).then(function (ok) { if (ok) { noteDraft = ''; render(); } });
  };
  addBox.appendChild(f);
}
function addNote(text) {
  var nl = notesList();
  var ready = nl ? Promise.resolve(nl) : api('POST', TASKS + '/users/@me/lists', { title: 'Ghi chú' }).then(function (l) {
    var n = { id: l.id, title: l.title || 'Ghi chú' }; state.lists.push(n); state.tasks[n.id] = []; return n;
  });
  return ready.then(function (l) { return addTask(l.id, text, ''); })
    .catch(function (e) { banner('Không thêm được ghi chú: ' + (e && e.message || 'lỗi mạng'), true); return false; });
}

// ---------- câu châm ngôn theo ngày ----------
var QUOTES = [
  'Có công mài sắt, có ngày nên kim.', 'Nước chảy đá mòn.', 'Một cây làm chẳng nên non, ba cây chụm lại nên hòn núi cao.',
  'Học, học nữa, học mãi.', 'Đi một ngày đàng, học một sàng khôn.', 'Không thầy đố mày làm nên.',
  'Có chí thì nên.', 'Thất bại là mẹ thành công.', 'Lá lành đùm lá rách.', 'Uống nước nhớ nguồn.',
  'Ăn quả nhớ kẻ trồng cây.', 'Gần mực thì đen, gần đèn thì sáng.', 'Tốt gỗ hơn tốt nước sơn.',
  'Chậm mà chắc.', 'Dục tốc bất đạt.', 'Làm việc gì cũng phải có đầu có cuối.',
  'Thuận vợ thuận chồng, tát bể Đông cũng cạn.', 'Một điều nhịn, chín điều lành.', 'Lời nói chẳng mất tiền mua, lựa lời mà nói cho vừa lòng nhau.',
  'Cái nết đánh chết cái đẹp.', 'Có làm thì mới có ăn.', 'Muốn ăn thì lăn vào bếp.',
  'Đường dài mới biết ngựa hay, ở lâu mới biết lòng người.', 'Chớ thấy sóng cả mà ngã tay chèo.', 'Hành trình ngàn dặm bắt đầu từ một bước chân.',
  'Việc hôm nay chớ để ngày mai.', 'Kiến tha lâu cũng đầy tổ.', 'Cần cù bù thông minh.',
  'Mưa dầm thấm lâu.', 'Nhất nghệ tinh, nhất thân vinh.', 'Tay làm hàm nhai, tay quai miệng trễ.',
  'Có thực mới vực được đạo.', 'Biết người biết ta, trăm trận trăm thắng.', 'Đoàn kết là sức mạnh.',
  'Thương người như thể thương thân.', 'Thời gian là vàng bạc.', 'Sai một li, đi một dặm.',
  'Tiên học lễ, hậu học văn.', 'Không có việc gì khó, chỉ sợ lòng không bền.', 'Gieo nhân nào gặp quả nấy.',
  'Rút dây động rừng — việc nhỏ cũng đáng cẩn thận.', 'Cẩn tắc vô ưu.', 'Có bột mới gột nên hồ.',
  'Đẽo cày giữa đường — hãy giữ chủ kiến của mình.', 'Của một đồng, công một nén.', 'Nhiều tay vỗ nên kêu.',
  'Ai ơi giữ chí cho bền, dù ai xoay hướng đổi nền mặc ai.', 'Mỗi ngày tiến một bước nhỏ, một năm là cả chặng đường.'
];
var qOff = 0;
function renderQuote() {
  var n = new Date(), start = new Date(n.getFullYear(), 0, 0);
  var doy = Math.floor((n - start) / 864e5);
  var q = QUOTES[(doy + qOff) % QUOTES.length];
  $('qText').textContent = '“' + q + '”';
  $('qSrc').textContent = 'Tục ngữ · ca dao';
}

// ---------- thời tiết (Open-Meteo, không cần khoá) ----------
var WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=20.25&longitude=105.97' +
  '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m' +
  '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
  '&timezone=Asia%2FBangkok&forecast_days=6';
function wxInfo(c) {
  if (c === 0) return ['☀', 'Trời quang'];
  if (c === 1) return ['🌤', 'Ít mây'];
  if (c === 2) return ['⛅', 'Có mây'];
  if (c === 3) return ['☁', 'Nhiều mây'];
  if (c === 45 || c === 48) return ['🌫', 'Sương mù'];
  if (c >= 51 && c <= 57) return ['🌦', 'Mưa phùn'];
  if (c >= 61 && c <= 67) return ['🌧', 'Mưa'];
  if (c >= 80 && c <= 82) return ['🌦', 'Mưa rào'];
  if (c >= 95) return ['⛈', 'Dông'];
  return ['⛅', 'Có mây'];
}
var wx = load('wx', null);
function fetchWeather() {
  return fetch(WX_URL).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
    wx = { at: Date.now(), cur: j.current, daily: j.daily }; save('wx', wx); renderWeather();
  }).catch(function () { renderWeather(); });
}
var SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
function renderWeather() {
  var box = $('wxBody'); box.textContent = '';
  if (!wx || !wx.cur) { box.textContent = 'Chưa tải được thời tiết.'; return; }
  var c = wx.cur, w = wxInfo(c.weather_code);
  var now = el('div', 'wxnow');
  now.appendChild(el('div', 'ic', w[0]));
  now.appendChild(el('div', 'tp', Math.round(c.temperature_2m) + '°'));
  var ds = el('div', 'ds');
  ds.appendChild(document.createTextNode(w[1] + ' · hôm nay ' + Math.round(wx.daily.temperature_2m_min[0]) + '–' + Math.round(wx.daily.temperature_2m_max[0]) + '°'));
  ds.appendChild(document.createElement('br'));
  ds.appendChild(document.createTextNode('Ẩm ' + Math.round(c.relative_humidity_2m) + '% · gió ' + Math.round(c.wind_speed_10m) + ' km/h'));
  now.appendChild(ds); box.appendChild(now);
  var p = wx.daily.precipitation_probability_max || [];
  var msg = p[0] >= 50 ? 'Hôm nay có mưa (' + p[0] + '%) — nhớ mang áo mưa' : p[1] >= 50 ? 'Ngày mai có mưa (' + p[1] + '%)' : '';
  if (msg) box.appendChild(el('div', 'wxrain', '☔ ' + msg));
  var fc = el('div', 'wxfc');
  for (var i = 1; i < wx.daily.time.length && i <= 5; i++) {
    var d = wx.daily.time[i].split('-'), dow = new Date(+d[0], +d[1] - 1, +d[2]).getDay();
    var cell = el('div', '', SHORT[dow]);
    var b = el('b', '', wxInfo(wx.daily.weather_code[i])[0] + ' ' + Math.round(wx.daily.temperature_2m_min[i]) + '–' + Math.round(wx.daily.temperature_2m_max[i]) + '°');
    b.title = 'Thấp nhất ' + Math.round(wx.daily.temperature_2m_min[i]) + '° · cao nhất ' + Math.round(wx.daily.temperature_2m_max[i]) + '°';
    cell.appendChild(b); fc.appendChild(cell);
  }
  box.appendChild(fc);
}

// ---------- chọn phần hiển thị ----------
var VIEW_ITEMS = [['clock', 'Đồng hồ & châm ngôn'], ['weather', 'Thời tiết'], ['urgent', 'Quá hạn & hôm nay'], ['main', 'Công việc'], ['week', 'Việc trong tuần']];
var PRESETS = {
  min: { clock: 0, weather: 0, urgent: 0, main: 1, week: 0 },
  daily: { clock: 1, weather: 0, urgent: 1, main: 1, week: 1 },
  full: { clock: 1, weather: 1, urgent: 1, main: 1, week: 1 }
};
function getView() { var v = load('view', null); return v || PRESETS.full; }
var ROWS_DEF = {};
function applyRows() {
  var r = load('rows', {}), root = document.documentElement;
  ['info', 'week'].forEach(function (k) {
    if (r[k]) root.style.setProperty('--h-' + k, r[k] + 'px'); else root.style.removeProperty('--h-' + k);
  });
}
function initSplit(id, key, sign, target) {
  var bar = $(id);
  bar.addEventListener('mousedown', function (e) {
    e.preventDefault();
    var y0 = e.clientY, h0 = $(target).getBoundingClientRect().height;
    var lim = [110, Math.round(window.innerHeight * 0.5)];
    document.body.classList.add('resizing');
    function mv(ev) {
      var h = Math.max(lim[0], Math.min(lim[1], Math.round(h0 + sign * (ev.clientY - y0))));
      var r = load('rows', {}); r[key] = h; save('rows', r); applyRows(); scheduleFit();
    }
    function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });
  bar.addEventListener('dblclick', function () { var r = load('rows', {}); delete r[key]; save('rows', r); applyRows(); scheduleFit(); });
}

function applyView() {
  var v = getView();
  $('hdLeft').hidden = !v.clock;
  document.querySelector('.wxcol').hidden = !v.weather;
  $('cardWx').hidden = !v.weather && !v.clock;
  $('cardUrgent').hidden = !v.urgent;
  $('rowInfo').hidden = !v.weather && !v.urgent && !v.clock;
  $('rowInfo').classList.toggle('solo', !(v.weather && v.urgent));
  $('mainWrap').hidden = !v.main;
  $('cardWeek').hidden = !v.week;
  $('splitInfo').hidden = !(v.weather || v.urgent || v.clock) || !v.main;
  $('splitWeek').hidden = !v.week || !v.main;
  scheduleFit();
}
function openView() {
  var box = $('viewList'); box.textContent = '';
  var v = getView();
  VIEW_ITEMS.forEach(function (x) {
    var lab = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!v[x[0]]; cb.setAttribute('data-k', x[0]);
    cb.onchange = function () { var cur = getView(); cur = JSON.parse(JSON.stringify(cur)); cur[x[0]] = cb.checked ? 1 : 0; save('view', cur); applyView(); markPreset(); };
    lab.appendChild(cb); lab.appendChild(document.createTextNode(x[1])); box.appendChild(lab);
  });
  markPreset();
  $('dlgView').showModal();
}
function markPreset() {
  var v = getView();
  Array.prototype.forEach.call(document.querySelectorAll('#presets button'), function (b) {
    var p = PRESETS[b.getAttribute('data-preset')], same = VIEW_ITEMS.every(function (x) { return !!p[x[0]] === !!v[x[0]]; });
    b.setAttribute('aria-pressed', same ? 'true' : 'false');
  });
  Array.prototype.forEach.call(document.querySelectorAll('#viewList input'), function (cb) { cb.checked = !!v[cb.getAttribute('data-k')]; });
}

// Nếu nội dung dài hơn ô: thu nhỏ chữ dần (tối thiểu 75%), còn dài nữa thì cuộn trong ô.
function fitAll() {
  var root = document.documentElement, f = 1;
  root.style.setProperty('--fit', 1);
  var els = [].concat(
    Array.prototype.slice.call(document.querySelectorAll('#grid .cb')),
    Array.prototype.slice.call(document.querySelectorAll('#urgentBody .ucol')),
    [$('weekBody')]).filter(function (e) { return e && e.offsetParent !== null; });
  function over() { return els.some(function (e) { return e.scrollHeight > e.clientHeight + 1; }); }
  // một cỡ chữ chung cho mọi việc (không ô nào to/nhỏ khác ô nào); tối thiểu 90%
  while (over() && f > 0.9) { f = Math.round((f - 0.05) * 100) / 100; root.style.setProperty('--fit', f); }
}
var fitT = null;
function scheduleFit() { clearTimeout(fitT); fitT = setTimeout(fitAll, 30); }

// ---------- chế độ Màn hình chờ (chỉ xem, dùng cho màn hình phụ) ----------
function idleOn() { return !$('idle').hidden; }
function iLine(cls, parts) {
  var d = el('div', 'i-it ' + cls);
  parts.forEach(function (p) { if (p) d.appendChild(p); });
  return d;
}
function fitIdleList(list, nodes, moreFmt) {
  function build(k) {
    list.textContent = '';
    for (var i = 0; i < k; i++) list.appendChild(nodes[i]);
    if (k < nodes.length) list.appendChild(el('div', 'i-more', moreFmt(nodes.length - k)));
  }
  build(nodes.length);
  var k = nodes.length;
  while (k > 0 && list.scrollHeight > list.clientHeight + 1) { k--; build(k); }
}
function renderIdle() {
  if (!idleOn()) return;
  tick();
  $('iQuote').textContent = $('qText').textContent;
  // thời tiết
  var w = $('iWx'); w.textContent = '';
  if (wx && wx.cur) {
    var info = wxInfo(wx.cur.weather_code);
    var top = el('div', 'i-wxtop');
    top.appendChild(el('span', 'i-temp', Math.round(wx.cur.temperature_2m) + '°'));
    top.appendChild(el('span', 'i-cond', info[1] + ' · Ninh Bình'));
    w.appendChild(top);
    var p = wx.daily.precipitation_probability_max || [];
    var msg = p[0] >= 50 ? 'Hôm nay có mưa (' + p[0] + '%)' : p[1] >= 50 ? 'Ngày mai có mưa (' + p[1] + '%)' : '';
    if (msg) w.appendChild(el('div', 'i-rain', msg));
    var fc = el('div', 'i-fc');
    for (var i = 1; i < wx.daily.time.length && i <= 5; i++) {
      var d = wx.daily.time[i].split('-'), dow = new Date(+d[0], +d[1] - 1, +d[2]).getDay();
      fc.appendChild(el('span', '', SHORT[dow] + ' ' + Math.round(wx.daily.temperature_2m_max[i]) + '°'));
    }
    w.appendChild(fc);
  }
  var t = todayStr(), items = allTaskItems();
  var late = items.filter(isLateIt).sort(function (a, b) { var da = dueOf(a), db = dueOf(b); if (da !== db) return da < db ? -1 : 1; return (tParse(a.task).time || '') < (tParse(b.task).time || '') ? -1 : 1; });
  var todayT = items.filter(function (it) { return dueOf(it) === t && !isLateIt(it); });
  var evs = evSorted(t);
  var secL = $('iLate'), secT = $('iToday'), secN = $('iNext');
  secL.querySelector('h3').textContent = 'Quá hạn' + (late.length ? ' · ' + late.length : '');
  secT.querySelector('h3').textContent = 'Hôm nay' + ((todayT.length + evs.length) ? ' · ' + (todayT.length + evs.length) : '');
  secN.querySelector('h3').textContent = 'Sắp tới';
  var more = function (n) { return '+ ' + n + ' việc nữa'; };

  if (!state.at) {
    secL.classList.add('empty'); secL.querySelector('.i-list').textContent = '';
    secT.querySelector('.i-list').textContent = 'Chưa có dữ liệu. Hãy đăng nhập Google ở trang chính.';
    secN.querySelector('.i-list').textContent = '';
    return;
  }
  // quá hạn
  secL.classList.toggle('empty', !late.length);
  fitIdleList(secL.querySelector('.i-list'), late.map(function (it) {
    var n = daysBetween(dueOf(it), t);
    return iLine('late', [el('i', 'dot'), el('span', 'i-t', it.task.title || '(không tên)'), el('span', 'i-tag', abbr(it.listTitle)), el('span', 'i-late', n === 0 ? 'quá giờ' : n > 60 ? 'từ lâu' : 'quá ' + n + ' ngày')]);
  }), more);
  // hôm nay
  var tn = evs.map(function (e) {
    return iLine('', [el('i', 'dot ev'), el('span', 'i-time2', evTimeLabel(e)), el('span', 'i-t', e.summary || '(không tên)')]);
  }).concat(todayT.map(function (it) {
    return iLine('', [el('i', 'dot'), el('span', 'i-t', it.task.title || '(không tên)'), el('span', 'i-tag', abbr(it.listTitle))]);
  }));
  var tl = secT.querySelector('.i-list');
  if (!tn.length) { tl.textContent = ''; tl.appendChild(el('div', 'i-none', 'Hôm nay chưa có việc.')); }
  else fitIdleList(tl, tn, more);
  // sắp tới (7 ngày)
  var nx = [];
  for (var k = 1; k <= 7; k++) {
    var dd = new Date(); dd.setDate(dd.getDate() + k); var day = ymd(dd);
    var lab = SHORT[dd.getDay()] + ' ' + pad(dd.getDate()) + '/' + pad(dd.getMonth() + 1);
    evSorted(day).forEach(function (e) { nx.push(iLine('', [el('span', 'i-day', lab), el('span', 'i-time2', evTimeLabel(e)), el('span', 'i-t', e.summary || '(không tên)')])); });
    items.filter(function (it) { return dueOf(it) === day; }).forEach(function (it) { nx.push(iLine('', [el('span', 'i-day', lab), el('span', 'i-t', it.task.title || '(không tên)'), el('span', 'i-tag', abbr(it.listTitle))])); });
  }
  var nl = secN.querySelector('.i-list');
  if (!nx.length) { nl.textContent = ''; nl.appendChild(el('div', 'i-none', 'Tuần này không còn việc nào.')); }
  else fitIdleList(nl, nx, more);
}
var idleQuietT = null;
function idleWake() {
  var b = $('idle'); b.classList.remove('quiet');
  clearTimeout(idleQuietT);
  idleQuietT = setTimeout(function () { b.classList.add('quiet'); }, 3000);
}
function enterIdle(full) {
  $('idle').hidden = false;
  document.body.classList.add('is-idle');
  try { history.replaceState(null, '', location.pathname + location.search + '#idle'); } catch (e) {}
  renderIdle(); idleWake();
  if (full && document.documentElement.requestFullscreen) { try { document.documentElement.requestFullscreen().catch(function () {}); } catch (e) {} }
}
function exitIdle() {
  $('idle').hidden = true;
  document.body.classList.remove('is-idle');
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  if (document.fullscreenElement && document.exitFullscreen) { try { document.exitFullscreen(); } catch (e) {} }
}
function toggleFull() {
  if (document.fullscreenElement) { document.exitFullscreen(); }
  else if (document.documentElement.requestFullscreen) { document.documentElement.requestFullscreen().catch(function () {}); }
}

function render() {
  renderLists();
  renderUrgent();
  renderWeek();
  renderNotes();
  scheduleFit();
  renderIdle();
  if (state.at) {
    var d = new Date(state.at);
    setStatus((state.offline ? 'Dữ liệu cũ · ' : 'Cập nhật ') + pad(d.getHours()) + ':' + pad(d.getMinutes()));
  } else setStatus('');
}

// ---------- thao tác ghi ----------
function removeFromState(it) {
  var arr = state.tasks[it.list] || [];
  state.tasks[it.list] = arr.filter(function (t) { return t.id !== it.task.id; });
  save('cache', state);
}
function completeTask(it, row) {
  row.classList.add('gone');
  api('PATCH', TASKS + '/lists/' + encodeURIComponent(it.list) + '/tasks/' + encodeURIComponent(it.task.id), { status: 'completed' })
    .then(function () { removeReminder(it.task.id); removeFromState(it); render(); })
    .catch(function (e) { row.classList.remove('gone'); var cb = row.querySelector('.chk'); if (cb) cb.checked = false; banner('Không lưu được: ' + (e && e.message || 'lỗi mạng'), true); });
}
function deleteTask(it, row) {
  if (!window.confirm('Xoá việc "' + (it.task.title || '') + '"?')) return;
  row.classList.add('gone');
  api('DELETE', TASKS + '/lists/' + encodeURIComponent(it.list) + '/tasks/' + encodeURIComponent(it.task.id))
    .then(function () { removeReminder(it.task.id); removeFromState(it); render(); })
    .catch(function (e) { row.classList.remove('gone'); banner('Không xoá được: ' + (e && e.message || 'lỗi mạng'), true); });
}

// ---------- nhắc việc: sự kiện Calendar nhắc trước 15 phút ----------
var TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok'; } catch (e) { return 'Asia/Bangkok'; } })();
function findReminders(taskId) {
  return api('GET', CAL + '/calendars/primary/events?privateExtendedProperty=' + encodeURIComponent('hdTask=' + taskId) + '&maxResults=20')
    .then(function (r) { return r.items || []; });
}
function removeReminder(taskId) {
  if (!taskId || !tokenValid()) return Promise.resolve();
  return findReminders(taskId).then(function (items) {
    return Promise.all(items.map(function (e) { return api('DELETE', CAL + '/calendars/primary/events/' + encodeURIComponent(e.id)).catch(function () {}); }));
  }).catch(function () {});
}
function setReminder(taskId, text, date, time) {
  if (!tokenValid() || !date || !time) return Promise.resolve();
  var st = new Date(date + 'T' + time + ':00'), en = new Date(st.getTime() + 30 * 60000);
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00'; }
  var body = {
    summary: text || '(việc)', start: { dateTime: iso(st), timeZone: TZ }, end: { dateTime: iso(en), timeZone: TZ },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: getLead() }] },
    extendedProperties: { private: { hdTask: taskId } }
  };
  return removeReminder(taskId).then(function () { return api('POST', CAL + '/calendars/primary/events', body); })
    .catch(function (e) { banner('Không tạo được nhắc việc: ' + (e && e.message || 'lỗi mạng'), true); });
}

// ---------- bấm vào việc để đổi ngày / giờ ----------
var pop = null;
function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', popOut, true); document.removeEventListener('keydown', popKey, true); } }
function popOut(e) { if (pop && !pop.contains(e.target)) closePop(); }
function popKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } }
function placePop(anchor) {
  document.body.appendChild(pop);
  var r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  var x = Math.min(Math.max(8, r.left), window.innerWidth - w - 8), y = r.bottom + 6;
  if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  setTimeout(function () { document.addEventListener('mousedown', popOut, true); document.addEventListener('keydown', popKey, true); }, 0);
}
function timeBox(cur, onChange) {
  var box = el('div', 'tpb');
  var inp = el('input'); inp.type = 'text'; inp.placeholder = 'Gõ giờ, vd 14:30'; inp.value = cur || ''; inp.setAttribute('aria-label', 'Giờ');
  inp.onchange = function () { var v = inp.value.trim() ? normTime(inp.value) : ''; if (v === null) { inp.value = cur || ''; return; } cur = v; inp.value = v; mark(); onChange(v); };
  box.appendChild(inp);
  var lst = el('div', 'tpl');
  for (var h = 6; h <= 22; h++) (function (hh) {
    var b = el('button', 'tph', pad(hh) + ':00'); b.type = 'button';
    b.onclick = function () { cur = b.textContent; inp.value = cur; mark(); onChange(cur); };
    lst.appendChild(b);
  })(h);
  box.appendChild(lst);
  var clr = el('button', 'tpc', 'Bỏ giờ'); clr.type = 'button'; clr.onclick = function () { cur = ''; inp.value = ''; mark(); onChange(''); };
  box.appendChild(clr);
  box.appendChild(leadSelect(getLead(), function (m) { save('lead', m); }));
  function mark() { Array.prototype.forEach.call(lst.children, function (b) { b.setAttribute('aria-pressed', b.textContent === cur ? 'true' : 'false'); }); }
  mark();
  return box;
}
function openTimePop(anchor, cur, onPick) {
  closePop(); pop = el('div', 'pop');
  pop.appendChild(timeBox(cur, function (v) { onPick(v); closePop(); }));
  placePop(anchor);
  var i = pop.querySelector('input'); if (i) i.focus();
}
function openEdit(anchor, it) {
  closePop(); pop = el('div', 'pop wide');
  var p = tParse(it.task), cur = { d: dueOf(it) || '', t: p.time };
  var dr = el('div', 'pd'); pop.appendChild(dr);
  var di = el('input', 'hd'); di.type = 'date';
  var qs = [['Hôm nay', 0], ['Ngày mai', 1], ['Ngày kia', 2]].map(function (q) {
    var d = new Date(); d.setDate(d.getDate() + q[1]); var key = ymd(d);
    var b = el('button', 'dchip', q[0]); b.type = 'button'; b.setAttribute('data-date', key);
    b.onclick = function () { cur.d = key; paint(); }; dr.appendChild(b); return b;
  });
  var pk = el('button', 'dchip', '📅'); pk.type = 'button'; pk.title = 'Chọn ngày khác';
  pk.onclick = function () { try { di.showPicker(); } catch (e) { di.focus(); di.click(); } };
  di.onchange = function () { cur.d = di.value; paint(); };
  var nd = el('button', 'dchip', 'Bỏ ngày'); nd.type = 'button'; nd.onclick = function () { cur.d = ''; cur.t = ''; paint(); tb.replaceWith((tb = timeBox('', function (v) { cur.t = v; paint(); }))); };
  dr.appendChild(pk); dr.appendChild(di); dr.appendChild(nd);
  var tb = timeBox(cur.t, function (v) { cur.t = v; paint(); });
  pop.appendChild(tb);
  var act = el('div', 'pa'); var ok = el('button', 'primary', 'Lưu'); ok.type = 'button'; var no = el('button', '', 'Huỷ'); no.type = 'button';
  act.appendChild(no); act.appendChild(ok); pop.appendChild(act);
  function paint() {
    var custom = true;
    qs.forEach(function (b) { var on = cur.d === b.getAttribute('data-date'); b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (on) custom = false; });
    var isC = !!cur.d && custom; pk.setAttribute('aria-pressed', isC ? 'true' : 'false');
    pk.textContent = isC ? '📅 ' + cur.d.slice(8, 10) + '/' + cur.d.slice(5, 7) : '📅'; if (isC) di.value = cur.d;
  }
  paint();
  no.onclick = closePop;
  ok.onclick = function () {
    var date = cur.d, time = cur.t; if (time && !date) date = todayStr();
    var title = tJoin(time, p.text), body = { title: title };
    if (date) body.due = date + 'T00:00:00.000Z'; else body.due = null;
    ok.disabled = true;
    api('PATCH', TASKS + '/lists/' + encodeURIComponent(it.list) + '/tasks/' + encodeURIComponent(it.task.id), body).then(function (t) {
      it.task.title = title; if (date) it.task.due = body.due; else delete it.task.due;
      save('cache', state); closePop(); render();
      if (time) setReminder(it.task.id, p.text, date, time); else removeReminder(it.task.id);
    }).catch(function (e) { ok.disabled = false; banner('Không lưu được: ' + (e && e.message || 'lỗi mạng'), true); });
  };
  placePop(anchor);
}
function addTask(listId, title, date, time) {
  if (time && !date) date = todayStr();
  var body = { title: tJoin(time, title) };
  if (date) body.due = date + 'T00:00:00.000Z';
  return api('POST', TASKS + '/lists/' + encodeURIComponent(listId) + '/tasks', body).then(function (t) {
    (state.tasks[listId] = state.tasks[listId] || []).push(t);
    save('cache', state);
    if (time) setReminder(t.id, title, date, time);
    return true;
  }).catch(function (e) { banner('Không thêm được: ' + (e && e.message || 'lỗi mạng'), true); return false; });
}
var LEADS = [5, 10, 15, 30, 60];
function getLead() { var v = +load('lead', 15); return LEADS.indexOf(v) >= 0 ? v : 15; }
function getQLead() { var v = +load('qlead', 30); return LEADS.indexOf(v) >= 0 ? v : 30; }
function leadSelect(cur, onChange) {
  var s = el('select', 'lead'); s.title = 'Nhắc trước bao nhiêu phút'; s.setAttribute('aria-label', 'Nhắc trước');
  LEADS.forEach(function (m) { var o = el('option', '', '🔔 ' + (m >= 60 ? '1 giờ' : m + ' phút')); o.value = m; if (m === cur) o.selected = true; s.appendChild(o); });
  s.onchange = function () { onChange(+s.value); };
  return s;
}
var quickBusy = false;
function quickAdd(text) {
  var lead = getQLead();
  return api('POST', CAL + '/calendars/primary/events/quickAdd?text=' + encodeURIComponent(text)).then(function (ev) {
    if (ev && ev.id) return api('PATCH', CAL + '/calendars/primary/events/' + encodeURIComponent(ev.id), { reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: lead }] } }).catch(function () {});
  }).then(function () { return refresh(); })
    .catch(function (e) { banner('Không thêm được sự kiện: ' + (e && e.message || 'lỗi mạng'), true); });
}

// ---------- chọn lịch ----------
function openSettings() {
  if (!tokenValid()) { banner('Hãy đăng nhập Google trước.', true); return; }
  var box = $('calList'); box.textContent = 'Đang tải…';
  $('dlg').showModal();
  api('GET', CAL + '/users/me/calendarList?maxResults=100').then(function (r) {
    var sel = selectedCals();
    box.textContent = '';
    (r.items || []).forEach(function (c) {
      var lab = el('label');
      var cb = el('input'); cb.type = 'checkbox';
      var id = c.primary ? 'primary' : c.id;
      cb.checked = sel.indexOf(id) >= 0 || (c.primary && sel.indexOf('primary') >= 0);
      cb.onchange = function () {
        var cur = selectedCals().filter(function (x) { return x !== id; });
        if (cb.checked) cur.push(id);
        if (!cur.length) { cur = ['primary']; }
        save('cals', cur);
        refresh();
      };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(c.summaryOverride || c.summary || c.id));
      box.appendChild(lab);
    });
  }).catch(function (e) { box.textContent = 'Không tải được danh sách lịch' + (e && e.message ? ': ' + e.message : '.'); });
}

// ---------- khởi động ----------
function init() {
  initThemes();
  applyRows(); initSplit('splitInfo', 'info', 1, 'rowInfo'); initSplit('splitWeek', 'week', -1, 'cardWeek');
  applyView(); renderQuote(); renderWeather(); fetchWeather();
  setInterval(fetchWeather, 30 * 60 * 1000);
  $('qNext').onclick = function () { qOff++; renderQuote(); };
  $('btnView').onclick = openView;
  $('btnIdle').onclick = function () { enterIdle(true); };
  $('iExit').onclick = exitIdle;
  $('iFull').onclick = toggleFull;
  $('idle').addEventListener('mousemove', idleWake);
  $('idle').addEventListener('dblclick', toggleFull);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && idleOn() && !document.fullscreenElement) exitIdle(); });
  window.addEventListener('resize', function () { renderIdle(); });
  window.addEventListener('hashchange', function () { if (location.hash === '#idle') { if (!idleOn()) enterIdle(false); } else if (idleOn()) exitIdle(); });
  if (location.hash === '#idle') enterIdle(false);
  window.addEventListener('resize', scheduleFit);
  Array.prototype.forEach.call(document.querySelectorAll('#presets button'), function (b) { b.onclick = function () { save('view', PRESETS[b.getAttribute('data-preset')]); applyView(); markPreset(); }; });
  Array.prototype.forEach.call(document.querySelectorAll('#weekTabs button'), function (b) { b.onclick = function () { save('weekMode', b.getAttribute('data-mode')); renderWeek(); }; });
  tick(); setInterval(tick, 15000);
  restoreToken();
  var cached = load('cache', null);
  if (cached && cached.lists) { state = cached; state.offline = true; render(); } else { render(); }

  $('btnRefresh').onclick = function () { refresh(); };
  $('btnSettings').onclick = openSettings;
  $('btnAuth').onclick = function () { if (token || localStorage.getItem('signedIn') === '1' && $('btnAuth').classList.contains('icon')) signOut(); else signIn(); };

  (function () {
    var f = $('quickAdd'), i = f.querySelector('input'), q = $('qLead'), pend = false;
    LEADS.forEach(function (m) { var o = el('option', '', '🔔 ' + (m >= 60 ? '1 giờ' : m + ' phút')); o.value = m; q.appendChild(o); });
    q.value = getQLead(); q.onchange = function () { save('qlead', +q.value); };
    function go() {
      var t = i.value.trim(); if (!t || quickBusy) return;
      quickBusy = true; save('qlead', +q.value);
      quickAdd(t).then(function () { i.value = ''; }).then(function () { quickBusy = false; }, function () { quickBusy = false; });
    }
    f.onsubmit = function (ev) { ev.preventDefault(); go(); };
    i.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.keyCode !== 13) return;
      if (e.isComposing || e.keyCode === 229) { pend = true; return; }   // Enter đang chốt chữ gõ tiếng Việt
      e.preventDefault(); go();
    });
    i.addEventListener('compositionend', function () { if (pend) { pend = false; setTimeout(go, 0); } });
    i.addEventListener('blur', function () { pend = false; });
  })();

  setInterval(function () { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (token && token.exp - Date.now() < 5 * 60 * 1000) renewNow();
    if (state.at && Date.now() - state.at > 60000) refresh();
  });
  window.addEventListener('online', function () { refresh(); });

  if (window.google && google.accounts) initAuth();
  if (tokenValid()) setAuthBtn(true);

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
}
init();
})();
