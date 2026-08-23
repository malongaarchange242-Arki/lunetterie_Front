# La Lunetterie — Frontend React

Gestion de stock pour une chaîne d'opticiens au Congo (Pointe-Noire, Brazzaville).
Chaque monture est suivie **individuellement** par code-barres CODE128, de la réception
fournisseur jusqu'à la vente.

React 19 + Vite 8 + Tailwind v4, sur un backend Go déjà en production.

## Deux frontends, un seul backend

| Dossier | État | Rôle |
|---|---|---|
| `../Pojet la lunetterie/Frontend/` | **en production** | Vanilla JS, ~20 000 lignes, 8 pages. La référence fonctionnelle. |
| `Frontend_React/` | en cours | Le portage. Couvre la Direction et les six postes magasin. |

Le backend Go est un **dépôt distinct**, `../backend/`. Les `cmd/` et `internal/` posés à
la racine de `D:\Pojet la lunetterie` sont une copie ancienne : les routes qu'on y lit ne
sont pas celles qui tournent.

**Avant d'implémenter un comportement métier, va lire son équivalent dans le front
vanilla.** C'est là que vivent les règles réelles (statuts, transitions, libellés,
contrôles). Les fichiers utiles : `presentoir.js` (les postes magasin), `scan.js`
(enregistrement), `direction.js` / `admin.js` (vues d'ensemble), `auth-guard.js` (rôles et
redirections).

## Points d'entrée

Site multi-pages. **Toute nouvelle page doit être déclarée dans `vite.config.ts` →
`build.rollupOptions.input`**, sinon elle renvoie un 404 en production alors qu'elle
marche en dev.

| Fichier | Module | Écran |
|---|---|---|
| `index.html` | `src/entry.tsx` → `src/App.tsx` | Direction (5 500 lignes, monolithe) + sa connexion |
| `magasin.html` | `src/magasin.tsx` | Connexion du magasin : choix du poste puis nom + code |
| `vendeuse.html` | `src/vendeuse.tsx` | Poste Vendeuse |
| `caisse.html` | `src/caisse.tsx` | Poste Caisse : tranche les lignes de proforma |
| `labo.html` | `src/labo.tsx` | Poste Laboratoire : réception, montage, `PRETE_A_LIVRER` |
| `sav.html` | `src/sav.tsx` | Poste SAV : suivi client sur les proformas |
| `responsable.html` | `src/responsable.tsx` | Poste R. Magasin : supervision + mise en présentoir |
| `scan.html` | `src/scan.tsx` | Enregistrement des montures (magasinier) |

`src/main.tsx`, `src/index.html`, `src/login.js`, `src/login.css`, `src/presentoir.html`
et `src/imports/` sont des restes de l'ancien front vanilla. **Rien ne les référence.**
`Labo21.html` à la racine est un brouillon hors build (il charge un script CDN).

## Le parcours de connexion

`login.html` **n'existe plus** : il y a deux portes, et chacune porte sa connexion.

```
index.html ── nom + code PIN (4 ou 6 chiffres) ou empreinte  → Direction
                (SUPER_ADMIN, ADMIN)

magasin.html ── on choisit d'abord son poste, puis nom + code
     │          Le rôle renvoyé par le serveur doit correspondre au poste choisi,
     │          sinon la connexion est refusée en le nommant.
     ├─ VENDEUR ─────────────→ /vendeuse.html
     ├─ CAISSIER ────────────→ /caisse.html
     ├─ LABORATOIRE ─────────→ /labo.html
     ├─ SAV ─────────────────→ /sav.html
     ├─ RESPONSABLE_STATION ─→ /responsable.html
     └─ MAGASINIER ──────────→ /scan.html
```

La table des postes est `POSTES` dans `src/magasin.tsx` : chaque entrée associe un
`role` serveur et un `home`. **Un `home` vide signifie « écran pas encore construit » :
on affiche une confirmation au lieu de rediriger vers un 404.**

### Les verrous de chaque poste

Tous relisent le rôle auprès de `/auth/me` — jamais sur parole depuis `localStorage`.
S'y ajoute `localStorage.poste`, posé par `magasin.html` : sans lui, retour à
`/magasin.html`, sinon l'écran s'ouvrirait en tapant l'URL.

| Écran | Rôle | `poste` exigé |
|---|---|---|
| `vendeuse.html` | `VENDEUR` | `vendeuse` |
| `caisse.html` | `CAISSIER` | `caisse` |
| `labo.html` | `LABORATOIRE` | `labo` |
| `responsable.html` | `RESPONSABLE_STATION` | `responsable` |
| `sav.html` | `SAV` ou `SUPER_ADMIN` | `sav`, sauf `SUPER_ADMIN` |
| `scan.html` | `MAGASINIER` ou `SUPER_ADMIN` | — |

