/* Небольшой скрипт сайта: мобильное меню, появление блоков, подсветка раздела. */
'use strict';

(function () {
  const menuBtn = document.getElementById('menuBtn');
  const nav = document.getElementById('nav');

  // Мобильное меню
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menuBtn.classList.toggle('open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    });

    nav.addEventListener('click', (event) => {
      if (event.target.tagName === 'A') {
        nav.classList.remove('open');
        menuBtn.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Появление карточек и подсветка активного раздела.
  // Делаем на обычном scroll + getBoundingClientRect: это работает во всех браузерах,
  // в том числе там, где IntersectionObserver не вызывает колбэки.
  const reveals = Array.from(document.querySelectorAll('.reveal'));
  const links = Array.from(document.querySelectorAll('.nav a[href^="#"]'));
  const sections = links
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  function updateReveals() {
    reveals.forEach((el) => {
      if (el.classList.contains('visible')) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
        el.classList.add('visible');
      }
    });
  }

  function updateActiveNav() {
    if (!sections.length) return;
    let current = sections[0].id;
    sections.forEach((section) => {
      if (section.getBoundingClientRect().top <= window.innerHeight * 0.45) {
        current = section.id;
      }
    });
    links.forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === '#' + current);
    });
  }

  function onScroll() {
    updateReveals();
    updateActiveNav();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.addEventListener('load', onScroll);
  updateReveals();
  updateActiveNav();

  // ---------- Видео ----------
  const video = document.getElementById('andreyVideo');
  const videoLayout = document.getElementById('videoLayout');
  const videoPicker = document.getElementById('videoPicker');
  const videoChoices = Array.from(document.querySelectorAll('.video-choice'));
  const videoTitle = document.getElementById('videoTitle');
  const videoDownload = document.getElementById('videoDownload');
  const pickVideoBtn = document.getElementById('pickVideoBtn');
  const videoFileInput = document.getElementById('videoFileInput');
  const videoQuality = document.getElementById('videoQuality');
  const captureFramesBtn = document.getElementById('captureFramesBtn');
  const captureFromCursorBtn = document.getElementById('captureFromCursorBtn');
  const captureStepFramesBtn = document.getElementById('captureStepFramesBtn');
  const downloadAllFramesBtn = document.getElementById('downloadAllFramesBtn');
  const frameResults = document.getElementById('frameResults');
  const frameStatus = document.getElementById('frameStatus');
  const frameUrls = [];
  const frameFiles = [];
  let capturingFrames = false;
  let localVideoUrl = null;

  function clearFrames() {
    while (frameUrls.length) URL.revokeObjectURL(frameUrls.pop());
    frameFiles.length = 0;
    if (frameResults) frameResults.textContent = '';
    if (frameStatus) frameStatus.textContent = '';
    if (downloadAllFramesBtn) downloadAllFramesBtn.hidden = true;
  }

  function waitForSeeked(element) {
    return new Promise((resolve, reject) => {
      let timer = null;
      let check = null;
      const cleanup = () => {
        element.removeEventListener('seeked', done);
        element.removeEventListener('error', fail);
        if (timer) clearTimeout(timer);
        if (check) clearTimeout(check);
      };
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('seek')); };
      element.addEventListener('seeked', done);
      element.addEventListener('error', fail);
      timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 15000);
      // Если время изменилось совсем чуть-чуть, браузер может не прислать событие
      // seeked. Тогда, убедившись, что перемотка уже закончилась, не ждём 15 секунд.
      check = setTimeout(() => {
        if (!element.seeking && element.readyState >= 2) done();
      }, 400);
    });
  }

  // Браузер перематывает большие ролики не идеально точно: на 4K бывает, что
  // для двух соседних моментов показывается один и тот же кадр. Поэтому после
  // перемотки узнаём у браузера время реально показанного кадра
  // (requestVideoFrameCallback → mediaTime) и сверяем его с предыдущим.
  const signatureCanvas = document.createElement('canvas');
  signatureCanvas.width = 32;
  signatureCanvas.height = 18;
  const signatureCtx = signatureCanvas.getContext('2d', { willReadFrequently: true });

  function frameSignature(source) {
    signatureCtx.drawImage(source, 0, 0, 32, 18);
    const data = signatureCtx.getImageData(0, 0, 32, 18).data;
    const gray = new Uint8Array(32 * 18);
    for (let i = 0; i < gray.length; i += 1) {
      const k = i * 4;
      gray[i] = (data[k] * 0.299 + data[k + 1] * 0.587 + data[k + 2] * 0.114) | 0;
    }
    return gray;
  }

  function sameFrame(first, second) {
    if (!first || !second) return false;
    let total = 0;
    for (let i = 0; i < first.length; i += 1) total += Math.abs(first[i] - second[i]);
    return total / first.length < 0.5;
  }

  function clampTime(element, value) {
    const last = Math.max(0, (element.duration || 0) - 0.02);
    return Math.min(Math.max(value, 0), last);
  }

  function delay(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  // Перематывает и возвращает время кадра, который браузер действительно показал.
  // precise — режим шага по кадрам: если время почти не меняется, сдвигаем его
  // всего на 0,5 мс, иначе можно перескочить через кадр.
  async function seekTo(element, value, precise) {
    let presented = null;
    const framePromise = typeof element.requestVideoFrameCallback === 'function'
      ? new Promise((resolve) => {
        element.requestVideoFrameCallback((now, metadata) => { resolve(metadata.mediaTime); });
      })
      : Promise.resolve(null);
    let target = clampTime(element, value);
    const nudge = precise ? 0.0005 : 0.04;
    if (Math.abs(element.currentTime - target) < nudge) {
      target = clampTime(element, target + nudge);
    }
    element.currentTime = target;
    await waitForSeeked(element);
    const mediaTime = await Promise.race([framePromise, delay(200).then(() => null)]);
    return typeof mediaTime === 'number' && isFinite(mediaTime) ? mediaTime : null;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('blob')), 'image/jpeg', 0.88);
      } catch (error) {
        reject(error);
      }
    });
  }

  function updateVideoQuality() {
    if (!videoQuality || !video) return;
    if (video.videoWidth && video.videoHeight) {
      videoQuality.textContent = 'Качество видео: ' + video.videoWidth + ' × ' + video.videoHeight;
    } else {
      videoQuality.textContent = 'Качество видео: определяем…';
    }
  }

  if (video) {
    video.addEventListener('loadedmetadata', updateVideoQuality);
    video.addEventListener('error', () => {
      if (videoQuality) videoQuality.textContent = 'Качество видео: не удалось определить';
    });
    updateVideoQuality();
  }

  function setVideoSource(src, poster, title) {
    if (!video) return;
    video.pause();
    clearFrames();
    if (videoQuality) videoQuality.textContent = 'Качество видео: определяем…';
    video.poster = poster || '';
    const source = video.querySelector('source');
    if (source) {
      source.setAttribute('src', src);
      video.load();
    } else {
      video.src = src;
    }
    if (videoTitle) videoTitle.textContent = title || 'Видео';
    if (videoDownload) {
      videoDownload.href = src;
      videoDownload.hidden = false;
    }
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }

  // Если постоянных роликов ещё нет, скрываем пустой плеер и сетку кнопок.
  if (videoLayout && videoPicker) {
    const hasVideoChoices = videoChoices.length > 0;
    videoLayout.hidden = !hasVideoChoices;
    videoPicker.hidden = !hasVideoChoices;
  }

  videoChoices.forEach((choice) => {
    choice.addEventListener('click', () => {
      setVideoSource(
        choice.getAttribute('data-src'),
        choice.getAttribute('data-poster'),
        choice.getAttribute('data-title')
      );
      videoChoices.forEach((item) => item.classList.toggle('active', item === choice));
    });
  });

  // Временный просмотр ролика со своего компьютера, пока файлы не лежат на сайте.
  if (pickVideoBtn && videoFileInput) {
    pickVideoBtn.addEventListener('click', () => videoFileInput.click());
    videoFileInput.addEventListener('change', () => {
      const file = videoFileInput.files && videoFileInput.files[0];
      if (!file || !video) return;
      if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
      localVideoUrl = URL.createObjectURL(file);
      const source = video.querySelector('source');
      if (source) source.remove();
      setVideoSource(localVideoUrl, '', file.name);
      if (videoLayout) {
        videoLayout.hidden = false;
        const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        videoLayout.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }
      if (videoDownload) videoDownload.setAttribute('download', file.name);
    });
  }

  // ---------- Серия кадров из видео ----------
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime() {
    const now = new Date();
    return {
      time: ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xFFFF,
      date: (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF
    };
  }

  // Собираем ZIP вручную, без библиотек: метод store, имена в UTF-8.
  async function buildZip(files) {
    const encoder = new TextEncoder();
    const stamp = dosDateTime();
    const parts = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const data = new Uint8Array(await file.blob.arrayBuffer());
      const name = encoder.encode(file.name);
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);
      parts.push(local, data);

      const entry = new Uint8Array(46 + name.length);
      const ev = new DataView(entry.buffer);
      ev.setUint32(0, 0x02014b50, true);
      ev.setUint16(4, 20, true);
      ev.setUint16(6, 20, true);
      ev.setUint16(8, 0x0800, true);
      ev.setUint16(10, 0, true);
      ev.setUint16(12, stamp.time, true);
      ev.setUint16(14, stamp.date, true);
      ev.setUint32(16, crc, true);
      ev.setUint32(20, data.length, true);
      ev.setUint32(24, data.length, true);
      ev.setUint16(28, name.length, true);
      ev.setUint16(30, 0, true);
      ev.setUint16(32, 0, true);
      ev.setUint16(34, 0, true);
      ev.setUint16(36, 0, true);
      ev.setUint32(38, 0, true);
      ev.setUint32(42, offset, true);
      entry.set(name, 46);
      central.push(entry);
      offset += local.length + data.length;
    }

    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  function addFrameCard(blob, index) {
    const name = 'кадр-' + (index + 1) + '.jpg';
    const url = URL.createObjectURL(blob);
    frameUrls.push(url);
    frameFiles.push({ name, blob });
    const link = document.createElement('a');
    link.className = 'frame-card';
    link.href = url;
    link.download = name;
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Кадр ' + (index + 1);
    const label = document.createElement('span');
    label.textContent = 'Кадр ' + (index + 1) + ' ↓';
    link.appendChild(img);
    link.appendChild(label);
    frameResults.appendChild(link);
  }

  // Общая съёмка. Либо times — готовый список моментов, либо options.stepFrames —
  // сколько кадров снять подряд с шагом в один кадр ролика.
  async function captureSeries(times, options) {
    const stepMode = Boolean(options && options.stepFrames);
    const count = stepMode ? options.stepFrames : times.length;
    if (capturingFrames) return;
    if (!video.videoWidth || !video.duration || !isFinite(video.duration) || video.duration <= 0) {
      if (frameStatus) frameStatus.textContent = 'Сначала дождись загрузки видео, потом нажимай снова.';
      return;
    }
    const buttons = [captureFramesBtn, captureFromCursorBtn, captureStepFramesBtn].filter(Boolean);
    capturingFrames = true;
    buttons.forEach((button) => { button.disabled = true; });
    const wasPlaying = !video.paused;
    const savedTime = video.currentTime;
    clearFrames();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    try {
      video.pause();
      // Если видео ещё перематывается (например, сразу после клика по таймлайну),
      // даём ему встать на место — иначе первый кадр серии может быть снят не там.
      if (video.seeking) {
        await Promise.race([
          new Promise((resolve) => { video.addEventListener('seeked', resolve, { once: true }); }),
          delay(2000),
        ]);
      }
      await delay(120);
      let firstTime = 0;
      // Шаг в один кадр подбираем на ходу: частота кадров заранее неизвестна.
      let frameStep = 0.012;
      if (stepMode) {
        const base = await seekTo(video, video.currentTime || 0, true);
        firstTime = base !== null ? base : Math.max(0, video.currentTime || 0);
        // Если курсор близко к концу ролика, немного отодвигаемся назад.
        if (firstTime > video.duration - 0.6) firstTime = Math.max(0, video.duration - 0.6);
      }
      let previousSignature = null;
      let stuckFrames = 0;
      let lastMediaTime = null;
      let stepKnown = false;
      for (let i = 0; i < count; i += 1) {
        if (frameStatus) frameStatus.textContent = 'Снимаю ' + (i + 1) + ' из ' + count + '…';
        // Если несколько кадров подряд не удаётся снять другими, сцена статичная —
        // дальше не тратим время на повторные перемотки.
        const attempts = stuckFrames >= 2 ? 1 : (stepMode ? 8 : 3);
        let target = stepMode
          ? (i === 0 ? firstTime : lastMediaTime + frameStep)
          : times[i];
        let signature = null;
        let mediaTime = null;
        let sameAsPrevious = false;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          mediaTime = await seekTo(video, target, stepMode);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          signature = frameSignature(canvas);
          if (!previousSignature) break;
          // Время показанного кадра точнее картинки: canvas иногда отстаёт на кадр.
          const delta = mediaTime !== null && lastMediaTime !== null ? mediaTime - lastMediaTime : null;
          sameAsPrevious = delta !== null ? delta < 0.002 : sameFrame(signature, previousSignature);
          if (!sameAsPrevious) {
            // Не перескочили ли через кадр? Тогда пробуем ещё раз с меньшим шагом.
            if (stepMode && stepKnown && delta !== null && delta > frameStep * 1.5) {
              frameStep = Math.max(0.004, delta / 2);
              target = lastMediaTime + frameStep;
              continue;
            }
            break;
          }
          // Браузер мог ещё не дорисовать новый кадр — даём ему время.
          let painted = false;
          for (let wait = 0; wait < 3; wait += 1) {
            await delay(80);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            signature = frameSignature(canvas);
            if (!sameFrame(signature, previousSignature)) { painted = true; break; }
          }
          if (painted) { sameAsPrevious = false; break; }
          // Кадр правда повторился: просим у браузера следующий.
          if (stepMode) {
            // Значит, шаг оказался меньше длительности кадра — увеличиваем его.
            frameStep = Math.min(0.1, frameStep * 1.4);
            target = lastMediaTime + frameStep;
          } else {
            target = (mediaTime !== null ? mediaTime : target) + 0.045;
          }
        }
        if (stepMode && mediaTime !== null && lastMediaTime !== null) {
          // Уточняем шаг по времени реально показанного кадра: так он не «уплывает».
          const delta = mediaTime - lastMediaTime;
          if (delta > 0.002 && (!stepKnown || delta <= frameStep * 1.5)) {
            frameStep = Math.min(0.1, delta);
            stepKnown = true;
          }
        }
        if (stepMode) {
          lastMediaTime = mediaTime !== null ? mediaTime : target;
        } else {
          lastMediaTime = mediaTime;
        }
        stuckFrames = previousSignature && sameAsPrevious ? stuckFrames + 1 : 0;
        previousSignature = signature;
        const blob = await canvasBlob(canvas);
        addFrameCard(blob, i);
      }
      if (frameStatus) frameStatus.textContent = 'Готово! Жми на кадр, чтобы скачать один, или скачай все сразу архивом.';
      if (downloadAllFramesBtn) downloadAllFramesBtn.hidden = frameFiles.length === 0;
    } catch (error) {
      if (frameStatus) frameStatus.textContent = 'Не получилось снять кадры. Открой ролик кнопкой «Открыть своё видео» и попробуй снова.';
    } finally {
      capturingFrames = false;
      buttons.forEach((button) => { button.disabled = false; });
      try {
        video.currentTime = savedTime;
        if (wasPlaying) {
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
        }
      } catch (error) {
        // Плеер мог выгрузиться — это не мешает скачиванию кадров.
      }
    }
  }

  if (captureFramesBtn && video && frameResults) {
    captureFramesBtn.addEventListener('click', () => {
      const times = [];
      for (let i = 0; i < 5; i += 1) times.push(video.duration * (i + 1) / 6);
      captureSeries(times);
    });
  }

  // Двадцать кадров подряд от текущей позиции курсора — для точного момента.
  if (captureFromCursorBtn && video && frameResults) {
    captureFromCursorBtn.addEventListener('click', () => {
      const count = 20;
      const step = 0.1;
      const span = step * (count - 1);
      let start = video.currentTime || 0;
      if (!isFinite(start) || start < 0) start = 0;
      if (start + span > video.duration) start = Math.max(0, video.duration - span - 0.05);
      const times = [];
      for (let i = 0; i < count; i += 1) times.push(start + i * step);
      captureSeries(times);
    });
  }

  // Десять кадров подряд с шагом в один кадр ролика: видно каждый кадр файла,
  // без пропусков — удобно сравнивать качество соседних кадров.
  if (captureStepFramesBtn && video && frameResults) {
    captureStepFramesBtn.addEventListener('click', () => {
      captureSeries(null, { stepFrames: 10 });
    });
  }

  if (downloadAllFramesBtn) {
    downloadAllFramesBtn.addEventListener('click', async () => {
      if (capturingFrames || !frameFiles.length) return;
      downloadAllFramesBtn.disabled = true;
      if (frameStatus) frameStatus.textContent = 'Собираю архив…';
      try {
        const zip = await buildZip(frameFiles);
        const url = URL.createObjectURL(zip);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'кадры.zip';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        if (frameStatus) frameStatus.textContent = 'Архив с кадрами скачан.';
      } catch (error) {
        if (frameStatus) frameStatus.textContent = 'Не получилось собрать архив. Скачай кадры по одному.';
      } finally {
        downloadAllFramesBtn.disabled = false;
      }
    });
  }

  // ---------- Аудио ----------
  const audio = document.getElementById('andreyAudio');
  const tracks = Array.from(document.querySelectorAll('.track'));
  const audioTitle = document.getElementById('audioTitle');
  const audioSub = document.getElementById('audioSub');
  const audioDownload = document.getElementById('audioDownload');

  tracks.forEach((track) => {
    track.addEventListener('click', () => {
      if (!audio) return;
      audio.pause();
      const src = track.getAttribute('data-src');
      audio.querySelector('source').setAttribute('src', src);
      if (audioDownload) audioDownload.href = src;
      if (audioTitle) audioTitle.textContent = track.getAttribute('data-title') || '';
      if (audioSub) audioSub.textContent = track.getAttribute('data-sub') || '';
      tracks.forEach((item) => item.classList.toggle('active', item === track));
      audio.load();
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    });
  });

  // Видео и музыка не играют одновременно.
  if (video && audio) {
    video.addEventListener('play', () => audio.pause());
    audio.addEventListener('play', () => video.pause());
  }

  // ---------- Вкладки проектов и записей ----------
  const tabGroups = Array.from(document.querySelectorAll('.project-tabs, .audio-tabs'));
  tabGroups.forEach((group) => {
    const tabs = Array.from(group.querySelectorAll('.project-tab, .audio-tab'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((item) => {
          const active = item === tab;
          item.classList.toggle('active', active);
          item.setAttribute('aria-selected', String(active));
          const panel = document.getElementById(item.getAttribute('aria-controls'));
          if (panel) panel.hidden = !active;
        });
        const activePanel = document.getElementById(tab.getAttribute('aria-controls'));
        if (activePanel) {
          activePanel.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
        }
        updateReveals();
      });
    });
  });

  // Год в подвале
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
