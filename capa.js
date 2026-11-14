/* FastCAPA — Карточка CAPA (capa.html)
 *
 * Открывается по ссылке ncr-view.html / monitor.html → capa.html?ref=<capaId>,
 * либо по прямой ссылке создания capa.html?create=1&ncr=<clientRef>.
 *
 * Модель работы: CAPA загружается из localStorage ОДИН раз и далее живёт
 * в памяти (переменная capa). collectForm() собирает в память ТОЛЬКО свободные
 * поля формы (5 Why, корневая причина, тип действия, СМК) — план действий
 * управляется исключительно через память (модальное окно), поэтому его записи
 * не теряются при перерисовке. В localStorage CAPA попадает по явным действиям
 * («Сохранить черновик» / «Отправить на исполнение» / переходы статусов).
 *
 * Алгоритм отработки корректирующих действий:
 *   draft       → черновик; [Сохранить черновик] / [Отправить на исполнение]
 *                 (при отправке исполнителям уходят уведомления)
 *   in_progress → каждое действие исполнитель отмечает «Выполнено»
 *                 (автор CAPA получает уведомление); когда все действия
 *                 выполнены — доступен [Перевести в наблюдение]
 *   observation → «CAPA разработан, наблюдение» (исполнители уведомлены);
 *                 закрытие только после истечения периода наблюдения
 *   closed      → read-only (все участники уведомлены)
 */
