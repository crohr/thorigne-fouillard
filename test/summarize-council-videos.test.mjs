import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";

import {
  buildVideoFolderName,
  buildVideoPaths,
  collectContinuationTokens,
  collectVideoRenderers,
  compileIncludePatterns,
  extractEventDateFromTitle,
  formatReadableSummaryBody,
  formatSummaryMarkdown,
  isVideoAlreadyProcessed,
  shouldIncludeTitle,
  stripDiacritics,
  videoRendererToRecord,
} from "../scripts/summarize-council-videos.mjs";

test("stripDiacritics normalizes French titles", () => {
  assert.equal(stripDiacritics("Thorigné-Fouillard"), "Thorigne-Fouillard");
});

test("extractEventDateFromTitle handles French council titles", () => {
  assert.equal(extractEventDateFromTitle("Conseil Municipal - Lundi 30 Juin 2025 à 20h30"), "2025-06-30");
  assert.equal(extractEventDateFromTitle("Conseil Municipal - Lundi24 Mars 2025 à 20h30"), "2025-03-24");
  assert.equal(extractEventDateFromTitle("Conseil Municipal - Lundi 1er Juillet 2024 à 20h30"), "2024-07-01");
});

test("buildVideoFolderName prefixes video directory with date", () => {
  assert.equal(buildVideoFolderName("jD0DlPXuAcQ", "2025-06-30"), "2025-06-30__jD0DlPXuAcQ");
  assert.equal(buildVideoPaths("/tmp/out", "jD0DlPXuAcQ", "2025-06-30").baseDir, "/tmp/out/videos/2025-06-30__jD0DlPXuAcQ");
});

test("shouldIncludeTitle keeps conseil municipal and excludes voeux", () => {
  const regexes = compileIncludePatterns([
    "^conseil municipal\\b",
    "election des colleges electoraux",
  ]);

  assert.equal(shouldIncludeTitle("Conseil Municipal - Lundi 30 Juin 2025 à 20h30", regexes), true);
  assert.equal(
    shouldIncludeTitle("Election des collèges électoraux pour l'élection des sénateurs", regexes),
    true,
  );
  assert.equal(shouldIncludeTitle("Vœux 2026 Thorigné-Fouillard", regexes), false);
});

test("collectVideoRenderers and collectContinuationTokens walk nested youtube payloads", () => {
  const payload = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        contents: [
                          {
                            videoRenderer: {
                              videoId: "jD0DlPXuAcQ",
                              title: { runs: [{ text: "Conseil Municipal - Lundi 30 Juin 2025 à 20h30" }] },
                            },
                          },
                        ],
                      },
                    },
                    {
                      continuationItemRenderer: {
                        continuationEndpoint: {
                          continuationCommand: {
                            token: "NEXT_TOKEN",
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };

  const renderers = collectVideoRenderers(payload);
  const tokens = collectContinuationTokens(payload);

  assert.equal(renderers.length, 1);
  assert.equal(tokens.length, 1);
  assert.equal(videoRendererToRecord(renderers[0], "test").videoId, "jD0DlPXuAcQ");
  assert.equal(tokens[0], "NEXT_TOKEN");
});

test("formatSummaryMarkdown wraps the summary in readable markdown", () => {
  const markdown = formatSummaryMarkdown(
    {
      videoId: "jD0DlPXuAcQ",
      title: "Conseil Municipal - Lundi 30 Juin 2025 à 20h30",
      url: "https://www.youtube.com/watch?v=jD0DlPXuAcQ",
      authorName: "Ville de Thorigné-Fouillard",
    },
    "Premier paragraphe.\n\nSecond paragraphe.",
  );

  assert.match(markdown, /^# Conseil Municipal - Lundi 30 Juin 2025 à 20h30/m);
  assert.match(markdown, /## Résumé/);
  assert.match(markdown, /30 juin 2025/i);
  assert.match(markdown, /Premier paragraphe\.\n\nSecond paragraphe\./);
});

test("formatReadableSummaryBody splits dense paragraphs into shorter blocks", () => {
  const body = formatReadableSummaryBody(
    "Phrase 1. Phrase 2. Phrase 3. Phrase 4.\n\nAutre bloc court.",
  );

  assert.equal(body, "Phrase 1. Phrase 2.\n\nPhrase 3. Phrase 4.\n\nAutre bloc court.");
});

test("isVideoAlreadyProcessed requires both summary and transcript content", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "council-videos-"));
  const paths = buildVideoPaths(tempDir, "abc123def45", "2025-01-01");
  await mkdir(path.dirname(paths.summarize), { recursive: true });

  assert.equal(await isVideoAlreadyProcessed(paths), false);

  await writeFile(paths.summarize, JSON.stringify({ summary: "ok", extracted: { content: "Transcript" } }));
  assert.equal(await isVideoAlreadyProcessed(paths), true);

  await writeFile(paths.summarize, "{not json");
  assert.equal(await isVideoAlreadyProcessed(paths), false);
});
