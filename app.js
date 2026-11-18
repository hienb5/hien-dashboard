(function () {
'use strict';

var CLIENT_ID = '115197862913-8fafdd0okn6n6gi0hj38f04vv9rnan68.apps.googleusercontent.com';
var SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/tasks';
var TASKS = 'https://tasks.googleapis.com/tasks/v1';
var CAL = 'https://www.googleapis.com/calendar/v3';

// Tên danh sách Google Tasks tương ứng với từng khối. Các danh sách khác gom vào "Cá nhân".
var GROUPS = {
  cangvu: 'Cảng vụ',
  hienvinh: 'Hiển Vinh'
};
var REFRESH_MS = 5 * 60 * 1000;

var $ = function (id) { return document.getElementById(id); };
var token = null;          // {value, exp}
var tokenClient = null;
var state = { lists: [], tasks: {}, events: [], at: null, offline: false };
var busy = false;

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

// ---------- đồng hồ ----------
var DAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
function tick() {
  var n = new Date();
  $('clock').textContent = pad(n.getHours()) + ':' + pad(n.getMinutes());
  $('date').textContent = DAYS[n.getDay()] + ', ' + pad(n.getDate()) + '/' + pad(n.getMonth() + 1) + '/' + n.getFullYear();
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
  refresh();
}

function onSignedOut(msg) {
  token = null;
  try { localStorage.removeItem('tok'); } catch (e) {}
  $('btnAuth').textContent = 'Đăng nhập Google';
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
      // Đăng nhập im lặng thất bại (cửa sổ bị chặn / chưa đăng nhập): hiện nút cho người dùng bấm.
      if (!tokenValid()) onSignedOut();
    }
  });
  if (tokenValid()) { refresh(); }
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
  var end = new Date(start); end.setDate(end.getDate() + 2);
  var q = '?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=' + encodeURIComponent(start.toISOString()) +
          '&timeMax=' + encodeURIComponent(end.toISOString());
  return Promise.all(selectedCals().map(function (id) {
    return api('GET', CAL + '/calendars/' + encodeURIComponent(id) + '/events' + q).then(function (r) {
      return (r.items || []).filter(function (e) { return e.status !== 'cancelled'; });
    }).catch(function (e) { if (e && e.code === 404) return []; throw e; });
  })).then(function (arr) { return [].concat.apply([], arr); });
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
    $('btnAuth').textContent = 'Đăng xuất';
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

// ---------- phân nhóm ----------
function listFor(group) {
  if (group === 'personal') {
    // danh sách mặc định: danh sách đầu tiên không thuộc khối khác
    var names = Object.keys(GROUPS).map(function (k) { return GROUPS[k]; });
    for (var i = 0; i < state.lists.length; i++) if (names.indexOf(state.lists[i].title) < 0) return state.lists[i];
    return null;
  }
  for (var j = 0; j < state.lists.length; j++) if (state.lists[j].title === GROUPS[group]) return state.lists[j];
  return null;
}
function itemsFor(group) {
  var names = Object.keys(GROUPS).map(function (k) { return GROUPS[k]; });
  var out = [];
  state.lists.forEach(function (l) {
    var isGroupList = names.indexOf(l.title) >= 0;
    var take = group === 'personal' ? !isGroupList : l.title === GROUPS[group];
    if (take) (state.tasks[l.id] || []).forEach(function (t) { out.push({ list: l.id, task: t }); });
  });
  out.sort(function (a, b) {
    var da = a.task.due ? a.task.due.slice(0, 10) : '9999', db = b.task.due ? b.task.due.slice(0, 10) : '9999';
    if (da !== db) return da < db ? -1 : 1;
    return (a.task.position || '') < (b.task.position || '') ? -1 : 1;
  });
  return out;
}

// ---------- hiển thị ----------
function chipFor(due) {
  if (!due) return null;
  var d = due.slice(0, 10), t = todayStr();
  if (d < t) return el('span', 'chip late', 'Quá hạn');
  if (d === t) return el('span', 'chip today', 'Hôm nay');
  return el('span', 'chip', d.slice(8, 10) + '/' + d.slice(5, 7));
}

