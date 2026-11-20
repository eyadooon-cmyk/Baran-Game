/* BARAN GAME — Android / browser back navigation
 * Keeps Android system Back inside the app and asks before leaving from Home.
 */
(() => {
  "use strict";

  const originalShowSection = window.showSection;
  const originalShowAdminPanel = window.showAdminPanel;
  const originalCloseAdminPanel = window.closeAdminPanel;
  const originalGoBackSection = window.goBackSection;
  if (typeof originalShowSection !== "function") return;

  let rootReady = false;
  let exitApproved = false;
  let handlingPopstate = false;
  const adminPanelHistory = [];

  const currentSection = () =>
    document.querySelector("main > section[id]:not(.hidden)")?.id || "home";

  const currentAdminPanel = () =>
    document.querySelector("#adminPanel .admin-subpanel:not(.hidden)")?.dataset.adminPanel || null;

  function ensureAppRoot(section = currentSection()) {
    if (rootReady || history.state?.baranGame === true) {
      rootReady = true;
      return;
    }
    history.pushState(
      { baranGame: true, root: true, section, adminPanel: null },
      "",
      location.href
    );
    rootReady = true;
  }

  function pushAppState(section, adminPanel = null) {
    history.pushState(
      { baranGame: true, root: false, section, adminPanel },
      "",
      location.href
    );
  }

  window.showSection = function (id, button, options) {
    const before = currentSection();
    if (window.currentUser || typeof currentUser !== "undefined" && currentUser) {
      ensureAppRoot(before);
    }
    const result = originalShowSection.call(this, id, button, options);
    if (!options?.fromHistory && id !== before &&
        (window.currentUser || typeof currentUser !== "undefined" && currentUser)) {
      pushAppState(id, null);
    }
    return result;
  };

  if (typeof originalShowAdminPanel === "function") {
    window.showAdminPanel = function (id, ...args) {
      const previous = currentAdminPanel();
      const result = originalShowAdminPanel.call(this, id, ...args);
      if (!handlingPopstate && previous !== id &&
          (window.currentUser || typeof currentUser !== "undefined" && currentUser)) {
        adminPanelHistory.push(previous);
        if (adminPanelHistory.length > 30) adminPanelHistory.shift();
        ensureAppRoot("admin");
        pushAppState("admin", id);
      }
      return result;
    };
  }

  function showAdminHubFromBack() {
    adminPanelHistory.pop();
    if (typeof originalCloseAdminPanel === "function") {
      originalCloseAdminPanel.call(window);
    }
  }

  window.addEventListener("popstate", (event) => {
    if (!(window.currentUser || typeof currentUser !== "undefined" && currentUser)) return;

    const state = event.state;
    const activeSection = currentSection();
    const activeAdminPanel = currentAdminPanel();

    if (state?.baranGame === true) {
      handlingPopstate = true;
      try {
        if (activeSection === "admin" && activeAdminPanel) {
          if (state.adminPanel) {
            if (adminPanelHistory.length) adminPanelHistory.pop();
            if (typeof originalShowAdminPanel === "function") {
              originalShowAdminPanel.call(window, state.adminPanel);
            }
          } else {
            showAdminHubFromBack();
          }
        } else if (state.section && state.section !== activeSection) {
          if (typeof baranSectionHistory !== "undefined" && baranSectionHistory.length) {
            baranSectionHistory.pop();
          }
          originalShowSection.call(window, state.section, null, { fromHistory: true });
        }
      } finally {
        handlingPopstate = false;
      }
      rootReady = true;
      return;
    }

    // A browser Back from a nested page should first return to the app home.
    if (activeSection !== "home") {
      handlingPopstate = true;
      try {
        if (typeof baranSectionHistory !== "undefined" && baranSectionHistory.length) {
          baranSectionHistory.pop();
        }
        originalShowSection.call(window, "home", null, { fromHistory: true });
      } finally {
        handlingPopstate = false;
      }
      history.pushState(
        { baranGame: true, root: true, section: "home", adminPanel: null },
        "",
        location.href
      );
      rootReady = true;
      return;
    }

    // Trap the Back action at Home so Android does not close the app immediately.
    history.pushState(
      { baranGame: true, root: true, section: "home", adminPanel: null },
      "",
      location.href
    );
    rootReady = true;
    if (exitApproved) return;
    const leave = window.confirm("هل تريد الخروج من BARAN GAME؟");
    if (leave) {
      exitApproved = true;
      history.back();
    }
  });

  // The in-page Back buttons use the same browser history as Android's system Back.
  window.goBackSection = function () {
    if (!(window.currentUser || typeof currentUser !== "undefined" && currentUser)) return;
    if (history.state?.baranGame === true && !history.state.root) {
      history.back();
      return;
    }
    if (typeof originalGoBackSection === "function") {
      originalGoBackSection.call(window);
    }
  };

  // Make the root history entry available immediately after a successful login.
  const originalShowApp = window.showApp;
  if (typeof originalShowApp === "function") {
    window.showApp = function (...args) {
      const result = originalShowApp.apply(this, args);
      ensureAppRoot("home");
      return result;
    };
  }
})();
