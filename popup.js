// popup.js – controller for the Clipper popup UI

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// nav
const tab_btns    = document.querySelectorAll(".tab-btn");
const panels      = document.querySelectorAll(".panel");

// search panel
const query_inp   = $("query");
const search_btn  = $("search_btn");
const domain_inp  = $("domain_filter");
const score_inp   = $("min_score");
const results_div = $("results");
const stat_chunks = $("stat-chunks");
const stat_pages  = $("stat-pages");

// clip panel
const clip_btn    = $("clip_btn");
const clip_status = $("clip-status");
const recent_div  = $("recent");
const domains_div = $("top-domains");

// vault panel
const vault_list  = $("vault-list");
const vault_fil   = $("vault_filter");
const vault_ref   = $("vault-refresh-btn");

// settings panel
const export_btn  = $("export_btn");
const import_btn  = $("import_btn");
const import_file = $("import_file");
const clear_btn   = $("clear_btn");
const settings_msg = $("settings-msg");

let last_hits = [];
let all_vault_pages = [];

// ── tab nav ───────────────────────────────────────────────────────────────────

tab_btns.forEach(btn => {
    btn.addEventListener("click", () => {
        tab_btns.forEach(b => b.classList.remove("active"));
        panels.forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const target = $(`${btn.dataset.tab}-panel`);
        if (target) target.classList.add("active");

        // Load vault data when switching to vault tab
        if (btn.dataset.tab === "vault") load_vault();
    });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function time_ago(ts) {
    if (!ts) return "";
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60)    return "just now";
    if (secs < 3600)  return `${Math.floor(secs/60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
    return `${Math.floor(secs/86400)}d ago`;
}

function favicon_url(url) {
    try {
        const origin = new URL(url).origin;
        return `https://www.google.com/s2/favicons?domain=${origin}&sz=16`;
    } catch { return ""; }
}

async function send(type, extra = {}) {
    return chrome.runtime.sendMessage({ type, ...extra });
}

// ── stats ─────────────────────────────────────────────────────────────────────

async function refresh_stats() {
    try {
        const res = await send("CLIPPER_HEALTH");
        const s = res?.stats || {};
        stat_chunks.textContent = s.total_chunks ?? "—";
        stat_pages.textContent  = s.unique_urls  ?? "—";
        const stat_model = $("stat-model");
        if (stat_model) {
            if (res?.model) {
                stat_model.textContent = "Local ML";
                stat_model.style.color = "#66e2b3";
            } else {
                stat_model.textContent = "Fallback";
                stat_model.style.color = "#e74c3c";
            }
        }
    } catch {
        stat_chunks.textContent = "?";
        stat_pages.textContent  = "?";
        const stat_model = $("stat-model");
        if (stat_model) stat_model.textContent = "?";
    }
}

// ── search ────────────────────────────────────────────────────────────────────

function highlight(text, words) {
    let out = esc(text);
    for (const w of words) {
        if (!w) continue;
        const re = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
        out = out.replace(re, "<mark>$1</mark>");
    }
    return out;
}

function render_results(hits) {
    last_hits = hits;
    if (!hits?.length) {
        results_div.innerHTML = `<div class="msg">No results found.</div>`;
        return;
    }
    const words = query_inp.value.trim().split(/\s+/).filter(Boolean);
    results_div.innerHTML = hits.map((item, i) => {
        const snip  = String(item.text_chunk || "").slice(0, 200).replace(/\s+/g, " ");
        const score = Number(item.sim_score || 0).toFixed(3);
        const title = item.title || item.url || "untitled";
        return `
        <div class="result-card">
            <div style="display:flex;align-items:baseline;gap:4px">
                <span class="result-title" title="${esc(item.url)}">${esc(title)}</span>
                <span class="result-score">${score}</span>
            </div>
            <div class="result-snippet">${highlight(snip, words)}…</div>
            <div class="result-actions">
                <a href="${esc(item.url)}" target="_blank">open page</a>
                <button class="copy-btn" data-idx="${i}" data-text="${esc(snip)}">copy snippet</button>
            </div>
        </div>`;
    }).join("");

    results_div.querySelectorAll(".copy-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(btn.dataset.text || "");
                btn.textContent = "copied!";
                setTimeout(() => btn.textContent = "copy snippet", 1500);
            } catch {
                btn.textContent = "failed";
            }
        });
    });
}

