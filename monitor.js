/* FastCAPA — Монитор несоответствий
 *
 * Таблица NCR из локальной очереди (localStorage).
 * Поиск по тексту + фильтры по приоритету и статусу.
 * Клик по строке → карточка NCR (ncr-view.html?ref=...).
 */
(function () {
  "use strict";

  var tbody = document.getElementById("ncr-tbody");
  var searchInput = document.getElementById("filter-search");
  var emptyMsg = document.getElementById("table-empty");
  var counter = document.getElementById("monitor-counter");
  var periodFrom = "";        // ISO-дата начала периода ("" = без ограничения)
  var periodTo = "";          // ISO-дата конца периода
  var activeSeverity = "";    // "" = все
  var activeStatus = "";      // "" = все
  var S = window.FastCAPAStore;

  // Попадает ли дата записи (ISO) в выбранный период (границы включительно)
  function inPeriod(iso) {
    if (!periodFrom && !periodTo) return true;
    var t = new Date(iso).getTime();
    if (isNaN(t)) return false;
    if (periodFrom && t < new Date(periodFrom + "T00:00:00").getTime()) return false;
    if (periodTo && t > new Date(periodTo + "T23:59:59").getTime()) return false;
    return true;
  }

  function render() {
    var all = S.loadQueue();
    var query = searchInput.value.trim().toLowerCase();

    var list = all.filter(function (item) {
      if (activeSeverity && item.severity !== activeSeverity) return false;
      if (activeStatus && item.status !== activeStatus) return false;
      if (!inPeriod(item.createdAt)) return false;
      if (!query) return true;
      var hay = [
        item.localId, item.clientRef, item.location,
        item.category, item.process, item.description
      ].join(" ").toLowerCase();
      return hay.indexOf(query) !== -1;
    });

    // Если записей нет вообще (или с активным фильтром/поиском) — объясняем почему
    var dbg = S.debugCount();
    if (all.length === 0) {
      emptyMsg.hidden = false;
      emptyMsg.innerHTML = dbg.present
        ? "В памяти есть данные, но прочитать их не удалось (повреждены). Откройте страницу регистрации и зарегистрируйте NCR заново."
        : "В памяти устройства пока нет ни одного NCR. <a href=\"ncr.html\">Зарегистрируйте первое несоответствие</a> — оно появится здесь. Если вы только что зарегистрировали NCR, убедитесь, что файл <b>store.js</b> лежит в той же папке, что и остальные страницы.";
    } else if (list.length === 0) {
      emptyMsg.hidden = false;
      emptyMsg.innerHTML = "Под текущий фильтр/поиск не попало ни одно несоответствие (всего в памяти: " + all.length + ").";
    } else {
      emptyMsg.hidden = true;
    }

    counter.textContent = "NCR: " + list.length + (list.length !== all.length ? " / " + all.length : "");
    tbody.innerHTML = "";

    // Добавление NCR в таблицу
    list.forEach(function (item) {
      var sev = S.getSeverity(item.severity);
      var sevColors = { "S-1": "#c0392b", "S-2": "#e87722", "S-3": "#e8a13d", "S-4": "#1f5c99" };
      var st = S.getStatus(item.status);
      var hasCapa = S.hasCapa(item.clientRef);
      var tr = document.createElement("tr");
      tr.className = "ncr-table__row";
      tr.title = "Открыть карточку NCR";

      tr.innerHTML =
        '<td class="ncr-table__id">' + S.escapeHtml(item.localId || item.clientRef) + "</td>" +
        '<td class="ncr-table__nowrap">' + S.formatDate(item.createdAt) + "</td>" +
        '<td class="ncr-table__loc"><div class="ncr-table__loc-inner">' + S.escapeHtml(item.location || "—") + "</div></td>" +
        "<td>" + S.escapeHtml(item.category || "—") + "</td>" +
        '<td><span class="badge badge--' + sev.code.toLowerCase() + '" style="color:' + sevColors[sev.code] +'" title="' +
          S.escapeHtml(sev.name + " · " + sev.sla) + '">' + sev.code + "</span></td>" +
        '<td class="ncr-table__desc"><div class="ncr-table__desc-inner">' + S.escapeHtml(item.description || "(без описания)") + "</div></td>" +
        '<td class="ncr-table__nowrap">' + S.attachmentsCount(item) + "</td>" +
        '<td><span class="status-badge ' + st.badge + '">' + S.escapeHtml(st.label) + "</span></td>" +
        '<td class="ncr-table__nowrap"><span class="badge ' +
          (hasCapa ? "badge--capa-yes" : "badge--capa-no") + '">' +
          (hasCapa ? "есть CAPA" : "нет CAPA") + "</span></td>" +
        '<td class="ncr-table__nowrap">' +
          (hasCapa
            ? '<span class="ncr-table__hint">план уже создан</span>'
            : '<button type="button" class="btn btn--gold btn--capa-row" data-capa-ncr="' +
              S.escapeHtml(item.clientRef) + '">🧩 Разработать CAPA</button>') +
        "</td>";

      // Кнопка «Разработать CAPA»: создание связанной CAPA без перехода в карточку NCR.
      // Кнопка есть не в каждой строке (при «есть CAPA» её нет) — обязательна проверка.
      var capaBtn = tr.querySelector("[data-capa-ncr]");
      if (capaBtn) {
        capaBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          window.location.href = "capa.html?create=1&ncr=" + encodeURIComponent(capaBtn.getAttribute("data-capa-ncr"));
        });
      }

      tr.addEventListener("click", function () {
        window.location.href = "ncr-view.html?ref=" + encodeURIComponent(item.clientRef);
      });

      tbody.appendChild(tr);
    });
  }

  // Фильтр-чипы приоритетов
  document.querySelectorAll(".filter-chip[data-sev]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      document.querySelectorAll(".filter-chip[data-sev]").forEach(function (c) { c.classList.remove("filter-chip--active"); });
      chip.classList.add("filter-chip--active");
      activeSeverity = chip.getAttribute("data-sev") || "";
      render();
    });
  });

  // Фильтр-чипы статусов
  document.querySelectorAll(".filter-chip[data-status]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      document.querySelectorAll(".filter-chip[data-status]").forEach(function (c) { c.classList.remove("filter-chip--active"); });
      chip.classList.add("filter-chip--active");
      activeStatus = chip.getAttribute("data-status") || "";
      render();
    });
  });

  searchInput.addEventListener("input", render);

  // Фильтр периода: компактный календарь с выбором диапазона двумя щелчками
  if (window.FastCAPADateRange) {
    window.FastCAPADateRange.create({
      container: document.getElementById("filter-daterange"),
      onChange: function (fromIso, toIso) {
        periodFrom = fromIso;
        periodTo = toIso;
        render();
      }
    });
  }

  // ==================== Диаграммы (canvas, без библиотек) ====================

  function drawDonut(canvasId, legendId, segments, centerTitle) {
    var canvas = document.getElementById(canvasId);
    var legend = document.getElementById(legendId);
    if (!canvas || !legend) return;
    var ctx = canvas.getContext("2d");
    var total = segments.reduce(function (sum, s) { return sum + s.value; }, 0);

    // Легенда: количество + проценты
    legend.innerHTML = "";
    segments.forEach(function (s) {
      var pct = total ? Math.round((s.value / total) * 100) : 0;
      var li = document.createElement("li");
      li.innerHTML =
        '<span class="chart-legend__dot" style="background:' + s.color + '"></span>' +
        '<span class="chart-legend__label">' + s.label + "</span>" +
        '<span class="chart-legend__value">' + s.value + " · " + pct + "%</span>";
      legend.appendChild(li);
    });

    // Кольцевая диаграмма
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2;
    var radius = Math.min(w, h) / 2 - 8;
    var inner = radius * 0.58;
    var start = -Math.PI / 2;   // с 12 часов

    if (total === 0) {
      // Пустое состояние: серый круг + текст
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "#d9dfe6";
      ctx.lineWidth = radius - inner;
      ctx.stroke();
      ctx.fillStyle = "#64707d";
      ctx.font = "600 14px 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Нет данных", cx, cy);
      return;
    }

    segments.forEach(function (s) {
      if (!s.value) return;
      var angle = (s.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      start += angle;
    });

    // Дырка и центр: всего N
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    ctx.fillStyle = "#143f6b";
    ctx.font = "700 26px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(total), cx, cy - 10);
    ctx.fillStyle = "#64707d";
    ctx.font = "12px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillText(centerTitle || "всего", cx, cy + 16);
  }

  function renderCharts() {
    var all = window.FastCAPAStore.loadQueue();

    // Приоритеты: S-1..S-4 — оттенки в общей палитре (красный→оранжевый→синий)
    var sevColors = { "S-1": "#c0392b", "S-2": "#e87722", "S-3": "#e8a13d", "S-4": "#1f5c99" };
    var sevSegments = ["S-1", "S-2", "S-3", "S-4"].map(function (code) {
      return {
        label: code + " " + (window.FastCAPAStore.getSeverity(code).name),
        value: all.filter(function (n) { return n.severity === code; }).length,
        color: sevColors[code]
      };
    });
    drawDonut("chart-severity", "chart-severity-legend", sevSegments, "инцидентов");

    // Статусы: оттенки сине-оранжевой палитры от светлого к тёмному
    var stColors = {
      new: "#e8a13d",
      assigned: "#cf6416",
      in_progress: "#1f5c99",
      pending_verification: "#5b83ac",
      closed: "#143f6b",
      rejected: "#aeb7c2"
    };
    var stSegments = window.FastCAPAStore.STATUSES.map(function (st) {
      return {
        label: st.label,
        value: all.filter(function (n) { return n.status === st.key; }).length,
        color: stColors[st.key]
      };
    });
    drawDonut("chart-status", "chart-status-legend", stSegments, "инцидентов");
  }

  // Перестраиваем диаграммы вместе с таблицей
  var _origRender = render;
  render = function () { _origRender(); renderCharts(); };

  // Обновление при возврате на страницу (после добавления NCR в другой вкладке)
  window.addEventListener("focus", render);
  window.addEventListener("storage", render);

  render();
})();