function renderTasks(group) {
  var box = $('tasks-' + group);
  box.textContent = '';
  var items = itemsFor(group);
  $('n-' + group).textContent = items.length ? items.length + ' việc' : '';
  var missing = group !== 'personal' && !listFor(group) && state.lists.length;
  if (missing) {
    var msg = el('div', 'empty', 'Chưa có danh sách "' + GROUPS[group] + '" trong Google Tasks. ');
    var b = el('button', '', 'Tạo danh sách');
    b.onclick = function () { createList(group); };
    msg.appendChild(b);
    box.appendChild(msg);
    return;
  }
  if (!items.length) { box.appendChild(el('div', 'empty', token ? 'Không có việc nào.' : '—')); return; }
  items.forEach(function (it) {
    var row = el('div', 'row');
    var cb = el('input', 'chk'); cb.type = 'checkbox'; cb.title = 'Đánh dấu xong'; cb.setAttribute('aria-label', 'Đánh dấu xong: ' + it.task.title);
    cb.onchange = function () { completeTask(it, row); };
    var t = el('span', 't', it.task.title || '(không tên)');
    row.appendChild(cb); row.appendChild(t);
    var chip = chipFor(it.task.due); if (chip) row.appendChild(chip);
    var del = el('button', 'del', '×'); del.title = 'Xoá việc'; del.setAttribute('aria-label', 'Xoá: ' + it.task.title);
    del.onclick = function () { deleteTask(it, row); };
    row.appendChild(del);
    box.appendChild(row);
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
function renderEvents(boxId, day) {
  var box = $(boxId); box.textContent = '';
  var list = state.events.filter(function (e) { return e.start && evOnDay(e, day); });
  list.sort(function (a, b) {
    var ka = a.start.date ? '0' : '1' + a.start.dateTime, kb = b.start.date ? '0' : '1' + b.start.dateTime;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  if (!list.length) { box.appendChild(el('div', 'empty', token ? 'Không có sự kiện nào.' : '—')); return; }
  list.forEach(function (e) {
    var row = el('div', 'row');
    row.appendChild(el('span', 'h', evTimeLabel(e)));
    row.appendChild(el('span', 't', e.summary || '(không tên)'));
    box.appendChild(row);
  });
}

function render() {
  ['personal', 'cangvu', 'hienvinh'].forEach(renderTasks);
  renderEvents('ev-today', todayStr());
  renderEvents('ev-tomorrow', tomorrowStr());
  if (state.at) {
    var d = new Date(state.at);
    setStatus((state.offline ? 'Dữ liệu cũ · ' : 'Cập nhật ') + pad(d.getHours()) + ':' + pad(d.getMinutes()));
  } else setStatus('');
  $('foot').textContent = 'Dữ liệu lấy từ Google Tasks và Google Calendar của bạn. Việc xong sẽ biến mất khỏi danh sách.';
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
    .then(function () { removeFromState(it); render(); })
    .catch(function (e) { row.classList.remove('gone'); var cb = row.querySelector('.chk'); if (cb) cb.checked = false; banner('Không lưu được: ' + (e && e.message || 'lỗi mạng'), true); });
}
function deleteTask(it, row) {
  if (!window.confirm('Xoá việc "' + (it.task.title || '') + '"?')) return;
  row.classList.add('gone');
  api('DELETE', TASKS + '/lists/' + encodeURIComponent(it.list) + '/tasks/' + encodeURIComponent(it.task.id))
    .then(function () { removeFromState(it); render(); })
    .catch(function (e) { row.classList.remove('gone'); banner('Không xoá được: ' + (e && e.message || 'lỗi mạng'), true); });
}
function addTask(group, title, date) {
  var l = listFor(group);
  if (!l) { banner('Chưa có danh sách cho khối này trong Google Tasks.', true); return Promise.resolve(); }
  var body = { title: title };
  if (date) body.due = date + 'T00:00:00.000Z';
  return api('POST', TASKS + '/lists/' + encodeURIComponent(l.id) + '/tasks', body).then(function (t) {
    (state.tasks[l.id] = state.tasks[l.id] || []).push(t);
    save('cache', state);
    render();
  }).catch(function (e) { banner('Không thêm được: ' + (e && e.message || 'lỗi mạng'), true); });
}
function createList(group) {
  api('POST', TASKS + '/users/@me/lists', { title: GROUPS[group] }).then(function () { refresh(); })
    .catch(function (e) { banner('Không tạo được danh sách: ' + (e && e.message || 'lỗi mạng'), true); });
}
function quickAdd(text) {
  return api('POST', CAL + '/calendars/primary/events/quickAdd?text=' + encodeURIComponent(text)).then(function () { return refresh(); })
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
  tick(); setInterval(tick, 15000);
  restoreToken();
  var cached = load('cache', null);
  if (cached && cached.lists) { state = cached; state.offline = true; render(); } else { render(); }

  $('btnRefresh').onclick = function () { refresh(); };
  $('btnSettings').onclick = openSettings;
  $('btnAuth').onclick = function () { if (token || localStorage.getItem('signedIn') === '1' && $('btnAuth').textContent === 'Đăng xuất') signOut(); else signIn(); };

  Array.prototype.forEach.call(document.querySelectorAll('form.add'), function (f) {
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var inputs = f.querySelectorAll('input');
      var title = inputs[0].value.trim();
      if (!title) return;
      addTask(f.getAttribute('data-group'), title, inputs[1].value).then(function () { inputs[0].value = ''; inputs[1].value = ''; });
    };
  });
  $('quickAdd').onsubmit = function (ev) {
    ev.preventDefault();
    var i = $('quickAdd').querySelector('input');
    var t = i.value.trim(); if (!t) return;
    quickAdd(t).then(function () { i.value = ''; });
  };

  setInterval(function () { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.at && Date.now() - state.at > 60000) refresh(); });
  window.addEventListener('online', function () { refresh(); });

  if (window.google && google.accounts) initAuth();
  if (tokenValid()) $('btnAuth').textContent = 'Đăng xuất';

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
}
init();
})();
