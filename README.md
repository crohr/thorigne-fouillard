# Thorigné-Fouillard

Projet de travail local pour récupérer, transcrire, résumer et analyser les vidéos des conseils municipaux de la ville de Thorigné-Fouillard à partir de leur chaîne YouTube.

## Contenu du dépôt

- `scripts/summarize-council-videos.mjs`: batch Node qui découvre les vidéos de la chaîne, appelle `summarize` et stocke les résultats localement
- `data/conseils-municipaux/manifest.json`: index des vidéos traitées
- `data/conseils-municipaux/videos/`: un dossier par vidéo au format `YYYY-MM-DD__<videoId>`
- `synthese-tensions-et-consensus.md`: synthèse narrative des grands points de friction et de consensus
- `index-seances-par-niveau-de-conflit.md`: codage de chaque séance en `consensuel`, `abstentions`, `conflit ouvert`
- `THEMES.md`: synthèse par grand thème

## Prérequis

- [`mise`](https://mise.jdx.dev/)
- le binaire `summarize` installé en local et configuré avec les accès nécessaires
- Node 24 via `mise`

Le dépôt épingle déjà Node dans [`.mise.toml`](.mise.toml).

## Utilisation

### Lancer les tests

```bash
mise exec node@24.14.0 -- node --test test/*.test.mjs
```

### Générer ou reprendre les résumés

```bash
mise exec node@24.14.0 -- node scripts/summarize-council-videos.mjs \
  --out ./data/conseils-municipaux
```

Le script est incrémental:

- il saute les vidéos déjà traitées quand `summarize.json` est valide
- il reprend automatiquement les vidéos manquantes ou corrompues
- il peut être relancé sans retraiter tout le corpus

### Options utiles

```bash
mise exec node@24.14.0 -- node scripts/summarize-council-videos.mjs --help
```

Options principales:

- `--channel`
- `--out`
- `--limit`
- `--force`
- `--query`
- `--include-regex`
- `--model`
- `--length`
- `--language`

## Structure des données

Chaque vidéo produit:

- `metadata.json`
- `summarize.json`
- `summary.md`
- `transcript.txt`

Exemple:

- [`data/conseils-municipaux/videos/2025-06-30__jD0DlPXuAcQ/summary.md`](data/conseils-municipaux/videos/2025-06-30__jD0DlPXuAcQ/summary.md)
- [`data/conseils-municipaux/videos/2025-06-30__jD0DlPXuAcQ/transcript.txt`](data/conseils-municipaux/videos/2025-06-30__jD0DlPXuAcQ/transcript.txt)

## Analyses disponibles

- [Synthèse tensions / consensus](synthese-tensions-et-consensus.md)
- [Index des séances par niveau de conflit](index-seances-par-niveau-de-conflit.md)
- [Tableau par thèmes](THEMES.md)

## Notes

- Le codage politique des séances est une synthèse à partir des résumés, pas une qualification juridique de chaque vote.
- Deux vidéos datées de mars 2026 apparaissent dans le corpus alors que la date courante de travail était le 13 mars 2026; elles sont donc à relire avec prudence.
