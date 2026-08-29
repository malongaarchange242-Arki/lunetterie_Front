# La Lunetterie — Page de connexion
## Spécification pour reconstruction dans Figma

---

## 0. Ce que tu dois fournir à l'agent Figma

**Fichiers**
1. Le logo La Lunetterie — **en PNG à fond transparent ou en SVG**. Le fichier actuel est un JPEG sur fond blanc : dans Figma il apparaîtra comme un carré blanc sur le fond noir. À défaut, l'agent devra le détourer.
2. Une capture de la page en 1440×900 comme référence visuelle.
3. Ce document, tel quel.

**Polices à installer avant de commencer** (toutes gratuites, Google Fonts)
- Sora — titres
- Manrope — texte d'interface
- JetBrains Mono — codes, compteurs, sur-titres

**À préciser à l'agent**
- Frame de travail : 1440 × 900 (desktop). La mise en page est fluide, les pourcentages ci-dessous sont relatifs.
- Figma ne peut pas reproduire deux choses : la rotation continue d'un dégradé conique, et le flou d'arrière-plan calculé en temps réel. Les approximations acceptables sont indiquées section 8.

---

## 1. Fondations

| | Valeur |
|---|---|
| Fond de page | `#0D0D0D` |
| Magenta action | `#F2138E` |
| Magenta profond | `#BF2178` |
| Cyan sélection | `#5FC2D9` |
| Blanc texte | `#F2F2F2` |
| Prune (encre sur rose) | `#5E123C` |
| Rose dôme | `#F7D6E7` |

**Règle de couleur** : le magenta ne sert qu'à l'action et à l'alerte. Le cyan ne sert qu'à la sélection et à la donnée. Aucune autre couleur n'est introduite.

**Rayons** : champs et boutons `999px` (pilules), conteneur logo `16px`, bannière d'erreur `16px`. Aucun angle vif.

**Opacités du blanc** (à utiliser au lieu de gris) : 100 % titres · 62 % libellés · 55 % descriptions · 40 % sur-titres · 34 % placeholders.

---

## 2. Structure

Deux colonnes superposées en absolu sur le fond noir.

- **Colonne gauche** — largeur `46 %`, hauteur totale, marge intérieure `26px 44px`. Trois blocs empilés en `space-between` : en-tête, formulaire, pied.
- **Panneau droit** — largeur `54 %`, ancré à droite. Contient le dôme, la molette, l'anneau et les contrôles.

---

## 3. Décor de fond (couche la plus basse)

Quatre calques sur le noir `#0D0D0D`, tous non cliquables :

1. Deux dégradés radiaux fixes : magenta `rgba(242,19,142,.16)` en haut à gauche (1000×700), cyan `rgba(95,194,217,.12)` en bas (900×700).
2. **Sphère A** — 620×620, cercle, `rgba(242,19,142,.30)` au centre vers transparent à 68 %, flou `60px`. Position : top `-180`, left `-140`.
3. **Sphère B** — 660×660, cercle, `rgba(95,194,217,.20)`, flou `70px`. Position : bottom `-240`, left `6 %`.
4. **Grille** — lignes de `1px` en `rgba(242,242,242,.03)`, maille `88px`, masquée en dégradé radial pour s'effacer sur les bords.

---

## 4. Colonne gauche

### En-tête
- Vignette logo `52×52`, rayon `16px`, fond `#F2F2F2`, image en `cover`, ombre `0 10px 28px -12px rgba(0,0,0,.8)` + reflet interne `inset 0 1px 0 rgba(255,255,255,.5)`.
- `LA LUNETTERIE` — Sora 600, 15px, interlettrage `+0.02em`.
- `SUIVI DE STOCK` — JetBrains Mono 500, 9.5px, interlettrage `+0.2em`, blanc 40 %.
- Filet vertical `1px × 34px` en blanc 14 %, puis `CONNEXION` — JetBrains Mono 500, 11px, `+0.22em`, `#5FC2D9`.
- Gap `16px` entre les éléments.

### Bloc rôle (change avec la molette)
Ligne horizontale, gap `20px`, largeur max `400px`.

