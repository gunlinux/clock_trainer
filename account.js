(function () {
  'use strict';

  var API_BASE = window.CLOCK_API_BASE || 'api/';
  var STORAGE_KEY = 'clockTrainerAccount';
  var memoryStore = {};
  var token = null;
  var user = null;
  var authMode = 'login';
  var ui = null;
  var busy = false;
  var background = [];

  function readStored() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return memoryStore[STORAGE_KEY] || null;
    }
  }

  function writeStored(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (err) {
      memoryStore[STORAGE_KEY] = value;
    }
  }

  function removeStored() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      delete memoryStore[STORAGE_KEY];
    }
  }

  function loadSession() {
    var raw = readStored();
    if (!raw) return;

    try {
      var data = JSON.parse(raw);
      if (data && data.token && data.user && data.user.username) {
        token = data.token;
        user = { id: data.user.id, username: data.user.username };
      }
    } catch (err) {}
  }

  function saveSession(data) {
    token = data.token;
    user = { id: data.user.id, username: data.user.username };
    writeStored(JSON.stringify({ token: token, user: user }));
  }

  function clearSession() {
    token = null;
    user = null;
    removeStored();
  }

  function request(method, path, body, withAuth) {
    var headers = { 'Content-Type': 'application/json' };

    if (!window.fetch) {
      return Promise.reject(new Error('Браузер не поддерживает сеть'));
    }

    if (withAuth && token) {
      headers.Authorization = 'Bearer ' + token;
    }

    return window.fetch(API_BASE + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};

        if (text) {
          try {
            data = JSON.parse(text);
          } catch (err) {}
        }

        if (!res.ok) {
          var error = new Error(data.error || ('Ошибка ' + res.status));
          error.status = res.status;
          throw error;
        }

        return data;
      });
    });
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);

    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;

    return node;
  }

  function buildUi() {
    var pill = el('button', 'pill acc-pill', 'Войти');
    pill.type = 'button';
    pill.id = 'accOpen';
    pill.setAttribute('aria-haspopup', 'dialog');
    pill.setAttribute('aria-expanded', 'false');

    var group = document.querySelector('header .hgroup');

    if (group) {
      group.appendChild(pill);
    } else {
      document.body.appendChild(pill);
    }

    var overlay = el('div', 'acc-overlay');
    overlay.id = 'accOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'accTitle');
    overlay.tabIndex = -1;

    overlay.innerHTML =
      '<div class="acc-dialog">' +
        '<div class="acc-top">' +
          '<h2 id="accTitle">Аккаунт</h2>' +
          '<button class="acc-close" id="accClose" type="button" aria-label="Закрыть">×</button>' +
        '</div>' +
        '<div id="accLoggedOut">' +
          '<div class="acc-tabs" role="tablist" aria-label="Вход или регистрация">' +
            '<button class="acc-tab active" id="accTabLogin" type="button" role="tab" aria-selected="true">Вход</button>' +
            '<button class="acc-tab" id="accTabRegister" type="button" role="tab" aria-selected="false">Регистрация</button>' +
          '</div>' +
          '<form id="accForm" novalidate>' +
            '<label class="acc-field"><span>Имя</span>' +
              '<input class="acc-input" id="accName" type="text" maxlength="24" autocomplete="username" placeholder="Как тебя зовут?">' +
            '</label>' +
            '<label class="acc-field"><span>PIN</span>' +
              '<input class="acc-input pin" id="accPin" type="text" inputmode="numeric" maxlength="4" autocomplete="current-password" placeholder="0000">' +
            '</label>' +
            '<p class="acc-hint" id="accHint">Имя от 2 до 24 символов, PIN — ровно 4 цифры.</p>' +
            '<p class="acc-msg" id="accMsg" role="status" aria-live="polite"></p>' +
            '<button class="acc-submit" id="accSubmit" type="submit">Войти</button>' +
          '</form>' +
        '</div>' +
        '<div id="accLoggedIn" hidden>' +
          '<p class="acc-hello">Привет, <b id="accWho"></b>!</p>' +
          '<div id="accStats"></div>' +
          '<div class="acc-actions">' +
            '<button id="accRefresh" type="button">Обновить</button>' +
            '<button class="acc-logout" id="accLogout" type="button">Выйти</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    ui = {
      pill: pill,
      overlay: overlay,
      close: document.getElementById('accClose'),
      loggedOut: document.getElementById('accLoggedOut'),
      loggedIn: document.getElementById('accLoggedIn'),
      tabLogin: document.getElementById('accTabLogin'),
      tabRegister: document.getElementById('accTabRegister'),
      form: document.getElementById('accForm'),
      name: document.getElementById('accName'),
      pin: document.getElementById('accPin'),
      hint: document.getElementById('accHint'),
      msg: document.getElementById('accMsg'),
      submit: document.getElementById('accSubmit'),
      who: document.getElementById('accWho'),
      stats: document.getElementById('accStats'),
      refresh: document.getElementById('accRefresh'),
      logout: document.getElementById('accLogout')
    };

    background = [
      document.querySelector('header'),
      document.querySelector('.tabs'),
      document.querySelector('.card'),
      document.querySelector('main')
    ];
  }

  function updatePill() {
    if (!ui) return;

    ui.pill.textContent = user ? user.username : 'Войти';
    ui.pill.title = user ? 'Аккаунт: ' + user.username : 'Войти или зарегистрироваться';

    if (user) {
      ui.pill.classList.add('logged-in');
    } else {
      ui.pill.classList.remove('logged-in');
    }
  }

  function showLoggedIn() {
    ui.loggedOut.hidden = true;
    ui.loggedIn.hidden = false;
    ui.who.textContent = user ? user.username : '';
    ui.msg.textContent = '';
    loadStats();
  }

  function showLoggedOut(message, cls) {
    ui.loggedOut.hidden = false;
    ui.loggedIn.hidden = true;
    ui.msg.textContent = message || '';
    ui.msg.className = 'acc-msg' + (cls ? ' ' + cls : '');
  }

  function setAuthMode(mode) {
    authMode = mode;

    var isLogin = mode === 'login';

    ui.tabLogin.classList.toggle('active', isLogin);
    ui.tabRegister.classList.toggle('active', !isLogin);
    ui.tabLogin.setAttribute('aria-selected', isLogin ? 'true' : 'false');
    ui.tabRegister.setAttribute('aria-selected', isLogin ? 'false' : 'true');
    ui.submit.textContent = isLogin ? 'Войти' : 'Создать аккаунт';
    ui.hint.textContent = isLogin
      ? 'Введи имя и свой PIN.'
      : 'Придумай имя и PIN из 4 цифр. PIN понадобится для входа.';
    ui.msg.textContent = '';
    ui.msg.className = 'acc-msg';
    ui.pin.value = '';
  }

  function setBusy(on) {
    busy = on;
    ui.submit.disabled = on;
    ui.refresh.disabled = on;
    ui.submit.textContent = on
      ? 'Подожди…'
      : (authMode === 'login' ? 'Войти' : 'Создать аккаунт');
  }

  function setInert(on) {
    background.forEach(function (node) {
      if (!node) return;

      if (on) {
        node.setAttribute('inert', '');
      } else {
        node.removeAttribute('inert');
      }
    });
  }

  function openDialog() {
    if (ui.overlay.classList.contains('open')) return;

    ui.pill.setAttribute('aria-expanded', 'true');
    ui.overlay.classList.add('open');
    document.body.classList.add('acc-open');
    setInert(true);
    updatePill();

    if (user) {
      showLoggedIn();
      ui.close.focus();
    } else {
      showLoggedOut();
      setAuthMode('login');
      ui.name.focus();
    }
  }

  function closeDialog() {
    if (!ui.overlay.classList.contains('open')) return;

    ui.pill.setAttribute('aria-expanded', 'false');
    ui.overlay.classList.remove('open');
    document.body.classList.remove('acc-open');
    setInert(false);
    ui.pill.focus();
  }

  function submitAuth(e) {
    e.preventDefault();
    if (busy) return;

    var name = ui.name.value.trim();
    var pin = ui.pin.value.trim();

    if (name.length < 2 || name.length > 24) {
      ui.msg.textContent = 'Имя должно быть от 2 до 24 символов.';
      ui.msg.className = 'acc-msg bad';
      ui.name.focus();
      return;
    }

    if (!/^\d{4}$/.test(pin)) {
      ui.msg.textContent = 'PIN — это ровно 4 цифры.';
      ui.msg.className = 'acc-msg bad';
      ui.pin.focus();
      return;
    }

    setBusy(true);
    ui.msg.textContent = '';

    request('POST', authMode === 'login' ? 'login' : 'register', {
      username: name,
      pin: pin
    }, false).then(function (data) {
      saveSession(data);
      updatePill();
      setBusy(false);
      ui.pin.value = '';
      showLoggedIn();
      ui.close.focus();
    }).catch(function (err) {
      setBusy(false);
      ui.msg.textContent = err.message || 'Не удалось войти. Попробуй ещё раз.';
      ui.msg.className = 'acc-msg bad';
    });
  }

  function handleExpired() {
    clearSession();
    updatePill();
    showLoggedOut('Сессия закончилась. Войди снова.', 'bad');
  }

  function loadStats() {
    if (!user) return;

    ui.stats.innerHTML = '<p class="acc-empty">Загружаю статистику…</p>';
    ui.refresh.disabled = true;

    request('GET', 'stats', null, true).then(function (data) {
      renderStats(data);
      ui.refresh.disabled = false;
    }).catch(function (err) {
      ui.refresh.disabled = false;

      if (err.status === 401) {
        handleExpired();
        return;
      }

      ui.stats.innerHTML = '';
      ui.stats.appendChild(el('p', 'acc-empty', 'Не удалось загрузить статистику: ' + err.message));
    });
  }

  function formatPercent(value) {
    return Math.round((value || 0) * 100) + '%';
  }

  function formatDuration(seconds) {
    if (!seconds || seconds < 60) return 'меньше минуты';

    var totalMinutes = Math.round(seconds / 60);
    if (totalMinutes < 60) return totalMinutes + ' мин';

    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;

    return hours + ' ч' + (minutes ? ' ' + minutes + ' мин' : '');
  }

  function formatDay(day) {
    var parts = String(day).split('-');

    if (parts.length !== 3) return day;

    return parts[2] + '.' + parts[1];
  }

  function gameName(game) {
    if (game === 'clock') return 'Часы';
    if (game === 'counter') return 'Счёт';
    return game;
  }

  function metric(label, value) {
    var box = el('div', 'acc-metric');
    box.appendChild(el('span', null, label));
    box.appendChild(el('b', null, value));
    return box;
  }

  function renderStats(data) {
    var totals = data.totals || {};
    var games = data.by_game || [];
    var days = data.by_day || [];
    var box = ui.stats;

    box.innerHTML = '';

    if (!totals.answers) {
      box.appendChild(el('p', 'acc-empty', 'Пока нет ответов — сыграй немного, и здесь появится статистика.'));
      return;
    }

    var summary = el('div', 'acc-summary');
    summary.appendChild(metric('Ответов', String(totals.answers)));
    summary.appendChild(metric('Верно', String(totals.correct)));
    summary.appendChild(metric('Точность', formatPercent(totals.accuracy)));
    summary.appendChild(metric('Лучшая серия', String(totals.best_streak)));
    summary.appendChild(metric('Сессий', String(totals.sessions)));
    summary.appendChild(metric('В игре', formatDuration(totals.play_seconds)));
    box.appendChild(summary);

    if (games.length) {
      box.appendChild(el('div', 'acc-section-title', 'По играм'));

      games.forEach(function (stat) {
        var row = el('div', 'acc-row');
        row.appendChild(el('span', null, gameName(stat.game)));
        row.appendChild(el('b', null,
          stat.answers + ' · ' + formatPercent(stat.accuracy)));
        box.appendChild(row);
      });
    }

    if (days.length) {
      box.appendChild(el('div', 'acc-section-title', 'Последние дни'));

      days.slice(0, 7).forEach(function (day) {
        var row = el('div', 'acc-row');
        row.appendChild(el('span', null, formatDay(day.day)));
        row.appendChild(el('b', null,
          day.answers + ' · ' + formatPercent(day.accuracy)));
        box.appendChild(row);
      });
    }
  }

  function logout() {
    if (busy) return;

    setBusy(true);

    var finish = function (message, cls) {
      clearSession();
      setBusy(false);
      updatePill();
      showLoggedOut(message, cls);
      ui.name.focus();
    };

    request('POST', 'logout', null, true).then(function () {
      finish('Ты вышел из аккаунта.', 'good');
    }).catch(function (err) {
      finish(err.status === 401 ? 'Сессия уже закончилась.' : 'Вышел локально, но сервер не ответил.', 'bad');
    });
  }

  function refreshSession() {
    if (!token) return;

    request('GET', 'me', null, true).then(function (data) {
      user = { id: data.user.id, username: data.user.username };
      writeStored(JSON.stringify({ token: token, user: user }));
      updatePill();
      if (ui.overlay.classList.contains('open')) showLoggedIn();
    }).catch(function (err) {
      if (err.status === 401) {
        clearSession();
        updatePill();
      }
    });
  }

  function record(game, mode, level, correct, given, expected, responseMs) {
    if (!token) return;

    var payload = {
      game: game,
      mode: mode === null || mode === undefined ? null : Number(mode),
      level: Number(level),
      correct: !!correct,
      given: given === null || given === undefined ? null : String(given),
      expected: expected === null || expected === undefined ? null : String(expected),
      response_ms: responseMs === null || responseMs === undefined ? null : Math.round(responseMs)
    };

    request('POST', 'answers', payload, true).catch(function (err) {
      if (err.status === 401) {
        clearSession();
        updatePill();
      }
    });
  }

  function bindUi() {
    ui.pill.addEventListener('click', openDialog);
    ui.close.addEventListener('click', closeDialog);
    ui.refresh.addEventListener('click', loadStats);
    ui.logout.addEventListener('click', logout);
    ui.form.addEventListener('submit', submitAuth);
    ui.tabLogin.addEventListener('click', function () { setAuthMode('login'); });
    ui.tabRegister.addEventListener('click', function () { setAuthMode('register'); });

    ui.name.addEventListener('input', function () {
      ui.name.value = ui.name.value.slice(0, 24);
    });

    ui.pin.addEventListener('input', function () {
      ui.pin.value = ui.pin.value.replace(/\D/g, '').slice(0, 4);
    });

    ui.overlay.addEventListener('click', function (e) {
      if (e.target === ui.overlay) closeDialog();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ui.overlay.classList.contains('open')) closeDialog();
    });
  }

  function init() {
    buildUi();
    bindUi();
    loadSession();
    updatePill();

    if (token) {
      refreshSession();
    }
  }

  window.ClockAccount = {
    record: record,
    open: openDialog
  };

  init();
})();
