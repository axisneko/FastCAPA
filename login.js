/* FastCAPA — страница входа/регистрации (MVP: локальная авторизация) */
(function () {
  "use strict";

  var USERS_KEY = "fastcapa_users";       // зарегистрированные пользователи
  var SESSION_KEY = "fastcapa_session";   // текущая сессия

  var DEFAULT_ADMIN = { login: "admin", password: "1111", firstName: "Администратор" };

  function $(id) { return document.getElementById(id); }

  function loadUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function setSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ login: user.login, name: user.firstName }));
  }

  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  // ==================== ВКЛАДКИ ====================

  var tabLogin = $("tab-login"), tabRegister = $("tab-register");
  var loginForm = $("login-form"), registerForm = $("register-form"), loggedInPane = $("logged-in");

  function showLoginTab() {
    tabLogin.classList.add("tab--active");
    tabLogin.setAttribute("aria-selected", "true");
    tabRegister.classList.remove("tab--active");
    tabRegister.setAttribute("aria-selected", "false");
    loginForm.hidden = false;
    registerForm.hidden = true;
    loggedInPane.hidden = true;
  }

  function showRegisterTab() {
    tabRegister.classList.add("tab--active");
    tabRegister.setAttribute("aria-selected", "true");
    tabLogin.classList.remove("tab--active");
    tabLogin.setAttribute("aria-selected", "false");
    loginForm.hidden = true;
    loggedInPane.hidden = true;
    registerForm.hidden = false;
  }

  function showLoggedIn(session) {
    loginForm.hidden = true;
    registerForm.hidden = true;
    loggedInPane.hidden = false;
    $("logged-name").textContent = session.name || session.login;
    tabLogin.classList.remove("tab--active");
    tabRegister.classList.remove("tab--active");
  }

  tabLogin.addEventListener("click", showLoginTab);
  tabRegister.addEventListener("click", showRegisterTab);

  // ==================== ВХОД ====================

  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var login = $("login").value.trim();
    var password = $("password").value;
    var error = $("login-error");

    var users = loadUsers();
    var ok = (login === DEFAULT_ADMIN.login && password === DEFAULT_ADMIN.password) ||
      users.some(function (u) { return u.login === login && u.password === password; });

    if (!ok) {
      error.hidden = false;
      return;
    }

    error.hidden = true;
    var user = login === DEFAULT_ADMIN.login
      ? DEFAULT_ADMIN
      : users.find(function (u) { return u.login === login; });
    setSession(user);
    showLoggedIn({ login: user.login, name: user.firstName || user.login });
  });

  // ==================== РЕГИСТРАЦИЯ ====================

  registerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var error = $("register-error");

    var user = {
      lastName: $("reg-last").value.trim(),
      firstName: $("reg-first").value.trim(),
      middleName: $("reg-middle").value.trim(),
      department: $("reg-dept").value.trim(),
      position: $("reg-position").value.trim(),
      login: $("reg-login").value.trim(),
      password: $("reg-pass1").value
    };

    var users = loadUsers();

    if (!user.lastName || !user.firstName || !user.department || !user.position || !user.login) {
      error.textContent = "Заполните все обязательные поля";
      error.hidden = false;
      return;
    }
    if (user.password.length < 4) {
      error.textContent = "Пароль — минимум 4 символа";
      error.hidden = false;
      return;
    }
    if (user.password !== $("reg-pass2").value) {
      error.textContent = "Пароли не совпадают";
      error.hidden = false;
      return;
    }
    if (user.login === DEFAULT_ADMIN.login || users.some(function (u) { return u.login === user.login; })) {
      error.textContent = "Такой логин уже существует";
      error.hidden = false;
      return;
    }

    users.push(user);
    saveUsers(users);

    setSession(user);
    registerForm.reset();
    showLoggedIn({ login: user.login, name: user.firstName });
  });

  // ==================== ПОСТ-ВХОД ====================

  $("go-ncr").addEventListener("click", function () {
    window.location.href = "ncr.html";
  });

  $("logout").addEventListener("click", function () {
    clearSession();
    loginForm.reset();
    showLoginTab();
  });

  // ==================== ИНИЦИАЛИЗАЦИЯ ====================

  var session = getSession();
  if (session) {
    showLoggedIn(session);
  } else {
    showLoginTab();
  }
})();