**Avatar** — cercle `84px` :
- Fond : dégradé radial à `32 % 28 %` → `#3A3A3A` puis `#141414` à 62 % puis `#0A0A0A`.
- Bordure `1px rgba(255,255,255,.16)`.
- Ombres cumulées : `0 26px 54px -20px rgba(0,0,0,.95)`, halo magenta `0 0 0 8px rgba(242,19,142,.10)`, lueur `0 0 42px -14px rgba(242,19,142,.6)`, reflet `inset 0 1px 0 rgba(255,255,255,.24)`.
- Reflet en surimpression : dégradé linéaire `155deg` de `rgba(255,255,255,.28)` vers transparent à 52 %.
- Icône Lucide au centre, `34px`, blanc.

**Texte**, à droite :
- Sur-titre — JetBrains Mono 500, 10px, `+0.2em`, `#5FC2D9`. Ex. `RÔLE · STOCK GÉNÉRAL`.
- Titre — Sora 600, 22px, interlettrage `-0.028em`.
- Description — Manrope 300, 12.5px, interligne 1.5, blanc 55 %.

Séparateur en dessous : filet `1px`, dégradé horizontal de blanc 16 % vers transparent.

### Champs
Deux pilules identiques, gap `12px` :
- Rayon `999px`, marge intérieure `15px 18px`, gap interne `13px`.
- Repos : fond `rgba(255,255,255,.05)`, bordure `1.5px rgba(255,255,255,.13)`, reflet `inset 0 1px 0 rgba(255,255,255,.12)`, flou d'arrière-plan `22px` + saturation `150 %`.
- Rempli : bordure passe à `rgba(255,255,255,.2)`.
- **Focus** : bordure `1.5px #5FC2D9`, anneau `0 0 0 4px rgba(95,194,217,.15)`, fond `rgba(255,255,255,.08)`, icône de gauche passe au cyan.
- Icônes `17px` : `user` et `lock`. Le champ mot de passe porte un bouton œil `30px` à droite (`eye` / `eye-off`).
- Texte saisi : Manrope 500, 14.5px. Placeholder : blanc 34 %.

### Ligne d'options
- Case à cocher `20px`, rayon `7px`. Cochée : fond et bordure `#5FC2D9`, coche `#08252C`. Décochée : fond blanc 5 %, bordure `1.5px` blanc 24 %.
- `Rester connecté` — Manrope 500, 12.5px, blanc 62 %.
- `Mot de passe oublié` à droite — Manrope 500, 12.5px, `#5FC2D9` ; au survol `#F2138E`.

### Bouton principal
- Pleine largeur, rayon `999px`, marge intérieure `16px 26px`.
- Fond : dégradé linéaire `145deg` `#F2138E` → `#BF2178`.
- Bordure `1px rgba(255,255,255,.24)`.
- Ombre `0 18px 40px -14px rgba(242,19,142,.9)` + reflet `inset 0 1px 0 rgba(255,255,255,.45)`.
- Libellé Manrope 600, 15px, blanc, centré, avec icône `arrow-right` 17px à gauche.
- **État chargement** : dégradé `#D91B81` → `#8F1A5B`, libellé `Connexion…`, icône remplacée par un anneau de `17px` (bordure `2px` blanc 32 %, haut blanc plein) qui tourne.

### Bannière d'erreur (sous le bouton, conditionnelle)
Fond `rgba(242,19,142,.12)`, bordure `1px rgba(242,19,142,.38)`, rayon `16px`, marge `13px 16px`, icône `triangle-alert` `16px` et texte Manrope 500 12.5px, tous deux en `#F55FAB`.

### Pied
`LA LUNETTERIE` (Sora 600, 14px, `+0.02em`, blanc 85 %) et `mieux voir, mieux vivre` (Manrope 300, 15px, italique, blanc 45 %), gap `34px`, alignés sur la ligne de base.

---

## 5. Le dôme

Un cercle unique, débordant largement du cadre à droite.

- Diamètre : `155 %` de la largeur du panneau droit. Position : `left 6 %`, centré verticalement, la moitié droite sort de l'écran.
- Fond : dégradé radial centré à `26 % 30 %` → `#F7D6E7` puis `rgba(247,214,231,.62)` à 52 % puis `rgba(191,33,120,.34)` à 88 %.
- Bordure `2px rgba(255,255,255,.5)`.
- Flou d'arrière-plan `30px`, saturation `160 %`.
- Ombres : lueur externe `0 60px 140px -50px rgba(242,19,142,.85)`, reflet supérieur `inset 0 2px 0 rgba(255,255,255,.6)`, ombrage droit `inset -40px 0 90px -40px rgba(191,33,120,.5)`.
- Reflet ajouté par-dessus : dégradé radial à `22 % 24 %`, `rgba(255,255,255,.22)` vers transparent à 46 %.

