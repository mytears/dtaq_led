(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const protocol = window.LedProtocol;
  const labels = { rolling: '홍보 미디어 롤링', welcome: '웰컴', 'employee-search': '직원 검색 대기', employee: '직원 정보', 'weapon-search': '주요 사업 검색 대기', weapon: '무기 / 사업 정보' };
  const fadeDuration = 250;
  const welcomePreparationMs = 250;
  const startupBufferSeconds = 0.5;
  const rollingOptions = { finishEarly: true, repeatMinMs: 2000, preloadMs: 3000 };
  const samplePhotoUrls = new Set(['img_photo.png', 'img_photo111.png', 'weapon-k9-sample.png']
    .map(file => new URL(`images/${file}`, document.baseURI).href));
  let config = {};
  let screen = '', revision = 0, activeLayer, displayedLayer, finishFade, detailScrollFrame, scheduleTimer;
  let displayedGroup, currentGroup, pendingGroup, preloadedGroup, resumeMedia;
  let playlist = [], mediaIndex = -1, failedGroups = new Set();
  let welcomeList = [], activeWelcome;
  const status = value => { if ($('debug-status')) $('debug-status').textContent = value; };
  const displayValue = value => value == null || /^[\s—–-]*$/.test(value) ? '' : String(value);
  const text = (id, value) => { const element = $(id); if (element) element.textContent = displayValue(value); };
  function photoUrl(path) {
    if (typeof path !== 'string' || !path.trim()) return '';
    try {
      const url = new URL(path.trim(), document.baseURI);
      if (!/^https?:$/.test(url.protocol) || samplePhotoUrls.has(url.href.split(/[?#]/, 1)[0])) return '';
      return url.href;
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
  function clearGroupTimers(group) {
    clearTimeout(group.timer);
    clearTimeout(group.preloadTimer);
  }
  function stopGroup(group) {
    clearGroupTimers(group);
    group.panes.forEach(pane => pane.stop());
  }
  function discardGroup(group) {
    if (!group) return;
    stopGroup(group);
    group.layer.remove();
  }
  function retireCurrentMedia() {
    if (!currentGroup) return;
    const group = currentGroup;
    currentGroup = null;
    if (group === displayedGroup) {
      clearGroupTimers(group);
      group.panes.forEach(pane => pane.retire());
    } else {
      discardGroup(group);
      activeLayer = displayedLayer;
    }
  }
  function cancelMediaPreparation() {
    const pending = pendingGroup;
    const preloaded = preloadedGroup;
    pendingGroup = preloadedGroup = null;
    discardGroup(pending);
    discardGroup(preloaded);
  }
  function show(next, layer, group, duration = fadeDuration) {
    retireCurrentMedia();
    cancelAnimationFrame(detailScrollFrame);
    activeLayer = layer;
    currentGroup = group;
    screen = next;
    if ($('debug-panel')) $('debug-panel').dataset.screen = next;
    text('debug-screen', labels[next]);
    function reveal() {
      if (activeLayer !== layer || currentGroup !== group) return;
      finishFade?.();
      const previous = displayedLayer;
      const previousGroup = displayedGroup;
      displayedLayer = layer;
      displayedGroup = group;
      layer.hidden = false;
      layer.classList.add('is-active');
      layer.inert = false;
      if (!previous || previous === layer) {
        layer.style.removeProperty('opacity');
        return;
      }
      previous.classList.remove('is-active');
      previous.inert = true;
      // The previous screen stays opaque behind the incoming fade so the backdrop never shows through.
      const animation = layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-in-out', fill: 'both' });
      layer.style.removeProperty('opacity');
      finishFade = animation.onfinish = () => {
        finishFade = null;
        animation.onfinish = null;
        if (previousGroup) discardGroup(previousGroup);
        else previous.hidden = true;
        animation.cancel();
      };
    }
    if (group?.screen === 'rolling') {
      layer.style.opacity = '0';
      layer.hidden = false;
      layer.inert = true;
      group.start().then(reveal);
    } else {
      group?.start();
      reveal();
    }
  }
  function showStaticScreen(next, render) {
    cancelMediaPreparation();
    if (next !== 'rolling') activeWelcome = undefined;
    render?.();
    show(next, $(`screen-${next}`));
    scrollDetails();
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
  function createMediaPane(item, { muted = true, repeatMinMs = 0, onFinished, onFailure, onFadeStart, onFadeCancel } = {}) {
    const pane = document.createElement('div');
    pane.className = 'media-pane';
    pane.hidden = true;
    const isVideo = item.type === 'MOV';
    const element = document.createElement(isVideo ? 'video' : 'img');
    let loadTimer, repeatTimer, frame, drawFrame, resolveReady, resolveStarted, onPlaybackFrame, endFade;
    let stopped = false, retiring = false, hasLoaded = false;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const hasVideoFrameCallback = typeof element.requestVideoFrameCallback === 'function';
    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(loadTimer);
      clearTimeout(repeatTimer);
      element.onload = element.oncanplay = element.oncanplaythrough = element.onprogress = null;
      element.ontimeupdate = element.onended = element.onerror = null;
      if (isVideo) {
        endFade?.cancel();
        element.muted = true;
        element.pause();
        if (frame != null) {
          if (hasVideoFrameCallback) element.cancelVideoFrameCallback(frame);
          else cancelAnimationFrame(frame);
        }
        element.removeAttribute('src');
        element.load();
        element.remove();
      }
      resolveStarted?.();
      resolveReady();
    }
    function retire() {
      retiring = true;
      if (!isVideo) return;
      clearTimeout(repeatTimer);
      element.onended = null;
      element.muted = true;
      if (!hasLoaded || resolveStarted) stop();
    }
    function fail() {
      if (stopped) return;
      stop();
      if (!isVideo) pane.replaceChildren();
      if (!retiring) onFailure?.(item);
    }
    function loaded() {
      hasLoaded = true;
      clearTimeout(loadTimer);
      resolveReady();
    }
    function checkVideoBuffer() {
      if (hasLoaded || element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
      const buffered = element.buffered;
      if (element.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA ||
          (buffered.length && buffered.start(0) <= 0.05 &&
           buffered.end(0) >= Math.min(startupBufferSeconds, element.duration))) {
        element.oncanplay = element.oncanplaythrough = element.onprogress = null;
        loaded();
      }
    }
    pane.append(element);
    if (isVideo) {
      // WebView2 can initially paint its native video surface at the wrong zoom.
      // Draw decoded frames on a canvas sized to this pane.
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      element.setAttribute('aria-hidden', 'true');
      const context = canvas.getContext('2d', { alpha: false });
      drawFrame = (_, metadata) => {
        if (stopped) return;
        if (element.readyState >= 2 && element.videoWidth && element.videoHeight) {
          const bounds = canvas.getBoundingClientRect(), pixelScale = window.devicePixelRatio || 1;
          const width = Math.max(1, Math.round(bounds.width * pixelScale)), height = Math.max(1, Math.round(bounds.height * pixelScale));
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          context.drawImage(element, 0, 0, width, height);
          if (!element.paused) onPlaybackFrame?.(metadata?.mediaTime ?? element.currentTime);
        }
        frame = hasVideoFrameCallback
          ? element.requestVideoFrameCallback(drawFrame) : requestAnimationFrame(drawFrame);
      };
      pane.append(canvas);
      element.oncanplay = element.oncanplaythrough = element.onprogress = checkVideoBuffer;
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
        if (stopped || retiring) return;
        if (error.name === 'NotAllowedError' && !element.muted) {
          element.muted = true;
          element.play().catch(fail);
        } else {
          fail();
        }
      });
    }
    function start(deadline = Infinity) {
      if (stopped || retiring) return;
      if (!hasLoaded) {
        return ready.then(() => start(deadline));
      }
      pane.hidden = false;
      if (!isVideo) return;
      const started = new Promise(resolve => { resolveStarted = resolve; });
      loadTimer = setTimeout(fail, 15000);
      function markStarted() {
        if (!resolveStarted) return;
        clearTimeout(loadTimer);
        element.ontimeupdate = null;
        resolveStarted();
        resolveStarted = null;
      }
      function fadeEndingPane() {
        if (!endFade && onFadeStart?.()) {
          endFade = pane.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: fadeDuration, easing: 'ease-in-out', fill: 'forwards'
          });
        }
      }
      onPlaybackFrame = mediaTime => {
        if (resolveStarted && mediaTime > 0 && element.currentTime > 0) markStarted();
        if (!onFinished || retiring || endFade || repeatTimer) return;
        const remainingClipMs = Math.max(0, element.duration - mediaTime) * 1000 / element.playbackRate;
        if (remainingClipMs <= fadeDuration &&
            deadline - performance.now() - remainingClipMs < repeatMinMs) fadeEndingPane();
      };
      // A low-frame-rate clip may start its clock before presenting a second frame.
      element.ontimeupdate = () => {
        if (!element.paused && element.currentTime >= 0.15) markStarted();
      };
      drawFrame();
      const cycle = (item.ptime ?? 0) * 1000;
      function armCycle() {
        if (cycle > 0 && deadline - performance.now() - cycle >= repeatMinMs) {
          repeatTimer = setTimeout(restart, cycle);
        }
      }
      function restart() {
        clearTimeout(repeatTimer);
        repeatTimer = null;
        if (stopped || retiring) return;
        const remaining = deadline - performance.now();
        if (remaining <= 0 || remaining < repeatMinMs) {
          if (element.ended) {
            element.onended = null;
            markStarted();
            if (onFinished) fadeEndingPane();
            onFinished?.();
          }
          return;
        }
        if (endFade) {
          endFade.cancel();
          endFade = null;
          onFadeCancel();
        }
        element.currentTime = 0;
        if (element.paused) play();
        armCycle();
      }
      element.onended = () => {
        // A timer can already have restarted playback before a queued ended event runs.
        if (element.ended) {
          markStarted();
          restart();
        }
      };
      play();
      armCycle();
      return started;
    }
    return { pane, ready, retire, stop, start };
  }
  function createMediaGroup(screen, entry) {
    const layer = $(`${screen}-template`).content.firstElementChild.cloneNode(true);
    return { screen, entry, layer, panes: [] };
  }
  function prepareMedia(group) {
    group.layer.hidden = true;
    $('led-stage').append(group.layer);
    group.ready = Promise.all(group.panes.map(pane => pane.ready));
  }
  async function switchMedia(group, duration) {
    cancelMediaPreparation();
    retireCurrentMedia();
    pendingGroup = group;
    if (!group.ready) prepareMedia(group);
    if (group.screen === 'welcome') {
      let preparationTimer;
      const limit = new Promise(resolve => { preparationTimer = setTimeout(resolve, welcomePreparationMs); });
      await Promise.race([group.ready, limit]);
      clearTimeout(preparationTimer);
    } else {
      await group.ready;
    }
    if (pendingGroup !== group) return;

    syncStandby();
    if (pendingGroup !== group) return;
    pendingGroup = null;
    show(group.screen, group.layer, group, duration);
  }
  function findNextMedia(now) {
    for (let offset = 1; offset <= playlist.length; offset++) {
      const candidate = (mediaIndex + offset) % playlist.length;
      if (!failedGroups.has(candidate) && isScheduled(playlist[candidate].schedule, now)) {
        return candidate;
      }
    }
    return -1;
  }
  function preloadNextMedia(group) {
    if (currentGroup !== group || preloadedGroup) return;
    const index = findNextMedia(scheduleTime());
    if (index === -1) return;
    preloadedGroup = createRollingGroup(index);
    prepareMedia(preloadedGroup);
  }
  function finishRolling(group) {
    if (currentGroup !== group) return;
    const now = scheduleTime();
    if (!updateWelcome(now)) nextMedia(now);
  }
  function nextMedia(now = scheduleTime()) {
    const index = findNextMedia(now);
    if (index === -1) {
      if (activeLayer === $('screen-rolling') && !pendingGroup) return;
      showStaticScreen('rolling');
      status('현재 재생 가능한 홍보 미디어가 없습니다.');
      return;
    }
    mediaIndex = index;
    const group = preloadedGroup?.index === index ? preloadedGroup : createRollingGroup(index);
    if (group === preloadedGroup) preloadedGroup = null;
    return switchMedia(group, Math.min(fadeDuration, group.entry.fullTime * 500));
  }
  function createRollingGroup(index) {
    const entry = playlist[index];
    const duration = entry.fullTime * 1000;
    const group = createMediaGroup('rolling', entry);
    group.index = index;
    const player = group.layer.querySelector('.media-player');
    player.dataset.layout = entry.layout;
    let remaining = entry.contents.length;
    const unfinishedVideos = new Set();
    const visiblePanes = new Set(entry.contents.keys());
    group.panes = entry.contents.map((item, paneIndex) => {
      if (item.type === 'MOV') unfinishedVideos.add(paneIndex);
      function finishVideo() {
        if (unfinishedVideos.delete(paneIndex) && !unfinishedVideos.size && rollingOptions.finishEarly) {
          finishRolling(group);
        }
      }
      return createMediaPane(item, {
        muted: entry.layout !== '1',
        repeatMinMs: rollingOptions.repeatMinMs,
        onFinished: finishVideo,
        onFadeStart: () => false,
        onFadeCancel: () => visiblePanes.add(paneIndex),
        onFailure(failed) {
          visiblePanes.delete(paneIndex);
          if (preloadedGroup !== group) status(`미디어를 건너뜁니다: ${failed.file_path}`);
          if (--remaining > 0) {
            finishVideo();
          } else {
            failedGroups.add(index);
            if (preloadedGroup === group) {
              preloadedGroup = null;
              discardGroup(group);
              if (currentGroup) preloadNextMedia(currentGroup);
            } else if ((pendingGroup ?? currentGroup) === group && !updateWelcome()) {
              nextMedia();
            }
          }
        }
      });
    });
    player.append(...group.panes.map(pane => pane.pane));
    group.start = () => {
      status(`롤링 ${index + 1}/${playlist.length} · ${entry.layout}분할`);
      const deadline = performance.now() + duration;
      group.timer = setTimeout(() => finishRolling(group), duration);
      if (rollingOptions.preloadMs > 0) {
        group.preloadTimer = setTimeout(() => preloadNextMedia(group), Math.max(0, duration - rollingOptions.preloadMs));
      }
      return Promise.all(group.panes.map(pane => pane.start(deadline)));
    };
    return group;
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
    return switchMedia(group);
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
      image.onerror = null;
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
  function scrollDetails() {
    cancelAnimationFrame(detailScrollFrame);
    const viewports = activeLayer?.querySelectorAll('.auto-scroll');
    if (!viewports?.length) return;
    for (const viewport of viewports) viewport.scrollTop = 0;

    let previous = performance.now();
    let pauseUntil = previous + 2000, index = 0, position = 0;
    let scrollingViewports = [];
    function tick(now) {
      detailScrollFrame = requestAnimationFrame(tick);
      const delta = Math.min(now - previous, 100);
      previous = now;
      if (now < pauseUntil) return;

      if (!scrollingViewports.length) {
        scrollingViewports = Array.from(viewports).filter(viewport => viewport.scrollHeight > viewport.clientHeight);
        if (!scrollingViewports.length) return;
      }
      if (index === scrollingViewports.length) {
        for (const viewport of scrollingViewports) viewport.scrollTop = 0;
        scrollingViewports = [];
        index = 0;
        pauseUntil = now + 2000;
        return;
      }

      const viewport = scrollingViewports[index];
      const max = viewport.scrollHeight - viewport.clientHeight;
      position = Math.min(max, position + delta * .018);
      viewport.scrollTop = position;
      if (position >= max) {
        index++;
        position = 0;
        pauseUntil = now + (index < scrollingViewports.length ? 1000 : 4000);
      }
    }
    detailScrollFrame = requestAnimationFrame(tick);
  }
  function renderWeapon(weapon, project = false) {
    text('weapon-name', weapon.name);
    const branchName = project ? '사업' : (weapon.branch ?? '');
    const branchBadge = $('weapon-branch');
    branchBadge.textContent = branchName;
    branchBadge.hidden = branchName === '';
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
    const notice = config.notice;
    rollingOptions.finishEarly = notice?.finishEarly !== false;
    for (const key of ['repeatMinMs', 'preloadMs']) {
      const value = notice?.[key];
      if (Number.isFinite(value) && value >= 0) rollingOptions[key] = value;
    }
    playlist = normalizePlaylist(notice?.notice_list);
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
    resumeMedia = Boolean(pendingGroup || currentGroup || displayedGroup);
    cancelMediaPreparation();
    finishFade?.();
    if (currentGroup !== displayedGroup) discardGroup(currentGroup);
    discardGroup(displayedGroup);
    if (displayedGroup) displayedLayer = null;
    currentGroup = displayedGroup = null;
    activeLayer = displayedLayer;
    cancelAnimationFrame(detailScrollFrame);
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    activeWelcome = undefined;
    if (resumeMedia && !updateWelcome()) startRolling();
    tickSchedule();
    scrollDetails();
  });
  ready.then(() => {
    const params = new URLSearchParams(location.search), type = params.get('screen');
    const action = { rolling: 'ROLLING', employee: 'EMP', weapon: 'WEP', project: 'WEP' }[type];
    if (action && !revision) window.SetRevMsg('MSG|' + action + (['EMP', 'WEP'].includes(action) ? '|' + (params.get('id') || '') : ''));
  });
})();
