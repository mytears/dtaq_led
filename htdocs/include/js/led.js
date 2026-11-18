(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const protocol = window.LedProtocol;
  const labels = { rolling: '홍보 미디어 롤링', welcome: '웰컴', 'employee-search': '직원 검색 대기', employee: '직원 정보', 'weapon-search': '주요 사업 검색 대기', weapon: '무기 / 사업 정보' };
  const fadeDuration = 250;
  const welcomePreparationMs = 250;
  let config = {};
  let screen = '', revision = 0, activeLayer, finishFade, careerFrame, scheduleTimer;
  let currentGroup, pendingGroup, resumeMedia;
  let playlist = [], mediaIndex = -1, failedGroups = new Set();
  let welcomeList = [], activeWelcome;
  const status = value => { if ($('debug-status')) $('debug-status').textContent = value; };
  const displayValue = value => value == null || /^[\s—–-]*$/.test(value) ? '' : String(value);
  const text = (id, value) => { const element = $(id); if (element) element.textContent = displayValue(value); };
  function photoUrl(path) {
    if (typeof path !== 'string' || !path.trim()) return '';
    try {
      const url = new URL(path.trim(), document.baseURI);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }
  async function json(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw Error(`${path} (${response.status})`);
    return response.json();
  }
  function report(error) {
    const message = error instanceof Error ? error.message : String(error);
    status(message);
    console.error('[DTaQ LED]', error);
  }
  function freezeGroup(group) {
    if (!group) return;
    clearTimeout(group.timer);
    group.panes.forEach(pane => pane.freeze());
  }
  function discardGroup(group) {
    if (!group) return;
    freezeGroup(group);
    group.panes.forEach(pane => pane.stop());
    group.layer.remove();
  }
  function cancelMediaPreparation() {
    const group = pendingGroup;
    pendingGroup = null;
    discardGroup(group);
  }
  function show(next, layer, group, duration = fadeDuration) {
    if (layer === activeLayer) return;
    finishFade?.();
    const previous = activeLayer;
    const previousGroup = currentGroup;
    freezeGroup(previousGroup);
    cancelAnimationFrame(careerFrame);
    activeLayer = layer;
    currentGroup = group;
    screen = next;
    layer.classList.add('is-active');
    layer.hidden = false;
    layer.inert = false;
    if ($('debug-panel')) $('debug-panel').dataset.screen = next;
    text('debug-screen', labels[next]);
    group?.start();
    if (!previous) return;
    // Keep the frozen outgoing frame behind the incoming screen until the fade ends.
    previous.classList.remove('is-active');
    previous.inert = true;
    const animation = layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-in-out' });
    finishFade = animation.onfinish = () => {
      finishFade = null;
      animation.onfinish = null;
      animation.cancel();
      if (previousGroup) discardGroup(previousGroup);
      else previous.hidden = true;
    };
  }
  function showStaticScreen(next, render) {
    cancelMediaPreparation();
    if (next !== 'rolling') activeWelcome = undefined;
    render?.();
    show(next, $(`screen-${next}`));
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
      let value = typeof entry[key] === 'string' ? entry[key].trim() : entry[key];
      if (!required && (value == null || value === '')) continue;
      if (Number.isInteger(value) && value >= 0) {
        const digits = String(value);
        value = valid === isTime ? digits.padStart(value < 10000 ? 4 : 6, '0') : digits;
      }
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
      // Comparing whole minutes includes every second of etime.
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
    let loadTimer, repeatTimer, frame, frozen = false, stopped = false, hasLoaded = false, drawFrame, resolveReady;
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
        element.muted = true;
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
      hasLoaded = true;
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
    function play() {
      element.play().catch(error => {
        if (frozen) return;
        if (error.name === 'NotAllowedError' && !element.muted) {
          element.muted = true;
          element.play().catch(fail);
        } else {
          fail();
        }
      });
    }
    function start(deadline = Infinity) {
      if (frozen) return;
      if (!hasLoaded) {
        ready.then(() => start(deadline));
        return;
      }
      pane.hidden = false;
      if (!isVideo) return;
      drawFrame();
      const restart = () => {
        // Keep the last frame if a repeat would be visible only briefly before the cut.
        if (frozen || performance.now() + fadeDuration >= deadline) return;
        element.currentTime = 0;
        if (element.paused) play();
      };
      element.onended = restart;
      play();
      const cycle = (item.ptime ?? 0) * 1000;
      if (cycle > 0 && performance.now() + cycle + fadeDuration < deadline) {
        repeatTimer = setInterval(restart, cycle);
      }
    }
    return { pane, ready, freeze, stop, start };
  }
  function createMediaGroup(screen, entry) {
    const layer = $(`${screen}-template`).content.firstElementChild.cloneNode(true);
    return { screen, entry, layer, panes: [] };
  }
  async function prepareMedia(group, duration) {
    cancelMediaPreparation();
    freezeGroup(currentGroup);
    pendingGroup = group;
    group.layer.hidden = true;
    $('led-stage').append(group.layer);
    const ready = Promise.all(group.panes.map(pane => pane.ready));
    if (group.screen === 'welcome') {
      let preparationTimer;
      const limit = new Promise(resolve => { preparationTimer = setTimeout(resolve, welcomePreparationMs); });
      await Promise.race([ready, limit]);
      clearTimeout(preparationTimer);
    } else {
      await ready;
    }
    if (pendingGroup !== group) return;

    syncStandby();
    if (pendingGroup !== group) return;
    pendingGroup = null;
    show(group.screen, group.layer, group, duration);
  }
  function nextMedia(now = scheduleTime()) {
    let index = -1;
    for (let offset = 1; offset <= playlist.length; offset++) {
      const candidate = (mediaIndex + offset) % playlist.length;
      if (!failedGroups.has(candidate) && isScheduled(playlist[candidate].schedule, now)) {
        index = candidate;
        break;
      }
    }
    if (index === -1) {
      if (screen === 'rolling' && !pendingGroup && !currentGroup) return;
      showStaticScreen('rolling');
      status('현재 재생 가능한 홍보 미디어가 없습니다.');
      return;
    }
    mediaIndex = index;
    const entry = playlist[index];
    const duration = entry.fullTime * 1000;
    const group = createMediaGroup('rolling', entry);
    const player = group.layer.querySelector('.media-player');
    player.dataset.layout = entry.layout;
    let remaining = entry.contents.length;
    group.panes = entry.contents.map(item => createMediaPane(item, {
      muted: entry.layout !== '1',
      onFailure(failed) {
        status(`미디어를 건너뜁니다: ${failed.file_path}`);
        if (--remaining === 0) {
          failedGroups.add(index);
          const welcomeActive = updateWelcome();
          if (!welcomeActive && (pendingGroup ?? currentGroup) === group) nextMedia();
        }
      }
    }));
    player.append(...group.panes.map(pane => pane.pane));
    group.start = () => {
      status(`롤링 ${index + 1}/${playlist.length} · ${entry.layout}분할`);
      const deadline = performance.now() + duration;
      group.timer = setTimeout(() => {
        if (!updateWelcome() && !pendingGroup && currentGroup === group) nextMedia();
      }, duration);
      group.panes.forEach(pane => pane.start(deadline));
    };
    return prepareMedia(group, Math.min(fadeDuration, duration / 2));
  }
  function startRolling(now) {
    failedGroups = new Set();
    mediaIndex = -1;
    nextMedia(now);
  }
  function playWelcome(welcome) {
    const group = createMediaGroup('welcome', welcome);
    for (const [item, selector] of [[welcome.background, '.welcome-background'], [welcome.content, '.welcome-player']]) {
      if (!item) continue;
      const media = createMediaPane(item, {
        onFailure() {
          media.pane.hidden = true;
          console.warn('[DTaQ LED] 웰컴 미디어를 불러오지 못했습니다.', item.file_path);
        }
      });
      group.panes.push(media);
      group.layer.querySelector(selector).append(media.pane);
    }
    group.start = () => {
      status('웰컴 미디어 재생 · 롤링 중지');
      group.panes.forEach(pane => pane.start());
    };
    return prepareMedia(group);
  }
  function updateWelcome(now = scheduleTime()) {
    let nextWelcome;
    for (const entry of welcomeList) {
      if (isScheduled(entry, now) && (!nextWelcome || entry.stime >= nextWelcome.stime)) {
        nextWelcome = entry;
      }
    }
    if (nextWelcome !== activeWelcome) {
      activeWelcome = nextWelcome;
      if (nextWelcome) playWelcome(nextWelcome);
    }
    return Boolean(nextWelcome);
  }
  function syncStandby(now = scheduleTime()) {
    if (updateWelcome(now)) return;
    if ((pendingGroup?.screen ?? screen) !== 'rolling') {
      startRolling(now);
      return;
    }
    const group = pendingGroup ?? currentGroup;
    if (!group || !isScheduled(group.entry.schedule, now)) nextMedia(now);
  }
  function tickSchedule() {
    const next = pendingGroup?.screen ?? screen;
    if (next === 'rolling' || next === 'welcome') syncStandby();
    scheduleTimer = setTimeout(tickSchedule, 1000 - Date.now() % 1000);
  }
  function setDetailImage(image, src, alt) {
    image.alt = alt;
    if (src && !image.hidden && image.getAttribute('src') === src) return;
    image.hidden = true;
    if (!src) {
      image.onload = null;
      image.removeAttribute('src');
      return;
    }
    image.onload = () => { image.hidden = false; };
    image.onerror = () => { image.hidden = true; };
    image.src = src;
  }
  function renderEmployee(employee) {
    for (const key of ['name', 'id', 'dept', 'pos', 'email', 'phone']) {
      text(`employee-${key}`, employee[key]);
    }
    const duties = Array.isArray(employee.duties) ? employee.duties[0] : employee.duties;
    $('employee-duties').textContent = displayValue(employee.jobDesc) || displayValue(duties);
    setDetailImage($('employee-photo'), photoUrl(employee.photo), `${employee.name || ''} 직원 사진`);
    const history = Array.isArray(employee.history) ? employee.history : [];
    $('employee-history').replaceChildren();
    for (const entry of history) {
      const row = document.createElement('li'); row.className = 'history-row';
      for (const key of ['date', 'dept', 'pos']) {
        const cell = document.createElement('span');
        cell.textContent = displayValue(entry?.[key]);
        row.append(cell);
      }
      $('employee-history').append(row);
    }
  }
  function scrollCareer() {
    cancelAnimationFrame(careerFrame);
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
    const branch = Object.hasOwn(branches, weapon.branch) ? branches[weapon.branch] : undefined;
    const branchName = project ? '사업' : (branch?.[0] ?? displayValue(weapon.branch));
    $('weapon-branch').hidden = !branchName;
    text('weapon-branch-name', branchName);
    $('weapon-branch-icon').hidden = project || !branch;
    if (branch) $('weapon-branch-icon').src = `images/ico_army_${branch[1]}.svg`;
    text('weapon-label-1', project ? '진행상태' : '개발형태'); text('weapon-label-2', project ? '담당부서' : '제조업체');
    text('weapon-development', project ? weapon.status : weapon.development);
    text('weapon-manufacturer', project ? weapon.dept : weapon.manufacturer);
    text('weapon-period', weapon.period);
    $('weapon-performance').replaceChildren();
    const performance = Array.isArray(weapon.performance) ? weapon.performance : [weapon.performance];
    for (const value of performance.map(displayValue).filter(Boolean)) {
      const line = document.createElement('div');
      line.textContent = value;
      $('weapon-performance').append(line);
    }
    text('weapon-description', displayValue(weapon.description) || displayValue(weapon.desc));
    const path = typeof weapon.image === 'string' ? weapon.image.trim() : '';
    setDetailImage($('weapon-image'), path, weapon.name || '무기체계 이미지');
  }
  async function SetRevMsg(message) {
    const command = protocol.normalize(message);
    if (!command) { console.log('[DTaQ LED] 지원하지 않는 LED 신호:', message); return false; }
    const token = ++revision;
    await ready;
    if (token !== revision) return false;
    const { type, id } = command;
    const search = type === 'employee' ? 'employee-search' : 'weapon-search';
    try {
      text('debug-connection', message);
      if (type === 'rolling') {
        syncStandby();
      } else if (!id) {
        showStaticScreen(search);
        status('dtaq에서 검색한 정보를 LED로 전송해주세요.');
      } else {
        if (type === 'project') showStaticScreen(search);
        status(`${id} 정보를 불러오고 있습니다.`);
        const data = type === 'project' ? await json('data/projects.json') : config;
        if (token !== revision) return false;
        const items = type === 'project'
          ? (Array.isArray(data) ? data : data?.weapons)
          : data?.[type === 'employee' ? 'employees_list' : 'weapons_list'];
        if (!Array.isArray(items)) throw Error('JSON 데이터 형식이 올바르지 않습니다.');
        const item = items.find(entry => entry?.id != null && String(entry.id) === id);
        if (!item) throw Error(`${type === 'employee' ? '직원' : '무기 / 사업'} ID “${id}”를 찾을 수 없습니다.`);
        if (type === 'employee') {
          showStaticScreen('employee', () => renderEmployee(item));
          scrollCareer();
        } else {
          showStaticScreen('weapon', () => renderWeapon(item, type === 'project'));
        }
        status(`${item.name} · ${id}`);
      }
      return true;
    } catch (error) {
      if (token === revision) {
        showStaticScreen(search);
        report(error);
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
      welcomeList.push({
        ...schedule,
        content: validMedia(content) ? content : null,
        background: validMedia(background) ? background : null
      });
    }
    playlist = normalizePlaylist(config.notice?.notice_list);
    if (!revision) syncStandby();
    tickSchedule();
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
  window.chrome?.webview?.addEventListener('message', ({ data }) => {
    // The player bridge already forwards the value of each udp-receive object.
    if (typeof data === 'string') window.SetRevMsg(data);
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(scheduleTimer);
    resumeMedia = Boolean(pendingGroup || currentGroup);
    cancelMediaPreparation();
    finishFade?.();
    freezeGroup(currentGroup);
    currentGroup?.panes.forEach(pane => pane.stop());
    cancelAnimationFrame(careerFrame);
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    activeWelcome = undefined;
    if (resumeMedia && !updateWelcome()) startRolling();
    tickSchedule();
    if (screen === 'employee') scrollCareer();
  });
  ready.then(() => {
    const params = new URLSearchParams(location.search), type = params.get('screen');
    const action = { rolling: 'ROLLING', employee: 'EMP', weapon: 'WEP', project: 'WEP' }[type];
    if (action && !revision) window.SetRevMsg('MSG|' + action + (['EMP', 'WEP'].includes(action) ? '|' + (params.get('id') || '') : ''));
  });
})();
