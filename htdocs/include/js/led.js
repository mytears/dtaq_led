(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const protocol = window.LedProtocol;
  const labels = { rolling: '홍보 미디어 롤링', welcome: '웰컴', 'employee-search': '직원 검색 대기', employee: '직원 정보', 'weapon-search': '주요 사업 검색 대기', weapon: '무기 / 사업 정보' };
  const fadeDuration = 250;
  let config = {};
  let screen = '', revision = 0, pendingScreen, fadeAnimation, careerFrame, noticeTimer, scheduleTimer;
  let currentGroup, fadingGroup;
  let playlist = [], mediaIndex = -1, failedGroups = new Set();
  let welcomeList = [], activeWelcome;
  const failedWelcome = new Set();
  const status = value => { if ($('debug-status')) $('debug-status').textContent = value; };
  const text = (id, value) => { const element = $(id); if (element) element.textContent = value == null || value === '' ? '—' : String(value); };
  function localAsset(value) {
    if (typeof value !== 'string' || value.includes('\\') || /[?#\x00-\x1f]/.test(value)) return '';
    const parts = value.split('/');
    return ['images', 'commonfiles'].includes(parts[0]) && parts.length > 1 && parts.every(p => p && p !== '..' && p !== '.') ? value : '';
  }
  async function json(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw Error(`${path} (${response.status})`);
    return response.json();
  }
  function report(error) {
    const message = error instanceof Error ? error.message : String(error);
    status(message);
    $('notice').textContent = message;
    $('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 7000);
    console.error('[DTaQ LED]', error);
  }
  function freezeMedia() {
    if (!currentGroup) return;
    fadingGroup = currentGroup;
    currentGroup = null;
    clearTimeout(fadingGroup.timer);
    fadingGroup.panes.forEach(pane => pane.freeze());
  }
  function stopMedia() {
    freezeMedia();
    if (!fadingGroup) return;
    fadingGroup.panes.forEach(pane => {
      pane.stop();
      pane.pane.remove();
    });
    fadingGroup = null;
  }
  function show(next) {
    screen = next;
    document.querySelectorAll('.screen').forEach(el => { el.hidden = el.id !== `screen-${next}`; });
    if ($('debug-panel')) $('debug-panel').dataset.screen = next;
    text('debug-screen', labels[next]);
    $('notice').hidden = true;
    clearTimeout(noticeTimer);
  }
  function fadeTo(opacity, duration = fadeDuration) {
    const overlay = $('screen-fade');
    if (overlay.style.opacity !== String(opacity)) {
      const from = Number(getComputedStyle(overlay).opacity);
      fadeAnimation?.cancel();
      overlay.style.opacity = opacity;
      fadeAnimation = from === opacity ? null : overlay.animate([{ opacity: from }, { opacity }], {
        duration, easing: 'ease-in-out'
      });
    }
    return fadeAnimation?.finished.catch(() => {});
  }
  async function transitionTo(next, prepare, fadeInDuration) {
    if (screen === next && !pendingScreen && !prepare) {
      show(next);
      return true;
    }
    const transition = { screen: next };
    pendingScreen = transition;
    // Keep the last canvas frame visible until the overlay covers it.
    freezeMedia();
    cancelAnimationFrame(careerFrame);
    await fadeTo(1);
    if (pendingScreen !== transition) return false;
    stopMedia();
    show(next);
    try {
      await prepare?.();
      return pendingScreen === transition;
    } finally {
      if (pendingScreen === transition) {
        pendingScreen = null;
        fadeTo(0, fadeInDuration);
      }
    }
  }
  function resize() {
    document.documentElement.style.setProperty('--stage-scale', Math.min(innerWidth / 3200, innerHeight / 1200));
  }
  function normalizeSchedule(entry, required = false) {
    if (!entry) return null;
    const isDay = value => typeof value === 'string' && /^\d{8}$/.test(value);
    const isTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?$/.test(value);
    const schedule = {};
    for (const [key, valid] of Object.entries({ sday: isDay, eday: isDay, stime: isTime, etime: isTime })) {
      const value = entry[key];
      if (!required && (value == null || value === '')) continue;
      if (!valid(value)) return null;
      schedule[key] = value.slice(0, key.endsWith('time') ? 4 : 8);
    }
    return schedule;
  }
  function scheduleTime() {
    const now = new Date();
    const twoDigits = value => String(value).padStart(2, '0');
    return {
      day: `${now.getFullYear()}${twoDigits(now.getMonth() + 1)}${twoDigits(now.getDate())}`,
      time: `${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}`
    };
  }
  function isScheduled({ sday, eday, stime, etime }, { day, time }) {
    return (!sday || sday <= day) && (!eday || day <= eday) &&
      (!stime || stime <= time) && (!etime || time <= etime);
  }
  function validDuration(seconds) {
    return Number.isFinite(seconds) && seconds > 0 && seconds * 1000 <= 2147483647;
  }
  function validMedia(item) {
    if (!item || !['MOV', 'IMG'].includes(item.type)) return false;
    const path = item.file_path;
    if (typeof path !== 'string' || !path.trim() || /[\\\x00-\x1f]/.test(path)) return false;
    try {
      const url = new URL(path, document.baseURI);
      return /^https?:$/.test(url.protocol) && url.origin === location.origin;
    } catch {
      return false;
    }
  }
  function normalizePlaylist(items) {
    const paneCounts = new Map([['1', 1], ['2A', 2], ['2B', 2], ['3', 3]]);
    const groups = [];
    for (const entry of Array.isArray(items) ? items : []) {
      const schedule = normalizeSchedule(entry);
      if (!schedule) continue;
      const layout = entry.layout ?? '1';
      const contents = entry.contents ?? [entry];
      const fullTime = entry.full_time ?? (entry.contents == null ? entry.ptime : undefined);
      if (Array.isArray(contents) && contents.length === paneCounts.get(layout) &&
          contents.every(item => validMedia(item) && validDuration(item.ptime)) &&
          validDuration(fullTime)) {
        groups.push({ layout, contents, fullTime, schedule });
      }
    }
    return groups;
  }
  function createMediaPane(item, { muted = true, onFailure } = {}) {
    const pane = document.createElement('div');
    pane.className = 'media-pane';
    pane.hidden = true;
    const isVideo = item.type === 'MOV';
    const element = document.createElement(isVideo ? 'video' : 'img');
    let loadTimer, repeatTimer, frame, frozen = false, stopped = false, drawFrame, resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const hasVideoFrameCallback = typeof element.requestVideoFrameCallback === 'function';
    function freeze() {
      if (frozen) return;
      frozen = true;
      clearTimeout(loadTimer);
      clearInterval(repeatTimer);
      element.onload = element.onloadeddata = element.onended = element.onerror = null;
      if (isVideo) {
        if (frame != null) {
          if (hasVideoFrameCallback) element.cancelVideoFrameCallback(frame);
          else cancelAnimationFrame(frame);
        }
        element.pause();
      }
    }
    function stop() {
      if (stopped) return;
      stopped = true;
      freeze();
      if (isVideo) {
        element.removeAttribute('src');
        element.load();
      }
      resolveReady();
    }
    function fail() {
      if (frozen) return;
      stop();
      if (!isVideo) pane.replaceChildren();
      onFailure?.(item);
    }
    function loaded() {
      clearTimeout(loadTimer);
      resolveReady();
    }
    pane.append(element);
    if (isVideo) {
      // WebView2 can initially paint its native video surface at the wrong zoom.
      // Draw decoded frames on a canvas sized to this pane.
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      element.setAttribute('aria-hidden', 'true');
      const context = canvas.getContext('2d', { alpha: false });
      drawFrame = () => {
        if (frozen) return;
        if (element.readyState >= 2 && element.videoWidth && element.videoHeight) {
          const bounds = canvas.getBoundingClientRect(), pixelScale = window.devicePixelRatio || 1;
          const width = Math.max(1, Math.round(bounds.width * pixelScale)), height = Math.max(1, Math.round(bounds.height * pixelScale));
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          context.drawImage(element, 0, 0, width, height);
        }
        frame = hasVideoFrameCallback
          ? element.requestVideoFrameCallback(drawFrame) : requestAnimationFrame(drawFrame);
      };
      pane.append(canvas);
      element.onloadeddata = loaded;
      element.muted = muted; element.playsInline = true; element.preload = 'auto';
    } else {
      element.alt = item.alt ?? '국방기술품질원 안내 이미지';
      element.onload = loaded;
    }
    element.onerror = fail;
    loadTimer = setTimeout(fail, isVideo ? 30000 : 15000);
    element.src = item.file_path;
    return {
      pane, ready, freeze, stop,
      start(deadline = Infinity) {
        pane.hidden = false;
        if (frozen || !isVideo) return;
        drawFrame();
        const restart = () => {
          // Keep the last frame if a repeat would be visible only briefly before the cut.
          if (frozen || performance.now() + fadeDuration >= deadline) return;
          element.currentTime = 0;
          if (element.paused) element.play().catch(fail);
        };
        element.onended = restart;
        element.play().catch(fail);
        const cycle = (item.ptime ?? 0) * 1000;
        if (cycle > 0 && performance.now() + cycle + fadeDuration < deadline) {
          repeatTimer = setInterval(restart, cycle);
        }
      }
    };
  }
  function nextMedia(now = scheduleTime()) {
    const empty = $('media-empty');
    let index = -1;
    for (let offset = 1; offset <= playlist.length; offset++) {
      const candidate = (mediaIndex + offset) % playlist.length;
      if (!failedGroups.has(candidate) && isScheduled(playlist[candidate].schedule, now)) {
        index = candidate;
        break;
      }
    }
    if (index === -1) {
      if (screen === 'rolling' && !pendingScreen && !currentGroup && !empty.hidden) return;
      return transitionTo('rolling', () => {
        status('현재 재생 가능한 홍보 미디어가 없습니다.');
        empty.hidden = false;
      });
    }
    mediaIndex = index;
    const entry = playlist[index];
    const duration = entry.fullTime * 1000;
    return transitionTo('rolling', async () => {
      empty.hidden = true;
      const player = $('media-player');
      const group = { entry, panes: [], timer: null };
      currentGroup = group;
      player.dataset.layout = entry.layout;
      let remaining = entry.contents.length;
      group.panes = entry.contents.map(item => createMediaPane(item, {
        muted: false,
        onFailure(failed) {
          status(`미디어를 건너뜁니다: ${failed.file_path}`);
          if (--remaining === 0) {
            failedGroups.add(index);
            nextMedia();
          }
        }
      }));
      player.append(...group.panes.map(pane => pane.pane));
      status(`롤링 ${index + 1}/${playlist.length} · ${entry.layout}분할`);
      await Promise.all(group.panes.map(pane => pane.ready));
      if (currentGroup !== group) return;
      if (!isScheduled(entry.schedule, scheduleTime())) {
        nextMedia();
        return;
      }
      const deadline = performance.now() + duration;
      group.timer = setTimeout(nextMedia, duration);
      group.panes.forEach(pane => pane.start(deadline));
    }, Math.min(fadeDuration, duration / 2));
  }
  function startRolling() {
    failedGroups = new Set();
    mediaIndex = -1;
    nextMedia();
  }
  function playWelcome(welcome) {
    return transitionTo('welcome', async () => {
      const foreground = createMediaPane(welcome.content, {
        onFailure() {
          failedWelcome.add(welcome);
          updateWelcome();
        }
      });
      const group = { panes: [foreground] };
      currentGroup = group;
      $('welcome-player').append(foreground.pane);
      if (welcome.background) {
        const background = createMediaPane(welcome.background);
        group.panes.push(background);
        $('welcome-background').append(background.pane);
      }
      status('웰컴 미디어 재생 · 롤링 중지');
      await Promise.all(group.panes.map(pane => pane.ready));
      if (currentGroup !== group) return;
      if (!isScheduled(welcome, scheduleTime())) {
        updateWelcome();
        return;
      }
      group.panes.forEach(pane => pane.start());
    });
  }
  function updateWelcome(now = scheduleTime()) {
    let nextWelcome;
    for (const entry of welcomeList) {
      if (!isScheduled(entry, now)) {
        failedWelcome.delete(entry);
      } else if (!failedWelcome.has(entry) && (!nextWelcome || entry.stime >= nextWelcome.stime)) {
        nextWelcome = entry;
      }
    }
    if (nextWelcome === activeWelcome &&
        (!nextWelcome || currentGroup || pendingScreen?.screen === 'welcome')) return Boolean(nextWelcome);
    activeWelcome = nextWelcome;
    if (!nextWelcome) {
      startRolling();
      return false;
    }
    if ((pendingScreen?.screen ?? screen) !== 'welcome') revision++;
    playWelcome(nextWelcome);
    return true;
  }
  function tickSchedule() {
    const now = scheduleTime();
    const isWelcomeActive = updateWelcome(now);
    if ((pendingScreen?.screen ?? screen) === 'rolling' &&
        (currentGroup ? !isScheduled(currentGroup.entry.schedule, now) : !pendingScreen)) nextMedia(now);
    scheduleTimer = setTimeout(tickSchedule, 1000 - Date.now() % 1000);
    return isWelcomeActive;
  }
  function setPhoto(id, path, fallback) {
    const image = $(id);
    image.onerror = () => { image.onerror = null; image.src = fallback; };
    image.src = localAsset(path) || fallback;
  }
  function renderEmployee(employee) {
    ['name', 'id', 'dept', 'pos', 'email', 'phone'].forEach(key => text('employee-' + key, employee[key]));
    text('employee-duties', employee.jobDesc || (Array.isArray(employee.duties) ? employee.duties[0] : employee.duties));
    setPhoto('employee-photo', employee.photo, 'images/img_photo.png');
    $('employee-photo').alt = `${employee.name || ''} 직원 사진`;
    const history = Array.isArray(employee.history) ? employee.history : [];
    $('employee-history').replaceChildren();
    for (const entry of history) {
      const row = document.createElement('li'); row.className = 'history-row';
      for (const key of ['date', 'dept', 'pos']) { const cell = document.createElement('span'); cell.textContent = entry?.[key] || '—'; row.append(cell); }
      $('employee-history').append(row);
    }
    if (!history.length) { const empty = document.createElement('li'); empty.className = 'history-empty'; empty.textContent = '등록된 근무이력이 없습니다.'; $('employee-history').append(empty); }
  }
  function scrollCareer() {
    const viewport = $('career-viewport'); viewport.scrollTop = 0;
    let previous = performance.now(), pauseUntil = previous + 2000, position = 0, atBottom = false;
    function tick(now) {
      if (screen !== 'employee') return;
      const delta = Math.min(now - previous, 100); previous = now;
      const max = viewport.scrollHeight - viewport.clientHeight;
      if (max > 0 && now >= pauseUntil) {
        if (atBottom) {
          position = 0; viewport.scrollTop = 0; atBottom = false; pauseUntil = now + 2000;
        } else {
          position = Math.min(max, position + delta * .018);
          viewport.scrollTop = position;
          if (position >= max) { atBottom = true; pauseUntil = now + 4000; }
        }
      }
      careerFrame = requestAnimationFrame(tick);
    }
    careerFrame = requestAnimationFrame(tick);
  }
  function renderWeapon(weapon, project = false) {
    text('weapon-name', weapon.name);
    const branches = { army: ['육군', 1], navy: ['해군', 3], air: ['공군', 2] };
    const branch = branches[weapon.branch];
    text('weapon-branch-name', project ? '사업' : (branch?.[0] || '기타'));
    $('weapon-branch-icon').hidden = project || !branch;
    if (branch) $('weapon-branch-icon').src = `images/ico_army_${branch[1]}.svg`;
    text('weapon-label-1', project ? '진행상태' : '개발형태'); text('weapon-label-2', project ? '담당부서' : '제조업체');
    text('weapon-development', project ? weapon.status : weapon.development);
    text('weapon-manufacturer', project ? weapon.dept : weapon.manufacturer);
    text('weapon-period', weapon.period);
    $('weapon-performance').replaceChildren();
    const performance = Array.isArray(weapon.performance) ? weapon.performance : [weapon.performance || (project ? weapon.desc : '자료 준비중')];
    performance.forEach(value => { const line = document.createElement('div'); line.textContent = value; $('weapon-performance').append(line); });
    text('weapon-description', weapon.description || weapon.desc || '자료 준비중');
    const path = typeof weapon.image === 'string' ? weapon.image.trim() : '';
    $('weapon-image').hidden = !path; $('weapon-image-empty').hidden = !!path;
    $('weapon-image').onerror = () => { $('weapon-image').hidden = true; $('weapon-image-empty').hidden = false; };
    if (path) { $('weapon-image').src = path; $('weapon-image').alt = weapon.name || '무기체계 이미지'; }
  }
  async function SetRevMsg(message) {
    const command = protocol.normalize(message);
    if (!command) { console.log('[DTaQ LED] 지원하지 않는 LED 신호:', message); return false; }
    const token = ++revision;
    await ready;
    if (token !== revision || updateWelcome()) return false;
    const { type, id } = command;
    const search = type === 'employee' ? 'employee-search' : 'weapon-search';
    try {
      text('debug-connection', message);
      if (type === 'rolling') {
        if ((pendingScreen?.screen ?? screen) !== 'rolling') startRolling();
      } else if (!id) {
        if (!await transitionTo(search) || token !== revision) return false;
        status('dtaq에서 검색한 정보를 LED로 전송해주세요.');
      } else {
        if (type === 'project') transitionTo(search);
        status(`${id} 정보를 불러오고 있습니다.`);
        const data = type === 'project' ? await json('data/projects.json') : config;
        if (token !== revision || updateWelcome()) return false;
        const items = type === 'project'
          ? (Array.isArray(data) ? data : data?.weapons)
          : data?.[type === 'employee' ? 'employees_list' : 'weapons_list'];
        if (!Array.isArray(items)) throw Error('JSON 데이터 형식이 올바르지 않습니다.');
        const item = items.find(entry => entry?.id != null && String(entry.id) === id);
        if (!item) throw Error(`${type === 'employee' ? '직원' : '무기 / 사업'} ID “${id}”를 찾을 수 없습니다.`);
        const completed = type === 'employee'
          ? await transitionTo('employee', () => { renderEmployee(item); scrollCareer(); })
          : await transitionTo('weapon', () => renderWeapon(item, type === 'project'));
        if (!completed || token !== revision) return false;
        status(`${item.name} · ${id}`);
      }
      return true;
    } catch (error) {
      if (token === revision) {
        await transitionTo(search);
        if (token === revision) report(error);
      }
      return false;
    }
  }
  function initDebug() {
    if (!$('debug-panel')) return;
    $('employee-form').addEventListener('submit', event => { event.preventDefault(); window.SetRevMsg('MSG|EMP|' + $('debug-employee').value.trim()); });
    $('weapon-form').addEventListener('submit', event => { event.preventDefault(); window.SetRevMsg('MSG|WEP|' + $('debug-weapon').value.trim()); });
    $('debug-rolling').addEventListener('click', () => window.SetRevMsg('MSG|ROLLING'));
    $('debug-collapse').addEventListener('click', () => { const collapsed = !$('debug-body').hidden; $('debug-body').hidden = collapsed; $('debug-collapse').textContent = collapsed ? '펼치기' : '접기'; $('debug-collapse').setAttribute('aria-expanded', String(!collapsed)); });
    $('debug-fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (error) { report(error); } });
    $('debug-panel').hidden = new URLSearchParams(location.search).get('debug') === '0';
    document.addEventListener('keydown', event => { if (event.key.toLowerCase() === 'd' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.target.closest('input,textarea,select,[contenteditable]')) $('debug-panel').hidden = !$('debug-panel').hidden; });
  }
  async function boot() {
    try { config = (await json('data/kiosk_contents.json')) || {}; }
    catch (error) { report(Error('data/kiosk_contents.json을 읽을 수 없습니다. HTTP 서버로 실행하고 JSON 문법을 확인해주세요.')); }
    const entries = config.welcome?.welcome_list;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const schedule = normalizeSchedule(entry, true);
      if (!schedule) continue;
      const content = { type: entry.type, file_path: entry.file_path, alt: entry.alt };
      const background = { type: entry.bg_type ?? 'IMG', file_path: entry.bg_path ?? entry.background, alt: '' };
      if (validMedia(content)) {
        welcomeList.push({ ...schedule, content, background: validMedia(background) ? background : null });
      }
    }
    playlist = normalizePlaylist(config.notice?.notice_list);
    if (!tickSchedule() && !revision) startRolling();
    for (const [listId, items] of [['employee-ids', config.employees_list], ['weapon-ids', config.weapons_list]]) {
      if (!Array.isArray(items)) continue;
      const list = $(listId);
      for (const item of items) {
        if (item?.id == null) continue;
        const option = document.createElement('option');
        option.value = item.id;
        option.label = `${item.name} · ${item.dept || ''}`;
        list.append(option);
      }
    }
  }
  window.SetRevMsg = SetRevMsg;
  resize(); window.addEventListener('resize', resize); initDebug();
  const ready = boot();
  window.DTAQ_LED = Object.freeze({ ready, getState: () => ({ screen, mediaIndex, mediaCount: playlist.length }) });
  if (window.chrome?.webview) window.chrome.webview.addEventListener('message', event => window.SetRevMsg(event.data));
  window.addEventListener('pagehide', () => {
    clearTimeout(scheduleTimer);
    pendingScreen = null;
    fadeAnimation?.cancel();
    fadeAnimation = null;
    $('screen-fade').style.opacity = 0;
    stopMedia();
    cancelAnimationFrame(careerFrame);
  });
  window.addEventListener('pageshow', event => { if (event.persisted) tickSchedule(); });
  ready.then(() => {
    const params = new URLSearchParams(location.search), type = params.get('screen');
    const action = { rolling: 'ROLLING', employee: 'EMP', weapon: 'WEP', project: 'WEP' }[type];
    if (action && !revision) window.SetRevMsg('MSG|' + action + (['EMP', 'WEP'].includes(action) ? '|' + (params.get('id') || '') : ''));
  });
})();
