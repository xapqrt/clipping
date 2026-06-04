import {
    clear_all_vectors,
    delete_vectors_for_url,
    export_all_vectors_payload,
    from_storable_embedding,
    get_domain_counts,
    get_all_vectors,
    get_vector_stats,
    import_vectors_payload,
    put_vector_rows,
    to_storable_embedding,
} from "./db.js";

const ext_api = globalThis.chrome;
let model_pipeline = null;
let model_loading = false;
let model_load_promise = null;

// ── model ─────────────────────────────────────────────────────────────────────

async function load_model() {
    if (model_pipeline) return model_pipeline;
    if (model_load_promise) return model_load_promise;

    model_load_promise = (async () => {
        try {
            const { pipeline, env } = await import("./vendor/transformers.min.js");

            // Point to bundled WASM if the wasm dir has files, otherwise let it use defaults
            env.allowLocalModels = false;
            env.useBrowserCache = true;

            // Single thread to avoid SharedArrayBuffer issues in service workers
            env.backends.onnx.wasm.numThreads = 1;

            const pipe = await pipeline(
                "feature-extraction",
                "Xenova/all-MiniLM-L6-v2",
                { quantized: true, progress_callback: null }
            );
            model_pipeline = pipe;
            console.log("[Clipper] Model loaded OK");
            return pipe;
        } catch (err) {
            console.error("[Clipper] Model load failed:", err);
            model_load_promise = null;
            return null;
        }
    })();

    return model_load_promise;
}

async function embed(text) {
    const pipe = await load_model();
    if (!pipe) {
        // Deterministic fake fallback so at least clipping doesn't crash
        const v = new Float32Array(384);
        for (let i = 0; i < 384; i++) v[i] = ((text.charCodeAt(i % text.length || 1) || 7) % 31) / 31;
        return v;
    }
    const out = await pipe(text, { pooling: "mean", normalize: true });
    return out.data;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function cosine_sim(a, b) {
    let dot = 0, na = 0, nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        na  += a[i] * a[i];
        nb  += b[i] * b[i];
    }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function safe_progress(tab_id, label, pct) {
    if (!tab_id) return;
    try {
        await ext_api.tabs.sendMessage(tab_id, { type: "CLIPPER_PROGRESS", label, pct });
    } catch { /* tab may have closed */ }
}

async function trigger_clip_on_tab(tab_id) {
    if (!tab_id) return;
    try {
        await ext_api.tabs.sendMessage(tab_id, { type: "CLIPPER_CLIP" });
    } catch {
        // Content script not injected yet – inject then retry
        await ext_api.scripting.executeScript({ target: { tabId: tab_id }, files: ["content.js"] });
        await new Promise(r => setTimeout(r, 200));
        await ext_api.tabs.sendMessage(tab_id, { type: "CLIPPER_CLIP" });
    }
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

ext_api.runtime.onInstalled.addListener(() => {
    ext_api.contextMenus.removeAll(() => {
        ext_api.contextMenus.create({ id: "clipper-clip", title: "Save page to Clipper", contexts: ["page"] });
    });
    // Warm up the model on install so first clip is fast
    load_model();
});

ext_api.runtime.onStartup.addListener(() => {
    load_model();
});

ext_api.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "clipper-clip" || !tab?.id) return;
    await trigger_clip_on_tab(tab.id);
});

ext_api.commands.onCommand.addListener(async (command) => {
    if (command !== "clipper-clip-activet") return;
    const [tab] = await ext_api.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await trigger_clip_on_tab(tab.id);
});

// ── message router ────────────────────────────────────────────────────────────

