# Clipper

A completely local semantic web clipper for Chrome. It lets you save web content and actually search through it based onn meaning!

The best part? Everything is processed right on your machine

## The Cool Stuff

- **Local-First Semantic Search**: Clip pages and search your vault using ML embeddings
- **Total Privacy**: We’re running transformers.js with WASM locally. Zero cloud dependency
- **Vector Storage**: Text chunks and their embeddings are dumped into IndexedDB so semantic searches are blazing fast
- **Quick Clipping**: Just hit the keyboard shortcut or click the popup button to instantly rip and save the current page
- **Smart Extraction**: Automatically pulls the text from the DOM and chops it into manageable 300 word chunks (plus metadata)
- **Analytics & Control**: See your recent clips, check which domains you save from the most, and filter your search results by domain or similarity score
- **Vault Management**: You can export your entire database as a JSON backup and import it whenever




## How It Actually Works

When you clip something:

1. You hit the "Clip" button or use the hotkey.
2. The content script scrapes the page text and splits it into 300-word chunks.
3. Each chunk gets pushed through the local ML model to generate an embedding.
4. It all gets saved into IndexedDB along with the source URL, title, domain, and timestamp.

When you search:

1. You type a query into the popup.
2. The query is embedded using the exact same ML model.
3. The app calculates the cosine similarity against all the stored vectors in your vault.
4. Results are ranked by relevance, and you can filter out the noise using domain rules or a minimum score threshold.

## Installation (Developer Mode)

Since this is a local extension, there's no build process needed:

1. Clone or download this repo.
2. Open Chrome and head to chrome://extensions.
3. Toggle "Developer mode" on (top right corner).
4. Click "Load unpacked" and select the project folder.
5. The Clipper icon should pop up in your extensions menu. Pin it!
