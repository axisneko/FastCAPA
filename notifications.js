/* FastCAPA — Уведомления (общий модуль для всех страниц)
 *
 * Колокол в AppBar с количеством непрочитанных и выпадающей панелью.
 * Уведомления создаются в сценариях CAPA (store.js: pushNotification):
 *   - «Отправить на исполнение» → исполнителям по действиям
 *   - «Действие выполнено» → автору CAPA
 *   - «Перевести в наблюдение» → исполнителям и автору
 *   - «CAPA закрыт» → исполнителям и автору
 *
 * Подключение: <script src="store.js"></script><script src="notifications.js"></script>
 * Разметка: <span class="notif-wrap" id="notif-wrap"></span> внутри .appbar__meta.
 */
(function () {
  "use strict";

  var S = window.FastCAPAStore;

  function user() {
    return S.currentUser();
  }

  // Отрисовать колокол с бейджем непрочитанных
  function renderBell() {
    var wrap = document.getElementById("notif-wrap");
    if (!wrap) return;
    var unread = S.unreadNotificationsCount(user());
    wrap.innerHTML =
      '<button type="button" id="notif-bell" class="notif-bell" title="Уведомления">🔔' +
      (unread > 0 ? '<span class="notif-bell__count">' + (unread > 99 ? "99+" : unread) + "</span>" : "") +
      "</button>" +
      '<div id="notif-panel" class="notif-panel" hidden></div>';

    document.getElementById("notif-bell").addEventListener("click", togglePanel);
  }

  function togglePanel() {
    var panel = document.getElementById("notif-panel");
    if (!panel) return;
    if (panel.hidden) {
      renderPanel();
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  }

  function renderPanel() {
    var panel = document.getElementById("notif-panel");
    if (!panel) return;
    var list = S.notificationsFor(user());

    var items = list.slice(0, 30).map(function (n) {
      var unread = (n.readBy || []).indexOf(user()) === -1;
      return (
        '<div class="notif-item' + (unread ? " notif-item--unread" : "") + '" data-notif-link="' +
        S.escapeHtml(n.link || "") + '">' +
        '<div class="notif-item__title">' + S.escapeHtml(n.title) + "</div>" +
        '<div class="notif-item__text">' + S.escapeHtml(n.text) + "</div>" +
        '<div class="notif-item__ts">' + S.formatDate(n.ts) + "</div>" +
        "</div>"
      );
    }).join("");

    panel.innerHTML =
      '<div class="notif-panel__title">Уведомления</div>' +
      (items || '<p class="empty">Уведомлений нет.</p>');

    // Клик по уведомлению: перейти по ссылке и отметить прочитанным
    panel.querySelectorAll(".notif-item").forEach(function (el) {
      el.addEventListener("click", function () {
        S.markNotificationsRead(user());
        renderBell();
        var link = el.getAttribute("data-notif-link");
        if (link) window.location.href = link;
        panel.hidden = true;
      });
    });
  }

  // Закрыть панель по клику вне неё
  document.addEventListener("click", function (e) {
    var wrap = document.getElementById("notif-wrap");
    if (!wrap || wrap.contains(e.target)) return;
    var panel = document.getElementById("notif-panel");
    if (panel) panel.hidden = true;
  });

  // Перерисовка при возврате на страницу и при изменениях в других вкладках
  window.addEventListener("focus", renderBell);
  window.addEventListener("storage", renderBell);

  renderBell();
})();