ext_api.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    // ── STORE PAGE ───────────────────────────────────────────────────────────
    if (msg?.type === "CLIPPER_STORE_PAGE") {
        const data   = msg.payload;
        const tab_id = sender?.tab?.id;

        (async () => {
            if (!data?.url || !Array.isArray(data?.chunks) || !data.chunks.length) {
                throw new Error("Invalid payload – missing url or chunks");
            }

            await safe_progress(tab_id, "Embedding chunks...", 10);
            await delete_vectors_for_url(data.url);

            const rows = [];
            for (let i = 0; i < data.chunks.length; i++) {
                const chunk = data.chunks[i];
                const emb   = await embed(chunk);
                rows.push({
                    id:         `${data.url}::${Date.now()}::${i}`,
                    url:        data.url,
                    title:      data.title || "",
                    domain:     (() => { try { return new URL(data.url).hostname; } catch { return ""; } })(),
                    text_chunk: chunk,
                    embedding:  to_storable_embedding(emb),
                    stored_at:  Date.now(),
                });
                const pct = 10 + Math.round(((i + 1) / data.chunks.length) * 85);
                await safe_progress(tab_id, `Embedding ${i + 1}/${data.chunks.length}...`, pct);
            }

            await put_vector_rows(rows);
            await safe_progress(tab_id, "Saved to Clipper!", 100);
            sendResponse({ ok: true, stored: rows.length });
        })().catch(e => {
            console.error("[Clipper] STORE_PAGE error:", e);
            sendResponse({ ok: false, error: String(e) });
        });
        return true;
    }

    // ── SEARCH ───────────────────────────────────────────────────────────────
    if (msg?.type === "CLIPPER_SEARCH") {
        (async () => {
            const q_emb         = await embed(msg.query || "");
            const min_score     = Number.isFinite(Number(msg.min_score)) ? Number(msg.min_score) : -1;
            const domain_filter = String(msg.domain_filter || "").trim().toLowerCase();
            const top_k         = Math.max(1, Math.min(50, Number(msg.top_k) || 10));

            const all_rows = await get_all_vectors();

            const scored = all_rows.map(row => {
                const db_emb    = from_storable_embedding(row.embedding);
                let sim         = cosine_sim(q_emb, db_emb);
                // Small keyword overlap boost
                const q_tokens  = String(msg.query || "").toLowerCase().split(/\s+/).filter(Boolean);
                const text_low  = String(row.text_chunk || "").toLowerCase();
                let overlap = 0;
                for (const t of q_tokens) if (t && text_low.includes(t)) overlap++;
                sim += Math.min(0.2, overlap * 0.04);
                return { ...row, sim_score: sim };
            })
            .filter(r => r.sim_score >= min_score)
            .filter(r => {
                if (!domain_filter) return true;
                try { return new URL(r.url).hostname.toLowerCase().includes(domain_filter); }
                catch { return false; }
            });

            scored.sort((a, b) => b.sim_score - a.sim_score);

            // Best chunk per URL
            const best = new Map();
            for (const r of scored) {
                if (!best.has(r.url) || r.sim_score > best.get(r.url).sim_score)
                    best.set(r.url, r);
            }

            const hits = Array.from(best.values())
                .sort((a, b) => b.sim_score - a.sim_score)
                .slice(0, top_k);

            sendResponse({ ok: true, hits });
        })().catch(e => sendResponse({ ok: false, error: String(e), hits: [] }));
        return true;
    }

    // ── STATS ─────────────────────────────────────────────────────────────────
    if (msg?.type === "CLIPPER_STATS") {
        get_vector_stats()
            .then(stats => sendResponse({ ok: true, stats }))
            .catch(e  => sendResponse({ ok: false, error: String(e), stats: { total_chunks: 0, unique_urls: 0 } }));
        return true;
    }

    // ── CLEAR ALL ────────────────────────────────────────────────────────────
    if (msg?.type === "CLIPPER_CLEAR_ALL") {
        clear_all_vectors()
            .then(() => sendResponse({ ok: true }))
            .catch(e => sendResponse({ ok: false, error: String(e) }));
        return true;
    }

    // ── EXPORT ───────────────────────────────────────────────────────────────
    if (msg?.type === "CLIPPER_EXPORT_ALL") {
        export_all_vectors_payload()
            .then(payload => sendResponse({ ok: true, payload }))
            .catch(e => sendResponse({ ok: false, error: String(e), payload: null }));
        return true;
    }

    // ── IMPORT ───────────────────────────────────────────────────────────────
    if (msg?.type === "CLIPPER_IMPORT_ALL") {
        (async () => {
            await import_vectors_payload(msg.payload);
            const stats = await get_vector_stats();
            sendResponse({ ok: true, stats });
        })().catch(e => sendResponse({ ok: false, error: String(e) }));
        return true;
    }

    // ── RECENT ───────────────────────────────────────────────────────────────
    if (msg?.type === "CLIPPER_RECENT") {
        (async () => {
            const rows   = await get_all_vectors();
            const by_url = new Map();
            for (const row of rows) {
                const parts = String(row.id || "").split("::");
                const ts    = Number(parts[parts.length - 2] || 0) || row.stored_at || 0;
                const prev  = by_url.get(row.url);
                if (!prev || ts > prev.ts)
                    by_url.set(row.url, { url: row.url, title: row.title || "untitled", ts, domain: row.domain || "" });
            }
            const items = Array.from(by_url.values()).sort((a, b) => b.ts - a.ts).slice(0, 20);
            sendResponse({ ok: true, items });
        })().catch(e => sendResponse({ ok: false, error: String(e), items: [] }));
        return true;
    }

    // ── DOMAIN COUNTS ────────────────────────────────────────────────────────
    if (msg?.type === "CLIPPER_DOMAIN_COUNTS") {
        get_domain_counts(10)
            .then(items => sendResponse({ ok: true, items }))
            .catch(e  => sendResponse({ ok: false, error: String(e), items: [] }));
        return true;
    }

    // ── GET ALL CLIPPED (for vault page) ─────────────────────────────────────
    if (msg?.type === "CLIPPER_GET_ALL") {
        (async () => {
            const rows = await get_all_vectors();
            // Deduplicate by URL, keep newest + collect chunk count
            const by_url = new Map();
            for (const row of rows) {
                const parts = String(row.id || "").split("::");
                const ts    = Number(parts[parts.length - 2] || 0) || row.stored_at || 0;
                if (!by_url.has(row.url)) {
                    by_url.set(row.url, {
                        url: row.url, title: row.title || "untitled",
                        domain: row.domain || (() => { try { return new URL(row.url).hostname; } catch { return ""; } })(),
                        ts, chunks: 1,
                        snippet: (row.text_chunk || "").slice(0, 200),
                    });
                } else {
                    const e = by_url.get(row.url);
                    e.chunks++;
                    if (ts > e.ts) e.ts = ts;
                }
            }
            const pages = Array.from(by_url.values()).sort((a, b) => b.ts - a.ts);
            sendResponse({ ok: true, pages });
        })().catch(e => sendResponse({ ok: false, error: String(e), pages: [] }));
        return true;
    }

    // ── DELETE ONE URL ───────────────────────────────────────────────────────
    if (msg?.type === "CLIPPER_DELETE_URL") {
        delete_vectors_for_url(msg.url)
            .then(() => sendResponse({ ok: true }))
            .catch(e => sendResponse({ ok: false, error: String(e) }));
        return true;
    }

    // ── HEALTH ───────────────────────────────────────────────────────────────
    if (msg?.type === "CLIPPER_HEALTH") {
        (async () => {
            const stats = await get_vector_stats();
            sendResponse({ ok: true, stats, model: Boolean(model_pipeline) });
        })().catch(e => sendResponse({ ok: false, error: String(e) }));
        return true;
    }
});