# Erreurs de type-check (`tsc --noEmit`) — corrigées

Relevées le 2026-08-19, avant mes modifications sur `renderLocalStock` /
`selectStockScope` — aucune n'était liée à ce changement (elles étaient en
dehors des zones touchées, confirmé via `git diff -w --ignore-cr-at-eol`).
**Les deux bugs ci-dessous ont été corrigés** ; `tsc --noEmit` ne renvoie
plus rien.

```bash
node node_modules/typescript/bin/tsc --noEmit
```

## 1. Import manquant dans `src/App.tsx` (8 erreurs)

`src/dashboardMetrics.ts` exporte `computeReferenceLocationBreakdown` et
`criticalReferenceRows`, mais `App.tsx` ne les importe pas — seul
`summarizeStockSummary` est importé en ligne 3 :

```ts
import { summarizeStockSummary } from './dashboardMetrics'
```

Les deux fonctions sont pourtant utilisées telles quelles :

| Ligne | Usage |
|---|---|
| [App.tsx:1638](src/App.tsx#L1638) | `computeReferenceLocationBreakdown(glasses, stationCityMap)` |
| [App.tsx:1659](src/App.tsx#L1659) | `criticalReferenceRows(synthetic)` |

Sans l'import, TypeScript ne trouve pas les noms (`TS2304`) et perd le
typage de tout ce qui en dépend en cascade (`entry`, `row` retombent en
`unknown`/`any` implicite → `TS18046`, `TS7006`) :

```
src/App.tsx(1638,35): error TS2304: Cannot find name 'computeReferenceLocationBreakdown'.
src/App.tsx(1655,18): error TS18046: 'entry' is of type 'unknown'.
src/App.tsx(1656,33): error TS18046: 'entry' is of type 'unknown'.
src/App.tsx(1657,18): error TS18046: 'entry' is of type 'unknown'.
src/App.tsx(1659,12): error TS2304: Cannot find name 'criticalReferenceRows'.
src/App.tsx(1659,52): error TS7006: Parameter 'row' implicitly has an 'any' type.
src/App.tsx(1663,53): error TS7006: Parameter 'row' implicitly has an 'any' type.
src/App.tsx(1682,23): error TS7006: Parameter 'row' implicitly has an 'any' type.
```

**Correctif probable** : élargir l'import ligne 3 à

```ts
import { summarizeStockSummary, computeReferenceLocationBreakdown, criticalReferenceRows } from './dashboardMetrics'
```

Écran concerné : la vue « Références critiques » (rupture de stock par
référence), qui ne compile donc pas dans son état actuel.

## 2. Tonalité `'cyan'` inexistante dans `src/responsable.tsx`

[responsable.tsx:2548](src/responsable.tsx#L2548), dans la liste « Montures
prêtes à remettre » (onglet remise client) :

```ts
status: pointee
  ? { label: '✓ pointée', tone: 'green' as const }
  : { label: 'prête', tone: 'cyan' as const },   // ← tone invalide
```

`GlassTableTone` ([GlassTable.tsx:24](src/GlassTable.tsx#L24)) n'accepte que
`'green' | 'slate' | 'amber' | 'blue'` — `'cyan'` n'existe pas dans cette
palette, d'où :

```
src/responsable.tsx(2531,25): error TS2322: ... status: { label: string; tone: "cyan"; } ...
  Types of property 'tone' are incompatible.
    Type '"cyan"' is not assignable to type 'GlassTableTone'.
```

**Correctif probable** : remplacer `'cyan'` par `'blue'` (le plus proche
visuellement dans `TONES`), ou ajouter `'cyan'` à `GlassTableTone` si la
teinte doit être distincte du reste du design system (auquel cas il faut
aussi lui donner une entrée dans `TONES`, [GlassTable.tsx:26](src/GlassTable.tsx#L26)).

## Correctifs appliqués

1. `src/App.tsx:3` — import élargi à `computeReferenceLocationBreakdown` et
   `criticalReferenceRows`.
2. `src/GlassTable.tsx:24` — `'cyan'` ajouté à `GlassTableTone` (et sa
   classe dans `TONES`), plutôt que de changer l'appel en `'blue'` : le
   reste du code (`responsable.tsx:1225`, `labo.tsx:192`, `caisse.tsx:446`)
   utilise déjà cyan pour « Prête », il fallait aligner le type sur cet
   usage plutôt que le contourner.

`tsc --noEmit` ne renvoie plus aucune erreur.
