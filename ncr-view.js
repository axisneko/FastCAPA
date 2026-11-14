/* FastCAPA — Карточка NCR (ncr-view.html)
 *
 * Открывается по ссылке monitor.html → ncr-view.html?ref=<clientRef>.
 *
 * Этап 1 — отработка инцидента (Manual Workflow):
 *   new                  → [Взять в работу] / [Устранить на месте] (Quick Fix) / [Отклонить]
 *   in_progress          → блок «Коррекция»: что сделано + фото «После» → [ВЫПОЛНЕНО]
 *   pending_verification → блок «Верификация»: [✅ Подтвердить] / [❌ Отклонить]
 *   closed / rejected    → read-only, история
 */
(function () {
  "use strict";

  var root = document.getElementById("ncr-view-root");
  var S = window.FastCAPAStore;
  var item = null;
  var correctionFiles = [];   // фото «После» текущей формы коррекции

  // ==================== Lightbox ====================
  var lightbox = document.getElementById("lightbox");
  var lbImg = document.getElementById("lightbox-img");
  var lbVideo = document.getElementById("lightbox-video");
  var lbCaption = document.getElementById("lightbox-caption");
  var media = [];            // [{src, type, name}]
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
    if (lightbox.hidden) return;
    if (e.key === "Escape") closeLightbox();
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

  // ==================== Переходы статусов ====================

  function changeStatus(newStatus, action, note) {
    S.updateItem(item.clientRef, function (rec) {
      rec.status = newStatus;
      S.addHistory(rec, action, S.currentUser(), note);
    });
    render();
  }

  function takeInProgress() {
    S.updateItem(item.clientRef, function (rec) {
      rec.status = "in_progress";
      rec.assignee = S.currentUser();
      S.addHistory(rec, "take", S.currentUser(), "Взято в работу: " + S.currentUser());
    });
    render();
  }

  // Открыть/закрыть форму назначения ответственного
  function toggleAssignForm(show) {
    var form = document.getElementById("assign-form");
    if (form) form.hidden = !show;
  }

  // Заполнить select сотрудниками (локальные пользователи + admin)
  function fillAssigneeSelect() {
    var sel = document.getElementById("assign-user");
    if (!sel) return;
    var users = [];
    try {
      users = JSON.parse(localStorage.getItem("fastcapa_users") || "[]");
    } catch (e) { users = []; }
    sel.innerHTML = '<option value="">— выберите сотрудника —</option>';
    [{ login: "admin", firstName: "Администратор" }].concat(users).forEach(function (u) {
      var opt = document.createElement("option");
      opt.value = u.firstName ? u.firstName + " (" + u.login + ")" : u.login;
      opt.textContent = u.firstName ? u.firstName + " (" + u.login + ")" : u.login;
      sel.appendChild(opt);
    });
  }

  // NEW → ASSIGNED: назначить ответственного
  function assignUser() {
    var sel = document.getElementById("assign-user");
    var name = sel && sel.value;
    if (!name) return;
    S.updateItem(item.clientRef, function (rec) {
      rec.status = "assigned";
      rec.assignee = name;
      S.addHistory(rec, "assign", S.currentUser(), "Назначен ответственный: " + name);
    });
    render();
  }

  // ASSIGNED → IN_PROGRESS: ответственный принял
  function acceptWork() {
    S.updateItem(item.clientRef, function (rec) {
      rec.status = "in_progress";
      S.addHistory(rec, "accept", S.currentUser(), "Ответственный принял NCR в работу");
    });
    render();
  }

  // Выполнено: IN_PROGRESS → PENDING_VERIFICATION (валидация: фото «После» ИЛИ текст)
  function completeWork() {
    var textEl = document.getElementById("correction-text");
    var text = textEl ? textEl.value.trim() : "";
    var err = document.getElementById("correction-error");

    if (!text && correctionFiles.length === 0) {
      err.hidden = false;
      err.textContent = "⚠ Приложите хотя бы одно фото «После» или напишите, что сделано.";
      return;
    }
    err.hidden = true;

    S.updateItem(item.clientRef, function (rec) {
      rec.status = "pending_verification";
      rec.correction = rec.correction || {};
      rec.correction.description = text || "—";
      rec.correction.doneAt = new Date().toISOString();
      if (correctionFiles.length) {
        rec.correction.photos = correctionFiles.map(function (f) {
          return { name: f.name, type: f.type, size: f.size, dataUrl: f.url };
        });
      }
      S.addHistory(rec, "complete", S.currentUser(),
        "Выполнено. Фото «После»: " + correctionFiles.length + (text ? ", описание заполнено" : ""));
    });
    render();
  }

  function verify() {
    // Жёсткое правило: NCR не закрывается, пока связанный CAPA
    // не верифицирован (closed с итогом «эффект подтверждён»)
    if (hasUnverifiedCapa()) {
      var list = unverifiedCapaList().map(function (c) { return c.id + " (" + capaStateLabel(c) + ")"; }).join("; ");
      window.alert("NCR нельзя закрыть: CAPA не верифицированы — " + list +
        ". Дождитесь итога «эффект подтверждён» в карточке завершения наблюдения.");
      return;
    }
    changeStatus("closed", "verify", "Результат подтверждён");
  }

  function reject() {
    changeStatus("rejected", "reject", "Отклонено: не является несоответствием");
  }

  // ==================== Отрисовка ====================

  function renderNotFound() {
    root.innerHTML =
      '<section class="block">' +
      '<h2 class="block__title">NCR не найдено</h2>' +
      '<p class="empty">Запись не найдена в памяти устройства. Возможно, она была удалена.</p>' +
      '<p style="margin-top:16px"><a href="monitor.html" class="appbar__link appbar__link--dark">← Вернуться к монитору</a></p>' +
      "</section>";
  }

  function mediaFromAttachments() {
    return (item.attachments || [])
      .filter(function (a) { return !!a.dataUrl; })
      .map(function (a) { return { src: a.dataUrl, type: a.type, name: a.name }; });
  }

  function mediaFromCorrection() {
    return ((item.correction && item.correction.photos) || [])
      .filter(function (a) { return !!a.dataUrl; })
      .map(function (a) { return { src: a.dataUrl, type: a.type, name: a.name }; });
  }

  function render() {
    var ref = new URLSearchParams(window.location.search).get("ref");
    var list = S.loadQueue();
    // Поиск по clientRef, при неудаче — fallback по localId / serverId
    // (надёжный переход из карточки CAPA и других страниц)
    item = list.find(function (n) { return n.clientRef === ref; }) ||
           list.find(function (n) { return n.localId === ref; }) ||
           list.find(function (n) { return n.serverId && String(n.serverId) === ref; });

    if (!item) {
      renderNotFound();
      return;
    }

    var sev = S.getSeverity(item.severity);
    var st = S.getStatus(item.status);
    document.title = "FastCAPA — " + (item.localId || item.clientRef);

    root.innerHTML =
      // Шапка карточки
      '<section class="block ncr-card__head">' +
      '<div class="ncr-card__head-row">' +
      "<div>" +
      '<div class="ncr-card__id">' + S.escapeHtml(item.localId || item.clientRef) + "</div>" +
      '<p class="ncr-card__date">Зарегистрировано: ' + S.formatDate(item.createdAt) + "</p>" +
      "</div>" +
      '<div class="ncr-card__badges">' +
      '<span class="badge badge--' + sev.code.toLowerCase() + '">' + sev.code + " · " + S.escapeHtml(sev.name) + "</span>" +
      '<span class="status-badge ' + st.badge + ' status-badge--big">' + S.escapeHtml(st.label) + "</span>" +
      '<span class="badge badge--' + (item.sync === "local" ? "local" : "synced") + '">' + S.syncLabel(item) + "</span>" +
      '<span class="badge ' + (S.hasCapa(item.clientRef) ? "badge--capa-yes" : "badge--capa-no") + '">' +
      (S.hasCapa(item.clientRef) ? "есть CAPA" : "нет CAPA") + "</span>" +
      "</div>" +
      "</div>" +
      '<div class="ncr-card__sla">SLA: ' + S.escapeHtml(sev.sla) + "</div>" +
      "</section>" +

      // Реквизиты
      '<section class="block">' +
      '<h2 class="block__title">Реквизиты</h2>' +
      '<dl class="ncr-card__props">' +
      propRow("Локация (L1–L4)", item.location) +
      propRow("Категория", item.category) +
      propRow("Процесс", item.process) +
      (item.assignee ? propRow("Ответственный", item.assignee) : "") +
      propRow("Файлов вложено", String(S.attachmentsCount(item))) +
      (item.serverId ? propRow("Server ID", String(item.serverId)) : "") +
      propRow("Client Ref", item.clientRef) +
      "</dl>" +
      "</section>" +

      // Описание (read-only)
      '<section class="block">' +
      '<h2 class="block__title">Описание несоответствия</h2>' +
      '<p class="ncr-card__desc">' + S.escapeHtml(item.description || "(описание отсутствует)") + "</p>" +
      "</section>" +

      // Вложения «До» (фото проблемы)
      '<section class="block">' +
      '<h2 class="block__title">Вложения · фото проблемы <span class="count-badge">' + S.attachmentsCount(item) + "</span></h2>" +
      buildGallery(mediaFromAttachments(), item.attachments || []) +
      "</section>" +

      // ===== Этап 2: блок «Корректирующие действия» (CAPA) =====
      capaBlock() +

      // ===== Этап 1: рабочие блоки по статусу =====
      workflowBlock() +

      // История
      '<section class="block">' +
      '<h2 class="block__title">История</h2>' +
      buildHistory() +
      "</section>";

    bindEvents();
  }

  function propRow(label, value) {
    return (
      '<div class="ncr-card__prop">' +
      '<dt class="ncr-card__prop-label">' + S.escapeHtml(label) + "</dt>" +
      '<dd class="ncr-card__prop-value">' + S.escapeHtml(value || "—") + "</dd>" +
      "</div>"
    );
  }

  // ==================== Блок «Корректирующие действия» (CAPA) ====================

  // Блок CAPA: без CAPA → кнопка создания; с CAPA → сводка + переход
  function capaBlock() {
    var capas = S.loadCapasByNcr(item.clientRef);

    if (capas.length === 0) {
      return (
        '<section class="block block--workflow">' +
        '<h2 class="block__title">Корректирующие действия</h2>' +
        '<p class="block__hint">CAPA для этого несоответствия ещё нет. Создайте план, чтобы устранить корневую причину — или закройте NCR после коррекции без CAPA.</p>' +
        '<div class="workflow-actions">' +
        '<a href="capa.html?create=1&ncr=' + encodeURIComponent(item.clientRef) + '" ' +
        'class="btn btn--gold btn--workflow" style="text-decoration:none">+ Создать план CAPA</a>' +
        "</div>" +
        "</section>"
      );
    }

    // Сводка по связанным CAPA (One-to-Many: у NCR может быть несколько CAPA)
    var rows = capas.map(function (c) {
      var st = S.getCapaStatus(c.status);
      var responsible = (c.actions && c.actions.length && c.actions[0].assignee) || "—";
      var due = (c.actions && c.actions.length && c.actions[0].dueDate) || "";
      var verified = c.status === "closed" && !(c.observation && c.observation.result === "not_confirmed");
      var notConfirmed = c.status === "closed" && c.observation && c.observation.result === "not_confirmed";
      return (
        '<div class="capa-summary-row">' +
        '<span class="ncr-table__id">' + S.escapeHtml(c.id) + "</span>" +
        '<span class="status-badge ' + st.badge + '">' + S.escapeHtml(st.label) + "</span>" +
        (verified ? '<span class="badge badge--capa-verified">✔ Верифицирован</span>' : "") +
        (notConfirmed ? '<span class="badge badge--capa-not-confirmed">✖ Результат не подтверждён</span>' : "") +
        '<span class="capa-summary-row__meta">Ответственный: ' + S.escapeHtml(responsible) +
        (due ? " · Срок: " + S.escapeHtml(due) : "") + "</span>" +
        '<a href="capa.html?ref=' + encodeURIComponent(c.id) + '" class="appbar__link appbar__link--dark capa-summary-row__link">Перейти к CAPA</a>' +
        "</div>"
      );
    }).join("");

    return (
      '<section class="block block--workflow">' +
      '<h2 class="block__title">Корректирующие действия <span class="count-badge">' + capas.length + "</span></h2>" +
      rows +
      "</section>"
    );
  }

  // ==================== Жёсткое правило закрытия NCR ====================
  // NCR не может получить статус Closed, пока связанный CAPA не верифицирован:
  // CAPA считается верифицированным ТОЛЬКО если он closed c итогом
  // наблюдения «эффект подтверждён». Блокируют закрытие:
  //   - любой незавершённый CAPA (draft / in_progress / observation);
  //   - CAPA, закрытый с итогом «результат не подтверждён»
  //     (эффект не достигнут — несоответствие не устранено системно).
  function hasUnverifiedCapa() {
    return S.loadCapasByNcr(item.clientRef).some(function (c) {
      return c.status !== "closed" || (c.observation && c.observation.result === "not_confirmed");
    });
  }

  function unverifiedCapaList() {
    return S.loadCapasByNcr(item.clientRef).filter(function (c) {
      return c.status !== "closed" || (c.observation && c.observation.result === "not_confirmed");
    });
  }

  function capaStateLabel(c) {
    if (c.status !== "closed") return S.getCapaStatus(c.status).label;
    if (c.observation && c.observation.result === "not_confirmed") return "Закрыт · результат не подтверждён";
    return "Верифицирован (эффект подтверждён)";
  }

  function openCapaWarningHtml() {
    var capas = unverifiedCapaList();
    return (
      '<p class="capa-open-warning">🔒 CAPA не верифицированы: «' +
      S.escapeHtml(capas.map(function (c) { return c.id + " — " + capaStateLabel(c); }).join("; ")) +
      "». NCR нельзя закрыть, пока каждый связанный CAPA не пройдёт период наблюдения " +
      'и не получит итог «эффект подтверждён» в карточке завершения наблюдения.</p>'
    );
  }

  // Блок рабочего процесса — зависит от статуса
  function workflowBlock() {
    switch (item.status) {
      case "new": return blockNew();
      case "assigned": return blockAssigned();
      case "in_progress": return blockInProgress();
      case "pending_verification": return blockPending();
      case "closed": return blockClosedInfo();
      case "rejected": return blockRejectedInfo();
      default: return "";
    }
  }

  // NEW: Взять себе / Назначить ответственного / Отклонить
  function blockNew() {
    return (
      '<section class="block block--workflow">' +
      '<h2 class="block__title">Отработка инцидента</h2>' +
      '<p class="block__hint">NCR зарегистрирован и ждёт реакции. Выберите действие:</p>' +
      '<div class="workflow-actions">' +
      '<button type="button" id="act-take" class="btn btn--primary btn--workflow">🔧 Взять в работу себе</button>' +
      '<button type="button" id="act-assign" class="btn btn--gold btn--workflow">👤 Назначить ответственного</button>' +
      '<button type="button" id="act-reject-new" class="btn btn--ghost btn--workflow">❌ Отклонить (не дефект)</button>' +
      "</div>" +
      '<div id="assign-form" class="assign-form" hidden>' +
      '<div class="field">' +
      '<label for="assign-user">Ответственный <span class="req">*</span></label>' +
      '<select id="assign-user" class="input input--big"><option value="">— выберите сотрудника —</option></select>' +
      "</div>" +
      '<div class="workflow-actions">' +
      '<button type="button" id="act-assign-confirm" class="btn btn--primary btn--workflow">Передать в работу</button>' +
      '<button type="button" id="act-assign-cancel" class="btn btn--ghost btn--workflow">Отмена</button>' +
      "</div>" +
      "</div>" +
      "</section>"
    );
  }

  // ASSIGNED: ответственный назначен, ожидает принятия
  function blockAssigned() {
    return (
      '<section class="block block--workflow">' +
      '<h2 class="block__title">Передано в работу</h2>' +
      '<p class="block__hint">Ответственный: <b>' + S.escapeHtml(item.assignee || "—") + '</b>. Ожидается, когда он примет NCR в работу.</p>' +
      '<div class="workflow-actions">' +
      '<button type="button" id="act-accept" class="btn btn--primary btn--workflow">👍 Принять в работу</button>' +
      '<button type="button" id="act-reassign" class="btn btn--gold btn--workflow">👤 Переназначить</button>' +
      "</div>" +
      '<div id="assign-form" class="assign-form" hidden>' +
      '<div class="field">' +
      '<label for="assign-user">Новый ответственный <span class="req">*</span></label>' +
      '<select id="assign-user" class="input input--big"><option value="">— выберите сотрудника —</option></select>' +
      "</div>" +
      '<div class="workflow-actions">' +
      '<button type="button" id="act-assign-confirm" class="btn btn--primary btn--workflow">Передать в работу</button>' +
      '<button type="button" id="act-assign-cancel" class="btn btn--ghost btn--workflow">Отмена</button>' +
      "</div>" +
      "</div>" +
      "</section>"
    );
  }

  // IN_PROGRESS: блок «Коррекция»
  function blockInProgress() {
    return (
      '<section class="block block--workflow">' +
      '<h2 class="block__title">Коррекция · что сделано</h2>' +
      '<p class="block__hint">Опишите предпринятые действия и приложите фото результата («После»). Чтобы нажать «ВЫПОЛНЕНО», нужно фото или текст.</p>' +
      '<div class="field">' +
      '<label for="correction-text">Предпринятые действия</label>' +
      '<textarea id="correction-text" class="input input--big" rows="3" placeholder="Например: заменил прокладку, очистил сопло…"></textarea>' +
      "</div>" +
      '<div class="field">' +
      "<label>Фото «После»</label>" +
      '<input type="file" id="correction-photos" accept="image/*" capture="environment" hidden multiple />' +
      '<div class="photos-buttons">' +
      '<button type="button" id="btn-correction-photos" class="btn btn--ghost btn--photos">📷 Выбрать файлы</button>' +
      '<button type="button" id="btn-correction-camera" class="btn btn--primary btn--photos">📸 Сделать фото</button>' +
      "</div>" +
      '<div id="correction-previews" class="previews"></div>' +
      "</div>" +
      '<p id="correction-error" class="field-error" hidden></p>' +
      '<button type="button" id="act-complete" class="submit-btn submit-btn--done">✔ ВЫПОЛНЕНО</button>' +
      "</section>"
    );
  }

  // PENDING_VERIFICATION: блок «Верификация»
  function blockPending() {
    var corr = item.correction || {};
    var corrMedia = mediaFromCorrection();
    return (
      '<section class="block block--workflow">' +
      '<h2 class="block__title">Верификация результата</h2>' +
      '<p class="block__hint">Работа заявлена как выполненная. Проверьте и подтвердите:</p>' +
      '<div class="ncr-card__prop" style="border-bottom:none">' +
      '<dt class="ncr-card__prop-label">Что сделано</dt>' +
      '<dd class="ncr-card__prop-value">' + S.escapeHtml(corr.description || "—") + "</dd>" +
      "</div>" +
      (corr.doneAt ? '<p class="block__hint">Завершено: ' + S.formatDate(corr.doneAt) + "</p>" : "") +
      buildGallery(corrMedia, corr.photos || [], "Фото «После» пока не приложены.") +
      (hasUnverifiedCapa() ? openCapaWarningHtml() : "") +
      '<div class="workflow-actions">' +
      '<button type="button" id="act-verify" class="btn btn--primary btn--workflow"' +
      (hasUnverifiedCapa() ? " disabled title=\"CAPA не верифицированы — закройте их с итогом «эффект подтверждён»\"" : "") +
      '>✅ Подтвердить · закрыть NCR</button>' +
      '<button type="button" id="act-reject" class="btn btn--ghost btn--workflow">❌ Отклонить (не дефект)</button>' +
      "</div>" +
      "</section>"
    );
  }

  function blockClosedInfo() {
    return (
      '<section class="block block--workflow block--done">' +
      '<h2 class="block__title">✅ Инцидент закрыт</h2>' +
      '<p class="empty">Несоответствие устранено и подтверждено. Этап 1 завершён.</p>' +
      "</section>"
    );
  }

  function blockRejectedInfo() {
    return (
      '<section class="block block--workflow">' +
      '<h2 class="block__title">Отклонено</h2>' +
      '<p class="empty">Запись помечена как не являющаяся несоответствием (ложное срабатывание).</p>' +
      "</section>"
    );
  }

  function buildHistory() {
    var rows = (item.history || []).map(function (h) {
      var labels = {
        created: "Создано",
        take: "Взято в работу",
        assign: "Назначен ответственный",
        accept: "Принято в работу",
        complete: "Выполнено",
        verify: "Подтверждено · закрыто",
        reject: "Отклонено"
      };
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

  // Галерея (общая для «До» и «После»)
  function buildGallery(mediaList, attachments, emptyText) {
    if (!attachments || attachments.length === 0) {
      if (item.attachmentsMeta && item.attachmentsMeta.length && emptyText === undefined) {
        return (
          '<p class="empty">Метаданные вложений: ' +
          S.escapeHtml(item.attachmentsMeta.map(function (a) { return a.name; }).join(", ")) +
          ". Файлы доступны только после синхронизации с сервером.</p>"
        );
      }
      return '<p class="empty">' + S.escapeHtml(emptyText || "Вложений нет.") + "</p>";
    }

    var idx = 0;
    var html = '<div class="gallery">';
    attachments.forEach(function (a) {
      if (a.dataUrl) {
        html +=
          '<figure class="gallery__item" data-media-index="' + idx + '" title="Открыть просмотр">' +
          (a.type && a.type.indexOf("video/") === 0
            ? '<div class="gallery__video-badge">▶ видео</div><div class="gallery__ph">🎬</div>'
            : '<img class="gallery__img" src="' + a.dataUrl + '" alt="' + S.escapeHtml(a.name) + '" />') +
          '<figcaption class="gallery__caption">' + S.escapeHtml(a.name) + "</figcaption>" +
          "</figure>";
        idx++;
      } else if (a.name) {
        html +=
          '<figure class="gallery__item gallery__item--file">' +
          '<div class="gallery__ph">📄</div>' +
          '<figcaption class="gallery__caption">' + S.escapeHtml(a.name) + "</figcaption>" +
          "</figure>";
      }
    });
    html += "</div>";
    return html;
  }

  // ==================== События ====================

  function bindEvents() {
    var el;

    // Клики по галереям → lightbox
    document.querySelectorAll("#ncr-view-root .gallery__item[data-media-index]").forEach(function (fig) {
      fig.addEventListener("click", function () {
        // Определяем, из какой галереи клик (ближайший блок)
        var block = fig.closest(".block");
        var list = mediaFromAttachments();
        var isAfter = !!(block && block.querySelector(".gallery") && item.correction && item.correction.photos &&
          block.textContent.indexOf("Что сделано") !== -1);
        if (isAfter) list = mediaFromCorrection();
        openLightbox(list, parseInt(fig.getAttribute("data-media-index"), 10));
      });
    });

    if ((el = document.getElementById("act-take"))) el.addEventListener("click", takeInProgress);
    if ((el = document.getElementById("act-assign"))) el.addEventListener("click", function () { fillAssigneeSelect(); toggleAssignForm(true); });
    if ((el = document.getElementById("act-assign-confirm"))) el.addEventListener("click", assignUser);
    if ((el = document.getElementById("act-assign-cancel"))) el.addEventListener("click", function () { toggleAssignForm(false); });
    if ((el = document.getElementById("act-accept"))) el.addEventListener("click", acceptWork);
    if ((el = document.getElementById("act-reassign"))) el.addEventListener("click", function () { fillAssigneeSelect(); toggleAssignForm(true); });
    if ((el = document.getElementById("act-reject-new"))) el.addEventListener("click", reject);
    if ((el = document.getElementById("act-verify"))) el.addEventListener("click", verify);
    if ((el = document.getElementById("act-reject"))) el.addEventListener("click", reject);

    // Блок коррекции
    var photoInput = document.getElementById("correction-photos");
    if (photoInput) {
      document.getElementById("btn-correction-photos").addEventListener("click", function () { photoInput.click(); });
      document.getElementById("btn-correction-camera").addEventListener("click", function () { photoInput.click(); });
      photoInput.addEventListener("change", function () {
        var files = Array.from(photoInput.files || []);
        files.forEach(function (file) {
          if (file.type.indexOf("image/") === 0) {
            compressImage(file, 900, 0.62, function (compressed) {
              correctionFiles.push(compressed);
              renderCorrectionPreviews();
            });
          } else {
            correctionFiles.push({ name: file.name, type: file.type, size: file.size, url: null });
            renderCorrectionPreviews();
          }
        });
        photoInput.value = "";
      });
      document.getElementById("act-complete").addEventListener("click", completeWork);
    }
  }

  function renderCorrectionPreviews() {
    var container = document.getElementById("correction-previews");
    if (!container) return;
    container.innerHTML = "";
    correctionFiles.forEach(function (f) {
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
  }

  render();
})();
