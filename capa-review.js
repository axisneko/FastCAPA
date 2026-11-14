/* FastCAPA — Карточка завершения наблюдения (capa-review.html)
 *
 * Открывается по ссылке capa-review.html?ref=<capaId> из монитора CAPA
 * или карточки CAPA, когда период наблюдения окончен (observation).
 *
 * Обязательное условие: без заполнения этой карточки CAPA завершить нельзя.
 *
 * Состав:
 *   1. Результат наблюдения (выпадающий список из 4 итогов)
 *   2. Текстовое заключение (+ голосовой ввод через Web Speech API:
 *      распознанный текст сразу попадает в поле)
 *   3. Вложения (фото/PDF/видео — доказательства)
 *   4. Итог — 4 типа завершения:
 *      - Завершено (эффект подтверждён)   → CAPA → closed
 *      - Продлить срок наблюдения         → описание причин + календарь +
 *                                           новая дата окончания (→ observation)
 *      - Результат не подтверждён         → действия не дали результата,
 *                                           CAPA → closed с пометкой
 *      - Отправить на доработку           → CAPA → draft, поля обнуляются
 *                                           для повторного заполнения
 */
(function () {
  "use strict";

  var root = document.getElementById("capa-review-root");
  var S = window.FastCAPAStore;
  var capa = null;
  var reviewFiles = [];       // вложения текущей формы
  var observationFiles = [];  // уже сохранённые вложения результата наблюдения

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
    if (e.key === "Escape") { closeLightbox(); return; }
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

  // ==================== Голосовой ввод (Web Speech API) ====================

  var recBtn = null, recStatus = null, recognition = null, recActive = false;
  var baseText = "";   // текст поля до начала записи (дописываем в конец)

  function initVoice() {
    recBtn = document.getElementById("review-voice-btn");
    recStatus = document.getElementById("review-voice-status");
    if (!recBtn || !recStatus) return;

    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      recStatus.hidden = false;
      recStatus.textContent = "⚠ Распознавание речи недоступно в этом браузере (поддерживаются Chrome/Edge/Safari). Введите текст вручную.";
      recBtn.disabled = true;
      return;
    }

    recBtn.addEventListener("click", function () {
      if (recActive) { recognition.stop(); return; }
      recognition = new SR();
      recognition.lang = "ru-RU";
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onstart = function () {
        recActive = true;
        baseText = document.getElementById("review-result-text").value;
        recBtn.classList.add("fab--recording");
        recStatus.hidden = false;
        recStatus.textContent = "🔴 Идёт запись… говорите, нажмите ещё раз для остановки";
      };

      recognition.onresult = function (e) {
        var text = "";
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) text += e.results[i][0].transcript;
        }
        if (text) {
          var field = document.getElementById("review-result-text");
          var sep = baseText && baseText.slice(-1) !== " " ? " " : "";
          field.value = (baseText + sep + text).trim();
          baseText = field.value;
        }
      };

      recognition.onerror = function (e) {
        recActive = false;
        recBtn.classList.remove("fab--recording");
        recStatus.hidden = false;
        recStatus.textContent = "⚠ Ошибка распознавания: " + e.error;
      };

      recognition.onend = function () {
        if (recActive) {
          recActive = false;
          recBtn.classList.remove("fab--recording");
          recStatus.hidden = false;
          recStatus.textContent = "Запись остановлена. Текст добавлен в поле — проверьте и отредактируйте.";
        }
      };

      try { recognition.start(); } catch (err) {
        recStatus.hidden = false;
        recStatus.textContent = "⚠ Не удалось начать запись.";
      }
    });
  }

  // ==================== Загрузка / проверка доступа ====================

  function renderNotFound() {
    root.innerHTML =
      '<section class="block">' +
      '<h2 class="block__title">CAPA не найдено</h2>' +
      '<p class="empty">Запись не найдена в памяти устройства.</p>' +
      '<p style="margin-top:16px"><a href="capa-monitor.html" class="appbar__link appbar__link--dark">← К монитору CAPA</a></p>' +
      "</section>";
  }

  function renderNotAvailable(reason) {
    root.innerHTML =
      '<section class="block">' +
      '<h2 class="block__title">Карточка завершения недоступна</h2>' +
      '<p class="empty">' + S.escapeHtml(reason) + "</p>" +
      '<p style="margin-top:16px"><a href="capa.html?ref=' + encodeURIComponent(capa.id) +
      '" class="appbar__link appbar__link--dark">← К карточке CAPA</a></p>' +
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

  // ==================== Отрисовка ====================

  function render() {
    var ref = new URLSearchParams(window.location.search).get("ref");
    capa = S.loadCapas().find(function (c) { return c.id === ref; }) || null;

    if (!capa) {
      renderNotFound();
      return;
    }

    document.title = "FastCAPA — Завершение · " + capa.id;

    if (capa.status !== "observation") {
      renderNotAvailable("Карточка завершения наблюдения доступна только для CAPA в статусе «CAPA разработан, наблюдение».");
      return;
    }

    observationFiles = (capa.observation && capa.observation.attachments) || [];

    root.innerHTML =
      // Шапка
      '<section class="block capa-card__head">' +
      '<div class="ncr-card__head-row">' +
      "<div>" +
      '<div class="ncr-card__id">' + S.escapeHtml(capa.id) + "</div>" +
      '<p class="ncr-card__date">Период наблюдения окончен: ' + S.formatDate(capa.observationUntil) + "</p>" +
      "</div>" +
      '<div class="ncr-card__badges">' +
      '<span class="status-badge capa-status--observation status-badge--big">Наблюдение завершено</span>' +
      "</div>" +
      "</div>" +
      '<div class="ncr-card__sla">Связанное NCR: <a href="ncr-view.html?ref=' + encodeURIComponent(capa.ncrRef) + '">' +
      S.escapeHtml(capa.ncrLocalId || capa.ncrRef) + "</a></div>" +
      "</section>" +

      // Контекст
      '<section class="block">' +
      '<h2 class="block__title">Контекст</h2>' +
      '<dl class="ncr-card__props">' +
      propRow("Локация", capa.context.location) +
      propRow("Корневая причина", capa.rootCauseText) +
      propRow("Тип причины (5M)", (S.getCapaRootCauseType(capa.rootCauseType) || {}).label) +
      propRow("Действий выполнено", capa.actions.filter(function (a) { return a.status === "done"; }).length + " из " + capa.actions.length) +
      "</dl>" +
      "</section>" +

      // Форма результата наблюдения
      '<section class="block block--workflow">' +
      '<h2 class="block__title">1 · Результат наблюдения <span class="req">*</span></h2>' +
      '<p class="block__hint">Итог наблюдения за периодом: подтвердился ли эффект корректирующих действий.</p>' +
      '<div class="field">' +
      '<select id="review-outcome" class="input input--big">' +
      '<option value="">— выберите итог —</option>' +
      S.CAPA_OBSERVATION_OUTCOMES.map(function (o) {
        var cur = capa.observation.result === o.key ? " selected" : "";
        return '<option value="' + o.key + '"' + cur + ">" + S.escapeHtml(o.label) + "</option>";
      }).join("") +
      "</select>" +
      "</div>" +
      "</section>" +

      '<section class="block block--workflow">' +
      '<h2 class="block__title">2 · Заключение по наблюдению</h2>' +
      '<p class="block__hint">Опишите, что наблюдалось в период: повторялись ли несоответствия, как работает оборудование/процесс.</p>' +
      '<div class="field">' +
      '<textarea id="review-result-text" class="input input--big" rows="4"' +
      ' placeholder="Например: за 30 дней повторных сколов краски на двери не зафиксировано…">' +
      S.escapeHtml(capa.observation.note || "") + "</textarea>" +
      "</div>" +
      '<div class="field">' +
      "<label>Голосовой ввод · запись распознаётся и добавляется в поле заключения</label>" +
      '<button type="button" id="review-voice-btn" class="fab" aria-label="Записать заключение голосом">' +
      '<span class="fab__icon">🎙</span></button>' +
      '<p id="review-voice-status" class="voice-status" hidden></p>' +
      "</div>" +
      "</section>" +

      // Вложения
      '<section class="block">' +
      '<h2 class="block__title">3 · Вложения <span class="count-badge" id="review-files-count">' +
      (observationFiles.length + reviewFiles.length) + "</span></h2>" +
      '<p class="block__hint">Фото, PDF, видео — доказательства результата наблюдения.</p>' +
      '<input type="file" id="review-files" accept="image/*,application/pdf,video/*" hidden multiple />' +
      '<div class="photos-buttons">' +
      '<button type="button" id="btn-review-files" class="btn btn--ghost btn--photos">📎 Прикрепить файл</button>' +
      "</div>" +
      '<div id="review-previews" class="previews"></div>' +
      '<div id="review-gallery"></div>' +
      "</section>" +

      // Итог: карточка завершения
      buildOutcomeBlock() +

      // История
      '<section class="block">' +
      '<h2 class="block__title">История</h2>' +
      buildHistory() +
      "</section>";

    bindEvents();
    initVoice();
    renderReviewGallery();
  }

  // Блок итога: состав полей зависит от выбранного типа завершения
  function buildOutcomeBlock() {
    return (
      '<section class="block block--workflow block--action">' +
      '<h2 class="block__title">4 · Завершение</h2>' +
      '<p class="block__hint">Выберите итог в блоке 1 — появятся поля выбранного типа завершения. Без заполнения этой карточки CAPA завершить нельзя.</p>' +
      '<p id="review-error" class="field-error" hidden></p>' +
      '<div id="review-outcome-extra"></div>' +
      '<button type="button" id="act-finish" class="btn btn--primary btn--workflow">✔ Завершить наблюдение</button>' +
      "</section>"
    );
  }

  // Динамические поля по типу завершения
  function renderOutcomeExtra() {
    var extra = document.getElementById("review-outcome-extra");
    if (!extra) return;
    var outcome = (document.getElementById("review-outcome") || {}).value || "";

    if (outcome === "extended") {
      // Продление: описание причин + календарь + предпросмотр новой даты
      var defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + S.CAPA_OBSERVATION_DAYS_DEFAULT);
      var iso = defaultDate.toISOString().slice(0, 10);
      extra.innerHTML =
        '<div class="field">' +
        '<label for="review-extend-reason">Причины продления <span class="req">*</span></label>' +
        '<textarea id="review-extend-reason" class="input input--big" rows="2"' +
        ' placeholder="Например: недостаточно данных за период, сезонность нагрузки…"></textarea>' +
        "</div>" +
        '<div class="field">' +
        '<label for="review-extend-until">Новая дата окончания наблюдения <span class="req">*</span></label>' +
        '<input type="date" id="review-extend-until" class="input input--big" value="' + iso + '" />' +
        '<p class="block__hint" id="review-extend-preview"></p>' +
        "</div>";
      var untilInput = document.getElementById("review-extend-until");
      var preview = document.getElementById("review-extend-preview");
      var updatePreview = function () {
        preview.textContent = untilInput.value
          ? "Период наблюдения будет продлён до " + S.formatDate(untilInput.value) + "."
          : "";
      };
      untilInput.addEventListener("change", updatePreview);
      updatePreview();
    } else if (outcome === "not_confirmed" || outcome === "rework") {
      var needReason = outcome === "not_confirmed"
        ? "Опишите, какие несоответствия повторились / почему эффект не подтверждён"
        : "Опишите, что нужно переработать в плане (5 Why, действия, сроки)";
      extra.innerHTML =
        '<div class="field">' +
        '<label for="review-reject-reason">Комментарий <span class="req">*</span></label>' +
        '<textarea id="review-reject-reason" class="input input--big" rows="2"' +
        ' placeholder="' + needReason + '…"></textarea>' +
        "</div>";
    } else {
      extra.innerHTML = "";
    }
  }

  function buildHistory() {
    var labels = {
      created: "Создан из NCR",
      draft_saved: "Черновик сохранён",
      submit: "Отправлен на исполнение",
      observation: "Переведён в наблюдение",
      observation_extended: "Наблюдение продлено",
      close: "Закрыт",
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

  // ==================== Вложения ====================

  function renderReviewGallery() {
    var container = document.getElementById("review-gallery");
    if (!container) return;
    var all = observationFiles.concat(reviewFiles.map(function (f) {
      return { name: f.name, type: f.type, dataUrl: f.url };
    }));
    if (!all.length) {
      container.innerHTML = '<p class="empty">Вложений нет.</p>';
      return;
    }
    var html = '<div class="gallery">';
    var idx = 0;
    all.forEach(function (a) {
      if (a.dataUrl) {
        html +=
          '<figure class="gallery__item" data-media-index="' + idx + '" title="Открыть просмотр">' +
          (a.type && a.type.indexOf("video/") === 0
            ? '<div class="gallery__video-badge">▶ видео</div><div class="gallery__ph">🎬</div>'
            : '<img class="gallery__img" src="' + a.dataUrl + '" alt="' + S.escapeHtml(a.name) + '" />') +
          '<figcaption class="gallery__caption">' + S.escapeHtml(a.name) + "</figcaption>" +
          "</figure>";
        idx++;
      } else {
        html +=
          '<figure class="gallery__item gallery__item--file">' +
          '<div class="gallery__ph">📄</div>' +
          '<figcaption class="gallery__caption">' + S.escapeHtml(a.name) + "</figcaption>" +
          "</figure>";
      }
    });
    html += "</div>";
    container.innerHTML = html;

    container.querySelectorAll(".gallery__item[data-media-index]").forEach(function (fig) {
      fig.addEventListener("click", function () {
        var list = all.filter(function (a) { return !!a.dataUrl; }).map(function (a) {
          return { src: a.dataUrl, type: a.type, name: a.name };
        });
        openLightbox(list, parseInt(fig.getAttribute("data-media-index"), 10));
      });
    });
  }

  function renderReviewPreviews() {
    var container = document.getElementById("review-previews");
    if (!container) return;
    container.innerHTML = "";
    reviewFiles.forEach(function (f) {
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
    var badge = document.getElementById("review-files-count");
    if (badge) badge.textContent = String(observationFiles.length + reviewFiles.length);
  }

  // ==================== Завершение ====================

  function collectAndValidate() {
    var outcome = (document.getElementById("review-outcome") || {}).value || "";
    var note = ((document.getElementById("review-result-text") || {}).value || "").trim();
    var errors = [];
    if (!outcome) errors.push("выберите итог наблюдения");
    if (!note) errors.push("заполните заключение по наблюдению");

    var reason = "", untilIso = null;
    if (outcome === "extended") {
      reason = ((document.getElementById("review-extend-reason") || {}).value || "").trim();
      untilIso = ((document.getElementById("review-extend-until") || {}).value || "").trim();
      if (!reason) errors.push("укажите причины продления");
      if (!untilIso) errors.push("выберите новую дату окончания наблюдения");
    } else if (outcome === "not_confirmed" || outcome === "rework") {
      reason = ((document.getElementById("review-reject-reason") || {}).value || "").trim();
      if (!reason) errors.push("заполните комментарий");
    }
    return { outcome: outcome, note: note, reason: reason, untilIso: untilIso, errors: errors };
  }

  function finishReview() {
    var data = collectAndValidate();
    var err = document.getElementById("review-error");
    if (data.errors.length) {
      err.hidden = false;
      err.textContent = "⚠ Исправьте перед завершением: " + data.errors.join("; ") + ".";
      return;
    }
    err.hidden = true;

    var files = observationFiles.concat(reviewFiles.map(function (f) {
      return { name: f.name, type: f.type, size: f.size, dataUrl: f.url };
    }));
    var user = S.currentUser();
    var link = "capa.html?ref=" + encodeURIComponent(capa.id);
    var participants = [capa.createdBy].concat(capa.actions.map(function (a) { return a.assignee; }))
      .filter(function (v, i, arr) { return v && arr.indexOf(v) === i; });

    // Сохраняем результат наблюдения в CAPA
    S.updateCapa(capa.id, function (c) {
      c.observation = c.observation || { result: "", attachments: [], reworkCount: 0, extensions: [] };
      c.observation.result = data.outcome;
      c.observation.note = data.note;
      c.observation.attachments = files;
      c.observation.lastReviewAt = new Date().toISOString();
      c.observation.lastReviewBy = user;
    });

    if (data.outcome === "confirmed") {
      S.updateCapa(capa.id, function (c) {
        c.status = "closed";
        S.addCapaHistory(c, "close", user, "Наблюдение завершено: эффект корректирующих действий подтверждён. " + data.note);
      });
      S.pushNotification({
        recipients: participants,
        title: "CAPA " + capa.id + " закрыт",
        text: "Наблюдение завершено, эффект подтверждён (" + user + ").",
        link: link
      });
      window.location.href = link;
      return;
    }

    if (data.outcome === "extended") {
      S.updateCapa(capa.id, function (c) {
        c.observationUntil = new Date(data.untilIso + "T23:59:59").toISOString();
        c.observation.extensions = (c.observation.extensions || []).concat([{
          until: c.observationUntil, reason: data.reason, by: user, ts: new Date().toISOString()
        }]);
        S.addCapaHistory(c, "observation_extended", user,
          "Наблюдение продлено до " + S.formatDate(c.observationUntil) + ". Причины: " + data.reason);
      });
      S.pushNotification({
        recipients: participants,
        title: "CAPA " + capa.id + " — наблюдение продлено",
        text: "Новая дата окончания: " + S.formatDate(capa.observationUntil) + ". Причины: " + data.reason,
        link: link
      });
      window.location.href = link;
      return;
    }

    if (data.outcome === "not_confirmed") {
      S.updateCapa(capa.id, function (c) {
        c.status = "closed";
        S.addCapaHistory(c, "close_not_confirmed", user,
          "Результат не подтверждён: корректирующие действия не дали результата. " + data.reason);
      });
      S.pushNotification({
        recipients: participants,
        title: "CAPA " + capa.id + " — результат не подтверждён",
        text: "Корректирующие действия не дали результата. Требуется новое решение по несоответствию.",
        link: link
      });
      window.location.href = link;
      return;
    }

    // rework: возврат в процесс создания CAPA — поля обнуляются для повторного заполнения
    S.updateCapa(capa.id, function (c) {
      c.status = "draft";
      c.observation.reworkCount = (c.observation.reworkCount || 0) + 1;
      c.observation.reworkReason = data.reason;
      c.why = [""];
      c.rootCauseType = "";
      c.rootCauseText = "";
      c.actions = [];
      c.attachments = [];
      c.observationUntil = null;
      S.addCapaHistory(c, "rework", user,
        "Отправлен на доработку (доработка №" + c.observation.reworkCount + "). Причина: " + data.reason);
    });
    S.pushNotification({
      recipients: participants,
      title: "CAPA " + capa.id + " отправлен на доработку",
      text: "Причина: " + data.reason + " Откройте карточку и заполните заново.",
      link: link
    });
    window.location.href = link;
  }

  // ==================== События ====================

  function bindEvents() {
    var outcomeSelect = document.getElementById("review-outcome");
    if (outcomeSelect) outcomeSelect.addEventListener("change", renderOutcomeExtra);
    renderOutcomeExtra();

    var fileInput = document.getElementById("review-files");
    document.getElementById("btn-review-files").addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      Array.from(fileInput.files || []).forEach(function (file) {
        if (file.type.indexOf("image/") === 0) {
          compressImage(file, 900, 0.62, function (compressed) {
            reviewFiles.push(compressed);
            renderReviewPreviews();
            renderReviewGallery();
          });
        } else {
          reviewFiles.push({ name: file.name, type: file.type, size: file.size, url: null });
          renderReviewPreviews();
          renderReviewGallery();
        }
      });
      fileInput.value = "";
    });

    document.getElementById("act-finish").addEventListener("click", finishReview);
  }

  render();
})();