`SUPER_ADMIN` entre par la Direction, où rien ne pose `poste` : l'en dispenser est la
seule façon de lui laisser consulter `sav.html` et `scan.html`. Le magasinier, lui, va de
la connexion à sa caméra sans écran intermédiaire et n'en ressort pas de la journée.

### Clés `localStorage`

`token` · `user` · `poste` · `loginName`

`loginName` est **la chaîne de nom exacte que le serveur a acceptée**. Ne la reconstruis
pas depuis `first_name` + `last_name` : l'ordre attendu par `/auth/check-user` est
« NOM Prénom », pas l'inverse. Par empreinte il n'y a pas de nom saisi, la clé est
effacée et le champ retombe sur la fiche employé — c'est pourquoi il reste modifiable.

## Rôles

`SUPER_ADMIN` (8 = `SUPER_DIRECTEUR`) · `ADMIN` (7 = `DIRECTION`) · `MAGASINIER` ·
`VENDEUR` · `LABORATOIRE` · `RESPONSABLE_STATION` · `CAISSIER` · `SAV`

Le serveur renvoie tantôt `role_name`, tantôt `role_id` seul : passe toujours par
`getRoleName()`, qui gère les deux plus les alias (`VENDEUSE` → `VENDEUR`,
`DIRECTION` → `ADMIN`, `LABO` → `LABORATOIRE`…).

Les `role_id` 9 (`CAISSIER`) et 10 (`SAV`) sont fixés à la main par les migrations
`025_caisse` et `028_sav` : la séquence aurait fait dépendre leur id de l'ordre
d'exécution des migrations.

## Cycle de vie d'une monture

```
RECU_FOURNISSEUR → EN_STOCK_GENERAL → EN_TRANSIT → EN_STOCK_SOUS_STATION
                                                         ↓
                             EN_LABORATOIRE ← EN_PRESENTOIR → EN_CAISSE → VENDUE
                                    ↓               ↓             ↓
                             PRETE_A_LIVRER    RESERVEE   PERDUE / CASSEE / RETOURNEE
```

Un transfert se fait en **trois appels** : `POST /transfers` → `POST /transfers/:id/items`
(une par monture) → `POST /transfers/:id/dispatch`.

### Les deux passages qui ne se font pas tout seuls

**`EN_STOCK_SOUS_STATION` → `EN_PRESENTOIR`** : le seul chemin est un transfert vers le
poste **Présentoir**, une station à part entière qu'on retrouve par son nom exact dans
`/auth/stations`. Une simple recherche de code-barres depuis un magasin ne fait que
consulter (`display_service.go` `PlaceOnDisplay`). C'est l'onglet « Mise en présentoir »
de `src/responsable.tsx`. Sans ce geste, la vendeuse n'a rien à vendre et `POST /proformas`
répond avec un `warning` : `SendToCaisse` n'accepte **que** des montures `EN_PRESENTOIR`
de la station appelante.

**`EN_TRANSIT` → `EN_LABORATOIRE`** : après encaissement la monture part en transit vers
le labo, et c'est `GET /inventory/glasses/:barcode?station_id=` qui vaut réception. Le
scan de `src/labo.tsx` fait cet appel quand le code est inconnu de ses listes.

`PRETE_A_LIVRER` est le **dernier statut du cycle** : le backend n'a pas de « livrée ».
La remise au client se pointe à l'écran, elle ne s'enregistre nulle part.

**Emplacements**, deux grammaires : `RAYON-A-ETA-3-BAC-B-POS-12` pour l'entrepôt,
`PR03-12` (meuble-position) pour le présentoir.

**Gamme**, dérivée du prix : ≤ 50 000 FCFA = Classique, ≤ 100 000 = Moyenne gamme,
au-delà = Luxe.

### ⚠️ Une monture vendue ne reste pas `VENDUE`

L'encaissement (`POST /proformas/:id/settle`, décision `VENDUE`) passe la monture en
`VENDUE` **puis l'expédie aussitôt au Laboratoire** : `EN_TRANSIT`, puis `EN_LABORATOIRE`
au scan là-bas. `/inventory/glasses?status=VENDUE` ne renvoie donc quasiment jamais les
ventes — compter dessus affiche « 0 vente » face à des proformas réglées.

**La vente est sur la proforma, pas sur la monture** : ligne à `outcome = VENDUE`, en-tête
à `REGLEE` (le serveur ne règle que si une monture au moins a été encaissée, il annule
sinon). `soldFromProformas()` dans `src/vendeuse.tsx` reconstruit les ventes à partir de
là et les fusionne avec la liste `VENDUE` de l'API.

## API

