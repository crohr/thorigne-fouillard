#!/usr/bin/env node

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const DEFAULT_CHANNEL_URL = "https://www.youtube.com/@villethorignefouillard";
const DEFAULT_OUTPUT_DIR = "data/conseils-municipaux";
const DEFAULT_MODEL = "cli/codex/gpt-5.4";
const DEFAULT_LENGTH = "long";
const DEFAULT_LANGUAGE = "fr";
const DEFAULT_YOUTUBE_MODE = "auto";
const DEFAULT_FORMAT = "md";
const DEFAULT_MARKDOWN_MODE = "auto";
const DEFAULT_QUERIES = [
  "conseil municipal",
  "election des colleges electoraux",
  "installation du conseil municipal",
  "seance exceptionnelle",
];
const DEFAULT_INCLUDE_PATTERNS = [
  "^conseil municipal\\b",
  "election des colleges electoraux",
  "installation du conseil municipal",
  "seance exceptionnelle",
];
const CANONICAL_AUTHOR_NAMES = new Set(["ville de thorigne-fouillard", "ville de thorigné-fouillard"]);
const MONTHS_BY_NAME = new Map([
  ["janvier", "01"],
  ["fevrier", "02"],
  ["mars", "03"],
  ["avril", "04"],
  ["mai", "05"],
  ["juin", "06"],
  ["juillet", "07"],
  ["aout", "08"],
  ["septembre", "09"],
  ["octobre", "10"],
  ["novembre", "11"],
  ["decembre", "12"],
]);
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

export function stripDiacritics(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizeText(value) {
  return stripDiacritics(String(value ?? ""))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function compileIncludePatterns(patterns) {
  return patterns.map((pattern) => new RegExp(pattern, "i"));
}

export function shouldIncludeTitle(title, includeRegexes) {
  const normalized = normalizeText(title);
  return includeRegexes.some((regex) => regex.test(normalized));
}

export function extractEventDateFromTitle(title) {
  const normalized = normalizeText(title)
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2");
  const match = normalized.match(/\b(\d{1,2})(?:\s*er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(20\d{2})\b/);

  if (!match) {
    return null;
  }

  const [, dayRaw, monthName, year] = match;
  const month = MONTHS_BY_NAME.get(monthName);
  if (!month) {
    return null;
  }

  const day = dayRaw.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatEventDateDisplay(isoDate) {
  if (!isoDate) {
    return "Date non détectée";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function buildVideoFolderName(videoId, eventDate = null) {
  return `${eventDate ?? "date-inconnue"}__${videoId}`;
}

export function buildLegacyVideoPaths(outputDir, videoId) {
  const baseDir = path.join(outputDir, "videos", videoId);
  return {
    baseDir,
    metadata: path.join(baseDir, "metadata.json"),
    summarize: path.join(baseDir, "summarize.json"),
    summary: path.join(baseDir, "summary.md"),
    transcript: path.join(baseDir, "transcript.txt"),
  };
}

export function buildVideoPaths(outputDir, videoId, eventDate = null) {
  const baseDir = path.join(outputDir, "videos", buildVideoFolderName(videoId, eventDate));
  return {
    baseDir,
    metadata: path.join(baseDir, "metadata.json"),
    summarize: path.join(baseDir, "summarize.json"),
    summary: path.join(baseDir, "summary.md"),
    transcript: path.join(baseDir, "transcript.txt"),
  };
}

export async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function writeFileAtomic(targetPath, content) {
  const directory = path.dirname(targetPath);
  const tempPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, content);
  await rename(tempPath, targetPath);
}

export async function writeJsonAtomic(targetPath, value) {
  await writeFileAtomic(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function extractInitialData(html) {
  const marker = "var ytInitialData = ";
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error("Impossible de trouver ytInitialData dans la page YouTube.");
  }

  let index = start + marker.length;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const jsonText = html.slice(start + marker.length, index + 1);
        return JSON.parse(jsonText);
      }
    }
  }

  throw new Error("ytInitialData trouvé mais non parseable.");
}

export function extractInertubeConfig(html) {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
  const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1];

  if (!apiKey || !clientVersion || !visitorData) {
    throw new Error("Impossible d'extraire la configuration INNERTUBE de YouTube.");
  }

  return { apiKey, clientVersion, visitorData };
}

export function collectVideoRenderers(node, results = []) {
  if (!node) {
    return results;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectVideoRenderers(item, results);
    }
    return results;
  }

  if (typeof node !== "object") {
    return results;
  }

  if (node.videoRenderer && typeof node.videoRenderer === "object") {
    results.push(node.videoRenderer);
  }

  for (const value of Object.values(node)) {
    collectVideoRenderers(value, results);
  }

  return results;
}

export function collectContinuationTokens(node, results = [], seen = new Set()) {
  if (!node) {
    return results;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectContinuationTokens(item, results, seen);
    }
    return results;
  }

  if (typeof node !== "object") {
    return results;
  }

  const token = node.continuationCommand?.token ?? node.continuationEndpoint?.continuationCommand?.token;
  if (token && !seen.has(token)) {
    seen.add(token);
    results.push(token);
  }

  for (const value of Object.values(node)) {
    collectContinuationTokens(value, results, seen);
  }

  return results;
}

