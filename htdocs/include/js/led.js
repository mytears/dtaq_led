(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const protocol = window.LedProtocol;
  const labels = { rolling: '홍보 미디어 롤링', welcome: '웰컴', 'employee-search': '직원 검색 대기', employee: '직원 정보', 'weapon-search': '주요 사업 검색 대기', weapon: '무기 / 사업 정보' };
  let config = {};
  let screen = '', revision = 0, currentGroup, careerFrame, noticeTimer, scheduleTimer;
  let playlist = [], mediaIndex = -1, failedGroups = new Set();
  let welcomeList = [], activeWelcome;
  const failedWelcome = new Set();
  const status = text => { $('debug-status').textContent = text; };
  const text = (id, value) => { $(id).textContent = value == null || value === '' ? '—' : String(value); };
  function localAsset(value, directories = ['images', 'commonfiles']) {
    if (typeof value !== 'string' || value.includes('\\') || /[?#\x00-\x1f]/.test(value)) return '';
    const parts = value.split('/');
    return directories.includes(parts[0]) && parts.length > 1 && parts.every(p => p && p !== '..' && p !== '.') ? value : '';
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
  function stopMedia() {
    if (!currentGroup) return;
    const group = currentGroup;
    currentGroup = null;
    clearTimeout(group.timer);
    group.panes.forEach(pane => {
      pane.stop();
      pane.pane.remove();
    });
  }
  function show(next) {
    stopMedia();
    cancelAnimationFrame(careerFrame);
    screen = next;
    document.querySelectorAll('.screen').forEach(el => { el.hidden = el.id !== `screen-${next}`; });
    $('debug-panel').dataset.screen = next;
    text('debug-screen', labels[next]);
    $('notice').hidden = true;
    clearTimeout(noticeTimer);
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
  function validMedia(item, directories) {
    return item && ['MOV', 'IMG'].includes(item.type) && localAsset(item.file_path, directories);
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
          contents.every(item => validMedia(item, ['commonfiles']) && validDuration(item.ptime)) &&
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
    let loadTimer, repeatTimer, frame, stopped = false, drawFrame, resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const hasVideoFrameCallback = typeof element.requestVideoFrameCallback === 'function';
    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(loadTimer);
      clearInterval(repeatTimer);
      element.onload = element.onloadeddata = element.onerror = null;
      if (isVideo) {
        if (frame != null) {
          if (hasVideoFrameCallback) element.cancelVideoFrameCallback(frame);
          else cancelAnimationFrame(frame);
        }
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
      resolveReady();
    }
    function fail() {
      if (stopped) return;
      stop();
      pane.replaceChildren();
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
        if (stopped) return;
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
      element.loop = true;
    } else {
      element.alt = item.alt ?? '국방기술품질원 안내 이미지';
      element.onload = loaded;
    }
    element.onerror = fail;
    loadTimer = setTimeout(fail, isVideo ? 30000 : 15000);
    element.src = item.file_path;
    return {
      pane, ready, stop,
      start(deadline = Infinity) {
        pane.hidden = false;
        if (stopped || !isVideo) return;
        drawFrame();
        element.play().catch(fail);
        const cycle = (item.ptime ?? 0) * 1000;
        if (cycle > 0 && performance.now() + cycle < deadline) {
          repeatTimer = setInterval(() => {
            if (performance.now() < deadline) element.currentTime = 0;
          }, cycle);
        }
      }
    };
  }
  async function nextMedia(now = scheduleTime()) {
    if (screen !== 'rolling') return;
    stopMedia();
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
      if (empty.hidden) status('현재 재생 가능한 홍보 미디어가 없습니다.');
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    mediaIndex = index;
    const entry = playlist[index];
    const player = $('media-player');
    const group = { entry, panes: [], timer: null };
    currentGroup = group;
    player.dataset.layout = entry.layout;
    let remaining = entry.contents.length;
    group.panes = entry.contents.map(item => createMediaPane(item, {
      muted: false,
      onFailure(failed) {
        status(`미디어를 건너뜁니다: ${failed.file_path}`);
        remaining--;
        if (remaining === 0) {
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
    const duration = entry.fullTime * 1000;
    const deadline = performance.now() + duration;
    group.timer = setTimeout(nextMedia, duration);
    group.panes.forEach(pane => pane.start(deadline));
  }
  function startRolling() {
    failedGroups = new Set();
    mediaIndex = -1;
    show('rolling');
    nextMedia();
  }
  async function playWelcome(welcome) {
    stopMedia();
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
    if (nextWelcome === activeWelcome && (!nextWelcome || currentGroup)) return Boolean(nextWelcome);
    activeWelcome = nextWelcome;
    if (!nextWelcome) {
      startRolling();
      return false;
    }
    if (screen !== 'welcome') {
      revision++;
      show('welcome');
    }
    playWelcome(nextWelcome);
    return true;
  }
  function tickSchedule() {
    const now = scheduleTime();
    const isWelcomeActive = updateWelcome(now);
    if (screen === 'rolling' && (!currentGroup || !isScheduled(currentGroup.entry.schedule, now))) nextMedia(now);
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
    const path = localAsset(weapon.image);
    $('weapon-image').hidden = !path; $('weapon-image-empty').hidden = !!path;
    $('weapon-image').onerror = () => { $('weapon-image').hidden = true; $('weapon-image-empty').hidden = false; };
    if (path) { $('weapon-image').src = path; $('weapon-image').alt = weapon.name || '무기체계 이미지'; }
  }
  async function SetRevMsg(message) {
    const command = protocol.normalize(message);
    if (!command) { report(Error('지원하지 않는 LED 명령 형식입니다.')); return false; }
    const token = ++revision;
    await ready;
    if (token !== revision || updateWelcome()) return false;
    try {
      const { type, id } = command;
      text('debug-connection', message);
      if (type === 'rolling') {
        if (screen !== 'rolling') startRolling();
      } else if (!id) {
        show(type === 'employee' ? 'employee-search' : 'weapon-search'); status('dtaq에서 검색한 정보를 LED로 전송해주세요.');
      } else {
        show(type === 'employee' ? 'employee-search' : 'weapon-search');
        status(`${id} 정보를 불러오고 있습니다.`);
        const data = type === 'project' ? await json('data/projects.json') : config;
        if (token !== revision || updateWelcome()) return false;
        const items = type === 'project'
          ? (Array.isArray(data) ? data : data?.weapons)
          : data?.[type === 'employee' ? 'employees_list' : 'weapons_list'];
        if (!Array.isArray(items)) throw Error('JSON 데이터 형식이 올바르지 않습니다.');
        const item = items.find(entry => entry?.id != null && String(entry.id) === id);
        if (!item) { show(type === 'employee' ? 'employee-search' : 'weapon-search'); throw Error(`${type === 'employee' ? '직원' : '무기 / 사업'} ID “${id}”를 찾을 수 없습니다.`); }
        if (type === 'employee') { renderEmployee(item); show('employee'); scrollCareer(); }
        else { renderWeapon(item, type === 'project'); show('weapon'); }
        status(`${item.name} · ${id}`);
      }
      return true;
    } catch (error) { if (token === revision) report(error); return false; }
  }
  function initDebug() {
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
      if (validMedia(content, ['commonfiles'])) {
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
