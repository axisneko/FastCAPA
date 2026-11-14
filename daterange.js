/* FastCAPA — Компактный календарь выбора периода (daterange)
 *
 * Компонент window.FastCAPADateRange.create({ container, onChange }).
 * Рисует кнопку с иконкой календаря и выпадающую панель с сеткой месяца.
 * Диапазон выбирается двумя щелчками: первый — дата начала, второй — дата конца.
 * Кнопки «Сбросить» и «Готово» закрывают панель (сброс вызывает onChange("", "")).
 * Стили — классы .daterange__* из styles.css.
 */
(function () {
  "use strict";

  var MONTHS = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
  ];
  var WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  // ISO-дата (YYYY-MM-DD) из компонентов или объекта Date
  function isoOf(y, m, d) {
    return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }

  // Короткая дата для подписи кнопки: 05.03
  function shortLabel(iso) {
    var parts = iso.split("-");
    return parts[2] + "." + parts[1];
  }

  function DateRange(opts) {
    var root = document.createElement("span");
    root.className = "daterange";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "daterange__btn";
    btn.title = "Выбрать период";

    var panel = document.createElement("div");
    panel.className = "daterange__panel";
    panel.hidden = true;

    root.appendChild(btn);
    root.appendChild(panel);
    opts.container.appendChild(root);

    var fromIso = "";      // выбранное начало ("" = не выбрано)
    var toIso = "";        // выбранный конец
    var pickIso = "";      // первая точка диапазона до завершения выбора
    var viewYear, viewMonth; // отображаемый месяц панели

    // ==================== Отрисовка кнопки ====================

    function renderBtn() {
      if (fromIso && toIso) {
        var cross = fromIso.slice(0, 4) !== toIso.slice(0, 4);
        btn.textContent = "📅 " + shortLabel(fromIso) + (cross ? " " + fromIso.slice(0, 4) : "") +
          " – " + shortLabel(toIso) + (cross ? " " + toIso.slice(0, 4) : "");
        btn.classList.add("daterange__btn--active");
      } else {
        btn.textContent = "📅 Период";
        btn.classList.remove("daterange__btn--active");
      }
    }

    // ==================== Отрисовка панели ====================

    function renderPanel() {
      panel.innerHTML = "";

      // Заголовок: месяц/год + стрелки навигации
      var head = document.createElement("div");
      head.className = "daterange__head";
      head.innerHTML =
        '<button type="button" class="daterange__nav" data-nav="-1" title="Предыдущий месяц">‹</button>' +
        '<span class="daterange__month">' + MONTHS[viewMonth] + " " + viewYear + "</span>" +
        '<button type="button" class="daterange__nav" data-nav="1" title="Следующий месяц">›</button>';
      panel.appendChild(head);

      // Сетка: подписи дней недели + дни месяца
      var grid = document.createElement("div");
      grid.className = "daterange__week";
      WEEKDAYS.forEach(function (wd) {
        var cell = document.createElement("span");
        cell.className = "daterange__wd";
        cell.textContent = wd;
        grid.appendChild(cell);
      });
      panel.appendChild(grid);

      var days = document.createElement("div");
      days.className = "daterange__week daterange__days";

      var first = new Date(viewYear, viewMonth, 1);
      // Смещение до понедельника (первый день недели — Пн)
      var offset = (first.getDay() + 6) % 7;
      var total = new Date(viewYear, viewMonth + 1, 0).getDate();
      var todayIso = isoOf(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

      for (var i = 0; i < offset; i++) {
        var pad = document.createElement("span");
        pad.className = "daterange__day daterange__day--empty";
        days.appendChild(pad);
      }

      var lo = fromIso || pickIso; // нижняя граница активной области
      var hi = toIso || pickIso;   // верхняя граница активной области
      if (lo && hi && lo > hi) { var t = lo; lo = hi; hi = t; }

      for (var d = 1; d <= total; d++) {
        var dayIso = isoOf(viewYear, viewMonth, d);
        var cell = document.createElement("button");
        cell.type = "button";
        cell.className = "daterange__day";
        cell.textContent = String(d);
        if (dayIso === todayIso) cell.classList.add("daterange__day--today");
        if (lo && hi && dayIso >= lo && dayIso <= hi) cell.classList.add("daterange__day--in");
        if (dayIso === lo || dayIso === hi) cell.classList.add("daterange__day--edge");
        days.appendChild(cell);
      }
      panel.appendChild(days);

      // Подвал: сброс + подтверждение
      var foot = document.createElement("div");
      foot.className = "daterange__foot";
      foot.innerHTML =
        '<button type="button" class="daterange__clear">Сбросить</button>' +
        '<button type="button" class="daterange__done">Готово</button>';
      panel.appendChild(foot);
    }

    // ==================== События панели ====================

    panel.addEventListener("click", function (e) {
      var target = e.target;

      // Навигация по месяцам
      if (target.classList.contains("daterange__nav")) {
        var step = Number(target.getAttribute("data-nav")) || 0;
        viewMonth += step;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        renderPanel();
        return;
      }

      // Выбор дня: первый щелчок — точка диапазона, второй — завершение
      if (target.classList.contains("daterange__day") && !target.classList.contains("daterange__day--empty")) {
        var dayIso = isoOf(viewYear, viewMonth, Number(target.textContent));
        if (!pickIso) {
          pickIso = dayIso;
          fromIso = toIso = "";
        } else {
          fromIso = pickIso <= dayIso ? pickIso : dayIso;
          toIso = pickIso <= dayIso ? dayIso : pickIso;
          pickIso = "";
          // Фильтр применяется сразу, не дожидаясь кнопки «Готово»
          opts.onChange(fromIso, toIso);
        }
        renderBtn();
        renderPanel();
        return;
      }

      // Сброс: очистить выбор и уведомить
      if (target.classList.contains("daterange__clear")) {
        fromIso = toIso = pickIso = "";
        renderBtn();
        renderPanel();
        opts.onChange("", "");
        return;
      }

      // Готово: применить выбор и закрыть
      if (target.classList.contains("daterange__done")) {
        close();
        opts.onChange(fromIso, toIso);
      }
    });

    // ==================== Открытие / закрытие ====================

    function open() {
      var anchor = fromIso ? new Date(fromIso + "T00:00:00") : new Date();
      viewYear = anchor.getFullYear();
      viewMonth = anchor.getMonth();
      pickIso = "";
      renderPanel();
      panel.hidden = false;
    }

    function close() {
      panel.hidden = true;
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      panel.hidden ? open() : close();
    });

    // Закрытие по щелчку вне панели и по Escape
    document.addEventListener("click", function (e) {
      if (!panel.hidden && !root.contains(e.target)) {
        // Если выбор не завершён (есть первая точка, а вторая не выбрана) —
        // считаем диапазон из одной даты и применяем его
        if (pickIso && !toIso) {
          fromIso = pickIso;
          toIso = pickIso;
          pickIso = "";
          renderBtn();
          opts.onChange(fromIso, toIso);
        }
        close();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) {
        if (pickIso && !toIso) {
          fromIso = pickIso;
          toIso = pickIso;
          pickIso = "";
          renderBtn();
          opts.onChange(fromIso, toIso);
        }
        close();
      }
    });

    renderBtn();
  }

  window.FastCAPADateRange = {
    create: function (opts) {
      if (!opts || !opts.container || typeof opts.onChange !== "function") return null;
      return new DateRange(opts);
    }
  };
})();