Base : `import.meta.env.VITE_API_URL` ou `https://api-lunetterie.universearch.com/api/v1`

Utilisées ici : `/auth/me` · `/auth/login` · `/auth/check-user` · `/auth/set-password` ·
`/auth/stations` · `/auth/webauthn/*` · `/inventory/glasses[/:barcode]` ·
`/inventory/proformas[/:id/settle]` · `/inventory/reserves` · `/inventory/sales` ·
`/inventory/movements` · `/inventory/stock-summary` · `/inventory/transfers` ·
`/inventory/deliveries` · `/inventory/claims` · `/inventory/sav/followups` · `/ai/chat`

Réponses : `{ success, data: { … } }`. Les erreurs portent un `error` ou `message`
**utile** — remonte-le à l'écran plutôt qu'un « erreur » générique. Le serveur nomme
par exemple la monture déjà engagée sur une autre proforma.

Dans `vendeuse.tsx`, passe par `apiFetch()` : il pose le jeton et **déconnecte sur
401/403** au lieu d'afficher des listes vides qui feraient croire à un stock à zéro.

## ⚠️ Ce que le backend ne stocke pas

Ces manques dictent des contournements dans le code. **Vérifie s'ils sont comblés avant
de bâtir dessus.**

| Manque | Conséquence |
|---|---|
| pas de `sold_by` sur une monture vendue | impossible d'attribuer une vente à une vendeuse ; « Mes stats » compte des **mouvements**, rapprochés par comparaison de chaînes sur `user_first_name + user_last_name` |
| ~~pas de `created_by` sur une proforma~~ **comblé** | `POST /proformas` grave l'auteur (`proforma_handler.go`) et `created_by` revient dans les lectures (`proforma_repository.go`). **Le front n'en tire pas encore parti** : « Suivi de mes clients » liste toujours les clients **du magasin**. À brancher |
| ~~pas d'issue par ligne de proforma~~ **comblé** | `proforma.items[].outcome` vaut `VENDUE` ou `RETOUR_PRESENTOIR` dès que la Caisse a tranché (`null` tant qu'elle attend), avec `settled_at`. C'est lui qui donne le statut d'une ligne, plus la déduction par code-barres |
| aucun champ d'ordonnance | foyer, teinte, sphère, cylindre, axe, addition, prix des verres, accessoires, montage, remise **transitent dans `proforma.note`** |
| réclamations : **écriture seule** | `POST /inventory/claims` existe et l'écran Réclamation l'utilise. Il n'y a **pas de route de lecture** — `claims` n'enregistre que `Create` (`cmd/api/main.go`), et le dépôt Go n'a pas de `List`. « Suivi de réclamation » demande quand même `GET /inventory/claims` : la table se remplira seule le jour où la route existera. En attendant, son erreur est tenue **à l'écart du bandeau global**, sinon tout le poste afficherait « 1 liste indisponible » en permanence |

### La `note` porte l'ordonnance

`serializePrescription()` / `parsePrescription()` dans `src/vendeuse.tsx`. Le format est
**du texte lisible, volontairement** : le poste Caisse réaffiche `proforma.note` telle
quelle (`../Frontend/presentoir.js:1871`), donc le caissier doit y lire une ordonnance,
pas un bloc technique.

```
Verres : Simple foyer · Photo / Transit°
OD : sph +1.00 · cyl -0.50 · axe 60° · add — · prix 40000
OG : sph +0.75 · cyl -0.75 · axe 105° · add — · prix 40000
Accessoires : Housse rigide · prix 5000
Montage : prix 10000
Remise : 10 %
—
Retrait prévu vendredi.
```

Le parseur est tolérant : une note écrite à la main ressort intégralement en note libre
sans rien casser. Ce contournement disparaîtra le jour où les vrais champs existeront.

### Réserve vs caisse

`Mise à la caisse` = `POST /proformas` seul. `Mise en réserve` = `POST /proformas` **puis**
`POST /reserves`. Deux déplacements de suite sur les mêmes montures : si le second échoue,
la proforma existe quand même et le message le dit. **À confirmer avec le backend.**

## Design system

Repris de la Direction (`src/App.tsx`), à respecter sur tout nouvel écran.

- **Shell** : `<div className={dark ? 'dark' : ''}>` en racine, puis
  `flex min-h-screen bg-slate-50 dark:bg-slate-900`