search_btn.addEventListener("click", async () => {
    const q = query_inp.value.trim();
    if (!q) return;
    search_btn.disabled = true;
    results_div.innerHTML = `<div class="msg">Searching…</div>`;
    try {
        const res = await send("CLIPPER_SEARCH", {
            query: q,
            domain_filter: domain_inp.value.trim(),
            min_score: score_inp.value ? Number(score_inp.value) : -1,
            top_k: 15,
        });
        render_results(res?.hits || []);
        refresh_stats();
    } catch (e) {
        results_div.innerHTML = `<div class="msg err">Search failed: ${esc(String(e))}</div>`;
    } finally {
        search_btn.disabled = false;
    }
});

query_inp.addEventListener("keydown", e => {
    if (e.key === "Enter") search_btn.click();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && last_hits[0]?.url)
        chrome.tabs.create({ url: last_hits[0].url });
});

// ── clip ──────────────────────────────────────────────────────────────────────

function set_clip_status(msg, cls = "") {
    clip_status.textContent = msg;
    clip_status.className = ["msg", cls].filter(Boolean).join(" ");
}

async function get_active_tab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function do_clip() {
    const tab = await get_active_tab();
    if (!tab?.id) { set_clip_status("No active tab found.", "err"); return; }

    clip_btn.disabled = true;
    set_clip_status("Clipping…");

    try {
        await chrome.tabs.sendMessage(tab.id, { type: "CLIPPER_CLIP" });
        set_clip_status("Clip started — watch the page overlay for progress.", "ok");
    } catch {
        // Content script not injected yet
        try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
            await new Promise(r => setTimeout(r, 200));
            await chrome.tabs.sendMessage(tab.id, { type: "CLIPPER_CLIP" });
            set_clip_status("Injected & clipping — watch the page overlay.", "ok");
        } catch (err) {
            const msg = String(err);
            if (msg.includes("Cannot access") || msg.includes("chrome://"))
                set_clip_status("Cannot clip this page type (chrome:// or extension pages).", "err");
            else
                set_clip_status(`Clip failed: ${msg}`, "err");
        }
    } finally {
        clip_btn.disabled = false;
        setTimeout(() => refresh_recent(), 3000);
        setTimeout(() => refresh_stats(), 3500);
    }
}

clip_btn.addEventListener("click", () => do_clip());

async function refresh_recent() {
    try {
        const res = await send("CLIPPER_RECENT");
        const items = res?.items || [];
        if (!items.length) {
            recent_div.innerHTML = `<div class="msg">No clips yet.</div>`;
            return;
        }
        recent_div.innerHTML = items.map(x => `
            <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #1a1a1a">
                <img src="${favicon_url(x.url)}" class="vault-favicon" onerror="this.style.display='none'" />
                <div style="flex:1;min-width:0">
                    <div style="font-size:11px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                        <a href="${esc(x.url)}" target="_blank" style="color:inherit;text-decoration:none">${esc(x.title || x.url)}</a>
                    </div>
                    <div style="font-size:10px;color:#444">${time_ago(x.ts)}</div>
                </div>
            </div>`).join("");
    } catch {
        recent_div.innerHTML = `<div class="msg err">Failed to load recent clips.</div>`;
    }
}