---

## 6. La molette de rôles

### Géométrie
Les pastilles sont posées sur un arc de cercle. Pour chaque rôle d'indice `i`, avec `pos` la position courante du tambour (valeur décimale) :

```
offset = i − pos
angle  = offset × 17°
x      = 330 × (1 − cos(angle))
y      = 330 × sin(angle)
échelle = 1 − 0,06 × |offset|
opacité = max(0,7 ; 1 − 0,13 × |offset|)
```

- Rayon de l'arc : `330px`. Écart angulaire : `17°` par rôle.
- Point d'ancrage de chaque pastille : `left: 0`, `top: 50 %`, origine de transformation `0 50 %`. Le couloir des pastilles est décalé de `9 %` depuis le bord gauche du panneau.
- **Aucune rotation du texte.** Seule la position suit la courbe. C'est important : les versions inclinées ont été rejetées.
- Le rôle actif est celui dont `|offset|` est le plus petit ; il se retrouve au point le plus à gauche de l'arc, aligné sur l'axe vertical central.

### Pastille
- Rayon `999px`, marge intérieure `14px 20px`, gap interne `10px`, largeur max `274px`.
- Texte Manrope 600, 13.5px. Icône Lucide `17px` à gauche.
- **Active** : fond dégradé `145deg` `#F2138E` → `#BF2178`, texte blanc, bordure `1px rgba(255,255,255,.55)`, ombre `0 20px 44px -14px rgba(191,33,120,.75)` + reflet `inset 0 1px 0 rgba(255,255,255,.55)`, plus une pastille ronde blanche de `8px` à l'extrémité droite avec lueur `0 0 12px rgba(255,255,255,.9)`.
- **Inactive** : fond dégradé `145deg` de `rgba(255,255,255,.72)` vers `rgba(255,255,255,.44)`, texte `#5E123C`, bordure `1px rgba(255,255,255,.6)`, ombre `0 8px 20px -14px rgba(191,33,120,.4)`.
- Transition entre les deux : `340ms`, courbe `cubic-bezier(.22, 1, .36, 1)`.

### Contenu (verbatim, ne pas reformuler)

| Rôle | Sur-titre | Icône Lucide |
|---|---|---|
| Magasinier stock Generale | `RÔLE · STOCK GÉNÉRAL` | `glasses` |
| Magasinier Pre-enregistrment | `RÔLE · PRÉ-ENREGISTREMENT` | `clipboard-list` |
| Admin | `RÔLE · ADMINISTRATEUR` | `shield-check` |

Descriptions associées :
- Suivi des montures et verres en stock, entrées et sorties, inventaire tournant en boutique.
- Déclaration des arrivages fournisseurs avant contrôle physique et mise en rayon.
- Gestion des utilisateurs, des seuils d'alerte, des tarifs et des exports comptables.

### Contrôles annexes
- **Chevrons** en bas à droite : deux cercles `42px`, fond `rgba(255,255,255,.55)`, bordure `1px rgba(94,18,60,.28)`, icône `#5E123C`, ombre `0 8px 20px -12px rgba(94,18,60,.6)`. Au survol : fond `#5E123C`, icône `#F2F2F2`, remontée de `2px`. Entre les deux, le compteur `1 / 3` en JetBrains Mono 500 10.5px, `rgba(13,13,13,.75)`.
- **Légende** en haut à droite : `CHOISIR UN RÔLE` (JetBrains Mono 500, 10px, `+0.2em`, `#5E123C`) et `glisser · molette · ↑↓` (Manrope 500, 11.5px, `rgba(13,13,13,.72)`).

---

## 7. L'anneau holographique

Décoratif, à droite des pastilles. Diamètre `178px`, ancré à `8px` du bord droit, centré verticalement. **Quatre calques concentriques superposés**, tous en anneau (le centre est vide) :

1. **Rail** (dessous) — bande de `11px`, dégradé conique de blancs alternés entre 45 % et 90 % d'opacité, ombre portée `0 22px 44px -20px rgba(94,18,60,.75)`. C'est lui qui donne le relief.
2. **Halo** — bande de `30px` débordant de `10px` vers l'extérieur, dégradé conique blanc → magenta → cyan, flou `13px`, opacité `85 %`.
3. **Arc chromatique** — bande de `11px`, dégradé conique : transparent → blanc plein à `16°` → `#5FC2D9` à `38°` → `#F2138E` à `62°` → `#BF2178` (95 %) à `88°` → cyan 45 % à `124°` → transparent à `178°`, le reste transparent. Saturation `150 %`.
4. **Liseré interne** (dessus) — bande de `2px` en retrait de `10px`, dégradé linéaire `160deg` de blanc 95 % vers blanc 15 % puis `rgba(94,18,60,.35)`. Simule l'épaisseur du verre.