- **Sidebar** `w-56 lg:w-60 bg-slate-900 dark:bg-slate-950 h-screen sticky` — logo sur
  fond blanc (le JPEG n'a pas de transparence), rôle en `uppercase tracking-[0.15em]`
- **TopBar** `sticky h-14 backdrop-blur-sm` · **MobileNav** `md:hidden fixed bottom-0`
- **Carte** : `bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4`
- **Rayons** : `rounded-xl` (boutons, tuiles), `rounded-2xl` (cartes). Rien d'autre.
- **Pastille d'icône** : `w-10 h-10 rounded-xl`, fond `${color}18` (la couleur à 9 %)
- **Chiffre clé** : `text-3xl font-black tabular-nums` coloré
- **Textes** : `text-xs` libellés, `text-sm` corps, `text-slate-400/500` secondaire
- **Navigation** : pile d'états + `switch`, **pas de router**

| Rôle | Couleur |
|---|---|
| Primaire / stock général | `#2563eb` |
| Succès / CA | `#16a34a` |
| Violet / présentoir, réserve | `#9333ea` (et `#7c3aed`) |
| Cyan / stock local | `#0891b2` |
| Ambre / alerte | `#d97706` |
| Neutre / vide | `#94a3b8` |

Icônes : objet `ic` en SVG inline, `stroke="currentColor" strokeWidth={1.75}`. Pas de
bibliothèque d'icônes.

Le code existant écrit `flex-shrink-0` ; l'IDE suggère `shrink-0`. **Reste sur
`flex-shrink-0`** tant que `App.tsx` ne change pas — la cohérence prime.

## Impression

Le document proforma (`ProformaDocument` + `PROFORMA_CSS`) utilise **des classes CSS
maison, pas Tailwind** : la fenêtre d'impression n'a pas la feuille de style de l'app.
`printProforma()` clone le nœud affiché et lui réinjecte le même CSS, donc l'imprimé ne
peut pas diverger de l'écran.

Deux pièges déjà rencontrés :

- `src/index.css` applique Inter via `* { font-family }`. Le sélecteur `*` touche chaque
  élément **directement** et coupe l'héritage : d'où `.pf, .pf *` dans `PROFORMA_CSS`.
- Le logo part en **`data:` URI** (recopié depuis l'image de l'écran via canvas). En URL,
  `window.print()` se déclenche avant la fin du chargement et le logo sort blanc.

## Développement

Toolchain : Node 22, **pnpm 10.34.3** (`.mise.toml`).

```bash
pnpm install          # ou : npx pnpm@10.34.3 install
pnpm dev              # http://localhost:8443
node node_modules/typescript/bin/tsc --noEmit    # type-check
node node_modules/vitest/vitest.mjs run          # tests
```

### Pièges qui coûtent du temps

- 🔴 **Jamais `npm install` dans ce dossier.** `vite@8` épingle `rolldown` à
  `1.0.0-rc.12`, `vitest@4` veut `~1.2.1`. Un install npm par-dessus pnpm hisse la
  mauvaise version et **casse le build entier** (`viteWasmFallbackPlugin` introuvable).
  `package-lock.json` a été supprimé (il traînait à côté de `pnpm-lock.yaml`) : ne pas le
  régénérer avec `npm install`.
- Les shims de `node_modules/.bin` peuvent perdre leur bit d'exécution
  (`Permission denied`). Contourne avec `node node_modules/<pkg>/...`.
- `hmr: true` dans `vite.config.ts` (le scaffold Figma Make l'avait coupé). Les fichiers
  d'entrée appellent `createRoot` à la racine du module, donc React Fast Refresh ne peut
  pas les patcher : **rechargement complet, l'écran courant est perdu** à chaque édition.
- `git status` montre une quinzaine de fichiers modifiés qui ne le sont pas : c'est du
  CRLF. `git diff -w --ignore-cr-at-eol` ne renvoie rien.
- **git-lfs n'est pas installé** alors que `.gitattributes` déclare des règles LFS. Les
  binaires sont des pointeurs face aux vrais fichiers — attention avant de commiter.
- Les gardes appellent la vraie API : sans identifiants valides, `magasin.html` et
  `vendeuse.html` renvoient à `login.html`.
- Le nom des photos de monture varie selon l'écran d'origine. Utilise la cascade
  complète : `photo_monture_url || image_url || photo_url || image || monture_image ||
  frame_image`, et `photo_branche_url || branche_image_url` pour la branche.

## Qualité de code

- Double quotes pour les chaînes contenant une apostrophe (`"We're here"`), ou échappe-la.
  Une apostrophe non échappée dans une chaîne simple casse le build.
- Export par défaut pour les composants de page.
- Tailwind v4 via `@tailwindcss/vite`. Pas de fichier de config, pas de PostCSS. Le CSS
  global et le thème vont dans `src/index.css`, les `@import` en premier.
- Formatage : `pnpm format` (oxfmt).
- Les commentaires expliquent **pourquoi**, pas quoi. Ceux du code existant documentent
  des pièges réels — ne les supprime pas sans avoir vérifié qu'ils ne valent plus.
