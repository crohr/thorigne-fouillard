# Thorigné-Fouillard

Projet de travail local pour récupérer, transcrire, résumer et analyser les vidéos des conseils municipaux de la ville de Thorigné-Fouillard à partir de leur chaîne YouTube.

## Analyses disponibles

- [Synthèse tensions / consensus](synthese-tensions-et-consensus.md)
- [Index des séances par niveau de conflit](index-seances-par-niveau-de-conflit.md)
- [Tableau par thèmes](THEMES.md)
- [Dossiers thématiques détaillés](themes/README.md)
- [Historique du Bistroc](themes/bistroc.md)
- [Urbanisme, foncier et ZAC multisite](themes/urbanisme-zac-multisite.md)
- [Budget et investissements](themes/budget-et-investissements.md)
- [Gouvernance et transparence](themes/gouvernance-et-transparence.md)
- [Social, CCAS, EHPAD et logements d'urgence](themes/social-ccas-ehpad-logements.md)
- [Trois raquettes et padel](themes/trois-raquettes-et-padel.md)
- [Historique de la salle de billard](themes/salle-de-billard.md)
- [Dossier des transcripts et résumés par séance](data/conseils-municipaux/videos/)

## Contenu du dépôt

- `scripts/summarize-council-videos.mjs`: batch Node qui découvre les vidéos de la chaîne, appelle `summarize` et stocke les résultats localement
- `data/conseils-municipaux/manifest.json`: index des vidéos traitées
- `data/conseils-municipaux/videos/`: un dossier par vidéo au format `YYYY-MM-DD__<videoId>`
- `synthese-tensions-et-consensus.md`: synthèse narrative des grands points de friction et de consensus
- `index-seances-par-niveau-de-conflit.md`: codage de chaque séance en `consensuel`, `abstentions`, `conflit ouvert`
- `THEMES.md`: synthèse par grand thème
- `themes/`: dossiers thématiques détaillés par sujet

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

## Notes

- Les transcriptions, résumés et analyses de ce dépôt sont générés par IA. Ils permettent de parcourir rapidement le corpus, mais doivent être revérifiés à partir des vidéos sources et des documents officiels si un point précis compte.
- Le codage politique des séances est une synthèse à partir des résumés, pas une qualification juridique de chaque vote.
