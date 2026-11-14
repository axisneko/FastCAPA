/* FastCAPA — NCR Form (offline-first + FastAPI integration)
 *
 * Стратегия:
 * 1. Справочники: пытаемся загрузить из backend (/api/v1/...).
 *    Если сервер недоступен — используем встроенный seed (offline-first).
 * 2. Создание NCR: пишем всегда в локальную очередь (localStorage),
 *    затем синхронизатор отправляет на POST /api/v1/ncr.
 *    Онлайн — отправка сразу; офлайн — запись висит «в памяти» до появления сети.
 */
(function () {
  "use strict";

  var API_BASE = "";              // тот же origin: фронтенд отдаёт сам FastAPI
  var QUEUE_KEY = "fastcapa_ncr_queue";   // локальные NCR (очередь на синхронизацию)
  var DICT_CACHE_KEY = "fastcapa_dict_cache_v3";  // v3: игнорирует старый (возможно пустой) кэш v2
  var MAX_FILES = 5;

  var apiOnline = false;          // доступность backend (может отличаться от navigator.onLine)
  var attachedFiles = [];         // вложения текущей формы (не сериализуем в localStorage)

  // ==================== СПРАВОЧНИКИ (fallback seed) ====================

  // Справочник «Локации» (иерархия L1–L4)
  // L1: Предприятие → L2: Департаменты/Цеха → L3: Отделы/Участки → L4: Рабочее место/Оборудование
  var FALLBACK_LOCATIONS = [
    {
      name: "Завод «Тяжелое Машиностроение»", level: 1,
      children: [
        // ===== БЛОК А: Офисные подразделения (Администрация и ИТР) =====
        {
          name: "1. Производство", level: 2,
          children: [
            {
              name: "1.1. Отдел Главного Технолога (ОГТ)", level: 3,
              children: [
                { name: "1.1.1. Серверная АСУ ТП (Офис ОГТ)", level: 4 },
                { name: "1.1.2. Рабочее место инженера-конструктора (ПК + CAD)", level: 4 }
              ]
            },
            {
              name: "1.2. Производственно-диспетчерский отдел (ПДО)", level: 3,
              children: [
                { name: "1.2.1. Диспетчерский пульт (Мониторинг станков)", level: 4 },
                { name: "1.2.2. Планшет мастера смены (Mobile device)", level: 4 }
              ]
            }
          ]
        },
        {
          name: "2. Качество (ОТК)", level: 2,
          children: [
            {
              name: "2.1. Лаборатория метрологии", level: 3,
              children: [
                { name: "2.1.1. Измерительная машина (CMM)", level: 4 },
                { name: "2.1.2. Эталонный стенд настройки", level: 4 }
              ]
            },
            {
              name: "2.2. Отдел контроля качества", level: 3,
              children: [
                { name: "2.2.1. Рабочее место контролера ОТК (Стол + Лупа)", level: 4 },
                { name: "2.2.2. Шкаф для хранения образцов брака", level: 4 }
              ]
            }
          ]
        },
        {
          name: "3. Снабжение", level: 2,
          children: [
            {
              name: "3.1. Отдел закупок", level: 3,
              children: [
                { name: "3.1.1. Сервер 1С:Закупки", level: 4 },
                { name: "3.1.2. Рабочее место менеджера по тендерам", level: 4 }
              ]
            }
          ]
        },
        {
          name: "4. ИТ и Цифровизация", level: 2,
          children: [
            {
              name: "4.1. Отдел инфраструктуры", level: 3,
              children: [
                { name: "4.1.1. Серверная стойка (Шкаф №1)", level: 4 },
                { name: "4.1.2. Коммутатор ядра сети", level: 4 }
              ]
            }
          ]
        },
        {
          name: "5. Персонал (HR)", level: 2,
          children: [
            {
              name: "5.1. Отдел кадров", level: 3,
              children: [
                { name: "5.1.1. Папки личных дел сотрудников", level: 4 },
                { name: "5.1.2. Сканер паспортов (МФУ)", level: 4 }
              ]
            }
          ]
        },
        {
          name: "6. Финансы", level: 2,
          children: [
            {
              name: "6.1. Бухгалтерия", level: 3,
              children: [
                { name: "6.1.1. Сервер 1С:Бухгалтерия", level: 4 },
                { name: "6.1.2. Касса (ККТ)", level: 4 }
              ]
            }
          ]
        },
        {
          name: "7. Дирекция", level: 2,
          children: [
            {
              name: "7.1. Кабинет Генерального директора", level: 3,
              children: [
                { name: "7.1.1. Видеостена в переговорной", level: 4 }
              ]
            },
            {
              name: "7.2. Юридический отдел", level: 3,
              children: [
                { name: "7.2.1. Шкаф архива договоров", level: 4 }
              ]
            }
          ]
        },
        // ===== БЛОК Б: Производственные подразделения =====
        {
          name: "8. Цех №1 (Литейный)", level: 2,
          children: [
            {
              name: "8.1. Плавильный участок", level: 3,
              children: [
                { name: "8.1.1. Индукционная печь ИСТ-2", level: 4 },
                { name: "8.1.2. Ковш разливочный (Инв. №55)", level: 4 }
              ]
            },
            {
              name: "8.2. Участок формовки", level: 3,
              children: [
                { name: "8.2.1. Автоматическая линия формовки", level: 4 },
                { name: "8.2.2. Система вытяжки газов", level: 4 }
              ]
            }
          ]
        },
        {
          name: "9. Цех №2 (Механический)", level: 2,
          children: [
            {
              name: "9.1. Участок ЧПУ", level: 3,
              children: [
                { name: "9.1.1. Токарный станок с ЧПУ (DMG)", level: 4 },
                { name: "9.1.2. Фрезерный обрабатывающий центр", level: 4 }
              ]
            },
            {
              name: "9.2. Участок слесарной сборки", level: 3,
              children: [
                { name: "9.2.1. Верстак сборочный №4", level: 4 },
                { name: "9.2.2. Пневмоинструмент (гайковерт)", level: 4 }
              ]
            }
          ]
        },
        {
          name: "10. Цех №3 (Сборочный)", level: 2,
          children: [
            {
              name: "10.1. Участок сварки", level: 3,
              children: [
                { name: "10.1.1. Пост сварщика №1", level: 4 }
              ]
            }
          ]
        }
      ]
    }
  ];

  var FALLBACK_PROCESSES = [
    { name: "Производство", children: ["Сварка", "Покраска", "Сборка", "Механическая обработка", "Брак", "Остановка", "Ошибка в документации"] },
    { name: "Закупки", children: ["Входной контроль", "Логистика", "Выбор поставщика"] },
    { name: "HR", children: [] },
    { name: "Продажи", children: ["Дилерская сеть", "Отгрузка"] }
  ];

  var FALLBACK_CATEGORIES = [
    { code: "C-01", name: "Производственный брак", topics: "Геометрия, Царапина, Цвет, Комплектация" },
    { code: "C-02", name: "Охрана труда", topics: "Отсутствие СИЗ, Нарушение ТБ, Травма" },
    { code: "C-03", name: "Документация", topics: "Ошибка в чертеже, Устаревшая инструкция" },
    { code: "C-04", name: "Логистика", topics: "Задержка поставки, Бой при транспортировке" }
  ];

  var SEVERITIES = [
    { code: "S-1", name: "Критический", color: "#d64545", sla: "15 мин · остановка линии, травма" },
    { code: "S-2", name: "Высокий", color: "#e8830c", sla: "1 час · брак партии" },
    { code: "S-3", name: "Средний", color: "#d4a017", sla: "8 часов · смена" },
    { code: "S-4", name: "Низкий", color: "#1a7f37", sla: "72 часа · эстетика" }
  ];

  // Активные справочники (заполняются при инициализации)
  var LOCATIONS = FALLBACK_LOCATIONS;
  var PROCESSES = FALLBACK_PROCESSES;
  var CATEGORIES = FALLBACK_CATEGORIES;

  // ==================== API-СЛОЙ ====================

  function apiFetch(path, options) {
    return fetch(API_BASE + path, options).then(function (resp) {
      if (!resp.ok) throw new Error("API " + resp.status);
      return resp.json();
    });
  }

  function fetchDictionaries() {
    return Promise.all([
      apiFetch("/api/v1/locations/tree"),
      apiFetch("/api/v1/processes/tree"),
      apiFetch("/api/v1/categories/tree")
    ]).then(function (results) {
      // Защита: пустой/битый ответ сервера не должен затирать fallback
      if (!Array.isArray(results[0]) || !results[0].length ||
          !Array.isArray(results[1]) || !results[1].length ||
          !Array.isArray(results[2]) || !results[2].length) {
        throw new Error("Пустой ответ справочников от сервера");
      }

      // Конвертация формата backend → формат клиента
      LOCATIONS = results[0].map(convertBackendLocation);
      PROCESSES = results[1].map(convertBackendProcess);
      CATEGORIES = convertBackendCategories(results[2]);
      apiOnline = true;

      // Кэш справочников: следующий офлайн-запуск покажет свежие данные.
      // Кэшируем только непустые справочники.
      try {
        localStorage.setItem(DICT_CACHE_KEY, JSON.stringify({
          locations: LOCATIONS, processes: PROCESSES, categories: CATEGORIES
        }));
      } catch (e) { /* квота — не критично */ }

      return true;
    });
  }

  function convertBackendLocation(node) {
    return {
      id: node.id,
      name: node.name,
      level: node.level,
      children: (node.children || []).map(convertBackendLocation)
    };
  }

  function convertBackendProcess(node) {
    return {
      id: node.id,
      name: node.name,
      children: (node.children || []).map(function (c) { return { id: c.id, name: c.name, children: [] }; })
    };
  }

  function convertBackendCategories(nodes) {
    // backend: [{code, name, children:[{code, name}]}] → плоский список L1
    return nodes.map(function (c) {
      var topics = (c.children || []).map(function (ch) { return ch.name; }).join(", ");
      return { code: c.code, name: c.name.replace(/^\[[A-Z]+\]\s*/, ""), topics: topics || "—" };
    });
  }

  function loadDictCache() {
    try {
      var raw = localStorage.getItem(DICT_CACHE_KEY);
      if (!raw) return false;
      var cache = JSON.parse(raw);
      // Кэш применяется только если в нём непустые справочники
      if (cache.locations && cache.locations.length &&
          cache.processes && cache.processes.length &&
          cache.categories && cache.categories.length) {
        LOCATIONS = cache.locations;
        PROCESSES = cache.processes;
        CATEGORIES = cache.categories;
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  // ==================== ОЧЕРЕДЬ NCR (offline-first) ====================

  function loadQueue() {
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  // Убрать фото (dataUrl) из записи — используется при переполнении localStorage
  function stripDataUrls(n) {
    return Object.assign({}, n, {
      attachments: (n.attachments || []).map(function (a) {
        return Object.assign({}, a, { dataUrl: null });
      })
    });
  }

  function saveQueue(q) {
    // Ступени экономии: 1) как есть → 2) фото только у самой свежей записи → 3) совсем без фото.
    // Сами записи (текст, локация, статус) сохраняются всегда — данные важнее вложений.
    var attempts = [
      q,
      q.map(function (n, i) { return i === 0 ? n : stripDataUrls(n); }),
      q.map(stripDataUrls)
    ];
    for (var i = 0; i < attempts.length; i++) {
      try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(attempts[i]));
        if (i > 0) {
          console.warn("FastCAPA: вложения частично выгружены (ступень " + (i + 1) + ") — превышен объём localStorage.");
        }
        return true;
      } catch (e) { /* пробуем следующую ступень */ }
    }
    console.error("FastCAPA: не удалось сохранить NCR — localStorage переполнен.");
    return false;
  }

  function generateLocalId() {
    return "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  }

  // Синхронизатор: отправляет все записи со статусом local
  function syncQueue() {
    var queue = loadQueue();
    var pending = queue.filter(function (n) { return n.sync === "local"; });
    if (pending.length === 0) {
      updateNetBadge();
      return Promise.resolve();
    }

    var ids = pending.map(function (n) { return n.clientRef; });

    return Promise.all(pending.map(function (item) {
      return apiFetch("/api/v1/ncr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.description ? item.description.slice(0, 80) : ("NCR " + item.locationL4),
          description: item.description,
          severity: severityToApi(item.severity),
          asset_id: item.locationL4Id || null,
          process_id: item.processId || null,
          category_code: item.category || null,
          client_ref: item.clientRef
        })
      }).then(function (ack) {
        item.sync = "synced";
        item.serverId = ack.server_id;
        return null;
      }).catch(function () {
        return item.clientRef; // останется local, попробуем в следующий раз
      });
    })).then(function (failed) {
      saveQueue(queue);
      var stillLocal = failed.filter(Boolean).length;
      renderSaved();
      updateSubmit();
      if (stillLocal > 0) {
        console.info("FastCAPA: " + stillLocal + " NCR ждут синхронизации");
      }
      updateNetBadge();
    });
  }

  function severityToApi(code) {
    var map = { "S-1": "critical", "S-2": "high", "S-3": "medium", "S-4": "low" };
    return map[code] || "medium";
  }

  // ==================== УТИЛИТЫ ====================

  function $(id) { return document.getElementById(id); }

  function fillSelect(select, items, placeholder, disabled) {
    select.innerHTML = "";
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    select.appendChild(ph);
    items.forEach(function (item) {
      var normalized = (typeof item === "string")
        ? { value: item, label: item }
        : {
            value: item.value !== undefined ? item.value : (item.id || item.name),
            label: item.label !== undefined ? item.label : item.name
          };
      var opt = document.createElement("option");
      opt.value = normalized.value;
      opt.textContent = normalized.label;
      select.appendChild(opt);
    });
    select.disabled = !!disabled;
  }

  function findNode(nodes, value) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].name === value || nodes[i].id === value) return nodes[i];
    }
    return null;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ==================== КАСКАД ЛОКАЦИЙ ====================

  var selL1 = $("loc-l1"), selL2 = $("loc-l2"), selL3 = $("loc-l3"), selL4 = $("loc-l4");

  function initLocationCascade() {
    fillSelect(selL1, LOCATIONS, "— выберите —");
    fillSelect(selL2, [], "— сначала выберите L1 —", true);
    fillSelect(selL3, [], "— сначала выберите L2 —", true);
    fillSelect(selL4, [], "— сначала выберите L3 —", true);

    selL1.addEventListener("change", function () {
      var l1 = findNode(LOCATIONS, selL1.value);
      fillSelect(selL2, l1 ? l1.children : [], "— сначала выберите L1 —", !l1);
      fillSelect(selL3, [], "— сначала выберите L2 —", true);
      fillSelect(selL4, [], "— сначала выберите L3 —", true);
      updateSubmit();
    });

    selL2.addEventListener("change", function () {
      var l1 = findNode(LOCATIONS, selL1.value);
      var l2 = l1 ? findNode(l1.children, selL2.value) : null;
      fillSelect(selL3, l2 ? l2.children : [], "— сначала выберите L2 —", !l2);
      fillSelect(selL4, [], "— сначала выберите L3 —", true);
      updateSubmit();
    });

    selL3.addEventListener("change", function () {
      var l1 = findNode(LOCATIONS, selL1.value);
      var l2 = l1 ? findNode(l1.children, selL2.value) : null;
      var l3 = l2 ? findNode(l2.children, selL3.value) : null;
      fillSelect(selL4, l3 ? l3.children : [], "— сначала выберите L3 —", !l3);
      updateSubmit();
    });

    selL4.addEventListener("change", updateSubmit);
  }

  // ==================== ПРОЦЕССЫ (L1 → L2) ====================

  var selP1 = $("process-l1"), selP2 = $("process-l2");

  function initProcesses() {
    fillSelect(selP1, PROCESSES, "— выберите —");
    fillSelect(selP2, [], "— сначала выберите процесс —", true);

    selP1.addEventListener("change", function () {
      var p = findNode(PROCESSES, selP1.value);
      fillSelect(selP2, p ? p.children : [], "— сначала выберите процесс —", !p);
    });
  }

  // ==================== КАТЕГОРИИ ====================

  var selCategory = $("category");

  function initCategories() {
    fillSelect(
      selCategory,
      CATEGORIES.map(function (c) {
        return { value: c.code, label: c.code + " · " + c.name + (c.topics && c.topics !== "—" ? " (" + c.topics + ")" : "") };
      }),
      "— выберите —"
    );
  }

  // ==================== ПРИОРИТЕТЫ ====================

  function initSeverities() {
    var group = $("severity-group");
    group.innerHTML = "";
    SEVERITIES.forEach(function (s, idx) {
      var label = document.createElement("label");
      label.className = "severity-option severity-option--" + s.code.toLowerCase();

      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "severity";
      radio.value = s.code;
      radio.checked = idx === 0;

      var dot = document.createElement("span");
      dot.className = "severity-option__dot";
      dot.style.background = s.color;

      var name = document.createElement("span");
      name.textContent = s.code + " · " + s.name;

      var sla = document.createElement("span");
      sla.className = "severity-option__sla";
      sla.textContent = s.sla;

      label.appendChild(radio);
      label.appendChild(dot);
      label.appendChild(name);
      label.appendChild(sla);
      group.appendChild(label);
    });
  }

  // ==================== ГОЛОС (FAB) ====================

  var voiceBtn = $("voice-btn"), voiceStatus = $("voice-status");

  function initVoice() {
    var started = false, mediaRecorder = null, chunks = [], audioBlob = null;

    function startRecording() {
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        voiceStatus.hidden = false;
        voiceStatus.textContent = "Запись недоступна в этом браузере (нет MediaRecorder).";
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        chunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = function (e) { chunks.push(e.data); };
        mediaRecorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          audioBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
          voiceStatus.hidden = false;
          voiceStatus.textContent = "Записано " + (audioBlob.size / 1024).toFixed(0) +
            " КБ аудио. Файл будет отправлен на сервер вместе с NCR (ASR/GigaChat на backend).";
        };
        mediaRecorder.start();
        started = true;
        voiceBtn.classList.add("fab--recording");
        voiceStatus.hidden = false;
        voiceStatus.textContent = "🔴 Идёт запись… отпустите кнопку для остановки";
      }).catch(function () {
        voiceStatus.hidden = false;
        voiceStatus.textContent = "Нет доступа к микрофону.";
      });
    }

    function stopRecording() {
      if (started && mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        started = false;
        voiceBtn.classList.remove("fab--recording");
      }
    }

    voiceBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); startRecording(); });
    voiceBtn.addEventListener("pointerup", stopRecording);
    voiceBtn.addEventListener("pointerleave", stopRecording);
    voiceBtn.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    // Доступ к записанному blob при отправке формы
    voiceBtn._getAudio = function () { return audioBlob; };
    voiceBtn._resetAudio = function () { audioBlob = null; voiceStatus.hidden = true; };
  }

  // ==================== ФОТО/ВИДЕО ====================

  function initPhotos() {
    var input = $("photos"), previews = $("photo-previews");
    var camInput = $("photos-camera");

    // Кнопка «Сделать фото» — на телефоне открывает камеру (capture=environment)
    if (camInput) {
      $("btn-camera").addEventListener("click", function () { camInput.click(); });
      camInput.addEventListener("change", function () { handleFiles(camInput.files); });
    }
    $("btn-photos").addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () { handleFiles(input.files); });

    function handleFiles(fileList) {
      var files = Array.from(fileList || []);
      attachedFiles = [];

      var selected = files.slice(0, MAX_FILES);
      previews.innerHTML = "";

      var pending = selected.length;
      if (pending === 0) return;

      selected.forEach(function (file) {
        if (file.type.indexOf("image/") === 0) {
          compressImage(file, 900, 0.62, function (compressed) {
            attachedFiles.push(compressed);
            addPreview(previews, compressed.name, compressed.url);
          });
        } else {
          attachedFiles.push({ name: file.name, type: file.type, size: file.size, blob: file, url: null });
          addPreview(previews, file.name, null);
        }
      });
    }

    function addPreview(container, name, url) {
      var box = document.createElement("div");
      box.className = "preview";
      if (url) {
        var img = document.createElement("img");
        img.src = url;
        box.appendChild(img);
      }
      var label = document.createElement("span");
      label.className = "preview__label";
      label.textContent = name;
      box.appendChild(label);
      container.appendChild(box);
    }
  }

  function compressImage(file, maxWidth, quality, callback) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var scale = Math.min(1, maxWidth / img.width);
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        callback({
          name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
          type: "image/jpeg",
          size: blob.size,
          blob: blob,
          url: canvas.toDataURL("image/jpeg", quality)
        });
        URL.revokeObjectURL(url);
      }, "image/jpeg", quality);
    };
    img.onerror = function () {
      // Формат не поддерживается (например, HEIC) — пропускаем с уведомлением
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // ==================== СЕТЬ / КНОПКА ====================

  var submitBtn = $("submit-btn");

  function updateNetBadge() {
    var badge = $("net-badge");
    var online = navigator.onLine && apiOnline;
    badge.textContent = online ? "СЕРВЕР: OK" : (navigator.onLine ? "СЕРВЕР: НЕТ СВЯЗИ" : "OFFLINE");
    badge.className = "net-badge " + (online ? "net-badge--online" : "net-badge--offline");
  }

  function validate() {
    var l4ok = !!selL4.value;
    $("loc-l4-error").hidden = l4ok;
    var hasContent = !!$("description").value.trim() || attachedFiles.length > 0;
    var summary = $("form-summary");
    var formOk = l4ok && hasContent;
    summary.textContent = !l4ok
      ? "Выберите L4 — конкретный объект/место (каскад: L1 → L2 → L3 → L4)."
      : (!hasContent ? "Добавьте описание или фото — хотя бы одно." : "Готово к сохранению");
    return formOk;
  }

  function updateSubmit() {
    submitBtn.disabled = !validate();
    if (!navigator.onLine) {
      submitBtn.textContent = "💾 СОХРАНИТЬ В ПАМЯТЬ";
      submitBtn.classList.add("submit-btn--offline");
    } else {
      submitBtn.textContent = "✅ Зарегистрировать NCR";
      submitBtn.classList.remove("submit-btn--offline");
    }
  }

  $("ncr-form").addEventListener("change", updateSubmit);
  $("description").addEventListener("input", updateSubmit);
  window.addEventListener("online", function () { updateSubmit(); checkApiAndSync(); });
  window.addEventListener("offline", updateSubmit);

  function checkApiAndSync() {
    apiFetch("/health").then(function () {
      apiOnline = true;
      updateNetBadge();
      syncQueue();
    }).catch(function () {
      apiOnline = false;
      updateNetBadge();
    });
  }

  // ==================== ОТПРАВКА ФОРМЫ ====================

  $("ncr-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) return;

    var clientRef = generateLocalId();
    var severityCode = (document.querySelector('input[name="severity"]:checked') || {}).value || "S-3";
    // Логика этапа 1: сначала ВСЕГДА регистрация со статусом «Новый».
    // Взять в работу / назначить ответственного — отдельные действия в карточке NCR.
    var initialStatus = "new";

    var record = {
      clientRef: clientRef,
      localId: "NCR-" + new Date().getFullYear() + "-" + String(Date.now()).slice(-4),
      location: [selL1.value, selL2.value, selL3.value, selL4.value].filter(Boolean).join(" / "),
      locationL4: selL4.value,
      // Если справочники из API — value это UUID; для fallback — название
      locationL4Id: selL4.value,
      description: $("description").value.trim(),
      category: selCategory.value,
      process: [selP1.value, selP2.value].filter(Boolean).join(" / "),
      processId: selP2.value || selP1.value || null,
      severity: severityCode,
      attachmentsMeta: attachedFiles.map(function (f) { return { name: f.name, type: f.type, size: f.size }; }),
      // Сами вложения (dataUrl только у изображений) — для карточки/монитора без сервера
      attachments: attachedFiles.map(function (f) { return { name: f.name, type: f.type, size: f.size, dataUrl: f.url || null }; }),
      // Этап 1 (Manual Workflow): сначала всегда регистрация → «Новый»
      status: initialStatus,
      assignee: null,
      history: [
        {
          ts: new Date().toISOString(),
          action: "created",
          user: window.FastCAPAStore ? window.FastCAPAStore.currentUser() : "—",
          note: "Зарегистрировано → Новый"
        }
      ],
      sync: "local",
      createdAt: new Date().toISOString()
    };

    var queue = loadQueue();
    queue.unshift(record);
    saveQueue(queue);

    // Аудио: если записано и сервер доступен — отправляем следом (ASR задним числом)
    var audio = voiceBtn._getAudio ? voiceBtn._getAudio() : null;

    // Очистка формы
    this.reset();
    attachedFiles = [];
    $("photo-previews").innerHTML = "";
    if (voiceBtn._resetAudio) voiceBtn._resetAudio();
    fillSelect(selL2, [], "— сначала выберите L1 —", true);
    fillSelect(selL3, [], "— сначала выберите L2 —", true);
    fillSelect(selL4, [], "— сначала выберите L3 —", true);
    fillSelect(selP2, [], "— сначала выберите процесс —", true);
    initSeverities();

    renderSaved();
    updateSubmit();

    // Синхронизация сразу (если сервер доступен)
    syncQueue().then(function () {
      if (audio && apiOnline && record.serverId) {
        sendVoice(record.serverId, audio);
      }
    });
  });

  function sendVoice(serverId, blob) {
    var form = new FormData();
    form.append("file", blob, "voice.webm");
    fetch(API_BASE + "/api/v1/ncr/" + serverId + "/voice", { method: "POST", body: form })
      .then(function (r) { if (!r.ok) throw new Error(r.status); })
      .catch(function (err) { console.warn("FastCAPA: голос не отправлен", err); });
  }

  // ==================== СПИСОК СОХРАНЁННЫХ ====================

  function renderSaved() {
    var list = loadQueue();
    var container = $("saved-list");
    container.innerHTML = "";
    $("saved-empty").hidden = list.length > 0;
    $("saved-count").textContent = list.length;
    $("ncr-counter").textContent = "NCR: " + list.length;

    list.forEach(function (item) {
      var sev = SEVERITIES.find(function (s) { return s.code === item.severity; }) || SEVERITIES[2];

      var el = document.createElement("article");
      el.className = "ncr-item";

      var top = document.createElement("div");
      top.className = "ncr-item__top";

      var left = document.createElement("div");
      left.innerHTML =
        '<div class="ncr-item__id">' + escapeHtml(item.localId || item.clientRef) + "</div>" +
        '<div class="ncr-item__title">' + escapeHtml(item.location) + "</div>" +
        '<div class="ncr-item__meta">' +
        new Date(item.createdAt).toLocaleString("ru-RU") +
        " · " + escapeHtml(item.category || "без категории") +
        (item.process ? " · процесс: " + escapeHtml(item.process) : "") +
        " · файлов: " + item.attachmentsMeta.length +
        (item.serverId ? " · server_id: " + escapeHtml(String(item.serverId).slice(0, 8)) : "") +
        "</div>" +
        '<div class="ncr-item__desc">' + escapeHtml(item.description || "(без описания)") + "</div>";

      var right = document.createElement("div");
      right.innerHTML =
        '<span class="badge badge--' + sev.code.toLowerCase() + '">' + sev.code + "</span> " +
        '<span class="badge badge--' + (item.sync === "local" ? "local" : "synced") + '">' +
        (item.sync === "local" ? "в памяти" : "синхронизирован") + "</span>";

      top.appendChild(left);
      top.appendChild(right);
      el.appendChild(top);
      container.appendChild(el);
    });
  }

  // ==================== ИНИЦИАЛИЗАЦИЯ ====================

  // 1) мгновенный старт: кэш справочников или fallback seed
  loadDictCache();
  initLocationCascade();
  initProcesses();
  initCategories();
  initSeverities();
  initVoice();
  initPhotos();
  updateSubmit();
  renderSaved();
  updateNetBadge();

  // 2) затем пытаемся подтянуть актуальные справочники с backend
  fetchDictionaries().then(function (ok) {
    if (ok) {
      // Перерисовываем селекты свежими данными
      initLocationCascade();
      initProcesses();
      initCategories();
      updateNetBadge();
    }
  }).catch(function () {
    updateNetBadge(); // fallback уже отрисован
  });

  checkApiAndSync();
})();
