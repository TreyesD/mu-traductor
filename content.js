// Inline chat translation (incoming) + ES->PT helper (outgoing).
(() => {
  if (window.__muTranslatorLoaded) return;
  window.__muTranslatorLoaded = true;

  const OWN_LANG = "es";
  const TARGET_OUT = "pt";
  // Optional "HH:MM" timestamp, up to two "[Channel]"/"[TAG]" prefixes, then "Name: message".
  // Player names have no spaces, which keeps system sentences from matching.
  const CHAT_RE = /^\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?(?:\[[^\]]{1,24}\]\s*){0,2}[^\s:\[\]]{2,16}:\s+([\s\S]+)$/;
  const SKIP_CHANNELS = /^\s*(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?\[(Sistema|Aviso|System)\]/i;

  // Rolling window of recent chat lines, sent as context to the translator.
  const recent = [];
  const ask = (text, sl, tl) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "translate", text, sl, tl, context: recent.slice(-8) }, (r) =>
          resolve(r && r.ok ? r : null)
        );
      } catch (_) {
        resolve(null);
      }
    });

  const style = document.createElement("style");
  style.textContent = `
    .mu-tr{display:block;color:#ffd75e;font-size:.85em;line-height:1.2;
      opacity:.95;margin-top:1px;pointer-events:none}
    #mu-tr-box{position:fixed;left:12px;bottom:70px;z-index:2147483647;
      display:none;width:340px;font:14px sans-serif}
    #mu-tr-box input{width:100%;box-sizing:border-box;padding:7px 9px;
      border:1px solid #ffd75e;border-radius:6px;background:#1b1209;color:#fff}
    #mu-tr-box small{display:block;color:#ffd75e;margin-top:3px}
  `;
  document.documentElement.appendChild(style);

  // ---------- Incoming ----------
  const done = new WeakSet();

  function candidateLine(el) {
    if (done.has(el) || el.closest(".mu-tr")) return null;
    if (el.children.length > 6) return null;
    const txt = el.textContent || "";
    if (txt.length < 8 || txt.length > 600) return null;
    if (SKIP_CHANNELS.test(txt)) return null;
    const m = CHAT_RE.exec(txt);
    return m ? m[1].trim() : null;
  }

  async function handle(el) {
    const body = candidateLine(el);
    if (!body) return;
    // Prefer the deepest matching element: skip if a child already matches.
    for (const c of el.children) if (candidateLine(c)) return;
    done.add(el);
    const full = (el.textContent || "").trim();
    const out = document.createElement("span");
    out.className = "mu-tr";
    out.textContent = "↳ ...";
    el.appendChild(out);
    const r = await ask(body, "auto", OWN_LANG);
    recent.push(full);
    if (recent.length > 20) recent.shift();
    if (!r || !r.text) { stats.fail++; out.remove(); return; }
    stats.ok++;
    if (r.lang === OWN_LANG || r.text.trim().toLowerCase() === body.toLowerCase()) {
      out.remove();
      return;
    }
    out.textContent = "↳ " + r.text;
  }

  function scan(root) {
    if (root.nodeType !== 1) {
      if (root.parentElement) handle(root.parentElement);
      return;
    }
    handle(root);
    root.querySelectorAll("*").forEach(handle);
    if (root.parentElement) handle(root.parentElement);
  }

  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.target && m.target.closest && m.target.closest(".mu-tr")) continue;
      m.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.classList.contains("mu-tr")) return;
        scan(n);
      });
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // Periodic deep scan (also walks open shadow roots), as a safety net.
  const stats = { seen: 0, ok: 0, fail: 0 };
  const badge = document.createElement("div");
  badge.style.cssText =
    "position:fixed;right:6px;bottom:4px;z-index:2147483647;font:11px sans-serif;" +
    "color:#ffd75e;background:rgba(0,0,0,.6);padding:2px 6px;border-radius:4px;pointer-events:none";
  document.documentElement.appendChild(badge);

  function walk(root, fn) {
    const els = root.querySelectorAll("*");
    for (const el of els) {
      fn(el);
      if (el.shadowRoot) walk(el.shadowRoot, fn);
    }
  }
  function deepScan() {
    walk(document, (el) => {
      if (candidateLine(el)) stats.seen++;
      handle(el);
    });
    badge.textContent =
      "MU-T: lines " + stats.seen + " | ok " + stats.ok + " | err " + stats.fail;
  }
  setInterval(deepScan, 1500);

  // ---------- Outgoing ----------
  const box = document.createElement("div");
  box.id = "mu-tr-box";
  box.innerHTML =
    '<input type="text" placeholder="Escribe en español → Enter" />' +
    "<small></small>";
  document.documentElement.appendChild(box);
  const boxInput = box.querySelector("input");
  const boxNote = box.querySelector("small");

  function setNativeValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function findGameInput() {
    let found = null;
    walk(document, (i) => {
      if (found || i === boxInput) return;
      const tag = i.tagName;
      const isField = tag === "INPUT" || tag === "TEXTAREA" || i.isContentEditable;
      if (!isField) return;
      const ph = (
        i.placeholder || i.getAttribute("placeholder") ||
        i.getAttribute("data-placeholder") || i.getAttribute("aria-label") || ""
      ).toLowerCase();
      if (/enter|hablar|falar|chat|mensaje|mensagem|escribe|escreva|message/.test(ph)) found = i;
    });
    return found;
  }

  function fillGameInput(gi, text) {
    gi.focus();
    if (gi.select) gi.select();
    // insertText behaves like real typing, so the game's own handlers see it.
    const ok = document.execCommand && document.execCommand("insertText", false, text);
    if (!ok) setNativeValue(gi, text);
  }

  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
      return;
    } catch (_) {}
    // Fallback: temporary textarea + execCommand.
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.documentElement.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    ta.remove();
  }

  function toast(text) {
    boxNote.textContent = text;
    box.style.display = "block";
    boxInput.style.display = "none";
    setTimeout(() => {
      box.style.display = "none";
      boxInput.style.display = "";
      boxNote.textContent = "";
    }, 2500);
  }

  async function translateOut(text) {
    const r = await ask(text, OWN_LANG, TARGET_OUT);
    return r && r.text ? r.text : null;
  }

  // Floating box: Alt+T toggles; Enter translates and fills the game chat.
  document.addEventListener(
    "keydown",
    async (e) => {
      if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        const show = box.style.display !== "block";
        box.style.display = show ? "block" : "none";
        if (show) boxInput.focus();
        return;
      }
      if (e.target === boxInput) {
        e.stopPropagation();
        if (e.key === "Escape") {
          box.style.display = "none";
        } else if (e.key === "Enter") {
          e.preventDefault();
          const txt = boxInput.value.trim();
          if (!txt) return;
          boxInput.value = "";
          // Keep the box (and its focus) alive until the text is copied.
          boxNote.textContent = "Traduciendo...";
          const pt = await translateOut(txt);
          if (!pt) {
            toast("Error al traducir");
            return;
          }
          await copyText(pt);
          const gi = findGameInput();
          if (gi) {
            box.style.display = "none";
            boxInput.style.display = "";
            boxNote.textContent = "";
            fillGameInput(gi, pt);
          } else {
            toast(pt + "  (copiado: Ctrl+V en el chat)");
          }
        }
        return;
      }
      // Ctrl+Enter inside the game chat input: translate its content in place.
      if (e.ctrlKey && e.key === "Enter" && e.target && e.target.tagName === "INPUT") {
        e.preventDefault();
        e.stopPropagation();
        const inp = e.target;
        const txt = inp.value.trim();
        if (!txt) return;
        const pt = await translateOut(txt);
        if (pt) setNativeValue(inp, pt);
      }
    },
    true
  );
})();