(function () {
  "use strict";

  var root = document.getElementById("capa-root");
  var S = window.FastCAPAStore;
  var capa = null;         // CAPA живёт в памяти между перерисовками
  var capaFiles = [];      // вложения текущей формы
  var MAX_WHY = 5;

  var WHY_Q1 = "Почему случилось несоответствие?";

  // ==================== Lightbox ====================
  var lightbox = document.getElementById("lightbox");
  var lbImg = document.getElementById("lightbox-img");
  var lbVideo = document.getElementById("lightbox-video");
  var lbCaption = document.getElementById("lightbox-caption");
  var media = [];
  var mediaIndex = 0;

  function openLightbox(list, index) {
    media = list;
    mediaIndex = index;
    showMedia();
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function showMedia() {
    if (!media.length) return;
    var m = media[mediaIndex];
    if (m.type && m.type.indexOf("video/") === 0) {
      lbImg.hidden = true;
      lbVideo.hidden = false;
      lbVideo.src = m.src;
    } else {
      lbVideo.hidden = true;
      lbVideo.removeAttribute("src");
      lbImg.hidden = false;
      lbImg.src = m.src;
    }
    lbCaption.textContent = (mediaIndex + 1) + " / " + media.length + " · " + m.name;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lbImg.removeAttribute("src");
    lbVideo.removeAttribute("src");
    document.body.style.overflow = "";
  }

  function navLightbox(step) {
    if (!media.length) return;
    mediaIndex = (mediaIndex + step + media.length) % media.length;
    showMedia();
  }

  document.querySelector(".lightbox__close").addEventListener("click", closeLightbox);
  document.querySelector(".lightbox__nav--prev").addEventListener("click", function () { navLightbox(-1); });
  document.querySelector(".lightbox__nav--next").addEventListener("click", function () { navLightbox(1); });
  lightbox.addEventListener("click", function (e) { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeLightbox();
      closeActionModal();
      return;
    }
    if (lightbox.hidden) return;
    if (e.key === "ArrowLeft") navLightbox(-1);
    if (e.key === "ArrowRight") navLightbox(1);
  });

  // ==================== Сжатие фото ====================

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
          url: canvas.toDataURL("image/jpeg", quality)
        });
        URL.revokeObjectURL(url);
      }, "image/jpeg", quality);
    };
    img.onerror = function () { URL.revokeObjectURL(url); };
    img.src = url;
  }

  // ==================== Форма ↔ память ====================

  // Собрать в память ТОЛЬКО свободные поля формы. План действий здесь не
  // трогается: его источник — память capa.actions (модальное окно), поэтому
  // перерисовки и collectForm не могут его потерять или заменить.
  function collectForm() {
    // 5 Why
    var why = [];
    document.querySelectorAll("#why-stack .why-input").forEach(function (inp) {
      why.push(inp.value.trim());
    });
    if (why.length) capa.why = why;

    // Корневая причина
    capa.rootCauseType = (document.getElementById("capa-rootcause-type") || {}).value || "";
    capa.rootCauseText = ((document.getElementById("capa-rootcause-text") || {}).value || "").trim();

    // Тип действия, СМК
    capa.actionType = (document.getElementById("capa-action-type") || {}).value || "corrective";
    var qms = document.getElementById("capa-qms-doc");
    capa.qmsDocRequired = !!(qms && qms.checked);
  }

  function validate() {
    var errors = [];
    if (!capa.rootCauseType) errors.push("выберите тип корневой причины (5M)");
    if (!capa.rootCauseText) errors.push("сформулируйте корневую причину");
    if (!capa.actions.length) errors.push("добавьте хотя бы одно действие в план");
    capa.actions.forEach(function (a, i) {
      if (!a.action) errors.push("действие №" + (i + 1) + ": не заполнено описание");
      if (!a.assignee) errors.push("действие №" + (i + 1) + ": не указан ответственный");
      if (!a.dueDate) errors.push("действие №" + (i + 1) + ": не указан срок");
    });
    return errors;
  }

  // Записать текущее состояние CAPA в localStorage
  function persistChanges(historyAction, note) {
    S.updateCapa(capa.id, function (c) {
      c.why = capa.why;
      c.rootCauseType = capa.rootCauseType;
      c.rootCauseText = capa.rootCauseText;
      c.actionType = capa.actionType;
      c.qmsDocRequired = capa.qmsDocRequired;
      c.actions = capa.actions;
      c.status = capa.status;
      if (capa.observationUntil) c.observationUntil = capa.observationUntil;
      if (capaFiles.length) {
        c.attachments = c.attachments.concat(capaFiles.map(function (f) {
          return { name: f.name, type: f.type, size: f.size, dataUrl: f.url };
        }));
        capa.attachments = c.attachments;
        capaFiles = [];
      }
      if (historyAction) S.addCapaHistory(c, historyAction, S.currentUser(), note || "");
    });
  }

  function saveDraft() {
    collectForm();
    capa.status = "draft";
    persistChanges("draft_saved", "Черновик сохранён");
    render();
  }

  // ==================== Уведомления (сценарии CAPA) ====================

  function capaLink() {
    return "capa.html?ref=" + encodeURIComponent(capa.id);
  }

  // Уникальные исполнители по плану действий
  function actionAssignees() {
    var seen = {};
    var out = [];
    capa.actions.forEach(function (a) {
      if (a.assignee && !seen[a.assignee]) { seen[a.assignee] = true; out.push(a.assignee); }
    });
    return out;
  }

  function notifyCapaSubmitted() {
    S.pushNotification({
      recipients: actionAssignees(),
      title: "Назначено действие по CAPA " + capa.id,
      text: "План «" + (capa.context.description || "").slice(0, 80) + "»: вам назначено действие в CAPA. Откройте карточку и выполните его в срок.",
      link: capaLink()
    });
  }

  function notifyActionDone(actionItem) {
    if (S.currentUser() === capa.createdBy) return; // автор сам отметил — уведомление не нужно
    S.pushNotification({
      recipients: [capa.createdBy],
      title: "Действие выполнено · CAPA " + capa.id,
      text: "«" + actionItem.action.slice(0, 80) + "» — отметил: " + S.currentUser() + ".",
      link: capaLink()
    });
  }

  function notifyObservationStarted() {
    var rec = actionAssignees().concat([capa.createdBy]);
    S.pushNotification({
      recipients: rec,
      title: "CAPA " + capa.id + " — период наблюдения",
      text: "Все действия выполнены. Начался период наблюдения до " + S.formatDate(capa.observationUntil) + ".",
      link: capaLink()
    });
  }

  // ==================== Переходы статусов ====================

  function submitForExecution() {
    collectForm();
    var errors = validate();
    var err = document.getElementById("capa-error");
    if (errors.length) {
      err.hidden = false;
      err.textContent = "⚠ Исправьте перед отправкой: " + errors.join("; ") + ".";
      return;
    }
    err.hidden = true;
    capa.status = "in_progress";
    persistChanges("submit", "Отправлен на исполнение. Уведомлены: " + actionAssignees().join(", "));
    notifyCapaSubmitted();
    render();
  }

  // Все действия плана выполнены?
  function allActionsDone() {
    return capa.actions.length > 0 && capa.actions.every(function (a) { return a.status === "done"; });
  }

  // Исполнитель отметил действие выполненным
  function markActionDone(index) {
    var a = capa.actions[index];
    if (!a || a.status === "done") return;
    a.status = "done";
    a.doneAt = new Date().toISOString();
    a.doneBy = S.currentUser();
    persistChanges(null, "");
    notifyActionDone(a);
    render();
  }

  function moveToObservation() {
    if (!allActionsDone()) {
      var err = document.getElementById("capa-error");
      err.hidden = false;
      err.textContent = "⚠ Перевести в наблюдение можно только после выполнения всех действий плана.";
      return;
    }
    var daysInput = document.getElementById("observation-days");
    var days = daysInput ? parseInt(daysInput.value, 10) : S.CAPA_OBSERVATION_DAYS_DEFAULT;
    if (!(days > 0)) {
      var err = document.getElementById("capa-error");
      err.hidden = false;
      err.textContent = "⚠ Укажите длительность периода наблюдения (дней).";
      return;
    }
    var until = new Date();
    until.setDate(until.getDate() + days);
    capa.observationUntil = until.toISOString();
    capa.status = "observation";
    persistChanges("observation", "CAPA разработан, наблюдение до " + S.formatDate(capa.observationUntil));
    notifyObservationStarted();
    render();
  }

  // ==================== Модальное окно «Добавить действие» ====================

  var actionModal = document.getElementById("action-modal");

  function openActionModal() {
    actionModal.hidden = false;
    document.body.style.overflow = "hidden";
    var sel = document.getElementById("modal-act-assignee");
    fillAssigneeSelect(sel);
    var cur = S.currentUser();
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === cur) { sel.value = cur; break; }
    }
    document.getElementById("modal-act-text").value = "";
    document.getElementById("modal-act-due").value = "";
    var err = document.getElementById("modal-act-error");
    err.hidden = true;
    document.getElementById("modal-act-text").focus();
  }

  function closeActionModal() {
    if (!actionModal || actionModal.hidden) return;
    actionModal.hidden = true;
    document.body.style.overflow = "";
  }

  function confirmActionModal() {
    var text = (document.getElementById("modal-act-text").value || "").trim();
    var assignee = (document.getElementById("modal-act-assignee").value || "").trim();
    var due = (document.getElementById("modal-act-due").value || "").trim();
    var err = document.getElementById("modal-act-error");

    var problems = [];
    if (!text) problems.push("опишите действие");
    if (!assignee) problems.push("выберите ответственного");
    if (!due) problems.push("укажите срок");
    if (problems.length) {
      err.hidden = false;
      err.textContent = "⚠ " + problems.join("; ") + ".";
      return;
    }

    // Добавляем в ПАМЯТЬ (не теряя существующие строки) и перерисовываем
    capa.actions.push({ action: text, assignee: assignee, dueDate: due, status: "pending", doneAt: null, doneBy: "", doneNote: "" });
    closeActionModal();
    render();
  }

  // Выпадающий список сотрудников (локальные пользователи + admin)
  function fillAssigneeSelect(sel) {
    var users = [];
    try {
      users = JSON.parse(localStorage.getItem("fastcapa_users") || "[]");
    } catch (e) { users = []; }
    sel.innerHTML = '<option value="">— выберите сотрудника —</option>';
    [{ login: "admin", firstName: "Администратор" }].concat(users).forEach(function (u) {
      var val = u.firstName ? u.firstName + " (" + u.login + ")" : u.login;
      var opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      sel.appendChild(opt);
    });
  }

  // ==================== Отрисовка ====================

  function renderNotFound() {
    root.innerHTML =
      '<section class="block">' +
      '<h2 class="block__title">CAPA не найдено</h2>' +
      '<p class="empty">Запись не найдена в памяти устройства.</p>' +
      '<p style="margin-top:16px"><a href="capa-monitor.html" class="appbar__link appbar__link--dark">← К монитору CAPA</a></p>' +
      "</section>";
  }

  function propRow(label, value) {
    return (
      '<div class="ncr-card__prop">' +
      '<dt class="ncr-card__prop-label">' + S.escapeHtml(label) + "</dt>" +
      '<dd class="ncr-card__prop-value">' + S.escapeHtml(value || "—") + "</dd>" +
      "</div>"
    );
  }

  function render() {
    var params = new URLSearchParams(window.location.search);
    var ref = params.get("ref");
    var createRef = params.get("create");
    var ncrLookup = params.get("ncr");

    // Прямое создание из NCR (например, из таблицы монитора)
    if (createRef === "1" && ncrLookup && !capa) {
      var queue = S.loadQueue();
      var ncr = queue.find(function (n) { return n.clientRef === ncrLookup; });
      if (!ncr) {
        renderNotFound();
        return;
      }
      capa = S.createCapaFromNcr(ncr, S.currentUser());
      // Чистим URL, чтобы F5 не создавал дубликаты
      window.history.replaceState({}, "", "capa.html?ref=" + encodeURIComponent(capa.id));
    } else if (!capa) {
      var list = S.loadCapas();
      capa = list.find(function (c) { return c.id === ref; }) || null;
    }

    if (!capa) {
      renderNotFound();
      return;
    }

    document.title = "FastCAPA — " + capa.id;

    // Исходное NCR: живая запись из очереди — для развёрнутого контекста
    // и корректной ссылки (поиск по clientRef и, для надёжности, по localId)
    var linkedNcr = S.loadQueue().find(function (n) { return n.clientRef === capa.ncrRef; }) ||
                    S.loadQueue().find(function (n) { return n.localId && n.localId === capa.ncrLocalId; }) || null;
    // В ссылке передаём основной идентификатор, а ncr-view.js сам найдёт
    // запись и по localId (fallback внутри карточки NCR)
    var ncrHref = "ncr-view.html?ref=" +
      encodeURIComponent(linkedNcr ? linkedNcr.clientRef : (capa.ncrLocalId || capa.ncrRef || ""));

    root.innerHTML =
      // Шапка
      '<section class="block capa-card__head">' +
      '<div class="ncr-card__head-row">' +
      "<div>" +
      '<div class="ncr-card__id">' + S.escapeHtml(capa.id) + "</div>" +
      '<p class="ncr-card__date">Создан: ' + S.formatDate(capa.createdAt) + " · автор: " + S.escapeHtml(capa.createdBy) + "</p>" +
      "</div>" +
      '<div class="ncr-card__badges">' +
      capaStatusBadge(capa.status, true) +
      "</div>" +
      "</div>" +
      '<div class="ncr-card__sla">Связанное NCR: <a href="' + ncrHref + '">' +
      S.escapeHtml(capa.ncrLocalId || capa.ncrRef) + "</a></div>" +
      "</section>" +

      // Исходное NCR: развёрнутые данные карточки несоответствия
      buildNcrBlock(linkedNcr, ncrHref) +

      // Блок 1: 5 Why
      buildWhyBlock() +

      // Блок 2: План действий
      buildActionsBlock() +

      // Блок 3: Вложения
      buildAttachmentsBlock() +

      // Блок 4: Управление
      buildControlBlock() +

      // История
      '<section class="block">' +
      '<h2 class="block__title">История</h2>' +
      buildHistory() +
      "</section>";

    bindEvents();
  }

  function capaStatusBadge(statusKey, big) {
    var st = S.getCapaStatus(statusKey);
    return '<span class="status-badge ' + st.badge + (big ? " status-badge--big" : "") + '">' +
      S.escapeHtml(st.label) + "</span>";
  }

  // Развёрнутый блок исходного NCR: все данные карточки несоответствия,
  // чтобы не переключаться в карточку NCR для получения деталей
  function buildNcrBlock(ncr, ncrHref) {
    var head = '<h2 class="block__title">Исходное NCR ' +
      (ncr ? '<a href="' + ncrHref + '" class="ncr-link">' + S.escapeHtml(ncr.localId || ncr.clientRef) + " →</a>" : "") +
      "</h2>";

    // NCR не найден в памяти (удалён/другое устройство) — показываем сохранённый контекст
    if (!ncr) {
      return (
        '<section class="block">' + head +
        '<p class="empty">Запись NCR не найдена в памяти устройства — показан контекст, сохранённый при создании CAPA.</p>' +
        '<dl class="ncr-card__props">' +
        propRow("Локация", capa.context.location) +
        propRow("Оборудование", capa.context.equipment) +
        "</dl>" +
        '<p class="ncr-card__desc">' + S.escapeHtml(capa.context.description || "(описание отсутствует)") + "</p>" +
        "</section>"
      );
    }

    var sev = S.getSeverity(ncr.severity);
    var st = S.getStatus(ncr.status);

    // Фото проблемы («До») из вложений NCR
    var photos = (ncr.attachments || []).map(function (a) {
      return { src: a.dataUrl, type: a.type, name: a.name };
    }).filter(function (m) { return !!m.src; });
    var nameOnly = (ncr.attachments || []).filter(function (a) { return !a.dataUrl && a.name; });

    // Коррекция (этап 1), если есть
    var corr = ncr.correction || {};

    return (
      '<section class="block">' + head +
      '<dl class="ncr-card__props">' +
      propRow("Локация", ncr.location) +
      propRow("Приоритет", sev.code + " · " + sev.name + " (SLA: " + sev.sla + ")") +
      propRow("Статус NCR", st.label) +
      propRow("Категория", ncr.category) +
      propRow("Процесс", ncr.process) +
      propRow("Ответственный", ncr.assignee) +
      propRow("Зарегистрировано", S.formatDate(ncr.createdAt)) +
      "</dl>" +
      '<p class="ncr-card__desc">' + S.escapeHtml(ncr.description || "(описание отсутствует)") + "</p>" +
      (photos.length || nameOnly.length
        ? buildGallery(photos, nameOnly, "Вложений NCR нет (данные могли быть выгружены при экономии памяти).")
        : '<p class="empty">Фото проблемы в памяти нет (возможно, выгружены при экономии места).</p>') +
      (corr.description
        ? '<div class="ncr-card__prop" style="border-bottom:none">' +
          '<dt class="ncr-card__prop-label">Коррекция (что сделано)</dt>' +
          '<dd class="ncr-card__prop-value">' + S.escapeHtml(corr.description) + "</dd>" +
          "</div>"
        : "") +
      "</section>"
    );
  }

  // Блок 1: анализ корневой причины («падающие домино»)
  // Уровень 1 всегда присутствует: «Почему случилось несоответствие?»
  function buildWhyBlock() {
    var readonly = capa.status === "closed";
    var why = capa.why && capa.why.length ? capa.why : [""];
    var stack = "";
    for (var i = 0; i < why.length; i++) {
      stack += whyRow(i, why[i], readonly);
    }
    var canAddWhy = why.length < MAX_WHY && !readonly;

    var rootCauseOptions = S.CAPA_ROOT_CAUSE_TYPES.map(function (t) {
      return '<option value="' + t.key + '"' + (capa.rootCauseType === t.key ? " selected" : "") + ">" +
        S.escapeHtml(t.label) + "</option>";
    }).join("");

    var actionTypeOptions = S.CAPA_ACTION_TYPES.map(function (t) {
      return '<option value="' + t.key + '"' + (capa.actionType === t.key ? " selected" : "") + ">" +
        S.escapeHtml(t.label) + "</option>";
    }).join("");

    return (
      '<section class="block block--workflow">' +
      '<h2 class="block__title">1 · Анализ корневой причины (5 Почему)</h2>' +
      '<p class="block__hint">Каждый ответ — это домино, которое ставит следующий вопрос: «почему?». Идите вглубь, пока не дойдёте до настоящей причины.</p>' +
      '<div id="why-stack" class="why-stack">' +
      stack +
      "</div>" +
      (canAddWhy
        ? '<button type="button" id="btn-add-why" class="btn btn--ghost btn--plus why-add-btn">+ Добавить «Почему» (' + why.length + "/" + MAX_WHY + ")</button>"
        : (readonly ? "" : '<p class="block__hint">Достигнут максимум — 5 уровней «почему».</p>')) +
      '<div class="capa-rootcause">' +
      '<div class="field">' +
      '<label for="capa-rootcause-type">Тип корневой причины (5M) <span class="req">*</span></label>' +
      '<select id="capa-rootcause-type" class="input input--big"' + (readonly ? " disabled" : "") + ">" +
      '<option value="">— выберите —</option>' + rootCauseOptions +
      "</select>" +
      "</div>" +
      '<div class="field">' +
      '<label for="capa-rootcause-text">Корневая причина (итоговый вывод) <span class="req">*</span></label>' +
      '<textarea id="capa-rootcause-text" class="input input--big" rows="2"' + (readonly ? " disabled" : "") +
      ' placeholder="Итоговая причина одним предложением…">' + S.escapeHtml(capa.rootCauseText || "") + "</textarea>" +
      "</div>" +
      '<div class="field">' +
      '<label for="capa-action-type">Тип действия</label>' +
      '<select id="capa-action-type" class="input input--big"' + (readonly ? " disabled" : "") + ">" +
      actionTypeOptions +
      "</select>" +
      '<p class="block__hint" id="action-type-hint"></p>' +
      "</div>" +
      '<div class="field field--checkbox">' +
      '<label><input type="checkbox" id="capa-qms-doc"' + (capa.qmsDocRequired ? " checked" : "") +
      (readonly ? " disabled" : "") + ' /> Требует изменения документации / техпроцесса (влияние на СМК — уходит в конструкторский отдел)</label>' +
      "</div>" +
      "</div>" +
      "</section>"
    );
  }

