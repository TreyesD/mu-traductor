// Translation service worker: Google (unofficial) first, MyMemory as fallback.
const cache = new Map();

async function viaGoogle(text, sl, tl) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=" +
    sl + "&tl=" + tl + "&q=" + encodeURIComponent(text);
  const r = await fetch(url);
  if (!r.ok) throw new Error("google " + r.status);
  const j = await r.json();
  return {
    text: j[0].map((s) => s[0]).join(""),
    lang: j[2] || sl,
  };
}

async function viaMyMemory(text, sl, tl) {
  const src = sl === "auto" ? "pt" : sl;
  const dst = tl === "pt" ? "pt-BR" : tl;
  const url =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(text) + "&langpair=" + src + "|" + dst;
  const r = await fetch(url);
  if (!r.ok) throw new Error("mymemory " + r.status);
  const j = await r.json();
  if (j.responseStatus !== 200) throw new Error("mymemory " + j.responseStatus);
  return { text: j.responseData.translatedText, lang: src };
}

async function translate(text, sl, tl) {
  const key = sl + ">" + tl + ":" + text;
  if (cache.has(key)) return cache.get(key);
  let res;
  try {
    res = await viaGoogle(text, sl, tl);
  } catch (e) {
    res = await viaMyMemory(text, sl, tl);
  }
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(key, res);
  return res;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "translate") {
    translate(msg.text, msg.sl, msg.tl)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
});
