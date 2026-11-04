(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const protocol = window.LedProtocol;
  const labels = { rolling: '홍보 미디어 롤링', welcome: '웰컴', 'employee-search': '직원 검색 대기', employee: '직원 정보', 'weapon-search': '주요 사업 검색 대기', weapon: '무기 / 사업 정보' };
  let config = {}, screen = '', revision = 0, mediaRevision = 0, mediaTimer, currentMedia, careerFrame, noticeTimer;
  let playlist = [], mediaIndex = -1, failedMedia = new Set();
  const status = text => { $('debug-status').textContent = text; };
  const text = (id, value) => { $(id).textContent = value == null || value === '' ? '—' : String(value); };
  const seconds = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
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
    mediaRevision++;
    clearTimeout(mediaTimer);
    if (currentMedia) {
      currentMedia.onload = currentMedia.onerror = currentMedia.onended = currentMedia.ontimeupdate = null;
      if (currentMedia.tagName === 'VIDEO') { currentMedia.pause(); currentMedia.removeAttribute('src'); currentMedia.load(); }
      currentMedia = null;
    }
    $('media-player').replaceChildren();
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
  function normalizePlaylist(items) {
    return (Array.isArray(items) ? items : []).map(item => typeof item === 'string' ? { src: item } : item)
      .filter(item => item && localAsset(item.src, ['commonfiles']))
      .map(item => ({ ...item, type: item.type || (/\.(mp4|webm|ogv)$/i.test(item.src) ? 'video' : 'image') }));
  }
  async function loadPlaylist() {
    const rolling = config.rolling || {};
    let items = normalizePlaylist(rolling.items);
    if (rolling.autoDiscover !== false) {
      let discovered;
      // A plain static server can use a generated manifest; the bundled server scans live.
      try { discovered = await json('api/media'); }
      catch { try { discovered = await json('data/media_manifest.json'); } catch { /* explicit JSON playlist remains usable */ } }
      if (Array.isArray(discovered)) {
        const found = normalizePlaylist(discovered);
        const paths = new Set(found.map(item => item.src));
        items = items.filter(item => paths.has(item.src));
        const configured = new Set(items.map(item => item.src));
        items.push(...found.filter(item => !configured.has(item.src)));
      }
    }
    return items;
  }
  function nextMedia() {
    if (screen !== 'rolling') return;
    stopMedia();
    if (!playlist.length || failedMedia.size >= playlist.length) {
      $('media-empty').hidden = false;
      status('재생 가능한 홍보 미디어가 없습니다. commonfiles와 JSON 설정을 확인해주세요.');
      return;
    }
    $('media-empty').hidden = true;
    do { mediaIndex = (mediaIndex + 1) % playlist.length; } while (failedMedia.has(mediaIndex));
    const item = playlist[mediaIndex], index = mediaIndex, token = mediaRevision;
    const element = document.createElement(item.type === 'video' ? 'video' : 'img');
    currentMedia = element;
    const active = () => screen === 'rolling' && token === mediaRevision && currentMedia === element;
    const fail = () => {
      if (!active()) return;
      failedMedia.add(index);
      status(`미디어를 건너뜁니다: ${item.src}`);
      nextMedia();
    };
    element.onerror = fail;
    $('media-player').append(element);
    document.documentElement.style.setProperty('--media-fit', ['contain', 'cover', 'fill'].includes(config.rolling?.fit) ? config.rolling.fit : 'fill');
    status(`롤링 ${index + 1}/${playlist.length} · ${item.src.split('/').pop()}`);
    if (item.type === 'video') {
      element.muted = true; element.autoplay = true; element.playsInline = true; element.preload = 'auto';
      const watchdog = () => { if (active()) { clearTimeout(mediaTimer); mediaTimer = setTimeout(fail, 30000); } };
      element.ontimeupdate = watchdog;
      element.onended = () => { if (active()) nextMedia(); };
      element.src = item.src;
      watchdog();
      element.play().catch(fail);
    } else {
      element.alt = item.alt || '국방기술품질원 홍보 이미지';
      element.onload = () => {
        if (!active()) return;
        clearTimeout(mediaTimer);
        mediaTimer = setTimeout(nextMedia, seconds(item.seconds, seconds(config.rolling?.imageSeconds, 10)) * 1000);
      };
      mediaTimer = setTimeout(fail, 15000);
      element.src = item.src;
    }
  }
  function renderWelcome() {
    const welcome = config.welcome || {};
    const background = localAsset(welcome.background);
    $('screen-welcome').style.backgroundImage = background ? `url("${encodeURI(background).replace(/"/g, '%22')}")` : '';
    ['subtitle', 'title', 'message', 'scheduleTitle', 'schedule'].forEach(key => {
      const id = 'welcome-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
      $(id).textContent = typeof welcome[key] === 'string' ? welcome[key] : '';
    });
    $('welcome-schedule-title').hidden = !welcome.scheduleTitle;
    $('welcome-schedule').hidden = !welcome.schedule;
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
    if (token !== revision) return false;
    try {
      const { type, id } = command;
      text('debug-connection', message);
      if (type === 'rolling') {
        show('rolling'); status('홍보 미디어를 불러오고 있습니다.');
        const items = await loadPlaylist();
        if (token !== revision) return false;
        playlist = items; failedMedia = new Set(); mediaIndex = -1; show('rolling'); nextMedia();
      } else if (type === 'welcome') {
        renderWelcome(); show('welcome'); status('웰컴 화면 · 롤링 중지');
        const updated = await json('data/kiosk_contents.json');
        if (token !== revision) return false;
        config.welcome = updated.welcome;
        renderWelcome(); show('welcome'); status('웰컴 화면 · 롤링 중지');
      } else if (!id) {
        show(type === 'employee' ? 'employee-search' : 'weapon-search'); status('dtaq에서 검색한 정보를 LED로 전송해주세요.');
      } else {
        show(type === 'employee' ? 'employee-search' : 'weapon-search');
        status(`${id} 정보를 불러오고 있습니다.`);
        // Re-read the source JSON on each command so external edits are reflected.
        const data = await json(`data/${type === 'employee' ? 'employees' : type === 'project' ? 'projects' : 'weapons'}.json`);
        if (token !== revision) return false;
        const items = Array.isArray(data) ? data : data.weapons;
        if (!Array.isArray(items)) throw Error('JSON 데이터 형식이 올바르지 않습니다.');
        const item = items.find(entry => String(entry.id) === id);
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
    $('debug-welcome').addEventListener('click', () => window.SetRevMsg('MSG|WELCOME'));
    $('debug-collapse').addEventListener('click', () => { const collapsed = !$('debug-body').hidden; $('debug-body').hidden = collapsed; $('debug-collapse').textContent = collapsed ? '펼치기' : '접기'; $('debug-collapse').setAttribute('aria-expanded', String(!collapsed)); });
    $('debug-fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (error) { report(error); } });
    $('debug-panel').hidden = new URLSearchParams(location.search).get('debug') === '0';
    document.addEventListener('keydown', event => { if (event.key.toLowerCase() === 'd' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.target.closest('input,textarea,select,[contenteditable]')) $('debug-panel').hidden = !$('debug-panel').hidden; });
  }
  async function boot() {
    try { config = await json('data/kiosk_contents.json'); }
    catch (error) { report(Error('data/kiosk_contents.json을 읽을 수 없습니다. HTTP 서버로 실행하고 JSON 문법을 확인해주세요.')); }
    renderWelcome();
    playlist = await loadPlaylist();
    if (!revision) { show(config.welcome?.show === true ? 'welcome' : 'rolling'); if (screen === 'rolling') nextMedia(); }
    const lists = await Promise.allSettled([json('data/employees.json'), json('data/weapons.json'), json('data/projects.json')]);
    lists.forEach((result, index) => {
      if (result.status !== 'fulfilled') { status('일부 JSON을 불러오지 못했습니다. 데이터 파일을 확인해주세요.'); return; }
      const items = Array.isArray(result.value) ? result.value : result.value.weapons;
      if (!Array.isArray(items)) return;
      for (const item of items) { const option = document.createElement('option'); option.value = item.id; option.label = `${item.name} · ${item.dept || ''}`; $(index === 0 ? 'employee-ids' : 'weapon-ids').append(option); }
    });
  }
  window.SetRevMsg = SetRevMsg;
  resize(); window.addEventListener('resize', resize); initDebug();
  const ready = boot();
  window.DTAQ_LED = Object.freeze({ ready, getState: () => ({ screen, mediaIndex, mediaCount: playlist.length }) });
  if (window.chrome?.webview) window.chrome.webview.addEventListener('message', event => window.SetRevMsg(event.data));
  window.addEventListener('pagehide', () => { stopMedia(); cancelAnimationFrame(careerFrame); });
  ready.then(() => {
    const params = new URLSearchParams(location.search), type = params.get('screen');
    const action = { rolling: 'ROLLING', welcome: 'WELCOME', employee: 'EMP', weapon: 'WEP', project: 'WEP' }[type];
    if (action && !revision) window.SetRevMsg('MSG|' + action + (['EMP', 'WEP'].includes(action) ? '|' + (params.get('id') || '') : ''));
  });
})();
