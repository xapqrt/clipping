/* content.js – injected into every page */
let toast_node = null;

// ── toast overlay ─────────────────────────────────────────────────────────────

function ensure_toast() {
    if (toast_node && document.documentElement.contains(toast_node)) return toast_node;
    toast_node = document.createElement("div");
    toast_node.id = "clipper-toast-root";
    Object.assign(toast_node.style, {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: "2147483647",
        background: "#0f0f0f",
        color: "#e8e8e8",
        padding: "12px 16px",
        borderRadius: "12px",
        font: "13px/1.5 ui-monospace, Menlo, monospace",
        boxShadow: "0 8px 32px rgba(0,0,0,.5)",
        minWidth: "240px",
        maxWidth: "340px",
        border: "1px solid #2a2a2a",
    });
    toast_node.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-weight:600;color:#66e2b3">Clipper</span>
            <span id="clipper_msg" style="flex:1;opacity:.85">starting...</span>
        </div>
        <div style="height:3px;background:#222;border-radius:4px;overflow:hidden">
            <div id="clipper_bar" style="height:100%;width:0%;background:linear-gradient(90deg,#66e2b3,#3eb89a);transition:width .25s ease;border-radius:4px"></div>
        </div>`;
    document.documentElement.appendChild(toast_node);
    return toast_node;
}

function toast_step(label, pct) {
    const root = ensure_toast();
    const msg = root.querySelector("#clipper_msg");
    const bar = root.querySelector("#clipper_bar");
    if (msg) msg.textContent = label;
    if (bar) bar.style.width = `${Math.min(100, pct)}%`;
}

function dismiss_toast(delay = 2500) {
    setTimeout(() => {
        toast_node?.remove();
        toast_node = null;
    }, delay);
}

// ── text extraction ───────────────────────────────────────────────────────────

function extract_text() {
    // Use TreeWalker to walk visible text nodes directly – avoids innerText quirks
    const skip_tags = new Set(["SCRIPT","STYLE","NOSCRIPT","NAV","FOOTER","ASIDE","FORM","HEADER","IFRAME","SVG"]);
    const parts = [];
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                // Skip hidden elements
                let el = node.parentElement;
                while (el && el !== document.body) {
                    if (skip_tags.has(el.tagName)) return NodeFilter.FILTER_REJECT;
                    try {
                        const s = getComputedStyle(el);
                        if (!s || s.display === "none" || s.visibility === "hidden")
                            return NodeFilter.FILTER_REJECT;
                    } catch (e) {
                        // Fallback: if style lookup fails/throws, assume visible
                    }
                    el = el.parentElement;
                }
                const text = node.nodeValue?.trim();
                return text && text.length > 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        }
    );
    let node;
    while ((node = walker.nextNode())) {
        parts.push(node.nodeValue.trim());
    }
    return parts.join(" ").replace(/\s{2,}/g, " ").trim();
}

function chunk_text(text, words_per_chunk = 300) {
    const words  = text.split(/\s+/).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < words.length; i += words_per_chunk) {
        chunks.push(words.slice(i, i + words_per_chunk).join(" "));
    }
    return chunks;
}

// ── clip flow ─────────────────────────────────────────────────────────────────

async function run_clip_flow() {
    toast_step("Extracting text...", 5);

    let raw = window.getSelection().toString().trim();
    let is_selection = false;
    if (raw && raw.length >= 10) {
        is_selection = true;
    } else {
        raw = extract_text();
    }

    if (!raw || raw.length < 50) {
        toast_step("No useful text found on this page", 100);
        dismiss_toast(2000);
        return;
    }

    const chunks = chunk_text(raw, 300).filter(c => c && c.trim().length > 10);
    if (!chunks.length) {
        toast_step("Nothing to clip", 100);
        dismiss_toast(2000);
        return;
    }

    const label = is_selection ? "selection" : "page";
    toast_step(`Sending ${chunks.length} ${label} chunks...`, 15);

    let res;
    try {
        res = await chrome.runtime.sendMessage({
            type: "CLIPPER_STORE_PAGE",
            payload: {
                url: location.href,
                title: is_selection ? `[Selection] ${document.title}` : document.title,
                chunks,
                source: is_selection ? "selection" : "page"
            },
        });
    } catch (err) {
        toast_step(`Error: ${err.message}`, 100);
        dismiss_toast(3000);
        console.error("[Clipper] sendMessage failed:", err);
        return;
    }

    if (res?.ok) {
        toast_step(`Saved! (${res.stored} chunks)`, 100);
    } else {
        toast_step(`Failed: ${res?.error || "unknown error"}`, 100);
        console.error("[Clipper] store failed:", res?.error);
    }
    dismiss_toast(2500);
}

// ── message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "CLIPPER_CLIP") {
        run_clip_flow().catch(err => {
            console.error("[Clipper] clip flow error:", err);
            toast_step(`Clip error: ${err.message}`, 100);
            dismiss_toast(3000);
        });
        return;
    }
    if (msg?.type === "CLIPPER_PROGRESS") {
        toast_step(msg.label || "working...", Number(msg.pct) || 0);
    }
});