function whyRow(index, value, readonly) {
    var question = index === 0 ? WHY_Q1 : "Почему ответ №" + index + "?";
    return (
      '<div class="why-row why-row--level-' + (index + 1) + '">' +
      '<div class="why-row__marker" aria-hidden="true">' + (index + 1) + "</div>" +
      '<div class="why-row__body">' +
      '<div class="why-row__level">Уровень ' + (index + 1) + "</div>" +
      '<div class="why-row__question">' + S.escapeHtml(question) + "</div>" +
      '<textarea class="input input--big why-input" rows="2"' + (readonly ? " disabled" : "") +
      ' placeholder="Ответ уровня ' + (index + 1) + '…">' + S.escapeHtml(value || "") + "</textarea>" +
      "</div>" +
      "</div>"
    );
  }

  // Блок 2: план действий (отработка: pending → done)
  function buildActionsBlock() {
    var readonly = capa.status === "closed";
    var canExecute = capa.status === "in_progress";

    var doneCount = capa.actions.filter(function (a) { return a.status === "done"; }).length;
    var rows = capa.actions.map(function (a, i) {
      var done = a.status === "done";
      return (
        "<tr" + (done ? ' class="act-row--done"' : "") + ">" +
        "<td>" + S.escapeHtml(a.action || "") + (done && a.doneBy ?
          '<div class="act-done-meta">✔ Выполнил: ' + S.escapeHtml(a.doneBy) + " · " + S.formatDate(a.doneAt) + "</div>" : "") + "</td>" +
        "<td>" + S.escapeHtml(a.assignee || "—") + "</td>" +
        "<td>" + S.escapeHtml(a.dueDate || "—") + "</td>" +
        "<td>" +
        (done
          ? '<span class="badge badge--act-done">Выполнено</span>'
          : (canExecute
            ? '<button type="button" class="btn btn--primary btn--act-done" data-act-done="' + i + '">✔ Выполнено</button>'
            : '<span class="badge badge--act-pending">Ожидает</span>')) +
        "</td>" +
        "</tr>"
      );
    });

    return (
      '<section class="block block--workflow">' +
      '<h2 class="block__title">2 · План действий <span class="count-badge">' + doneCount + " / " + capa.actions.length + "</span></h2>" +
      '<p class="block__hint">Что нужно сделать, чтобы это не повторилось? Каждое действие — с ответственным и сроком.' +
      (canExecute ? " Исполнитель отмечает действие «Выполнено» — автору CAPA уходит уведомление." : "") +
      "</p>" +
      '<div class="table-wrap">' +
      '<table class="ncr-table capa-actions-table">' +
      "<thead><tr><th>Действие</th><th>Ответственный</th><th>Срок</th><th>Статус</th></tr></thead>" +
      '<tbody id="actions-tbody">' +
      (rows.join("") || '<tr><td colspan="4" class="empty">Действий пока нет.</td></tr>') +
      "</tbody>" +
      "</table>" +
      "</div>" +
      (readonly ? "" : '<button type="button" id="btn-add-action" class="btn btn--ghost btn--plus why-add-btn">+ Добавить действие</button>') +
      "</section>"
    );
  }

  // Блок 3: вложения
  function buildAttachmentsBlock() {
    var readonly = capa.status === "closed";
    var saved = (capa.attachments || []).map(function (a) {
      return { src: a.dataUrl, type: a.type, name: a.name };
    }).filter(function (m) { return !!m.src; });
    var savedNames = (capa.attachments || []).filter(function (a) { return !a.dataUrl && a.name; });

    return (
      '<section class="block">' +
      '<h2 class="block__title">3 · Вложения <span class="count-badge">' + ((capa.attachments || []).length + capaFiles.length) + "</span></h2>" +
      '<p class="block__hint">Фото, PDF (акты, чертежи), видео — доказательство выполнения плана (например, фото установленного датчика).</p>' +
      (readonly ? "" :
        '<input type="file" id="capa-files" accept="image/*,application/pdf,video/*" hidden multiple />' +
        '<div class="photos-buttons">' +
        '<button type="button" id="btn-capa-files" class="btn btn--ghost btn--photos">📎 Прикрепить файл</button>' +
        "</div>") +
      '<div id="capa-previews" class="previews"></div>' +
      buildGallery(saved, savedNames) +
      "</section>"
    );
  }

  function buildGallery(mediaList, nameOnlyFiles, emptyText) {
    if (!mediaList.length && !(nameOnlyFiles || []).length) {
      return '<p class="empty">' + S.escapeHtml(emptyText || "Вложений нет.") + "</p>";
    }
    var html = '<div class="gallery">';
    mediaList.forEach(function (m, idx) {
      html +=
        '<figure class="gallery__item" data-media-index="' + idx + '" title="Открыть просмотр">' +
        (m.type && m.type.indexOf("video/") === 0
          ? '<div class="gallery__video-badge">▶ видео</div><div class="gallery__ph">🎬</div>'
          : '<img class="gallery__img" src="' + m.src + '" alt="' + S.escapeHtml(m.name) + '" />') +
        '<figcaption class="gallery__caption">' + S.escapeHtml(m.name) + "</figcaption>" +
        "</figure>";
    });
    (nameOnlyFiles || []).forEach(function (a) {
      html +=
        '<figure class="gallery__item gallery__item--file">' +
        '<div class="gallery__ph">📄</div>' +
        '<figcaption class="gallery__caption">' + S.escapeHtml(a.name) + "</figcaption>" +
        "</figure>";
    });
    html += "</div>";
    return html;
  }

  // Блок 4: управление
  function buildControlBlock() {
    var err = '<p id="capa-error" class="field-error" hidden></p>';

    if (capa.status === "draft") {
      return (
        '<section class="block block--workflow block--action">' +
        err +
        '<div class="workflow-actions">' +
        '<button type="button" id="act-save-draft" class="btn btn--ghost btn--workflow">💾 Сохранить черновик</button>' +
        '<button type="button" id="act-submit" class="btn btn--primary btn--workflow">📤 Отправить на исполнение</button>' +
        "</div>" +
        '<p class="block__hint" style="margin-top:10px">После отправки исполнителям по действиям уходят уведомления.</p>' +
        "</section>"
      );
    }

    if (capa.status === "in_progress") {
      var done = capa.actions.filter(function (a) { return a.status === "done"; }).length;
      var total = capa.actions.length;
      var allDone = allActionsDone();
      return (
        '<section class="block block--workflow block--action">' +
        err +
        '<p class="block__hint">Отработка: выполнено <b>' + done + " из " + total + "</b> действий." +
        (allDone ? " Все действия выполнены — можно переводить в наблюдение." :
          " Перевод в наблюдение станет доступен после выполнения всех действий.") + "</p>" +
        (allDone
          ? '<div class="field">' +
            '<label for="observation-days">Период наблюдения (дней) <span class="req">*</span></label>' +
            '<input type="number" id="observation-days" class="input input--big" min="1" value="' + S.CAPA_OBSERVATION_DAYS_DEFAULT + '" />' +
            "</div>" +
            '<button type="button" id="act-observe" class="btn btn--gold btn--workflow">👁 Перевести в наблюдение</button>'
          : '<button type="button" class="btn btn--gold btn--workflow" disabled>🔒 Перевести в наблюдение (выполните все действия)</button>') +
        "</section>"
      );
    }

    if (capa.status === "observation") {
      var obsDone = S.observationCompleted(capa);
      var reviewLink = "capa-review.html?ref=" + encodeURIComponent(capa.id);
      return (
        '<section class="block block--workflow block--action">' +
        err +
        '<p class="block__hint">Статус: «CAPA разработан, наблюдение». Наблюдение до: <b>' +
        S.formatDate(capa.observationUntil) + "</b>.</p>" +
        (obsDone
          ? '<p class="block__hint">Период наблюдения окончен. Заполните карточку результатов наблюдения — без неё завершить CAPA нельзя.</p>' +
            '<a href="' + reviewLink + '" class="btn btn--gold btn--workflow" style="text-decoration:none">📋 Карточка результатов наблюдения</a>'
          : '<p class="block__hint">Завершение возможно только после окончания периода наблюдения.</p>') +
        "</section>"
      );
    }

    // closed
    return (
      '<section class="block block--workflow block--done">' +
      '<h2 class="block__title">✅ CAPA закрыт</h2>' +
      '<p class="empty">Эффект подтверждён, период наблюдения завершён.</p>' +
      "</section>"
    );
  }

  function buildHistory() {
    var labels = {
      created: "Создан из NCR",
      draft_saved: "Черновик сохранён",
      submit: "Отправлен на исполнение",
      observation: "Переведён в наблюдение",
      observation_extended: "Наблюдение продлено",
      close: "Закрыт · эффект подтверждён",
      close_not_confirmed: "Закрыт · результат не подтверждён",
      rework: "Отправлен на доработку"
    };
    var rows = (capa.history || []).map(function (h) {
      return (
        '<div class="history-row">' +
        '<span class="history-row__ts">' + S.formatDate(h.ts) + "</span>" +
        '<span class="history-row__action">' + S.escapeHtml(labels[h.action] || h.action) + "</span>" +
        '<span class="history-row__user">' + S.escapeHtml(h.user || "—") + "</span>" +
        (h.note ? '<span class="history-row__note">' + S.escapeHtml(h.note) + "</span>" : "") +
        "</div>"
      );
    });
    return rows.join("") || '<p class="empty">Пока нет записей.</p>';
  }

  // ==================== События ====================

  function bindEvents() {
    var el;

    // Lightbox для сохранённых вложений
    document.querySelectorAll("#capa-root .gallery__item[data-media-index]").forEach(function (fig) {
      fig.addEventListener("click", function () {
        var saved = (capa.attachments || []).map(function (a) {
          return { src: a.dataUrl, type: a.type, name: a.name };
        }).filter(function (m) { return !!m.src; });
        openLightbox(saved, parseInt(fig.getAttribute("data-media-index"), 10));
      });
    });

    // 5 Why: добавление уровня (collectForm → память → render, данные не теряются)
    if ((el = document.getElementById("btn-add-why"))) {
      el.addEventListener("click", function () {
        collectForm();
        if (capa.why.length >= MAX_WHY) return;
        capa.why.push("");
        render();
        var inputs = document.querySelectorAll("#why-stack .why-input");
        if (inputs.length) inputs[inputs.length - 1].focus();
      });
    }

    // Подсказка типа действия
    var atSelect = document.getElementById("capa-action-type");
    if (atSelect) {
      var hint = document.getElementById("action-type-hint");
      var updateHint = function () {
        var t = S.getCapaActionType(atSelect.value);
        hint.textContent = t.hint || "";
      };
      atSelect.addEventListener("change", updateHint);
      updateHint();
    }

    // План действий: модальное окно добавления
    if ((el = document.getElementById("btn-add-action"))) {
      el.addEventListener("click", openActionModal);
    }

    // Отработка: «Выполнено» по действию
    document.querySelectorAll("#capa-root [data-act-done]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        markActionDone(parseInt(btn.getAttribute("data-act-done"), 10));
      });
    });

    // Вложения
    var fileInput = document.getElementById("capa-files");
    if (fileInput) {
      document.getElementById("btn-capa-files").addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function () {
        Array.from(fileInput.files || []).forEach(function (file) {
          if (file.type.indexOf("image/") === 0) {
            compressImage(file, 900, 0.62, function (compressed) {
              capaFiles.push(compressed);
              renderCapaPreviews();
            });
          } else {
            capaFiles.push({ name: file.name, type: file.type, size: file.size, url: null });
            renderCapaPreviews();
          }
        });
        fileInput.value = "";
      });
    }

    // Управление
    if ((el = document.getElementById("act-save-draft"))) el.addEventListener("click", saveDraft);
    if ((el = document.getElementById("act-submit"))) el.addEventListener("click", submitForExecution);
    if ((el = document.getElementById("act-observe"))) el.addEventListener("click", moveToObservation);
  }

  function renderCapaPreviews() {
    var container = document.getElementById("capa-previews");
    if (!container) return;
    container.innerHTML = "";
    capaFiles.forEach(function (f) {
      var box = document.createElement("div");
      box.className = "preview";
      if (f.url) {
        var img = document.createElement("img");
        img.src = f.url;
        box.appendChild(img);
      }
      var label = document.createElement("span");
      label.className = "preview__label";
      label.textContent = f.name;
      box.appendChild(label);
      container.appendChild(box);
    });
    var badge = document.querySelector("#capa-root .count-badge");
    if (badge) badge.textContent = String((capa.attachments || []).length + capaFiles.length);
  }

  // ==================== События модального окна (статичная разметка) ====================

  if (actionModal) {
    document.getElementById("modal-act-cancel").addEventListener("click", closeActionModal);
    document.getElementById("modal-act-confirm").addEventListener("click", confirmActionModal);
    actionModal.addEventListener("click", function (e) { if (e.target === actionModal) closeActionModal(); });
  }

  render();
})();
