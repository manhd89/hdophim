const PROXY_PREFIX = '/proxy-stream';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith(PROXY_PREFIX)) {
    event.respondWith(handleVirtualRequest(event));
  }
});

async function handleVirtualRequest(event) {
  const url = new URL(event.request.url);
  const playlistUrl = url.searchParams.get("url");

  if (!playlistUrl) {
    return new Response("Missing ?url=", { status: 400 });
  }

  try {
    const manifest = await fetchAndProcessPlaylist(playlistUrl);

    return new Response(manifest, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}

async function fetchAndProcessPlaylist(playlistUrl) {
  const res = await fetch(playlistUrl);
  if (!res.ok) throw new Error("Cannot fetch playlist");

  let text = await res.text();

  // resolve absolute URLs cho các dòng không phải comment
  text = text.replace(/^[^#].*$/gm, (line) => {
    try {
      return new URL(line.trim(), playlistUrl).toString();
    } catch {
      return line;
    }
  });

  // nếu là master playlist -> đi sâu stream con
  if (text.includes("#EXT-X-STREAM-INF")) {
    const lines = text.split("\n");

    for (let i = 1; i < lines.length; i++) {
      if (lines[i - 1].includes("#EXT-X-STREAM-INF")) {
        const subUrl = new URL(lines[i].trim(), playlistUrl).toString();
        return fetchAndProcessPlaylist(subUrl);
      }
    }
  }

  return cleanManifest(text, playlistUrl);
}

function cleanManifest(manifest, baseUrl) {
  const lines = manifest.split(/\r?\n/);
  const result = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // giữ nguyên comment HLS
    if (line.startsWith("#")) {
      result.push(lines[i]);
      i++;
      continue;
    }

    // resolve URL segment
    let url;
    try {
      url = new URL(line, baseUrl).toString();
    } catch {
      i++;
      continue;
    }

    // 🔥 APPLY FILTER QUẢNG CÁO Ở ĐÂY
    const cleaned = processSegment(url);

    if (cleaned) {
      result.push(cleaned);
    }

    i++;
  }

  return result.join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/* =========================
   FILTER LOGIC CỦA BẠN
========================= */

function normalizeConvertPath(url) {
  return url.replace(/\/convertv\d+\//g, "/");
}

function isTsFile(url) {
  return typeof url === "string" && url.endsWith(".ts");
}

function isValidMovieSegment(url) {
  return /^https?:\/\/[^/]+\/\d{8}\/[A-Za-z0-9]+\/\d+kb\/hls\/.+\.ts$/i.test(url);
}

function processSegment(url) {
  if (!url) return null;

  const cleanedUrl = normalizeConvertPath(url);

  if (!isTsFile(cleanedUrl)) return null;

  if (!isValidMovieSegment(cleanedUrl)) return null;

  return cleanedUrl;
}
