// Public embed script — served at /widget.js
// Loaded by 3rd-party sites as:
//   Popup (default):
//     <script src="https://megacrm.megafone.digital/widget.js" data-widget-id="..." async></script>
//   Inline (embedded in a container):
//     <div id="megacrm-webchat"></div>
//     <script src="..." data-widget-id="..." data-mode="inline" data-target="#megacrm-webchat" async></script>

import { createFileRoute } from "@tanstack/react-router";

const SCRIPT = String.raw`
(function () {
  "use strict";
  if (window.__MEGACRM_WEBCHAT_LOADED__) return;
  window.__MEGACRM_WEBCHAT_LOADED__ = true;

  var currentScript = document.currentScript || (function () {
    var ss = document.getElementsByTagName("script");
    for (var i = ss.length - 1; i >= 0; i--) {
      if (ss[i].src && ss[i].src.indexOf("/widget.js") !== -1) return ss[i];
    }
    return null;
  })();
  if (!currentScript) return;

  var WIDGET_ID = currentScript.getAttribute("data-widget-id");
  if (!WIDGET_ID) { console.warn("[MegaCRM] data-widget-id missing"); return; }

  var DATA_MODE = (currentScript.getAttribute("data-mode") || "").toLowerCase();
  var DATA_TARGET = currentScript.getAttribute("data-target") || "";

  var BASE = (function () {
    try { return new URL(currentScript.src).origin; }
    catch (_) { return ""; }
  })();
  if (!BASE) { console.warn("[MegaCRM] could not resolve script origin"); return; }

  var API = BASE + "/api/public/webchat/" + WIDGET_ID;
  var LS_VISITOR = "mc_wc_visitor_" + WIDGET_ID;
  var LS_SESSION = "mc_wc_session_" + WIDGET_ID;
  var LS_IDENTITY = "mc_wc_identity_" + WIDGET_ID;
  var LS_LAST = "mc_wc_last_" + WIDGET_ID;
  var LS_MSGS = "mc_wc_msgs_" + WIDGET_ID;

  // ---- Storage ----
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (_) {} }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  var visitorId = lsGet(LS_VISITOR);
  if (!visitorId) { visitorId = uuid(); lsSet(LS_VISITOR, visitorId); }

  // ---- Host + Shadow DOM (created after we know the mode) ----
  var host = null;
  var shadow = null;
  var inlineMode = false;

  function createHost(mode) {
    host = document.createElement("div");
    host.setAttribute("data-megacrm-webchat", "");
    if (mode === "inline") {
      host.style.cssText = "all: initial; display:block; width:100%; height:100%;";
      var target = null;
      try { target = DATA_TARGET ? document.querySelector(DATA_TARGET) : null; } catch (_) { target = null; }
      if (!target) {
        console.warn("[MegaCRM] inline mode but data-target not found; falling back to popup");
        return createHost("popup");
      }
      target.appendChild(host);
      inlineMode = true;
    } else {
      host.style.cssText = "all: initial; position: fixed; z-index: 2147483600;";
      document.body.appendChild(host);
      inlineMode = false;
    }
    shadow = host.attachShadow({ mode: "open" });
  }

  // ---- State ----
  var cfg = null;
  var sessionToken = lsGet(LS_SESSION);
  var open = false;
  var pollTimer = null;
  var sending = false;
  var chatStarted = false;
  var messages = [];
  try { messages = JSON.parse(lsGet(LS_MSGS) || "[]") || []; } catch (_) { messages = []; }
  var lastAt = lsGet(LS_LAST) || null;
  var identityCache = null;
  try { identityCache = JSON.parse(lsGet(LS_IDENTITY) || "null"); } catch (_) { identityCache = null; }


  // ---- Helpers ----
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === "class") e.className = attrs[k];
        else if (k === "html") e.innerHTML = attrs[k];
        else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else e.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c == null) continue;
        e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return e;
  }
  function fmtTime(iso) {
    try { var d = new Date(iso); return d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0"); }
    catch (_) { return ""; }
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function linkify(s) {
    return escapeHtml(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  function sanitizeCss(css) {
    if (!css) return "";
    var s = String(css);
    s = s.replace(/@import[^;]*;?/gi, "");
    s = s.replace(/url\((?!['"]?(?:#|data:image\/))[^)]*\)/gi, "");
    s = s.replace(/<\/style>/gi, "");
    return s.slice(0, 8192);
  }
  function phoneDigits(v) { return (v || "").replace(/\D+/g, ""); }

  // ---- Layout sizing for inline mode ----
  function applyInlineHostSize() {
    if (!inlineMode || !host) return;
    var fill = !!cfg.inline_fill_container;
    var w = cfg.inline_max_width;
    var h = cfg.inline_height;
    var align = cfg.inline_align || "center";
    if (fill) {
      host.style.cssText = "all:initial;display:block;width:100%;height:100%;";
    } else {
      var widthCss = w && w > 0 ? "min(100%, " + w + "px)" : "100%";
      var heightCss = h && h > 0 ? h + "px" : "600px";
      var mx = align === "center" ? "auto" : (align === "right" ? "0 0 0 auto" : "0 auto 0 0");
      host.style.cssText = "all:initial;display:block;width:" + widthCss + ";height:" + heightCss + ";margin:" + mx + ";";
    }
  }

  // ---- Styles ----
  function applyStyles() {
    var pc = cfg.primary_color || "#6366f1";
    var posCss = cfg.position === "bottom-left"
      ? "left: 20px; right: auto;"
      : "right: 20px; left: auto;";
    var launcherSize = cfg.launcher_size === "lg" ? 72 : (cfg.launcher_size === "sm" ? 48 : 60);
    var style = el("style");

    var windowCss;
    if (inlineMode) {
      windowCss =
        ".wc-window{position:relative;width:100%;height:100%;background:#fff;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.10);display:flex;flex-direction:column;overflow:hidden;font:14px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111827;border:1px solid #e5e7eb;}";
    } else {
      windowCss =
        ".wc-window{position:fixed;bottom:" + (launcherSize + 32) + "px;" + posCss + "width:370px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - " + (launcherSize + 60) + "px);background:#fff;border-radius:14px;box-shadow:0 20px 48px rgba(0,0,0,0.22);display:flex;flex-direction:column;overflow:hidden;font:14px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111827;}";
    }

    style.textContent =
      ".wc-launcher{position:fixed;bottom:20px;" + posCss + "width:" + launcherSize + "px;height:" + launcherSize + "px;border-radius:50%;background:" + pc + ";color:#fff;border:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.18);display:flex;align-items:center;justify-content:center;transition:transform .15s ease;}" +
      ".wc-launcher:hover{transform:scale(1.05);}" +
      ".wc-launcher svg{width:50%;height:50%;}" +
      ".wc-badge{position:absolute;top:-2px;right:-2px;background:#ef4444;color:#fff;border-radius:999px;min-width:18px;height:18px;font:600 11px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:0 5px;}" +
      windowCss +
      ".wc-header{background:" + pc + ";color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;}" +
      ".wc-header img{width:32px;height:32px;border-radius:50%;object-fit:cover;background:#fff;}" +
      ".wc-header .wc-title{font-weight:600;font-size:15px;line-height:1.1;flex:1;}" +
      ".wc-header .wc-sub{font-size:11px;opacity:.85;}" +
      ".wc-header button{background:transparent;border:0;color:#fff;cursor:pointer;padding:4px;opacity:.85;}" +
      ".wc-header button:hover{opacity:1;}" +
      ".wc-body{flex:1;overflow-y:auto;padding:14px;background:#f9fafb;display:flex;flex-direction:column;gap:8px;}" +
      ".wc-body::-webkit-scrollbar{width:6px;}.wc-body::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:3px;}" +
      ".wc-msg{max-width:80%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;word-wrap:break-word;white-space:pre-wrap;}" +
      ".wc-msg a{color:inherit;text-decoration:underline;}" +
      ".wc-msg.agent{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px;}" +
      ".wc-msg.visitor{align-self:flex-end;background:" + pc + ";color:#fff;border-bottom-right-radius:4px;}" +
      ".wc-msg.system{align-self:center;background:transparent;color:#6b7280;font-size:12px;text-align:center;padding:6px 10px;}" +
      ".wc-time{font-size:10px;opacity:.7;margin-top:2px;display:block;}" +
      ".wc-form{padding:18px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;}" +
      ".wc-form h3{margin:0 0 4px;font-size:15px;font-weight:600;}" +
      ".wc-form p{margin:0 0 8px;font-size:13px;color:#6b7280;}" +
      ".wc-form label{font-size:12px;font-weight:500;color:#374151;}" +
      ".wc-form input{padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none;font-family:inherit;}" +
      ".wc-form input:focus{border-color:" + pc + ";box-shadow:0 0 0 3px " + pc + "22;}" +
      ".wc-form button{margin-top:6px;background:" + pc + ";color:#fff;border:0;padding:10px 14px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;}" +
      ".wc-form button:disabled{opacity:.6;cursor:not-allowed;}" +
      ".wc-form .wc-err{color:#dc2626;font-size:12px;}" +
      ".wc-footer{border-top:1px solid #e5e7eb;padding:10px;background:#fff;display:flex;gap:8px;align-items:flex-end;}" +
      ".wc-footer textarea{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font:14px inherit;resize:none;outline:none;max-height:100px;}" +
      ".wc-footer textarea:focus{border-color:" + pc + ";}" +
      ".wc-footer button{background:" + pc + ";color:#fff;border:0;width:38px;height:38px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}" +
      ".wc-footer button.wc-attach{background:transparent;color:#6b7280;border:1px solid #d1d5db;}" +
      ".wc-footer button.wc-attach:hover{color:" + pc + ";border-color:" + pc + ";}" +
      ".wc-footer button:disabled{opacity:.5;cursor:not-allowed;}" +
      ".wc-msg img.wc-media{display:block;max-width:100%;max-height:220px;border-radius:8px;cursor:pointer;margin-bottom:4px;}" +
      ".wc-msg .wc-doc{display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(0,0,0,0.06);border-radius:8px;color:inherit;text-decoration:none;font-size:13px;max-width:260px;}" +
      ".wc-msg.visitor .wc-doc{background:rgba(255,255,255,0.18);}" +
      ".wc-msg .wc-doc svg{flex-shrink:0;opacity:.8;}" +
      ".wc-msg .wc-doc-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".wc-offline{padding:10px 14px;background:#fef3c7;color:#92400e;font-size:12px;text-align:center;border-bottom:1px solid #fde68a;}" +
      ".wc-poweredby{font-size:10px;color:#9ca3af;text-align:center;padding:4px;background:#fff;}" +
      (inlineMode ? "" :
        "@media (max-width:480px){.wc-window{width:calc(100vw - 20px);height:calc(100vh - 100px);bottom:90px;left:10px!important;right:10px!important;}}") +
      sanitizeCss(cfg.custom_css);
    shadow.appendChild(style);
  }

  function renderLauncher() {
    if (inlineMode) return null;
    var btn = el("button", { class: "wc-launcher", "aria-label": "Abrir chat" });
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    btn.onclick = function () { openWindow(); };
    return btn;
  }

  function renderForm() {
    var win = el("div", { class: "wc-window" });
    win.appendChild(buildHeader());
    if (!cfg.online) {
      win.appendChild(el("div", { class: "wc-offline" }, [cfg.offline_message || ""]));
    }
    var form = el("form", { class: "wc-form" });
    var err = el("div", { class: "wc-err" });

    var requireName = cfg.require_name !== false;
    var requirePhone = cfg.require_phone !== false;
    var collectEmail = !!cfg.collect_email;

    var nameInput = null, phoneInput = null, emailInput = null;
    form.appendChild(el("h3", null, [cfg.widget_title || "Chat"]));
    

    if (requireName) {
      form.appendChild(el("label", null, [cfg.form_name_label || "Nome"]));
      nameInput = el("input", {
        type: "text", required: "true", maxlength: "80",
        placeholder: cfg.form_name_placeholder || "Seu nome",
        value: (identityCache && identityCache.name) || "",
      });
      form.appendChild(nameInput);
    }
    if (requirePhone) {
      form.appendChild(el("label", null, [cfg.form_phone_label || "Telefone (com DDD)"]));
      phoneInput = el("input", {
        type: "tel", required: "true", maxlength: "40",
        placeholder: cfg.form_phone_placeholder || "(11) 99999-9999",
        value: (identityCache && identityCache.phone) || "",
        inputmode: "tel",
        autocomplete: "tel",
      });
      form.appendChild(phoneInput);
    }
    if (collectEmail) {
      form.appendChild(el("label", null, [(cfg.form_email_label || "E-mail") + " (opcional)"]));
      emailInput = el("input", {
        type: "email", maxlength: "200",
        placeholder: cfg.form_email_placeholder || "voce@email.com",
        value: (identityCache && identityCache.email) || "",
        autocomplete: "email",
      });
      form.appendChild(emailInput);
    }

    var submit = el("button", { type: "submit" }, [cfg.form_submit_label || "Iniciar conversa"]);
    form.appendChild(submit);
    form.appendChild(err);

    function isValidEmail(s) {
      if (!s) return true;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    }
    function validate() {
      if (requireName && nameInput && !nameInput.value.trim()) return "Informe seu nome.";
      if (requirePhone && phoneInput) {
        var d = phoneDigits(phoneInput.value);
        if (d.length < 8 || d.length > 15) return "Telefone inválido. Inclua DDD.";
      }
      if (collectEmail && emailInput && emailInput.value.trim() && !isValidEmail(emailInput.value.trim())) {
        return "E-mail inválido.";
      }
      return "";
    }
    function refreshState() {
      submit.disabled = !!validate();
    }
    if (nameInput) nameInput.addEventListener("input", refreshState);
    if (phoneInput) phoneInput.addEventListener("input", refreshState);
    if (emailInput) emailInput.addEventListener("input", refreshState);
    refreshState();

    form.onsubmit = function (e) {
      e.preventDefault();
      err.textContent = "";
      var msg = validate();
      if (msg) { err.textContent = msg; return; }
      var name = nameInput ? nameInput.value.trim() : "";
      var phone = phoneInput ? phoneDigits(phoneInput.value) : "";
      var email = emailInput ? emailInput.value.trim() : "";

      // Defer session creation until the visitor actually sends a message.
      // This prevents empty contacts/conversations from showing up in the inbox.
      identityCache = { name: name, phone: phone, email: email };
      lsSet(LS_IDENTITY, JSON.stringify(identityCache));
      messages = [{
        id: "welcome",
        from: "agent",
        text: cfg.welcome_message || "Olá! Como podemos ajudar?",
        created_at: new Date().toISOString(),
      }];
      lsSet(LS_MSGS, JSON.stringify(messages));
      lastAt = null;
      lsSet(LS_LAST, "");
      chatStarted = true;
      rerender();
    };
    win.appendChild(form);
    win.appendChild(brand());
    return win;
  }


  function buildHeader() {
    var h = el("div", { class: "wc-header" });
    if (cfg.logo_url) {
      var img = el("img", { src: cfg.logo_url, alt: "" });
      img.onerror = function () { img.style.display = "none"; };
      h.appendChild(img);
    }
    var titleWrap = el("div", { class: "wc-title" });
    titleWrap.appendChild(document.createTextNode(cfg.widget_title || "Chat"));
    var subTxt = cfg.online
      ? (cfg.header_subtitle_online || "Online")
      : (cfg.header_subtitle_offline || "Offline");
    var sub = el("div", { class: "wc-sub" }, [subTxt]);

    var col = el("div", { style: "flex:1;" });
    col.appendChild(titleWrap); col.appendChild(sub);
    h.appendChild(col);
    if (!inlineMode) {
      var closeBtn = el("button", { "aria-label": "Fechar", title: "Fechar" });
      closeBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      closeBtn.onclick = function () { closeWindow(); };
      h.appendChild(closeBtn);
    }
    return h;
  }

  function brand() {
    return el("div", { class: "wc-poweredby" }, [cfg.powered_by_label || "powered by MegaCRM"]);
  }


  function renderChat() {
    var win = el("div", { class: "wc-window" });
    win.appendChild(buildHeader());

    var body = el("div", { class: "wc-body" });
    for (var i = 0; i < messages.length; i++) renderMessageInto(body, messages[i]);
    win.appendChild(body);

    var ta = el("textarea", { rows: "1", placeholder: cfg.chat_input_placeholder || "Digite uma mensagem…", maxlength: "4000" });
    var sendBtn = el("button", { "aria-label": "Enviar" });
    sendBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    function ensureSession() {
      if (sessionToken) return Promise.resolve(true);
      var ident = identityCache || {};
      var payload = { visitor_id: visitorId, page_url: location.href };
      if (ident.name) payload.name = ident.name;
      if (ident.phone) payload.phone = ident.phone;
      if (ident.email) payload.email = ident.email;

      return fetch(API + "/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j.session_token) return false;
          sessionToken = res.j.session_token;
          lsSet(LS_SESSION, sessionToken);
          startPolling();
          return true;
        })
        .catch(function () { return false; });
    }
    function doSend() {
      var v = ta.value.trim();
      if (!v || sending) return;
      sending = true; sendBtn.disabled = true;
      var localId = "tmp-" + Date.now();
      var optimistic = { id: localId, from: "visitor", text: v, created_at: new Date().toISOString() };
      messages.push(optimistic);
      lsSet(LS_MSGS, JSON.stringify(messages));
      renderMessageInto(body, optimistic);
      body.scrollTop = body.scrollHeight;
      ta.value = ""; ta.style.height = "auto";
      ensureSession().then(function (ok) {
        if (!ok) {
          sending = false; sendBtn.disabled = false;
          optimistic.text += "  ⚠";
          return;
        }
        fetch(API + "/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Session-Token": sessionToken },
          body: JSON.stringify({ text: v }),
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            sending = false; sendBtn.disabled = false;
            if (!res.ok) {
              optimistic.text += "  ⚠";
              return;
            }
            if (res.j && res.j.id) {
              optimistic.id = res.j.id;
              if (res.j.created_at) {
                optimistic.created_at = res.j.created_at;
                lastAt = res.j.created_at;
                lsSet(LS_LAST, lastAt);
              }
              lsSet(LS_MSGS, JSON.stringify(messages.slice(-50)));
            }
          })
          .catch(function () { sending = false; sendBtn.disabled = false; });
      });
    }
    ta.addEventListener("input", function () {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 100) + "px";
    });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
    sendBtn.onclick = doSend;

    var footer = el("div", { class: "wc-footer" });

    // ---- Attachment button (only if the widget allows it) ----
    var attachBtn = null;
    var fileInput = null;
    if (cfg.allow_attachments !== false) {
      attachBtn = el("button", { class: "wc-attach", type: "button", "aria-label": "Anexar arquivo", title: "Anexar arquivo" });
      attachBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
      fileInput = el("input", {
        type: "file",
        accept: "image/png,image/jpeg,image/webp,image/gif,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx",
        style: "display:none;",
      });
      attachBtn.onclick = function () { if (!sending) fileInput.click(); };
      fileInput.addEventListener("change", function () {
        var f = fileInput.files && fileInput.files[0];
        fileInput.value = "";
        if (f) doUpload(f);
      });
      footer.appendChild(attachBtn);
      footer.appendChild(fileInput);
    }

    function doUpload(file) {
      if (sending) return;
      var MAX = 10 * 1024 * 1024;
      var allowed = [
        "image/png","image/jpeg","image/jpg","image/webp","image/gif",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ];
      var mime = (file.type || "").toLowerCase();
      if (file.size > MAX) {
        renderMessageInto(body, { from: "system", text: "Arquivo muito grande (máx. 10 MB)." });
        body.scrollTop = body.scrollHeight;
        return;
      }
      if (allowed.indexOf(mime) === -1) {
        renderMessageInto(body, { from: "system", text: "Tipo de arquivo não permitido." });
        body.scrollTop = body.scrollHeight;
        return;
      }

      sending = true; sendBtn.disabled = true; if (attachBtn) attachBtn.disabled = true;
      var localId = "tmp-" + Date.now();
      var isImage = mime.indexOf("image/") === 0;
      var previewUrl = null;
      try { previewUrl = URL.createObjectURL(file); } catch (_) { previewUrl = null; }
      var optimistic = {
        id: localId, from: "visitor",
        type: isImage ? "image" : "document",
        text: file.name,
        media_url: previewUrl,
        media_mime: mime,
        media_filename: file.name,
        created_at: new Date().toISOString(),
      };
      messages.push(optimistic);
      renderMessageInto(body, optimistic);
      body.scrollTop = body.scrollHeight;

      ensureSession().then(function (ok) {
        if (!ok) {
          sending = false; sendBtn.disabled = false; if (attachBtn) attachBtn.disabled = false;
          optimistic.text = file.name + "  ⚠";
          return;
        }
        var fd = new FormData();
        fd.append("file", file);
        fetch(API + "/upload", {
          method: "POST",
          headers: { "X-Session-Token": sessionToken },
          body: fd,
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            sending = false; sendBtn.disabled = false; if (attachBtn) attachBtn.disabled = false;
            if (!res.ok || !res.j || !res.j.id) {
              optimistic.text = file.name + "  ⚠";
              return;
            }
            optimistic.id = res.j.id;
            if (res.j.created_at) {
              optimistic.created_at = res.j.created_at;
              lastAt = res.j.created_at;
              lsSet(LS_LAST, lastAt);
            }
            if (res.j.media_url) optimistic.media_url = res.j.media_url;
            lsSet(LS_MSGS, JSON.stringify(messages.slice(-50)));
          })
          .catch(function () {
            sending = false; sendBtn.disabled = false; if (attachBtn) attachBtn.disabled = false;
            optimistic.text = file.name + "  ⚠";
          });
      });
    }

    footer.appendChild(ta); footer.appendChild(sendBtn);
    win.appendChild(footer);
    win.appendChild(brand());
    setTimeout(function () { body.scrollTop = body.scrollHeight; ta.focus(); }, 30);
    return win;
  }

  function renderMessageInto(body, m) {
    if (m.from === "system") {
      body.appendChild(el("div", { class: "wc-msg system" }, [m.text || ""]));
      return;
    }
    var wrap = el("div", { class: "wc-msg " + (m.from === "visitor" ? "visitor" : "agent") });

    if (m.type === "image" && m.media_url) {
      var img = document.createElement("img");
      img.className = "wc-media";
      img.src = m.media_url;
      img.alt = m.media_filename || "";
      img.onclick = function () { try { window.open(m.media_url, "_blank", "noopener"); } catch (_) {} };
      wrap.appendChild(img);
    } else if (m.type === "document" && m.media_url) {
      var a = document.createElement("a");
      a.className = "wc-doc";
      a.href = m.media_url;
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
        '<span class="wc-doc-name"></span>';
      a.querySelector(".wc-doc-name").textContent = m.media_filename || m.text || "arquivo";
      wrap.appendChild(a);
    } else {
      wrap.innerHTML = linkify(m.text || "");
    }

    if (m.created_at) {
      var t = document.createElement("span");
      t.className = "wc-time";
      t.textContent = fmtTime(m.created_at);
      wrap.appendChild(t);
    }
    body.appendChild(wrap);
  }

  function rerender() {
    var keep = [];
    for (var i = 0; i < shadow.childNodes.length; i++) {
      if (shadow.childNodes[i].nodeName === "STYLE") keep.push(shadow.childNodes[i]);
    }
    shadow.innerHTML = "";
    for (var j = 0; j < keep.length; j++) shadow.appendChild(keep[j]);

    var showChat = !!(sessionToken || chatStarted);
    if (inlineMode) {
      // Inline: always render the chat surface (form or chat), no launcher
      shadow.appendChild(showChat ? renderChat() : renderForm());
    } else {
      var launcher = renderLauncher();
      if (launcher) shadow.appendChild(launcher);
      if (open) shadow.appendChild(showChat ? renderChat() : renderForm());
    }

  }

  function openWindow() { open = true; rerender(); if (sessionToken) startPolling(); }
  function closeWindow() { open = false; rerender(); stopPolling(); }

  function startPolling() {
    stopPolling();
    poll();
    pollTimer = setInterval(poll, 3000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function poll() {
    if (!sessionToken || document.hidden) return;
    var url = API + "/messages" + (lastAt ? "?after=" + encodeURIComponent(lastAt) : "");
    fetch(url, { headers: { "X-Session-Token": sessionToken } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.messages || !j.messages.length) return;
        var body = shadow.querySelector(".wc-body");
        var changed = false;
        for (var i = 0; i < j.messages.length; i++) {
          var m = j.messages[i];
          if (messages.some(function (x) { return x.id === m.id; })) continue;
          if (m.from === "visitor") {
            var matched = false;
            for (var k = 0; k < messages.length; k++) {
              var x = messages[k];
              if (x.from === "visitor" && typeof x.id === "string" && x.id.indexOf("tmp-") === 0 && (x.text || "") === (m.text || "")) {
                x.id = m.id;
                if (m.created_at) x.created_at = m.created_at;
                matched = true;
                break;
              }
            }
            if (matched) { lastAt = m.created_at || lastAt; changed = true; continue; }
          }
          messages.push(m);
          if (body) renderMessageInto(body, m);
          lastAt = m.created_at;
          changed = true;
        }
        if (changed) {
          lsSet(LS_MSGS, JSON.stringify(messages.slice(-50)));
          lsSet(LS_LAST, lastAt || "");
          if (body) body.scrollTop = body.scrollHeight;
        }
      })
      .catch(function () {});
  }

  // Optimistic pre-render: for popup mode, show the launcher immediately
  // with default styling so the visitor sees the widget before /config
  // resolves. When the real config arrives, we re-create the host with
  // the actual colors/size/logo. Skipped for inline mode because we need
  // the target element dimensions/alignment from config first.
  var preRendered = false;
  if (DATA_MODE !== "inline") {
    try {
      cfg = {
        primary_color: "#6366f1",
        position: "bottom-right",
        launcher_size: "md",
        widget_title: "Chat",
        online: true,
      };
      createHost("popup");
      applyStyles();
      rerender();
      preRendered = true;
    } catch (_) { preRendered = false; }
  }

  // Fetch real config, then re-render with actual settings
  fetch(API + "/config")
    .then(function (r) { if (!r.ok) throw new Error("config"); return r.json(); })
    .then(function (c) {
      cfg = c;
      var mode = DATA_MODE || cfg.display_mode || "popup";
      if (mode !== "inline") mode = "popup";
      // If we pre-rendered but the real mode is inline, or vice versa,
      // tear down the placeholder and re-create.
      if (preRendered && mode !== "popup") {
        try { if (host && host.parentNode) host.parentNode.removeChild(host); } catch (_) {}
        host = null; shadow = null; inlineMode = false;
        createHost(mode);
      } else if (preRendered) {
        // Same mode (popup): keep existing host, just refresh styles.
        // Clear the shadow so applyStyles re-injects the correct <style>.
        try { shadow.innerHTML = ""; } catch (_) {}
      } else {
        createHost(mode);
      }
      applyInlineHostSize();
      applyStyles();
      if (sessionToken) {
        chatStarted = true;
        for (var i = messages.length - 1; i >= 0; i--) {
          if (messages[i].id !== "welcome" && messages[i].created_at) { lastAt = messages[i].created_at; break; }
        }
      } else if (messages && messages.length > 0) {
        // User already submitted the pre-chat form previously but hasn't sent a message yet.
        chatStarted = true;
      }

      rerender();
      if (inlineMode && sessionToken) startPolling();
    })
    .catch(function (e) { console.warn("[MegaCRM] widget config failed", e); });

})();
`;

export const Route = createFileRoute("/widget.js")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(SCRIPT, {
          status: 200,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
    },
  },
});