async function refresh_top_domains() {
    try {
        const res = await send("CLIPPER_DOMAIN_COUNTS");
        const items = res?.items || [];
        if (!items.length) {
            domains_div.innerHTML = `<div class="msg">No domain data yet.</div>`;
            return;
        }
        domains_div.innerHTML = items.map(x => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1a1a1a">
                <span style="font-size:11px;color:#ccc">${esc(x.domain)}</span>
                <span style="font-size:10px;color:#66e2b3">${x.chunks} chunk${x.chunks !== 1 ? "s" : ""}</span>
            </div>`).join("");
    } catch {
        domains_div.innerHTML = `<div class="msg err">Failed to load top domains.</div>`;
    }
}

// ── vault ─────────────────────────────────────────────────────────────────────

async function load_vault() {
    vault_list.innerHTML = `<div id="vault-empty">Loading vault…</div>`;
    try {
        const res = await send("CLIPPER_GET_ALL");
        all_vault_pages = res?.pages || [];
        render_vault(all_vault_pages);
    } catch (e) {
        vault_list.innerHTML = `<div class="msg err">Failed to load vault: ${esc(String(e))}</div>`;
    }
}

function render_vault(pages) {
    if (!pages.length) {
        vault_list.innerHTML = `<div id="vault-empty">Your vault is empty. Clip some pages first!</div>`;
        return;
    }
    vault_list.innerHTML = pages.map(p => {
        const domain  = p.domain || ((() => { try { return new URL(p.url).hostname; } catch { return ""; } })());
        const ago     = time_ago(p.ts);
        return `
        <div class="vault-card" data-url="${esc(p.url)}">
            <img src="${favicon_url(p.url)}" class="vault-favicon" onerror="this.style.display='none'" />
            <div class="vault-info">
                <div class="vault-title" title="${esc(p.url)}">
                    <a href="${esc(p.url)}" target="_blank" style="color:inherit;text-decoration:none">${esc(p.title || p.url)}</a>
                </div>
                <div class="vault-meta">${esc(domain)} · ${p.chunks} chunk${p.chunks !== 1 ? "s" : ""} · ${ago}</div>
                ${p.snippet ? `<div class="vault-snippet">${esc(p.snippet)}</div>` : ""}
            </div>
            <button class="vault-del" data-url="${esc(p.url)}" title="Remove from vault">×</button>
        </div>`;
    }).join("");

    vault_list.querySelectorAll(".vault-del").forEach(btn => {
        btn.addEventListener("click", async e => {
            e.stopPropagation();
            const url = btn.dataset.url;
            btn.disabled = true;
            btn.textContent = "…";
            try {
                await send("CLIPPER_DELETE_URL", { url });
                await load_vault();
                refresh_stats();
            } catch {
                btn.textContent = "×";
                btn.disabled = false;
            }
        });
    });
}

vault_fil.addEventListener("input", () => {
    const q = vault_fil.value.trim().toLowerCase();
    if (!q) { render_vault(all_vault_pages); return; }
    const filtered = all_vault_pages.filter(p =>
        (p.title || "").toLowerCase().includes(q) ||
        (p.domain || "").toLowerCase().includes(q) ||
        (p.url || "").toLowerCase().includes(q)
    );
    render_vault(filtered);
});

vault_ref.addEventListener("click", load_vault);

// ── settings ──────────────────────────────────────────────────────────────────

function set_settings_msg(msg, cls = "") {
    settings_msg.textContent = msg;
    settings_msg.className = ["msg", cls].filter(Boolean).join(" ");
}

export_btn.addEventListener("click", async () => {
    try {
        const res = await send("CLIPPER_EXPORT_ALL");
        if (!res?.ok || !res.payload) { set_settings_msg("Export failed.", "err"); return; }
        const blob = new Blob([JSON.stringify(res.payload, null, 2)], { type: "application/json" });
        const a    = document.createElement("a");
        a.href     = URL.createObjectURL(blob);
        a.download = `clipper-backup-${Date.now()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 500);
        set_settings_msg(`Exported ${res.payload.count} chunks.`, "ok");
    } catch (e) {
        set_settings_msg(`Export failed: ${String(e)}`, "err");
    }
});

import_btn.addEventListener("click", () => import_file.click());

import_file.addEventListener("change", async () => {
    const file = import_file.files?.[0];
    if (!file) return;
    try {
        const payload = JSON.parse(await file.text());
        const res = await send("CLIPPER_IMPORT_ALL", { payload });
        if (!res?.ok) { set_settings_msg("Import failed.", "err"); return; }
        const s = res.stats || {};
        set_settings_msg(`Imported! Now ${s.total_chunks} chunks across ${s.unique_urls} pages.`, "ok");
        refresh_stats();
        refresh_recent();
        refresh_top_domains();
    } catch (e) {
        set_settings_msg(`Import failed: ${String(e)}`, "err");
    } finally {
        import_file.value = "";
    }
});

clear_btn.addEventListener("click", async () => {
    if (!confirm("Delete all clipped data? This cannot be undone.")) return;
    try {
        const res = await send("CLIPPER_CLEAR_ALL");
        if (res?.ok) {
            set_settings_msg("Vault cleared.", "ok");
            refresh_stats();
            refresh_recent();
            refresh_top_domains();
            all_vault_pages = [];
        } else {
            set_settings_msg("Clear failed.", "err");
        }
    } catch (e) {
        set_settings_msg(`Error: ${String(e)}`, "err");
    }
});

// ── message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "CLIPPER_PAGE_STORED") {
        refresh_stats();
        refresh_recent();
        refresh_top_domains();
        if (document.querySelector(".tab-btn[data-tab='vault']").classList.contains("active")) {
            load_vault();
        }
    }
});

// ── init ──────────────────────────────────────────────────────────────────────

refresh_stats();
refresh_recent();
refresh_top_domains();