(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return String(n).padStart(2, '0'); };

  var NS = 'http://www.w3.org/2000/svg';

  var ticksG = $('ticks');
  var numsG = $('numbers');

  for (var i = 0; i < 60; i++) {
    var th = i * 6 * Math.PI / 180;
    var isHour = i % 5 === 0;
    var r1 = isHour ? 80 : 84;
    var r2 = 89;

    var l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', (100 + r1 * Math.sin(th)).toFixed(2));
    l.setAttribute('y1', (100 - r1 * Math.cos(th)).toFixed(2));
    l.setAttribute('x2', (100 + r2 * Math.sin(th)).toFixed(2));
    l.setAttribute('y2', (100 - r2 * Math.cos(th)).toFixed(2));
    l.setAttribute('class', isHour ? 'tick-h' : 'tick-m');

    ticksG.appendChild(l);
  }

  for (var n = 1; n <= 12; n++) {
    var tn = n * 30 * Math.PI / 180;
    var t = document.createElementNS(NS, 'text');
    t.setAttribute('x', (100 + 68 * Math.sin(tn)).toFixed(2));
    t.setAttribute('y', (100 - 68 * Math.cos(tn)).toFixed(2));
    t.setAttribute('class', 'num');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.textContent = n;

    numsG.appendChild(t);
  }

  /* --- Подписи минут 5..60, видны только на лёгком и среднем уровнях --- */
  var minsG = $('minuteLabels');

  for (var mn = 1; mn <= 12; mn++) {
    var tm = mn * 30 * Math.PI / 180;
    var mt = document.createElementNS(NS, 'text');
    mt.setAttribute('x', (100 + 58 * Math.sin(tm)).toFixed(2));
    mt.setAttribute('y', (100 - 58 * Math.cos(tm)).toFixed(2));
    mt.setAttribute('class', 'min');
    mt.setAttribute('text-anchor', 'middle');
    mt.setAttribute('dominant-baseline', 'central');
    mt.textContent = mn * 5;

    minsG.appendChild(mt);
  }

  var hourHand = $('hourHand');
  var minuteHand = $('minuteHand');

  var hAngle = 0;
  var mAngle = 0;

  function shortestDelta(from, to) {
    var d = (to - from) % 360;

    if (d > 180) d -= 360;
    if (d < -180) d += 360;

    return d;
  }

  function setClock(total) {
    var m = ((total % 60) + 60) % 60;
    var h = ((Math.floor(total / 60) % 12) + 12) % 12;

    var tm = m * 6;
    var th = (h + m / 60) * 30;

    mAngle += shortestDelta(mAngle, tm);
    hAngle += shortestDelta(hAngle, th);

    minuteHand.style.transform = 'rotate(' + mAngle + 'deg)';
    hourHand.style.transform = 'rotate(' + hAngle + 'deg)';
  }

  /* --- Уровни сложности режима «Выбери время» --- */
  var LEVELS = {
    1: { step: 5, minutes: true, penaltyEvery: 0 },
    2: { step: 5, minutes: false, penaltyEvery: 3 },
    3: { step: 1, minutes: false, penaltyEvery: 2 }
  };

  var COOLDOWN_MS = 5000;

  var state = { mode: 1, level: 1, answer: 0, score: 0, mistakes: 0, locked: false };
  var dH = 0;
  var dM = 0;
  var timer = null;
  var cooldownUntil = 0;
  var cooldownTimer = null;

  function schedule(fn, ms) {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  }

  function randomTime(step) {
    step = step || 5;

    var h = Math.floor(Math.random() * 24);
    var m = Math.floor(Math.random() * (60 / step)) * step;
    return h * 60 + m;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function updateScore() {
    $('score').textContent = state.score;
  }

  function showFeedback(text, cls) {
    var f = $('feedback');
    f.textContent = text;
    f.className = 'feedback ' + cls;
  }

  function hideFeedback() {
    var f = $('feedback');
    f.textContent = '';
    f.className = 'feedback';
  }

  /* --- Два формата для одного положения стрелок --- */
  function pairLabel(t) {
    var h24 = Math.floor(t / 60) % 24;
    var m = t % 60;
    var h12 = h24 % 12;
    if (h12 === 0) h12 = 12;

    var a = h24;
    var b = (h24 + 12) % 24;
    if (a > b) { var tmp = a; a = b; b = tmp; }

    return {
      h12: h12 + ':' + pad(m),
      h24: pad(h24) + ':' + pad(m),   // тот, что реально загадан
      h24a: pad(a) + ':' + pad(m),    // меньший 24ч
      h24b: pad(b) + ':' + pad(m)     // больший 24ч
    };
  }

  /* --- Ключ положения стрелок (0..719 мин), чтобы не было визуально одинаковых вариантов --- */
  function visualKey(t) {
    return ((t % 720) + 720) % 720;
  }

  function buildOptions(ans, level) {
    var cfg = LEVELS[level];
    var ah = Math.floor(ans / 60);
    var am = ans % 60;
    var ansKey = visualKey(ans);
    var seen = {};
    seen[ansKey] = true;

    var pool = [];
    var sameHour = [];

    function push(list, value) {
      value = ((value % 1440) + 1440) % 1440;
      var vk = visualKey(value);

      if (!seen[vk]) {
        seen[vk] = true;
        list.push(value);
      }
    }

    if (level === 3) {
      // минимум три варианта в одном 24-часовом часе: ответ и два добранных
      var guard = 0;

      while (sameHour.length < 2 && guard++ < 500) {
        push(sameHour, ah * 60 + Math.floor(Math.random() * 60));
      }

      if (sameHour.length < 2) {
        push(sameHour, ah * 60 + (am + 5) % 60);
        push(sameHour, ah * 60 + (am + 10) % 60);
      }

      push(pool, ((ah + 1) % 24) * 60 + am);
      push(pool, ((ah + 2) % 24) * 60 + am);
      push(pool, ((ah + 6) % 24) * 60 + am);
      push(pool, ((ah + 9) % 24) * 60 + am);

      while (pool.length < 4) push(pool, randomTime(1));

      return shuffle([ans, sameHour[0], sameHour[1], pool[0]]);
    }

    push(pool, ah * 60 + (am + 5) % 60);
    push(pool, ah * 60 + (am + 30) % 60);
    push(pool, ah * 60 + (am + 55) % 60);
    push(pool, ((ah + 1) % 24) * 60 + am);
    push(pool, ((ah + 2) % 24) * 60 + am);
    push(pool, ((ah + 3) % 24) * 60 + am);
    push(pool, ((ah + 6) % 24) * 60 + am);
    push(pool, ((ah + 9) % 24) * 60 + am);

    while (pool.length < 12) push(pool, randomTime(cfg.step));

    shuffle(pool);
    return shuffle([ans, pool[0], pool[1], pool[2]]);
  }

  function renderOptions(opts, level) {
    var box = $('options');
    box.innerHTML = '';

    opts.forEach(function (value) {
      var p = pairLabel(value);
      var b = document.createElement('button');

      b.className = level === 3 ? 'opt solo' : 'opt';
      b.dataset.t = value;
      b.innerHTML = level === 3
        ? '<span class="t24">' + p.h24 + '</span>'
        : '<span class="t12">' + p.h12 + '</span>' +
          '<span class="t24">' + p.h24 + '</span>';

      b.addEventListener('click', function () { pickOption(b, value); });
      box.appendChild(b);
    });

    syncCooldown();
  }

  /* --- Пауза между ответами --- */
  function coolingDown() {
    return Date.now() < cooldownUntil;
  }

  function syncCooldown() {
    var left = cooldownUntil - Date.now();
    var label = $('cooldown');
    var opts = document.querySelectorAll('#options .opt');

    if (left <= 0) {
      label.textContent = '';
      Array.prototype.forEach.call(opts, function (b) { b.disabled = false; });

      if (cooldownTimer) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
      }

      return;
    }

    label.textContent = 'Можно отвечать через ' + Math.ceil(left / 1000) + ' с';
    Array.prototype.forEach.call(opts, function (b) { b.disabled = true; });

    if (!cooldownTimer) cooldownTimer = setInterval(syncCooldown, 250);
  }

  function startCooldown() {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    syncCooldown();
  }

  function stopCooldown() {
    cooldownUntil = 0;

    if (cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }

    syncCooldown();
  }

  /* --- Оформление, зависящее от уровня --- */
  function syncLevelUi() {
    var cfg = LEVELS[state.level];
    var clock = $('clock');

    if (state.mode === 1 && cfg.minutes) {
      clock.classList.add('minutes-on');
    } else {
      clock.classList.remove('minutes-on');
    }

    var lvls = document.querySelectorAll('.lvl');

    Array.prototype.forEach.call(lvls, function (b) {
      var on = +b.dataset.level === state.level;

      if (on) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }

      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (cfg.penaltyEvery > 0) {
      $('mistakes').textContent = 'ошибки: ' + state.mistakes + ' из ' + cfg.penaltyEvery;
    } else {
      $('mistakes').textContent = '';
    }
  }

  function setLevel(level) {
    state.level = level;
    state.mistakes = 0;
    syncLevelUi();
    nextTask();
  }

  function pickOption(btn, value) {
    if (state.locked || coolingDown()) return;
    state.locked = true;
    startCooldown();

    var p = pairLabel(state.answer);
    var cfg = LEVELS[state.level];

    if (value === state.answer) {
      state.score++;
      if (state.mistakes > 0) state.mistakes--;
      updateScore();
      syncLevelUi();
      btn.classList.add('ok');
      showFeedback('Верно! ' + p.h12 + ' = ' + p.h24a + ' или ' + p.h24b, 'good');
      schedule(nextTask, 1100);
    } else {
      btn.classList.add('bad');

      var kids = $('options').children;
      for (var i = 0; i < kids.length; i++) {
        if (+kids[i].dataset.t === state.answer) kids[i].classList.add('ok');
      }

      var penalty = false;

      if (cfg.penaltyEvery > 0) {
        state.mistakes++;

        if (state.mistakes >= cfg.penaltyEvery) {
          state.mistakes = 0;

          if (state.score > 0) {
            state.score--;
            updateScore();
            penalty = true;
          }
        }

        syncLevelUi();
      }

      showFeedback(
        'Правильный ответ: ' + p.h12 + ' = ' + p.h24a + ' или ' + p.h24b +
        (penalty ? ' (−1 балл)' : ''),
        'bad'
      );
      schedule(nextTask, 2300);
    }
  }

  /* ---------- РЕЖИМ 2 ---------- */
  function checkTyped() {
    if (state.locked) return;

    var hv = $('hh').value.trim();
    var mv = $('mm').value.trim();

    if (hv === '' || mv === '') {
      showFeedback('Введи часы и минуты', 'bad');
      return;
    }

    var h = parseInt(hv, 10);
    var m = parseInt(mv, 10);

    if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      showFeedback('Часы 0-23, минуты 0-59', 'bad');
      return;
    }

    state.locked = true;

    // принимаем оба 24-часовых варианта, т.к. на 12-часовом циферблате они одинаковы
    var typed = h * 60 + m;
    var ok = (typed === state.answer) ||
             (visualKey(typed) === visualKey(state.answer));

    if (ok) {
      state.score++;
      updateScore();
      var p = pairLabel(state.answer);
      showFeedback('Правильно! ' + p.h12 + ' = ' + p.h24a + ' или ' + p.h24b, 'good');
      schedule(nextTask, 1200);
    } else {
      var p2 = pairLabel(state.answer);
      showFeedback('Пока нет. Правильно: ' + p2.h12 + ' = ' + p2.h24a + ' или ' + p2.h24b, 'bad');
      schedule(nextTask, 2400);
    }
  }

  /* ---------- РЕЖИМ 3 ---------- */
  function renderDigital() {
    $('digH').textContent = pad(dH);
    $('digM').textContent = pad(dM);

    setClock(dH * 60 + dM);

    if (!state.locked && dH * 60 + dM === state.answer) {
      state.locked = true;
      state.score++;
      updateScore();

      var p = pairLabel(state.answer);
      showFeedback('Отлично! ' + p.h12 + ' = ' + p.h24a + ' или ' + p.h24b, 'good');
      schedule(nextTask, 1600);
    }
  }

  /* ---------- Новое задание ---------- */
  function nextTask() {
    clearTimeout(timer);
    state.locked = false;
    hideFeedback();

    if (state.mode === 1) {
      state.answer = randomTime(LEVELS[state.level].step);
      setClock(state.answer);
      renderOptions(buildOptions(state.answer, state.level), state.level);
    } else if (state.mode === 2) {
      state.answer = randomTime(5);
      setClock(state.answer);
      $('hh').value = '';
      $('mm').value = '';
      if (window.matchMedia('(min-width: 700px)').matches) $('hh').focus();
    } else {
      state.answer = randomTime(5);
      $('target3').textContent = pairLabel(state.answer).h24;

      var start = randomTime(5);
      var guard = 0;
      while (visualKey(start) === visualKey(state.answer) && guard++ < 50) {
        start = randomTime();
      }

      dH = Math.floor(start / 60);
      dM = start % 60;
      renderDigital();
    }
  }

  /* ---------- Вкладки ---------- */
  var tabs = document.querySelectorAll('.tab');

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener('click', function () {
      Array.prototype.forEach.call(tabs, function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      state.mode = +tab.dataset.mode;

      var panels = document.querySelectorAll('.panel');
      Array.prototype.forEach.call(panels, function (p) { p.classList.remove('show'); });
      $('panel' + state.mode).classList.add('show');

      syncLevelUi();
      nextTask();
    });
  });

  /* ---------- Режим 2: ввод ---------- */
  $('check2').addEventListener('click', checkTyped);

  ['hh', 'mm'].forEach(function (id) {
    var inp = $(id);

    inp.addEventListener('input', function (e) {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 2);
      if (id === 'hh' && e.target.value.length === 2) $('mm').focus();
    });

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') checkTyped();
    });
  });

  /* ---------- Режим 3: кнопки ---------- */
    var actBtns = document.querySelectorAll('[data-act]');

  Array.prototype.forEach.call(actBtns, function (b) {
    b.addEventListener('click', function () {
      if (state.locked) return;

      var a = b.dataset.act;

      // работаем с общим количеством минут — так перенос в часы происходит сам
      var total = dH * 60 + dM;

      if (a === 'h+') total += 60;
      if (a === 'h-') total -= 60;
      if (a === 'm+') total += 5;
      if (a === 'm-') total -= 5;

      // нормализуем в диапазон 0..1439
      total = ((total % 1440) + 1440) % 1440;

      dH = Math.floor(total / 60);
      dM = total % 60;

      renderDigital();
    });
  });

  /* ---------- Уровни сложности ---------- */
  var lvlBtns = document.querySelectorAll('.lvl');

  Array.prototype.forEach.call(lvlBtns, function (b) {
    b.addEventListener('click', function () {
      var lv = +b.dataset.level;
      if (lv === state.level) return;
      setLevel(lv);
    });
  });

  $('reset').addEventListener('click', function () {
    state.score = 0;
    state.mistakes = 0;
    stopCooldown();
    updateScore();
    syncLevelUi();
    nextTask();
  });

  syncLevelUi();
  nextTask();
})();
