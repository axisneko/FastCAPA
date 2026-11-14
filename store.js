/* FastCAPA — общий модуль данных NCR + CAPA
 *
 * Используется страницами monitor.html, capa-monitor.html, ncr-view.html, capa.html.
 * Единая точка чтения/записи очереди NCR (localStorage), реестра CAPA,
 * справочников (приоритеты, статусы, бейджи синхронизации).
 *
 * Статусная модель NCR (Manual Workflow, этап 1 — отработка инцидента):
 *   new                  → in_progress → pending_verification → closed
 *   new → pending_verification (Quick Fix «Устранить на месте»)
 *   любой (до closed)    → rejected
 *
 * Статусная модель CAPA (этап 2 — корректирующие действия):
 *   draft → in_progress → observation («CAPA разработан, наблюдение») → closed
 *   NCR можно закрыть и без CAPA; отметка «есть CAPA / нет CAPA» ставится
 *   по наличию CAPA, связанных с NCR (One-to-Many, связь по clientRef NCR).
 */
(function (global) {
  "use strict";

  var QUEUE_KEY = "fastcapa_ncr_queue";
  var CAPA_KEY = "fastcapa_capa_registry";
  // Период наблюдения CAPA ��о умолчанию (дней): до его истечения закрытие запрещено
  var OBSERVATION_DAYS_DEFAULT = 30;

  // ==================== CAPA: справочники ====================

  // Статусная модель CAPA
  // draft → in_progress → observation → closed
  var CAPA_STATUSES = [
    { key: "draft", label: "Черновик", badge: "capa-status--draft" },
    { key: "in_progress", label: "На исполнении", badge: "capa-status--in_progress" },
    { key: "observation", label: "CAPA разработан, наблюдение", badge: "capa-status--observation" },
    { key: "closed", label: "Закрыт", badge: "capa-status--closed" }
  ];

  // Типы действий (ISO): коррекция / корректирующее / предупреждающее
  var CAPA_ACTION_TYPES = [
    { key: "correction", label: "Коррекция", hint: "Устранить само несоответствие «сделал и забыл»" },
    { key: "corrective", label: "Корректирующее действие", hint: "Изменить процесс, чтобы не повторилось (5 Почему)" },
    { key: "preventive", label: "Предупреждающее", hint: "Проверить другие станки/участки этой серии" }
  ];

  // 5M — справочник типов корневой причины
  var CAPA_ROOT_CAUSE_TYPES = [
    { key: "method", label: "Метод" },
    { key: "machine", label: "Машина" },
    { key: "material", label: "Материал" },
    { key: "man", label: "Человек" },
    { key: "environment", label: "Среда" }
  ];

  // Итоги карточки завершения наблюдения (4 типа завершения)
  var CAPA_OBSERVATION_OUTCOMES = [
    { key: "confirmed", label: "Завершено · эффект подтверждён" },
    { key: "extended", label: "Продлить срок наблюдения" },
    { key: "not_confirmed", label: "Результат не подтверждён" },
    { key: "rework", label: "Отправить на доработку" }
  ];

  function getCapaObservationOutcome(key) {
    return CAPA_OBSERVATION_OUTCOMES.find(function (o) { return o.key === key; }) || null;
  }

  function getCapaStatus(key) {
    return CAPA_STATUSES.find(function (s) { return s.key === key; }) || CAPA_STATUSES[0];
  }

  function getCapaActionType(key) {
    return CAPA_ACTION_TYPES.find(function (t) { return t.key === key; }) || CAPA_ACTION_TYPES[0];
  }

  function getCapaRootCauseType(key) {
    return CAPA_ROOT_CAUSE_TYPES.find(function (t) { return t.key === key; }) || null;
  }

  // ==================== CAPA: хранилище (One-to-Many по clientRef NCR) ====================

  function normalizeCapa(c) {
    if (!c.status || !CAPA_STATUSES.some(function (s) { return s.key === c.status; })) {
      c.status = "draft";
    }
    if (!c.why || !c.why.length) c.why = [""]; // Уровень 1 — обязательный первый вопрос (существует всегда)
    // Действия: [{action, assignee, dueDate, status: pending|done, doneAt, doneNote}]
    c.actions = (c.actions || []).map(function (a) {
      return Object.assign({ status: "pending", doneAt: null, doneNote: "" }, a);
    });
    if (!c.attachments) c.attachments = [];
    if (!c.history) c.history = [];
    if (c.qmsDocRequired === undefined) c.qmsDocRequired = false;
    if (!c.observation) {
      c.observation = { result: "", attachments: [], reworkCount: 0, extensions: [] };
    }
    return c;
  }

  function loadCapas() {
    try {
      var raw = localStorage.getItem(CAPA_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return list.map(normalizeCapa);
    } catch (e) {
      return [];
    }
  }

  // Экономия места: данные вложений (dataUrl) выгружаются первыми
  function stripCapaDataUrls(c) {
    return Object.assign({}, c, {
      attachments: (c.attachments || []).map(function (a) {
        return Object.assign({}, a, { dataUrl: null });
      })
    });
  }

  function saveCapas(list) {
    var attempts = [
      list,
      list.map(stripCapaDataUrls)
    ];
    for (var i = 0; i < attempts.length; i++) {
      try {
        localStorage.setItem(CAPA_KEY, JSON.stringify(attempts[i]));
        return true;
      } catch (e) { /* пробуем следующую ступень */ }
    }
    console.error("FastCAPA: не удалось сохранить CAPA — localStorage переполнен.");
    return false;
  }

  // Все CAPA, связанные с данным NCR
  function loadCapasByNcr(ncrRef) {
    return loadCapas().filter(function (c) { return c.ncrRef === ncrRef; });
  }

  // Отметка для NCR: «есть CAPA» / «нет CAPA»
  function hasCapa(ncrRef) {
    return loadCapasByNcr(ncrRef).length > 0;
  }

  // Создать CAPA из NCR: контекст (Локация, Оборудование, Описание) копируется из NCR
  function createCapaFromNcr(ncr, author) {
    var list = loadCapas();
    var now = new Date().toISOString();
    var capa = normalizeCapa({
      id: "CAPA-" + new Date().getFullYear() + "-" + String(Date.now()).slice(-6),
      ncrRef: ncr.clientRef,
      ncrLocalId: ncr.localId || ncr.clientRef,
      // Контекст из NCR
      context: {
        location: ncr.location || "",
        equipment: ncr.location || "",       // Оборудование = L4-локация (конкретный станок/место)
        description: ncr.description || ""
      },
      why: [""],                              // 5 Why: первый вопрос всегда есть, дальше — до 5 уровней
      rootCauseType: "",                      // 5M-справочник
      rootCauseText: "",
      actionType: "corrective",
      qmsDocRequired: false,
      actions: [],
      attachments: [],
      observationUntil: null,                 // срок окончания периода наблюдения
      status: "draft",
      createdAt: now,
      createdBy: author || "—",
      history: [{ ts: now, action: "created", user: author || "—", note: "Создан из NCR " + (ncr.localId || ncr.clientRef) }]
    });
    list.push(capa);
    saveCapas(list);
    return capa;
  }

  // Обновить CAPA по id
  function updateCapa(capaId, updater) {
    var list = loadCapas();
    var capa = list.find(function (c) { return c.id === capaId; });
    if (!capa) return null;
    updater(capa);
    saveCapas(list);
    return capa;
  }

  // Запись в историю CAPA
  function addCapaHistory(capa, action, user, note) {
    capa.history.push({
      ts: new Date().toISOString(),
      action: action,
      user: user || "—",
      note: note || ""
    });
  }

  // ==================== Уведомления ====================

  var NOTIFICATIONS_KEY = "fastcapa_notifications";

  // Уведомления для всех (MVP без бэкенда: общий ящик; после «Отправить на
  // исполнение» исполнители видят свои действия в списке)
  function loadNotifications() {
    try {
      var raw = localStorage.getItem(NOTIFICATIONS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveNotifications(list) {
    try {
      localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(list.slice(0, 200)));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Добавить уведомление. recipients — массив имён (пусто/undefined = всем)
  function pushNotification(n) {
    var list = loadNotifications();
    list.unshift({
      id: "N-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      ts: new Date().toISOString(),
      readBy: [],
      recipients: n.recipients || null,      // null → для всех
      title: n.title || "",
      text: n.text || "",
      link: n.link || null                    // например "capa.html?ref=..."
    });
    saveNotifications(list);
  }

  // Уведомления, видимые текущему пользователю
  function notificationsFor(user) {
    return loadNotifications().filter(function (n) {
      return !n.recipients || n.recipients.indexOf(user) !== -1;
    });
  }

  function unreadNotificationsCount(user) {
    return notificationsFor(user).filter(function (n) {
      return (n.readBy || []).indexOf(user) === -1;
    }).length;
  }

  // Отметить всё прочитанным для пользователя
  function markNotificationsRead(user) {
    var list = loadNotifications();
    var changed = false;
    list.forEach(function (n) {
      var visible = !n.recipients || n.recipients.indexOf(user) !== -1;
      if (visible && (n.readBy || []).indexOf(user) === -1) {
        n.readBy = (n.readBy || []).concat([user]);
        changed = true;
      }
    });
    if (changed) saveNotifications(list);
  }

  // Начать период наблюдения: CAPA переходит в observation до observationUntil
  function startObservation(capa, days) {
    var d = typeof days === "number" && days > 0 ? days : OBSERVATION_DAYS_DEFAULT;
    var until = new Date();
    until.setDate(until.getDate() + d);
    capa.observationUntil = until.toISOString();
  }

  // Период наблюдения завершён? (проверка на момент вызова)
  function observationCompleted(capa) {
    if (!capa.observationUntil) return false;
    return new Date(capa.observationUntil).getTime() <= Date.now();
  }

  // ==================== Справочники NCR ====================

  // Справочник приоритетов (единый с формой регистрации)
  var SEVERITIES = [
    { code: "S-1", name: "Критический", color: "#d64545", sla: "15 мин · остановка линии, травма" },
    { code: "S-2", name: "Высокий", color: "#e8830c", sla: "1 час · брак партии" },
    { code: "S-3", name: "Средний", color: "#d4a017", sla: "8 часов · смена" },
    { code: "S-4", name: "Низкий", color: "#1a7f37", sla: "72 часа · эстетика" }
  ];

  // Статусная модель NCR (этап 1 — отработка инцидента)
  // new → assigned → in_progress → pending_verification → closed
  var STATUSES = [
    { key: "new", label: "Новый", badge: "status--new" },
    { key: "assigned", label: "Передано в работу", badge: "status--assigned" },
    { key: "in_progress", label: "В работе", badge: "status--in_progress" },
    { key: "pending_verification", label: "На проверке", badge: "status--pending" },
    { key: "closed", label: "Закрыт", badge: "status--closed" },
    { key: "rejected", label: "Отклонено", badge: "status--rejected" }
  ];

  function getStatus(key) {
    return STATUSES.find(function (s) { return s.key === key; }) || STATUSES[0];
  }

  function getSeverity(code) {
    return SEVERITIES.find(function (s) { return s.code === code; }) || SEVERITIES[2];
  }

  // Миграция: старые записи без статуса → new
  function normalize(item) {
    if (!item.status || !STATUSES.some(function (s) { return s.key === item.status; })) {
      item.status = "new";
    }
    if (!item.history) item.history = [];
    return item;
  }

  function loadQueue() {
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return list.map(normalize);
    } catch (e) {
      return [];
    }
  }

  // Сохранение очереди со ступенями экономии (фото «весят» больше квоты localStorage).
  // Сами записи (текст, статусы) сохраняются всегда — данные важнее вложений.
  function stripDataUrls(n) {
    var clone = Object.assign({}, n, {
      attachments: (n.attachments || []).map(function (a) {
        return Object.assign({}, a, { dataUrl: null });
      })
    });
    if (clone.correction && clone.correction.photos) {
      clone.correction = Object.assign({}, clone.correction, {
        photos: clone.correction.photos.map(function (a) {
          return Object.assign({}, a, { dataUrl: null });
        })
      });
    }
    return clone;
  }

  function saveQueue(q) {
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

  // Обновить одну запись (по clientRef) и сохранить очередь
  function updateItem(clientRef, updater) {
    var list = loadQueue();
    var item = list.find(function (n) { return n.clientRef === clientRef; });
    if (!item) return null;
    updater(item);
    saveQueue(list);
    return item;
  }

  // Запись в историю жизненного цикла (для аудита и будущего ИИ)
  function addHistory(item, action, user, note) {
    item.history.push({
      ts: new Date().toISOString(),
      action: action,
      user: user || "—",
      note: note || ""
    });
  }

  function syncLabel(item) {
    return item.sync === "local" ? "в памяти" : "синхронизирован";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString("ru-RU", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
  }

  // Полное количество файлов (включая аудио/видео — всё, что есть в attachments/attachmentsMeta)
  function attachmentsCount(item) {
    return (item.attachments && item.attachments.length) || (item.attachmentsMeta && item.attachmentsMeta.length) || 0;
  }

  // Имя текущего пользователя из сессии (локальная авторизация)
  function currentUser() {
    try {
      var raw = localStorage.getItem("fastcapa_session");
      var s = raw ? JSON.parse(raw) : null;
      return s ? (s.name || s.login || "—") : "—";
    } catch (e) {
      return "—";
    }
  }

  global.FastCAPAStore = {
    SEVERITIES: SEVERITIES,
    STATUSES: STATUSES,
    // CAPA
    CAPA_STATUSES: CAPA_STATUSES,
    CAPA_ACTION_TYPES: CAPA_ACTION_TYPES,
    CAPA_ROOT_CAUSE_TYPES: CAPA_ROOT_CAUSE_TYPES,
    CAPA_OBSERVATION_DAYS_DEFAULT: OBSERVATION_DAYS_DEFAULT,
    loadCapas: loadCapas,
    loadCapasByNcr: loadCapasByNcr,
    hasCapa: hasCapa,
    createCapaFromNcr: createCapaFromNcr,
    updateCapa: updateCapa,
    addCapaHistory: addCapaHistory,
    getCapaStatus: getCapaStatus,
    getCapaActionType: getCapaActionType,
    getCapaRootCauseType: getCapaRootCauseType,
    startObservation: startObservation,
    observationCompleted: observationCompleted,
    // Итоги наблюдения
    CAPA_OBSERVATION_OUTCOMES: CAPA_OBSERVATION_OUTCOMES,
    getCapaObservationOutcome: getCapaObservationOutcome,
    // Уведомления
    pushNotification: pushNotification,
    notificationsFor: notificationsFor,
    unreadNotificationsCount: unreadNotificationsCount,
    markNotificationsRead: markNotificationsRead,
    // NCR
    loadQueue: loadQueue,
    saveQueue: saveQueue,
    updateItem: updateItem,
    addHistory: addHistory,
    getStatus: getStatus,
    getSeverity: getSeverity,
    syncLabel: syncLabel,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    attachmentsCount: attachmentsCount,
    currentUser: currentUser,
    // Диагностика: сколько записей лежит в localStorage по ключу QUEUE_KEY
    debugCount: function () {
      var raw = null;
      try { raw = localStorage.getItem(QUEUE_KEY); } catch (e) { /* ignore */ }
      if (!raw) return { present: false, count: 0 };
      try {
        return { present: true, count: JSON.parse(raw).length };
      } catch (e) {
        return { present: true, count: -1 }; // данные есть, но повреждены
      }
    }
  };
})(window);
