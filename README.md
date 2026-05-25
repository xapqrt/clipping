# Brain=Sync

A local-first semantic web clipper for Chrome that lets you save web content and search through it intelligently, all processed locally on your machine.

## Features

- **Local-First Semantic Search**: Clip web pages and search through them using semantic similarity powered by ML embeddings—no cloud, no tracking
- **Privacy-Focused**: All embeddings are generated locally using transformers.js with WASM, keeping your data completely offline
- **Vector Storage**: Content chunks are stored as embeddings in IndexedDB for efficient semantic search
- **Quick Clipping**: Keyboard shortcut or popup button to instantly clip the current page
- **Smart Extraction**: Automatically extracts text from web pages into manageable 300-word chunks with metadata
- **Recent Clips**: View recently clipped pages with one-click access
- **Domain Analytics**: See which sites contribute most to your saved content
- **Filtering & Controls**: Filter results by domain and similarity score threshold
- **Backup & Restore**: Export your entire vault as JSON and import backups

## Architecture

### Core Components

- **content.js** - Content script that runs on all web pages. Handles text extraction and clips from the DOM
- **background.js** - Service worker that manages embeddings, database operations, and message routing
- **db.js** - IndexedDB wrapper for storing and querying vectors with metadata (URL, title, domain, timestamp)
- **popup.js** - UI controller for the extension popup with search, stats, and vault management
- **popup.html** - UI markup for the extension popup interface

### Key Technologies

- **transformers.js** - Client-side ML library for generating text embeddings (all-MiniLM-L6-v2 model)
- **WASM** - WebAssembly runtime for efficient embedding generation
- **IndexedDB** - Local browser database for storing vectors and metadata
- **Chrome MV3 API** - Service workers, content scripts, context menus, and storage APIs

## How It Works

### Clipping Flow
1. Click "Clip Current Page" button or use keyboard shortcut
2. Content script extracts text from the page
3. Text is split into 300-word chunks
4. Each chunk is embedded locally using the ML model
5. Chunks stored in IndexedDB with URL, title, domain, and timestamp metadata

### Search Flow
1. Enter a search query in the popup
2. Query text is embedded using the same ML model
3. Cosine similarity is computed against all stored vectors
4. Results ranked by relevance score
5. Results can be filtered by domain and minimum score threshold

### Storage Structure

Each vector row contains:
- `chunk_text` - The original text snippet
- `embedding` - Float32 embedding vector (384 dimensions)
- `url` - Source page URL
- `title` - Source page title
- `domain` - Source domain for filtering
- `timestamp` - When the clip was created
- `score` - Similarity score (computed during search)

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the project directory
6. The Brain=Sync icon should appear in your extension menu

## Usage

### Basic Search
1. Click the Brain=Sync extension icon
2. Type your search query
3. Click "Search Local"
4. Results appear sorted by relevance

### Clipping Pages
- **Method 1**: Click "Clip Current Page" button in popup
- **Method 2**: Use keyboard shortcut (configurable in Chrome extension settings)

### Filtering Results
- **Domain Filter**: Enter a domain name to show only results from that site
- **Min Score**: Set a similarity threshold (0.0-1.0) to filter low-confidence results

### Managing Your Vault
- **Stats**: See total chunks and unique pages saved
- **Recent Clips**: Quick access to recently saved pages
- **Domain Leaderboard**: See which sites have the most saved content
- **Clear Vault**: Completely wipe all saved data
- **Export Backup**: Download entire vault as JSON
- **Import Backup**: Restore vault from previously exported file

## Performance Notes

- **Model Loading**: The ML model (~50MB) loads on first use and is cached
- **Embedding Generation**: Processing pages takes a few seconds as embeddings are computed
- **Search Speed**: Searching across thousands of pages is typically instant due to vector similarity computation
- **Storage**: IndexedDB quota varies by browser but typically allows 50MB+ of storage

## Development

### Build/Run
- This is a Chrome extension, no build process needed
- Load unpacked from `chrome://extensions` in developer mode

### File Structure
```
/
├── manifest.json          - MV3 extension manifest
├── background.js          - Service worker (core logic)
├── content.js             - Content script (text extraction)
├── db.js                  - Database/vector operations
├── popup.html             - Popup UI
├── popup.js               - Popup controller
├── vendor/                - Third-party libraries (transformers.js)
└── wasm/                  - WebAssembly runtime files
```

## Limitations & Known Issues

- Search quality depends on the embedding model; very short queries may be less accurate
- Large pages may take longer to clip and process
- Clearing the vault is permanent—always export a backup first
- Some pages with heavy JavaScript content may not extract text correctly

## Future Ideas

- Sync between devices (still local-first, but optional)
- Tagging and collections for organization
- Custom chunking strategies
- Integration with other tools
- Advanced filters (date range, content type)
- Batch operations

## License

MIT

## Author

Built with ❤️ for better local-first web tools
