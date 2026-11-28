const $ = (id) => document.getElementById(id);
const DEFAULT_MODEL = "gemini-flash-lite-latest";

chrome.storage.local.get(["geminiKey", "geminiModel", "useLocal"], (s) => {
  $("local").checked = s.useLocal === true;
  $("key").value = s.geminiKey || "";
  $("model").value = s.geminiModel || DEFAULT_MODEL;
});

function say(t, ok = true) {
  $("msg").style.color = ok ? "#0a7d2c" : "#b00020";
  $("msg").textContent = t;
}

$("save").onclick = () => {
  chrome.storage.local.set(
    {
      useLocal: $("local").checked,
      geminiKey: $("key").value.trim(),
      geminiModel: $("model").value.trim() || DEFAULT_MODEL,
    },
    () => say("Guardado.")
  );
};

$("test").onclick = () => {
  $("save").click();
  say("Probando...");
  chrome.runtime.sendMessage(
    { type: "translate", text: "vc ta online? bora fazer pt pra siege", sl: "auto", tl: "es", context: [] },
    (r) => {
      if (r && r.ok && r.geminiError) say("Gemini falló: " + r.geminiError, false);
      else if (r && r.ok) say("Resultado (" + r.engine + ", " + (r.ms || "?") + " ms): " + r.text, r.engine === "gemini" || r.engine === "local");
      else say("Error: " + (r && r.error), false);
    }
  );
};
