const query_input = document.getElementById("query");
const search_btn = document.getElementById("search_btn");
const clip_btn = document.getElementById("clip_btn");
const clear_btn = document.getElementById("clear_btn");
const export_btn = document.getElementById("export_btn");
const import_btn = document.getElementById("import_btn");
const import_file_input = document.getElementById("import_file");
const stats_div = document.getElementById("stats");
const recent_div = document.getElementById("recent");
const domains_div = document.getElementById("domains");
const domain_filter_input = document.getElementById("domain_filter");
const min_score_input = document.getElementById("min_score");
const result_div = document.getElementById("results");
let last_hits = [];

function escape_html(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function refresh_stats() {
try {
    const res = await chrome.runtime.sendMessage({ type: "CLIPPER_STATS" });
    const stats = res?.stats || { total_chunks: 0, unique_urls: 0 };
    stats_div.textContent = `chunks: ${stats.total_chunks} | pages: ${stats.unique_urls}`;
  } catch {
    stats_div.textContent = "chunks: ? | pages: ?";
}
}

async function get_active_tab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function refresh_recent() {
 try {
     const res = await chrome.runtime.sendMessage({ type: "CLIPPER_RECENT" });
     const items = res?.items || [];
     if (!items.length) {
       recent_div.textContent = "recent clips will show here...";
       return;
     }

 recent_div.innerHTML = items
      .map((x) => {
        const label = escape_html(x.title || "untitled");
        const url = escape_html(x.url || "");
        return `<div style="margin-bottom:5px;"><a href="${url}" target="_blank">${label}</a></div>`;
      })
      .join("");
  } catch {
    recent_div.textContent = "failed to load recent clips";
  }
}

async function refresh_domains() {
    try {
       const res = await chrome.runtime.sendMessage({ type: "CLIPPER_DOMAIN_COUNTS" });
       const items = res?.items || [];
       if (!items.length) {
         domains_div.textContent = "top domains will show here...";
         return;
       }

domains_div.innerHTML = items
      .map((x) => `<div style="margin-bottom:4px;">${escape_html(x.domain)} <span style="opacity:.7">(${Number(x.chunks || 0)})</span></div>`)
      .join("");
  } catch {
    domains_div.textContent = "failed to load domain counts";
  }
}

async function trigger_clip() {
    const tab = await get_active_tab();
    if(!tab?.id) return;

   result_div.textContent = "Clipping page now...";
   clip_btn.disabled = true;
   
   try {
        await chrome.tabs.sendMessage(tab.id, { type: "CLIPPER_CLIP" });
        result_div.textContent = "Clipping page now...";
    } catch {

    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await chrome.tabs.sendMessage(tab.id, { type: "CLIPPER_CLIP" });
    result_div.textContent = "Inject content script, clipping now.";
} finally {
    clip_btn.disabled = false;
}
}

function render_hits(hits) {
    last_hits = hits;
    if(!hits?.length) {
        result_div.textContent = "No matches yet.";
        return;
    }

    const q_words = query_input.value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    
     const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const marks = (txt) => {
     let out = escape_html(txt);
    for(const w of q_words) {
     const re = new RegExp(`(${esc(w)})`, "ig");
     out = out.replace(re, "<mark>$1</mark>");
    }
    return out;
};
    
    const html = hits
    .map((item) => {
       const text = String(item.text_chunk || "");
       const snip = text.slice(0, 140).replace(/\s+/g, " ");
       const score = Number(item.sim_score || 0).toFixed(3);
      const safe_title = escape_html(item.title || "untitled");
           const safe_url = escape_html(item.url || "");     
       return `
        <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed #999;">
           <div><strong>${safe_title}</strong><span style="opacity:.7">score ${score}</span></div>
           <div style ="margin:4px 0;">${marks(snip)}...</div>
           <div style="display:flex;gap:8px;margin-top:6px;align-items:center;"><a href="${safe_url}" target="_blank">open source</a><button data-url="${safe_url}" data-text="${escape_html(snip)}" class="copy_btn">copy snippet</button></div>
        </div>
        `;
    })
    .join("");

    result_div.innerHTML = html;


  const copyBtns = result_div.querySelectorAll(".copy_btn");
copyBtns.forEach((b) => {
 b.addEventListener("click", async (ev) => {
  try {
 await navigator.clipboard.writeText(b.getAttribute("data-text") || "");
   result_div.textContent = "Snippet copied to clipboard.";
 setTimeout(() => refresh_stats().catch(() => {}), 800)
  } catch {
   result_div.textContent = "Copy failed.";
  }
 });
});
}

search_btn.addEventListener("click", async () => {
    const raw_q = query_input.value.trim();
    if(!raw_q) return;

  search_btn.disabled = true;
    result_div.textContent = "Searching local vectors...";
    
   try {
    const domain_filter = domain_filter_input.value.trim();
    const min_score = min_score_input.value.trim();
    const res = await chrome.runtime.sendMessage({ 
        type: "CLIPPER_SEARCH",
        query: raw_q,
        domain_filter,
      min_score: min_score ? Number(min_score) : -1
    });

    render_hits(res?.hits || []);
    refresh_stats().catch(() => {});
    refresh_recent().catch(() => {});
    refresh_domains().catch(() => {});
}finally {
    search_btn.disabled = false;
}
});

query_input.addEventListener("keydown", (ev) => {
     if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      if (last_hits[0]?.url) {
     chrome.tabs.create({ url: last_hits[0].url });
    return;
      }
     }
    
    
    if(ev.key === "Enter") search_btn.click();
});

clip_btn.addEventListener("click", () => {
    trigger_clip().catch((e) => {
   const msg = String(e);
if(msg.includes("Receiving end does not exist") || msg.includes("Cannot access")) {
    result_div.textContent = "Clip blocked on this page type (like chrome:// or web store).";
    return;
}
result_div.textContent = `Clip failed: ${msg}`;
    });
});

clear_btn.addEventListener("click", async () => {
    const res = await chrome.runtime.sendMessage({ type: "CLIPPER_CLEAR_ALL" });
    result_div.textContent = res?.ok ? "Local vault cleared." : "Clear failed.";
    await refresh_stats();
    await refresh_recent();
});

export_btn.addEventListener("click", async () => {
try {
    const res = await chrome.runtime.sendMessage({ type: "CLIPPER_EXPORT_ALL" });
    if (!res?.ok || !res.payload) {
      result_div.textContent = "Export failed.";
      return;
    }
   
    const blob = new Blob([JSON.stringify(res.payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const obj_url = URL.createObjectURL(blob);
    a.href = obj_url;
    a.download = `clipper-backup-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(obj_url), 500);
    result_div.textContent = `Exported ${res.payload.count} chunks.`;
  } catch {
    result_div.textContent = "Export failed.";
}
});

import_btn.addEventListener("click", () => import_file_input.click());

import_file_input.addEventListener("change", async () => {
const file = import_file_input.files?.[0];
if(!file) return;

try {
const text = await file.text();
const payload = JSON.parse(text);
const res = await chrome.runtime.sendMessage({ type: "CLIPPER_IMPORT_ALL", payload });
if(!res?.ok) {
result_div.textContent = "Import failed.";
return;
}
result_div.textContent = "Import complete.";
await refresh_stats();
await refresh_recent();
}catch(e) {
result_div.textContent = `Import failed: ${String(e)}`;
} finally {
import_file_input.value = "";
}
});

refresh_stats().catch((e) => {
    result_div.textContent = `Stats failed: ${String(e)}`;
});

refresh_recent().catch(() => {});