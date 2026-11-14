/* FastCAPA — Монитор CAPA (capa-monitor.html)
 *
 * Таблица CAPA из локального реестра (localStorage, ключ fastcapa_capa_registry).
 * Поиск по тексту + фильтры по корневой причине (5M) и статусу.
 * Диаграммы: статусы CAPA, корневые причины (5M).
 * Клик по строке → карточка CAPA (capa.html?ref=...).
 */
(function () {
  "use strict";

  var tbody = document.getElementById("capa-tbody");
  var searchInput = document.getElementById("capa-filter-search");
  var emptyMsg = document.getElementById("capa-table-empty");
  var counter = document.getElementById("capa-monitor-counter");
  var periodFrom = "";        // ISO-дата начала периода ("" = без ограничения)
  var periodTo = "";          // ISO-дата конца периода
  var activeRootCause = "";   // "" = все
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

  function rootCauseLabel(key) {
    var t = S.getCapaRootCauseType(key);
    return t ? t.label : "—";
  }

  function render() {
    var all = S.loadCapas();
    var query = searchInput.value.trim().toLowerCase();

    var list = all.filter(function (c) {
      if (activeRootCause && c.rootCauseType !== activeRootCause) return false;
      if (activeStatus && c.status !== activeStatus) return false;
      if (!inPeriod(c.createdAt)) return false;
      if (!query) return true;
      var hay = [
        c.id, c.ncrLocalId, c.ncrRef,
        c.context && c.context.location,
        c.context && c.context.description,
        c.rootCauseText, c.rootCauseType,
        (c.actions || []).map(function (a) { return a.action + " " + a.assignee; }).join(" ")
      ].join(" ").toLowerCase();
      return hay.indexOf(query) !== -1;
    });

    if (all.length === 0) {
      emptyMsg.hidden = false;
    } else if (list.length === 0) {
      emptyMsg.hidden = false;
      emptyMsg.innerHTML = "Под текущий фильтр/поиск не попало ни одного CAPA (всего в памяти: " + all.length + ").";
    } else {
      emptyMsg.hidden = true;
    }

    counter.textContent = "CAPA: " + list.length + (list.length !== all.length ? " / " + all.length : "");
    tbody.innerHTML = "";

    list.forEach(function (c) {
      var st = S.getCapaStatus(c.status);
      var tr = document.createElement("tr");
      tr.className = "ncr-table__row";
      tr.title = "Открыть карточку CAPA";

      // Плашка «Наблюдение завершено»: период истёк, требуется карточка завершения
      var obsOver = c.status === "observation" && S.observationCompleted(c);
      var statusCell = obsOver
        ? '<span class="status-badge capa-status--obs-over">⚠ Наблюдение завершено</span>' +
          '<br /><button type="button" class="btn btn--gold btn--capa-row" data-review-capa="' +
          S.escapeHtml(c.id) + '">📋 Завершить наблюдение</button>'
        : '<span class="status-badge ' + st.badge + '">' + S.escapeHtml(st.label) + "</span>";

      tr.innerHTML =
        '<td class="ncr-table__id">' + S.escapeHtml(c.id) + "</td>" +
        '<td class="ncr-table__nowrap">' + S.formatDate(c.createdAt) + "</td>" +
        '<td class="ncr-table__nowrap">' + S.escapeHtml(c.ncrLocalId || c.ncrRef) + "</td>" +
        '<td class="ncr-table__loc"><div class="ncr-table__loc-inner">' + S.escapeHtml((c.context && c.context.location) || "—") + "</div></td>" +
        "<td>" + S.escapeHtml(rootCauseLabel(c.rootCauseType)) + "</td>" +
        '<td class="ncr-table__nowrap">' + (c.actions || []).length + "</td>" +
        '<td class="ncr-table__desc"><div class="ncr-table__desc-inner">' +
        S.escapeHtml((c.context && c.context.description) || "(без описания)") + "</div></td>" +
        "<td>" + statusCell + "</td>";

      // Кнопка «Завершить наблюдение» — прямая ссылка на карточку завершения
      var reviewBtn = tr.querySelector("[data-review-capa]");
      if (reviewBtn) {
        reviewBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          window.location.href = "capa-review.html?ref=" + encodeURIComponent(reviewBtn.getAttribute("data-review-capa"));
        });
      }

      tr.addEventListener("click", function () {
        window.location.href = "capa.html?ref=" + encodeURIComponent(c.id);
      });

      tbody.appendChild(tr);
    });
  }

  // Фильтр-чипы корневой причины (5M)
  document.querySelectorAll(".filter-chip[data-rc]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      document.querySelectorAll(".filter-chip[data-rc]").forEach(function (c) { c.classList.remove("filter-chip--active"); });
      chip.classList.add("filter-chip--active");
      activeRootCause = chip.getAttribute("data-rc") || "";
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
      container: document.getElementById("capa-filter-daterange"),
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

    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2;
    var radius = Math.min(w, h) / 2 - 8;
    var inner = radius * 0.58;
    var start = -Math.PI / 2;

    if (total === 0) {
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
    var all = S.loadCapas();

    // Корневые причины (5M): сине-оранжевая палитра
    var rcColors = {
      method: "#143f6b",
      machine: "#e87722",
      material: "#5b83ac",
      man: "#cf6416",
      environment: "#aeb7c2"
    };
    var rcSegments = S.CAPA_ROOT_CAUSE_TYPES.map(function (t) {
      return {
        label: t.label,
        value: all.filter(function (c) { return c.rootCauseType === t.key; }).length,
        color: rcColors[t.key]
      };
    });
    drawDonut("capa-chart-rootcause", "capa-chart-rootcause-legend", rcSegments, "планов CAPA");

    // Статусы CAPA: сине-оранжевая палитра
    var stColors = {
      draft: "#aeb7c2",
      in_progress: "#1f5c99",
      observation: "#e87722",
      closed: "#143f6b"
    };
    var stSegments = S.CAPA_STATUSES.map(function (st) {
      return {
        label: st.label,
        value: all.filter(function (c) { return c.status === st.key; }).length,
        color: stColors[st.key]
      };
    });
    drawDonut("capa-chart-status", "capa-chart-status-legend", stSegments, "планов CAPA");
  }

  // Перестраиваем диаграммы вместе с таблицей
  var _origRender = render;
  render = function () { _origRender(); renderCharts(); };

  window.addEventListener("focus", render);
  window.addEventListener("storage", render);

  render();
})();