export function videoRendererToRecord(renderer, source) {
  const title =
    renderer.title?.runs?.map((run) => run.text).join("") ??
    renderer.title?.simpleText ??
    "";
  const publishedText =
    renderer.publishedTimeText?.simpleText ??
    renderer.publishedTimeText?.runs?.map((run) => run.text).join("") ??
    null;

  return {
    videoId: renderer.videoId,
    title,
    url: renderer.videoId ? `https://www.youtube.com/watch?v=${renderer.videoId}` : null,
    source,
    publishedText,
  };
}

export async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`);
  }

  return response.text();
}

export async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "user-agent": USER_AGENT,
      "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`);
  }

  return response.json();
}

export async function fetchYoutubePageContext(url) {
  const html = await fetchText(url);
  return {
    html,
    initialData: await extractInitialData(html),
    config: extractInertubeConfig(html),
  };
}

export function addUniqueVideos(targetMap, renderers, source) {
  for (const renderer of renderers) {
    const record = videoRendererToRecord(renderer, source);
    if (!record.videoId || !record.url || targetMap.has(record.videoId)) {
      continue;
    }
    targetMap.set(record.videoId, record);
  }
}

export async function browseContinuation(config, token) {
  return fetchJson(`https://www.youtube.com/youtubei/v1/browse?key=${config.apiKey}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-youtube-client-name": "1",
      "x-youtube-client-version": config.clientVersion,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: config.clientVersion,
          hl: "fr",
          gl: "FR",
          visitorData: config.visitorData,
        },
      },
      continuation: token,
    }),
  });
}

export async function discoverVideosFromPage(pageUrl, sourceLabel) {
  const { initialData, config } = await fetchYoutubePageContext(pageUrl);
  const videos = new Map();
  const pendingTokens = collectContinuationTokens(initialData);
  const seenTokens = new Set(pendingTokens);

  addUniqueVideos(videos, collectVideoRenderers(initialData), sourceLabel);

  while (pendingTokens.length > 0) {
    const token = pendingTokens.shift();
    const page = await browseContinuation(config, token);
    addUniqueVideos(videos, collectVideoRenderers(page), `${sourceLabel}:continuation`);
    for (const continuationToken of collectContinuationTokens(page)) {
      if (!seenTokens.has(continuationToken)) {
        seenTokens.add(continuationToken);
        pendingTokens.push(continuationToken);
      }
    }
  }

  return [...videos.values()];
}

export async function fetchOEmbedMetadata(videoUrl) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
  const payload = await fetchJson(oembedUrl);
  return {
    canonicalTitle: payload.title ?? null,
    authorName: payload.author_name ?? null,
    authorUrl: payload.author_url ?? null,
    thumbnailUrl: payload.thumbnail_url ?? null,
  };
}

export async function discoverCandidateVideos({ channelUrl, queries }) {
  const byVideoId = new Map();

  const videosUrl = `${channelUrl.replace(/\/$/, "")}/videos?view=0&sort=dd&shelf_id=0`;
  for (const record of await discoverVideosFromPage(videosUrl, "videos")) {
    byVideoId.set(record.videoId, record);
  }

  for (const query of queries) {
    const searchUrl = `${channelUrl.replace(/\/$/, "")}/search?query=${encodeURIComponent(query)}`;
    for (const record of await discoverVideosFromPage(searchUrl, `search:${query}`)) {
      if (!byVideoId.has(record.videoId)) {
        byVideoId.set(record.videoId, record);
      }
    }
  }

  return [...byVideoId.values()];
}

export async function enrichAndFilterVideos(candidates, includeRegexes) {
  const kept = [];

  for (const candidate of candidates) {
    try {
      const oembed = await fetchOEmbedMetadata(candidate.url);
      const canonicalTitle = oembed.canonicalTitle ?? candidate.title;
      const authorName = oembed.authorName ?? "";
      if (!CANONICAL_AUTHOR_NAMES.has(normalizeText(authorName))) {
        continue;
      }
      if (!shouldIncludeTitle(canonicalTitle, includeRegexes)) {
        continue;
      }

      kept.push({
        ...candidate,
        title: canonicalTitle,
        authorName: oembed.authorName,
        authorUrl: oembed.authorUrl,
        thumbnailUrl: oembed.thumbnailUrl,
      });
    } catch (error) {
      kept.push({
        ...candidate,
        title: candidate.title,
        enrichmentError: error instanceof Error ? error.message : String(error),
        authorName: null,
        authorUrl: null,
        thumbnailUrl: null,
      });
    }
  }

  kept.sort((left, right) => left.title.localeCompare(right.title, "fr"));
  return kept;
}

export async function loadJsonIfExists(targetPath) {
  if (!(await pathExists(targetPath))) {
    return null;
  }

  const raw = await readFile(targetPath, "utf8");
  return JSON.parse(raw);
}

export async function ensurePreferredVideoDirectory(outputDir, videoId, eventDate) {
  const preferred = buildVideoPaths(outputDir, videoId, eventDate);
  const legacy = buildLegacyVideoPaths(outputDir, videoId);

  if (!(await pathExists(preferred.baseDir)) && (await pathExists(legacy.baseDir))) {
    await mkdir(path.dirname(preferred.baseDir), { recursive: true });
    await rename(legacy.baseDir, preferred.baseDir);
  }

  return preferred;
}

export async function resolveVideoPaths(outputDir, videoId, eventDate = null) {
  const preferred = await ensurePreferredVideoDirectory(outputDir, videoId, eventDate);
  if (await pathExists(preferred.baseDir)) {
    return preferred;
  }

  const videosDir = path.join(outputDir, "videos");
  if (!(await pathExists(videosDir))) {
    return preferred;
  }

  const entries = await readdir(videosDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(`__${videoId}`));
  if (match) {
    return buildVideoPaths(outputDir, videoId, match.name.split("__")[0]);
  }

  return preferred;
}

export async function isVideoAlreadyProcessed(paths) {
  try {
    const payload = await loadJsonIfExists(paths.summarize);
    return Boolean(payload?.summary && payload?.extracted?.content);
  } catch {
    return false;
  }
}

export function spawnAndCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`Commande ${command} terminée avec le code ${code}: ${stderr || stdout}`));
    });
  });
}

export function buildSummarizeArgs(videoUrl, options) {
  return [
    videoUrl,
    "--youtube",
    options.youtubeMode,
    "--format",
    options.format,
    "--markdown-mode",
    options.markdownMode,
    "--length",
    options.length,
    "--model",
    options.model,
    "--language",
    options.language,
    "--json",
    "--plain",
  ];
}

export async function runSummarize(videoUrl, options) {
  const { stdout } = await spawnAndCapture("summarize", buildSummarizeArgs(videoUrl, options), {
    cwd: options.cwd,
    env: process.env,
  });
  return JSON.parse(stdout);
}

export function formatSummaryMarkdown(video, summaryText) {
  const eventDate = extractEventDateFromTitle(video.title);
  const summaryBody = formatReadableSummaryBody(summaryText);

  return [
    `# ${video.title}`,
    "",
    `- Date de séance: ${formatEventDateDisplay(eventDate)}`,
    `- ID YouTube: \`${video.videoId}\``,
    `- Vidéo: [${video.url}](${video.url})`,
    video.authorName ? `- Chaîne: ${video.authorName}` : null,
    "",
    "## Résumé",
    "",
    summaryBody,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export function splitIntoSentences(paragraph) {
  return paragraph
    .split(/(?<=[.!?])\s+(?=(?:["«*(_]*[A-ZÀÂÇÉÈÊËÎÏÔÛÙÜŸ]|["«]))/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function rebalanceParagraph(paragraph, maxLength = 450, maxSentences = 2) {
  const sentences = splitIntoSentences(paragraph);
  if (sentences.length <= maxSentences && paragraph.length <= maxLength) {
    return [paragraph.trim()];
  }

  const chunks = [];
  let current = [];

  for (const sentence of sentences) {
    const candidate = [...current, sentence].join(" ");
    if (current.length >= maxSentences || (candidate.length > maxLength && current.length > 0)) {
      chunks.push(current.join(" "));
      current = [sentence];
      continue;
    }
    current.push(sentence);
  }

  if (current.length > 0) {
    chunks.push(current.join(" "));
  }

  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
}

export function formatReadableSummaryBody(summaryText) {
  return String(summaryText ?? "")
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap((paragraph) => rebalanceParagraph(paragraph))
    .join("\n\n");
}

export async function processVideo(video, options) {
  const eventDate = extractEventDateFromTitle(video.title);
  const paths = await resolveVideoPaths(options.outputDir, video.videoId, eventDate);
  const alreadyProcessed = !options.force && (await isVideoAlreadyProcessed(paths));
  const now = new Date().toISOString();

  const metadata = {
    videoId: video.videoId,
    eventDate,
    url: video.url,
    title: video.title,
    source: video.source,
    publishedText: video.publishedText ?? null,
    authorName: video.authorName ?? null,
    authorUrl: video.authorUrl ?? null,
    thumbnailUrl: video.thumbnailUrl ?? null,
    updatedAt: now,
  };

  await mkdir(paths.baseDir, { recursive: true });
  await writeJsonAtomic(paths.metadata, metadata);

  if (alreadyProcessed) {
    const existing = await loadJsonIfExists(paths.summarize);
    if (existing?.summary) {
      await writeFileAtomic(paths.summary, formatSummaryMarkdown(video, existing.summary));
    }
    if (existing?.extracted?.content) {
      await writeFileAtomic(paths.transcript, `${String(existing.extracted.content).trim()}\n`);
    }
    return {
      videoId: video.videoId,
      title: video.title,
      url: video.url,
      status: "skipped",
      updatedAt: now,
      paths,
      error: null,
    };
  }

  try {
    const summarizeJson = await runSummarize(video.url, options);
    if (!summarizeJson?.summary || !summarizeJson?.extracted?.content) {
      throw new Error("Réponse summarize invalide: champs summary/extracted.content manquants.");
    }

    await writeJsonAtomic(paths.summarize, summarizeJson);
    await writeFileAtomic(paths.summary, formatSummaryMarkdown(video, summarizeJson.summary));
    await writeFileAtomic(paths.transcript, `${String(summarizeJson.extracted.content).trim()}\n`);

    return {
      videoId: video.videoId,
      title: video.title,
      url: video.url,
      status: "done",
      updatedAt: now,
      paths,
      error: null,
    };
  } catch (error) {
    await rm(paths.summarize, { force: true });
    await rm(paths.summary, { force: true });
    await rm(paths.transcript, { force: true });
    return {
      videoId: video.videoId,
      title: video.title,
      url: video.url,
      status: "failed",
      updatedAt: now,
      paths,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseArgs(argv) {
  const config = {
    channelUrl: DEFAULT_CHANNEL_URL,
    outputDir: DEFAULT_OUTPUT_DIR,
    model: DEFAULT_MODEL,
    length: DEFAULT_LENGTH,
    language: DEFAULT_LANGUAGE,
    youtubeMode: DEFAULT_YOUTUBE_MODE,
    format: DEFAULT_FORMAT,
    markdownMode: DEFAULT_MARKDOWN_MODE,
    force: false,
    limit: null,
    queries: [...DEFAULT_QUERIES],
    includePatterns: [...DEFAULT_INCLUDE_PATTERNS],
    cwd: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--channel":
        config.channelUrl = next;
        index += 1;
        break;
      case "--out":
        config.outputDir = next;
        index += 1;
        break;
      case "--model":
        config.model = next;
        index += 1;
        break;
      case "--length":
        config.length = next;
        index += 1;
        break;
      case "--language":
        config.language = next;
        index += 1;
        break;
      case "--youtube":
        config.youtubeMode = next;
        index += 1;
        break;
      case "--format":
        config.format = next;
        index += 1;
        break;
      case "--markdown-mode":
        config.markdownMode = next;
        index += 1;
        break;
      case "--limit":
        config.limit = Number.parseInt(next, 10);
        index += 1;
        break;
      case "--force":
        config.force = true;
        break;
      case "--query":
        config.queries.push(next);
        index += 1;
        break;
      case "--include-regex":
        config.includePatterns.push(next);
        index += 1;
        break;
      case "--help":
      case "-h":
        config.help = true;
        break;
      default:
        throw new Error(`Option inconnue: ${arg}`);
    }
  }

  if (config.limit !== null && !Number.isInteger(config.limit)) {
    throw new Error("--limit doit être un entier.");
  }

  return config;
}

export function renderHelp() {
  return `Usage:
  mise exec node@24.14.0 -- node scripts/summarize-council-videos.mjs [options]

Options:
  --channel <url>         URL de la chaine YouTube
  --out <dir>             Dossier de sortie (defaut: ${DEFAULT_OUTPUT_DIR})
  --model <name>          Modele summarize (defaut: ${DEFAULT_MODEL})
  --length <preset>       Longueur du resume (defaut: ${DEFAULT_LENGTH})
  --language <code>       Langue de sortie (defaut: ${DEFAULT_LANGUAGE})
  --youtube <mode>        Mode YouTube summarize (defaut: ${DEFAULT_YOUTUBE_MODE})
  --format <format>       Format summarize (defaut: ${DEFAULT_FORMAT})
  --markdown-mode <mode>  Markdown mode summarize (defaut: ${DEFAULT_MARKDOWN_MODE})
  --limit <n>             Limiter le nombre de videos traitees
  --force                 Retraiter les videos deja completees
  --query <text>          Ajouter une requete de recherche YouTube
  --include-regex <expr>  Ajouter une regex de filtrage sur les titres
  --help                  Afficher cette aide
`;
}

export async function runBatch(options) {
  const includeRegexes = compileIncludePatterns(options.includePatterns);
  const outputDir = path.resolve(options.cwd, options.outputDir);
  const manifestPath = path.join(outputDir, "manifest.json");

  await mkdir(outputDir, { recursive: true });

  const candidates = await discoverCandidateVideos({
    channelUrl: options.channelUrl,
    queries: options.queries,
  });
  const filtered = await enrichAndFilterVideos(candidates, includeRegexes);
  const selected = options.limit === null ? filtered : filtered.slice(0, options.limit);
  const selectedIds = new Set(selected.map((video) => video.videoId));

  const results = [];
  for (const video of selected) {
    console.error(`Traitement ${video.videoId} - ${video.title}`);
    results.push(
      await processVideo(video, {
        ...options,
        outputDir,
      }),
    );
  }
  const resultsById = new Map(results.map((result) => [result.videoId, result]));

  const manifest = {
    channel: options.channelUrl,
    queries: options.queries,
    generatedAt: new Date().toISOString(),
    videos: filtered.map((video) => {
      const processed = resultsById.get(video.videoId);
      const paths = buildVideoPaths(outputDir, video.videoId, extractEventDateFromTitle(video.title));
      const status = processed?.status ?? (selectedIds.has(video.videoId) ? "failed" : "pending");
      return {
        videoId: video.videoId,
        title: video.title,
        url: video.url,
        status,
        updatedAt: processed?.updatedAt ?? null,
        error: processed?.error ?? null,
        paths: {
          metadata: path.relative(outputDir, paths.metadata),
          summarize: path.relative(outputDir, paths.summarize),
          summary: path.relative(outputDir, paths.summary),
          transcript: path.relative(outputDir, paths.transcript),
        },
      };
    }),
  };

  await writeJsonAtomic(manifestPath, manifest);
  return manifest;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(renderHelp());
    return;
  }

  const manifest = await runBatch(options);
  const summary = manifest.videos.reduce(
    (accumulator, video) => {
      accumulator[video.status] = (accumulator[video.status] ?? 0) + 1;
      return accumulator;
    },
    { done: 0, skipped: 0, failed: 0 },
  );

  process.stdout.write(`${JSON.stringify({ outputDir: path.resolve(options.cwd, options.outputDir), summary }, null, 2)}\n`);
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
