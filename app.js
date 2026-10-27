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
  var clockEl = $('clock');

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

  var state = { mode: 1, level: 1, answer: 0, score: 0, mistakes: 0, locked: false, heartsDown: false };
  var dH = 0;
  var dM = 0;
  var dragHand = null;
  var dragPointer = null;
  var dragStartHour = 0;
  var dragTurn = 0;
  var dragPrev = 0;

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

  function awardPoint() {
    state.score++;
    state.mistakes = 0;
    state.heartsDown = false;
    updateScore();
    syncLevelUi();
  }

  function registerMistake() {
    var cfg = LEVELS[state.level];

    if (cfg.penaltyEvery <= 0) return false;

    state.mistakes++;

    if (state.mistakes < cfg.penaltyEvery) {
      syncLevelUi();
      return false;
    }

    var penalty = false;

    if (state.score > 0) {
      state.score--;
      updateScore();
      penalty = true;
    }

    state.heartsDown = true;
    syncLevelUi();
    return penalty;
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

  function showNext() {
    $('next').hidden = false;
  }

  function hideNext() {
    $('next').hidden = true;
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

    // 24ч чтение, которое всегда отличается от 12ч: для часов 1-12 берём двойник
    var alt = (h24 >= 1 && h24 <= 12) ? (h24 + 12) % 24 : h24;

    return {
      h12: h12 + ':' + pad(m),
      h24: pad(h24) + ':' + pad(m),   // тот, что реально загадан
      h24alt: pad(alt) + ':' + pad(m), // альтернативное 24ч чтение для вариантов
      h24a: pad(a) + ':' + pad(m),    // меньший 24ч
      h24b: pad(b) + ':' + pad(m)     // больший 24ч
    };
  }

  /* --- Ключ положения стрелок (0..719 мин), чтобы не было визуально одинаковых вариантов --- */
  function visualKey(t) {
    return ((t % 720) + 720) % 720;
  }

  function dualLabel(t) {
    var p = pairLabel(t);
    return p.h24a + ' / ' + p.h24b;
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
          '<span class="t24">' + p.h24alt + '</span>';

      b.addEventListener('click', function () { pickOption(b, value); });
      box.appendChild(b);
    });
  }

  /* --- Элементы ответа до «Дальше» --- */
  function setAnswerControls(enabled) {
    var opts = document.querySelectorAll('#options .opt');
    Array.prototype.forEach.call(opts, function (b) { b.disabled = !enabled; });
    $('check2').disabled = !enabled;

    var actBtns = document.querySelectorAll('[data-act]');
    Array.prototype.forEach.call(actBtns, function (b) { b.disabled = !enabled; });
  }

  /* --- Сердца-жизни на уровнях 2-3 --- */
  function playHeartAnim(heart, cls) {
    heart.classList.remove(cls);
    void heart.offsetWidth;
    heart.classList.add(cls);

    heart.addEventListener('animationend', function onEnd() {
      heart.classList.remove(cls);
      heart.removeEventListener('animationend', onEnd);
    });
  }

  function syncHearts(el, total) {
    if (!el) return;

    if (total <= 0) {
      el.textContent = '';
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
      el.dataset.hearts = '0';
      return;
    }

    var filled = total - state.mistakes;
    if (filled < 0) filled = 0;

    if (el.dataset.hearts !== String(total)) {
      el.dataset.hearts = String(total);
      el.className = 'hearts';
      el.setAttribute('role', 'img');
      el.innerHTML = '';

      for (var i = 0; i < total; i++) {
        var heart = document.createElement('span');
        var lost = i >= filled;

        heart.className = lost ? 'heart lost' : 'heart';
        heart.dataset.lost = lost ? '1' : '0';
        heart.setAttribute('aria-hidden', 'true');
        heart.textContent = '♥';
        el.appendChild(heart);
      }
    }

    var hearts = el.children;

    for (var j = 0; j < hearts.length; j++) {
      var h = hearts[j];
      var shouldLost = j >= filled;
      var wasLost = h.dataset.lost === '1';

      if (shouldLost && !wasLost) {
        h.classList.add('lost');
        playHeartAnim(h, 'burn');
      } else if (!shouldLost && wasLost) {
        h.classList.remove('lost');
        playHeartAnim(h, 'return');
      }

      h.dataset.lost = shouldLost ? '1' : '0';
    }

    el.setAttribute('aria-label', 'жизни: ' + filled + ' из ' + total);
  }

  /* --- Оформление, зависящее от уровня --- */
  function syncLevelUi() {
    var cfg = LEVELS[state.level];
    var clock = $('clock');

    if ((state.mode === 1 || state.mode === 2) && cfg.minutes) {
      clock.classList.add('minutes-on');
    } else {
      clock.classList.remove('minutes-on');
    }

    if (state.mode === 3) {
      clock.classList.add('drag-on');
    } else {
      clock.classList.remove('drag-on');
    }

    var panel3 = $('panel3');

    if (state.mode === 3 && state.level > 1) {
      panel3.classList.add('readout-off');
    } else {
      panel3.classList.remove('readout-off');
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

    syncHearts($('mistakes'), cfg.penaltyEvery);
    syncHearts($('mistakes2'), cfg.penaltyEvery);
  }

  function setLevel(level) {
    state.level = level;
    state.mistakes = 0;
    state.heartsDown = false;
    syncLevelUi();
    nextTask();
  }

  function pickOption(btn, value) {
    if (state.locked) return;
    state.locked = true;

    var p = pairLabel(state.answer);

    if (value === state.answer) {
      awardPoint();
      btn.classList.add('ok');
      showFeedback('Верно! ' + p.h12 + ' = ' + p.h24a + ' или ' + p.h24b, 'good');
    } else {
      btn.classList.add('bad');

      var kids = $('options').children;
      for (var i = 0; i < kids.length; i++) {
        if (+kids[i].dataset.t === state.answer) kids[i].classList.add('ok');
      }

      var penalty = registerMistake();

      showFeedback(
        'Правильный ответ: ' + p.h12 + ' = ' + p.h24a + ' или ' + p.h24b +
        (penalty ? ' (−1 балл)' : ''),
        'bad'
      );
    }

    showNext();
    setAnswerControls(false);
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
      awardPoint();
      var p = pairLabel(state.answer);
      showFeedback('Правильно! ' + p.h12 + ' = ' + p.h24a + ' или ' + p.h24b, 'good');
    } else {
      var penalty = registerMistake();
      var p2 = pairLabel(state.answer);
      showFeedback(
        'Пока нет. Правильно: ' + p2.h12 + ' = ' + p2.h24a + ' или ' + p2.h24b +
        (penalty ? ' (−1 балл)' : ''),
        'bad'
      );
    }

    showNext();
    setAnswerControls(false);
  }

  /* ---------- РЕЖИМ 3 ---------- */
  function renderDigital() {
    var p = pairLabel(dH * 60 + dM);
    var a = p.h24a.split(':');
    var b = p.h24b.split(':');
    $('digH').textContent = a[0];
    $('digM').textContent = a[1];
    $('digH2').textContent = b[0];
    $('digM2').textContent = b[1];

    setClock(dH * 60 + dM);

    if (!state.locked && visualKey(dH * 60 + dM) === visualKey(state.answer)) {
      state.locked = true;
      state.score++;
      updateScore();

      showFeedback('Отлично! ' + p.h12 + ' = ' + p.h24a + ' или ' + p.h24b, 'good');
      showNext();
      setAnswerControls(false);
    }
  }

  /* ---------- РЕЖИМ 3: перетаскивание стрелок ---------- */
  var HAND_HIT_ANGLE = 18;
  var CENTER_DEAD_ZONE = 18;
  var OVERLAP_SPLIT_RADIUS = 45;

  function pointerAngle(e) {
    var rect = clockEl.getBoundingClientRect();

    if (!rect.width || !rect.height) return null;

    var x = (e.clientX - rect.left) * 200 / rect.width;
    var y = (e.clientY - rect.top) * 200 / rect.height;
    var dx = x - 100;
    var dy = y - 100;
    var angle = Math.atan2(dx, -dy) * 180 / Math.PI;

    if (angle < 0) angle += 360;

    return { angle: angle, r: Math.sqrt(dx * dx + dy * dy) };
  }

  function pickHand(angle, r) {
    var minuteAngle = (dM * 6) % 360;
    var hourAngle = ((dH % 12 + dM / 60) * 30) % 360;
    var dm = Math.abs(shortestDelta(minuteAngle, angle));
    var dh = Math.abs(shortestDelta(hourAngle, angle));

    if (r < CENTER_DEAD_ZONE || Math.min(dm, dh) > HAND_HIT_ANGLE) return null;

    if (Math.abs(dm - dh) < 1) return r > OVERLAP_SPLIT_RADIUS ? 'minute' : 'hour';

    return dm < dh ? 'minute' : 'hour';
  }

  function applyDrag(angle) {
    if (dragHand === 'minute') {
      var total = dragTurn / 6;
      var snapped = Math.round(total / 5) * 5;
      dM = ((snapped % 60) + 60) % 60;
      dH = ((dragStartHour + Math.floor(snapped / 60)) % 24 + 24) % 24;
    } else {
      var h12 = Math.floor(angle / 30) % 12;
      dH = dH >= 12 ? (h12 + 12) % 24 : h12;
    }

    renderDigital();
  }

  function endDrag(e) {
    if (dragHand === null) return;

    if (e && dragPointer !== null && e.pointerId !== dragPointer) return;

    if (e && clockEl.hasPointerCapture && clockEl.hasPointerCapture(e.pointerId)) {
      try { clockEl.releasePointerCapture(e.pointerId); } catch (err) {}
    }

    dragHand = null;
    dragPointer = null;
    clockEl.classList.remove('dragging');
  }

  function onPointerDown(e) {
    if (state.mode !== 3 || state.locked || dragHand !== null) return;

    var p = pointerAngle(e);
    if (!p) return;

    var hand = pickHand(p.angle, p.r);
    if (!hand) return;

    e.preventDefault();

    dragHand = hand;
    dragPointer = e.pointerId;
    dragStartHour = dH;
    dragTurn = p.angle;
    dragPrev = p.angle;
    clockEl.classList.add('dragging');

    if (clockEl.setPointerCapture) {
      try { clockEl.setPointerCapture(e.pointerId); } catch (err) {}
    }

    applyDrag(p.angle);

    if (state.locked) endDrag(e);
  }

  function onPointerMove(e) {
    if (dragHand === null || e.pointerId !== dragPointer) return;

    if (state.locked) {
      endDrag(e);
      return;
    }

    var p = pointerAngle(e);
    if (!p) return;

    e.preventDefault();

    if (dragHand === 'minute') {
      dragTurn += shortestDelta(dragPrev, p.angle);
      dragPrev = p.angle;
    }

    applyDrag(p.angle);

    if (state.locked) endDrag(e);
  }

  /* ---------- Новое задание ---------- */
  function nextTask() {
    endDrag();

    if (state.heartsDown) {
      state.heartsDown = false;
      state.mistakes = 0;
      syncLevelUi();
    }

    state.locked = false;
    hideFeedback();
    hideNext();
    setAnswerControls(true);

    if (state.mode === 1) {
      state.answer = randomTime(LEVELS[state.level].step);
      setClock(state.answer);
      renderOptions(buildOptions(state.answer, state.level), state.level);
    } else if (state.mode === 2) {
      state.answer = randomTime(LEVELS[state.level].step);
      setClock(state.answer);
      $('hh').value = '';
      $('mm').value = '';
      if (window.matchMedia('(min-width: 700px)').matches) $('hh').focus();
    } else {
      state.answer = randomTime(5);
      $('target3').textContent = dualLabel(state.answer);

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
      // повторный клик по активной вкладке не должен выдавать новое задание
      if (+tab.dataset.mode === state.mode) return;

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

  $('next').addEventListener('click', function () {
    if (!state.locked) return;
    nextTask();
  });

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

  /* ---------- Режим 3: перетаскивание стрелок ---------- */
  clockEl.addEventListener('pointerdown', onPointerDown);
  clockEl.addEventListener('pointermove', onPointerMove);
  clockEl.addEventListener('pointerup', endDrag);
  clockEl.addEventListener('pointercancel', endDrag);

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
    state.heartsDown = false;
    updateScore();
    syncLevelUi();
    nextTask();
  });

  /* ---------- Помощь ---------- */
  var helpBtn = $('helpOpen');
  var helpOverlay = $('helpOverlay');
  var helpBackground = [
    document.querySelector('header'),
    document.querySelector('.tabs'),
    document.querySelector('.card')
  ];
  var helpTimer = null;
  var helpEndHandler = null;

  function setHelpBackgroundInert(on) {
    helpBackground.forEach(function (el) {
      if (!el) return;

      if (on) {
        el.setAttribute('inert', '');
      } else {
        el.removeAttribute('inert');
      }
    });
  }

  function resetHelp() {
    if (helpTimer !== null) {
      clearTimeout(helpTimer);
      helpTimer = null;
    }

    if (helpEndHandler) {
      helpOverlay.removeEventListener('animationend', helpEndHandler);
      helpEndHandler = null;
    }

    helpOverlay.classList.remove('open', 'closing');
    document.body.classList.remove('help-open');
    helpBtn.setAttribute('aria-expanded', 'false');
    setHelpBackgroundInert(false);
  }

  function openHelp() {
    if (helpOverlay.classList.contains('open') &&
        !helpOverlay.classList.contains('closing')) return;

    resetHelp();
    helpOverlay.classList.add('open');
    document.body.classList.add('help-open');
    helpBtn.setAttribute('aria-expanded', 'true');
    setHelpBackgroundInert(true);
    helpOverlay.focus();
  }

  function closeHelp() {
    if (!helpOverlay.classList.contains('open') ||
        helpOverlay.classList.contains('closing')) return;

    helpOverlay.classList.add('closing');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resetHelp();
      helpBtn.focus();
      return;
    }

    // слой прячем после анимации; таймер страхует, если animationend не придёт
    var finish = function () {
      resetHelp();
      helpBtn.focus();
    };

    helpEndHandler = function (e) {
      if (e.target === helpOverlay && e.animationName === 'help-out') finish();
    };

    helpOverlay.addEventListener('animationend', helpEndHandler);
    helpTimer = setTimeout(finish, 260);
  }

  helpBtn.addEventListener('click', openHelp);
  helpOverlay.addEventListener('click', closeHelp);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && helpOverlay.classList.contains('open')) closeHelp();
  });

  syncLevelUi();
  nextTask();
})();