L'angle de départ des calques 2 et 3 vaut `300° + pos × 51°`, donc l'arc tourne **trois fois plus vite** que le tambour.

---

## 8. Animations

| Nom | Cible | Durée | Courbe | Description |
|---|---|---|---|---|
| Défilement molette | position du tambour | continu | amortissement exponentiel | `pos += (cible − pos) × 0,14` à chaque image. Pas de ressort, donc **aucun rebond**. |
| Aimantation | position du tambour | `90ms` après la fin du geste | — | La cible devient l'entier le plus proche, puis le défilement l'atteint. |
| Débord élastique | position du tambour | — | — | La liste bute aux extrémités avec `0,4` rôle de débord, puis revient. |
| Rotation de l'arc | anneau, calques 2-3 | continu | linéaire | Angle = `300° + pos × 51°`. |
| `domeBreathe` | dôme | `16s` | ease-in-out, infini | Translation horizontale `0 → −8px` et échelle `1 → 1,015`. |
| `avatarFloat` | avatar | `9s` | ease-in-out, infini | `rotateY −9° → 9°`, `rotateX 5° → −4°`, `translateZ 0 → 16px`, en perspective `900px`. |
| `orbA` | sphère magenta | `22s` | ease-in-out, infini | Translation `0 → 50px, −70px`, échelle `1 → 1,14`. |
| `orbB` | sphère cyan | `26s` | ease-in-out, infini | Translation `0 → −60px, 60px`, échelle `1,06 → 0,9`. |
| `rise` | colonne gauche, bannière d'erreur | `500ms` / `300ms` | `cubic-bezier(.22, 1, .36, 1)` | Opacité `0 → 1`, translation `16px → 0`. |
| `spin` | anneau de chargement | `800ms` | linéaire, infini | Rotation `360°`. |
| Survol général | boutons, pastilles | `260 – 340ms` | `cubic-bezier(.22, 1, .36, 1)` | Éclaircissement du fond, remontée de `1 – 2px`. |

**Sensibilité du geste** : environ `232px` de défilement au trackpad par rôle. Chaque événement est plafonné à `18px` pour éviter l'emballement.

**Courbe unique du système** : `cubic-bezier(.22, 1, .36, 1)`. Elle démarre vite et se pose lentement — c'est ce qui donne la sensation de masse liquide. À utiliser partout sauf pour les rotations, qui sont linéaires.

### Ce que Figma ne sait pas faire, et par quoi remplacer

| Effet | Substitut dans Figma |
|---|---|
| Rotation d'un dégradé conique | Créer l'anneau comme un calque unique et l'animer en rotation via Smart Animate entre deux frames. |
| Flou d'arrière-plan temps réel | `Background blur` de Figma sur chaque calque de verre. Valeurs de la spec directement transposables. |
| Défilement continu avec inertie | Un prototype à 3 frames (un par rôle) reliées par Smart Animate en `400ms`, courbe `Ease out`. Le rendu ne sera pas identique mais l'intention passe. |
| Animations en boucle infinie | Aller-retour Smart Animate entre deux frames avec `After delay` à `0ms`. |

---

## 9. États à produire

1. Repos, rôle 1 sélectionné.
2. Rôle 2 sélectionné (vérifier que l'avatar, l'icône, le sur-titre, le titre et la description changent tous).
3. Rôle 3 sélectionné.
4. Champ identifiant en focus.
5. Bouton en cours de chargement.
6. Bannière d'erreur affichée.

---

## 10. Règles à ne pas transgresser

- Le magenta n'est jamais utilisé pour marquer une sélection — c'est le rôle du cyan. Un rôle actif est magenta parce qu'il **est** l'action, pas parce qu'il est coché.
- Aucun texte n'est incliné.
- Aucun angle vif : tout est en pilule ou en cercle.
- Les noms de rôles sont repris mot pour mot, y compris `Magasinier Pre-enregistrment`.
- Le dôme sort du cadre à droite ; il n'est jamais entièrement visible.
- Un seul bouton magenta plein par écran.
