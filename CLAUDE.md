# Appli de notes — clone simplifié Keep / Todoist

## Objectif
Appli de prise de notes personnelle, utilisée sur un **poste de travail d'entreprise verrouillé** (PC, navigateur Edge/Chromium).
- À gauche (~80 %) : grille de cartes (style Google Keep), chaque carte = un projet qui mélange
  texte libre, cases à cocher et tâches à délai.
- À droite (~20 %) : liste verticale de toutes les tâches à délai de tous les projets,
  triée par urgence.

## Contraintes d'environnement (poste verrouillé)
- **Aucune installation** : pas de Node, pas de npm, pas de build, pas de CDN.
- L'appli s'ouvre en **double-cliquant sur `index.html`** (protocole `file://`).
- ⚠️ Les modules ES (`<script type="module">`) sont bloqués en `file://` dans Chromium
  → utiliser des **scripts classiques** et un espace de noms global `window.Notes`.
- Aucune dépendance externe : HTML + CSS + JavaScript simple uniquement.
- Données **100 % locales** (`localStorage`), rien ne sort du poste.
- **Fonctionnement hors ligne obligatoire** : aucune ressource externe (CDN, police, image,
  API). Garanti par une Content-Security-Policy dans `index.html`
  (`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'…`).
  Ne jamais ajouter de `<script>`/`<style>` inline ni de ressource distante : la CSP les bloquerait.
- Le profil navigateur peut être réinitialisé par l'IT → **export/import JSON obligatoire**.

## Périmètre V1
- Grille de cartes, réordonnable au glisser-déposer (souris).
- Carte = titre + couleur + étiquettes + liste d'éléments de 3 types, dans l'ordre voulu :
  - **texte** libre ;
  - **case à cocher** simple (checklist, sans date) ;
  - **tâche à délai** : intitulé + délai en jours ouvrés, mise en évidence avec pastille d'urgence ;
  - **puce** (`bullet`) : élément de liste à puces, un seul niveau (ni case, ni date).
- Panneau de droite des tâches à délai (tri par urgence, cocher, section « Terminées »).
- Filtre par étiquette.
- Export / import JSON.
- **Hors V1** : rappels/notifications, synchro, mobile, multi-utilisateur, jours fériés.

## Tâches à délai (« mode tâche »)
- Création dans la carte ouverte : bouton « + Tâche à délai » → formulaire (intitulé + nombre
  de jours ouvrés, 5 par défaut, aperçu de l'échéance) → Entrée ou « Valider ». Échap annule.
- Délai en **jours ouvrés** : lundi → vendredi hors **11 jours fériés français**, calculés
  localement (`frenchHolidays`, Pâques par l'algorithme de Meeus ; lundi de Pentecôte inclus).
  L'aperçu du formulaire indique les fériés exclus.
  Exemple : créée un jeudi avec 5 jours → échéance le jeudi suivant.
- `start` = date de création ; `due` = `start` + `days` jours ouvrés. Modifier `days` recalcule
  `due` depuis `start` (la date de début ne bouge pas).
- **Pas de barre de progression.** L'urgence dépend uniquement des **jours ouvrés restants**,
  affichée par une pastille colorée sur le libellé (grille, éditeur, panneau) :
  - `J-5` et plus → gris (calme) ; `J-2` à `J-4` → orange (bientôt) ;
  - `J-1` et `Aujourd'hui` → rouge clair (urgent) ; `Retard N j` → rouge plein ; `Fait` → gris.
  - Seuils dans `workdays.js` : `URGENT_MAX = 1`, `SOON_MAX = 4`.
- Rafraîchissement automatique au changement de jour (contrôle toutes les 10 min + au retour
  sur l'onglet).

## Modèle de données
```json
{
  "version": 1,
  "notes": [
    {
      "id": "n_lx3k2a",
      "title": "Mailleur SC8R",
      "color": "blue",
      "tags": ["boulot"],
      "order": 0,
      "col": 1,
      "items": [
        { "id": "i_a1", "type": "text", "text": "Livraison V1" },
        { "id": "i_a2", "type": "task", "text": "Relire la spec", "done": false },
        { "id": "i_a3", "type": "deadline", "text": "Rapport tolérances", "done": false,
          "days": 5, "start": "2026-10-29", "due": "2026-11-05", "doneAt": null },
        { "id": "i_a4", "type": "bullet", "text": "Point à **retenir**" }
      ],
      "createdAt": "2026-10-31T09:00:00Z",
      "updatedAt": "2026-10-31T09:00:00Z"
    }
  ]
}
```
- Couleurs autorisées : `default`, `yellow`, `green`, `blue`, `pink`, `purple`, `grey`.
- `col` : colonne d'affichage (entier ≥ 0, optionnel). `order` : ordre dans la colonne.
- Dates `start`, `due`, `doneAt` : `AAAA-MM-JJ` (date locale du PC). `days` : entier 1 → 365.
- Clé `localStorage` : `notes-app-v1`.

## Arborescence
```
notes-app/
  index.html        # page principale, charge les scripts dans l'ordre
  css/style.css
  js/workdays.js    # logique pure : jours ouvrés, urgence d'une tâche à délai
  js/richtext.js    # gras / italique : lecture, écriture, découpe, fusion (+ rendu DOM sûr)
  js/store.js       # logique pure : données, CRUD, tri (aucun accès au DOM)
  js/layout.js      # logique pure : placement maçonnerie des cartes (aucun accès au DOM)
  js/ui.js          # rendu de la grille, filtre, barre d'étiquettes + Notes.view (affichage partagé)
  js/drag.js        # glisser-déposer des cartes dans la grille
  js/editor.js      # modal d'édition d'une carte, formulaire « mode tâche »
  js/panel.js       # panneau de droite des tâches à délai
  js/backup.js      # menu ⋮, export / import JSON, confirmation, rappel de sauvegarde
  js/ephemeris.js   # logique pure : semaine ISO, fête du jour, soleil, jours particuliers
  js/clock.js       # encart date / heure / éphéméride
  js/filesync.js    # sauvegarde automatique dans un fichier (File System Access API)
  js/app.js         # initialisation, liaison store <-> vues
  LISEZMOI.md       # guide d'utilisation
  tests/tests.html  # tests unitaires, ouverts dans le navigateur
  tests/tests.js
```
- Ordre de chargement : `workdays` → `richtext` → `store` → `ephemeris` → `layout` → `ui` → `drag` → `editor` → `panel` → `backup` → `clock` → `filesync` → `app`.
- Les modules « logique pure » ne touchent jamais au DOM → testables seuls.
- Les vues ne modifient jamais les données directement → passent toujours par `store.js`.
- Jamais de texte utilisateur via `innerHTML` → `textContent` uniquement.

## Affichage
- Mise en page : `.layout` en flex, grille `flex: 1` (~80 %), panneau `flex: 0 0 20%`
  (min 270 px, max 400 px), fond gris `#e8eaed` (tâches en cartes blanches), collé sous la barre du haut.
- Grille type Keep : cartes de largeur fixe (290 px en taille « Moyen »), hauteur libre.
- **Colonnes mémorisées** (`Notes.columnLayout`) : chaque note a un champ `col` ; elle reste
  dans sa colonne, empilée selon `order` (l'ordre ne compte qu'à l'intérieur d'une colonne).
  Note sans `col` valide (anciennes données, ou colonne disparue quand la fenêtre rétrécit)
  → colonne la plus courte. Au premier affichage sans filtre, les colonnes affichées des notes
  sans `col` sont mémorisées (`store.setColumns`) → la disposition ne saute pas.
  Une colonne disparue n'est jamais réécrite : en ré-élargissant, la carte y revient.
- Nouvelle note : en haut de la colonne la plus courte (`ui.shortestColumn()` → `addNote({ col })`).
- Cartes en `position: absolute` + `transform`. À chaque re-rendu, une carte repart de sa
  position précédente → seuls les vrais déplacements sont animés.
- Grille + panneau redessinés ensemble, au plus 1 fois par frame, à chaque `onChange`.

## Édition
- Clic (ou Entrée) sur une carte → modal centré ; « + Nouvelle note » crée la note et ouvre le modal.
- Boutons texte simples (style Keep) : « + Texte », « + Case à cocher », « + Liste à puces »,
  « + Tâche à délai ».
  **Insertion au curseur** (`insertItem`) : curseur dans un texte → texte coupé après la ligne
  en cours (`Notes.rich.cutAfterLine`, sur une ligne vide l'élément la remplace) ; curseur dans
  une autre ligne → juste dessous ; sinon en fin de carte. Les boutons ne volent pas le focus
  (`mousedown` → `preventDefault`), position mémorisée (`lastPoint`, `pendingPoint` pour le
  formulaire « tâche à délai »).
- Raccourcis en début de ligne d'un texte, suivis d'un espace : `[]` / `[ ]` → case à cocher ;
  `-`, `*` ou `•` → puce.
- Cases et puces partagent le comportement « liste » : Entrée → élément suivant du même type
  (coupe au curseur) ; Entrée sur un élément **vide** → fin de liste : retour au texte (ligne
  vide en tête du texte qui suit, ou nouveau bloc de texte).
- Style : la ligne d'un bloc de texte a la classe `editor-item-para` (jamais `editor-item-text`,
  réservée à la zone de saisie) et `flex-shrink: 0` → une longue ligne n'est jamais écrasée.
- Chaque frappe est enregistrée immédiatement. Le modal n'est reconstruit qu'après un ajout /
  une suppression d'élément (pour ne pas perdre le focus pendant la frappe).
- Clavier : Entrée dans une case à cocher → nouvelle case en dessous (coupe au curseur) ;
  Retour arrière sur une ligne vide → la supprime ; Retour arrière en début de ligne non vide →
  fusion avec la précédente (texte / case à cocher, jamais une tâche à délai ; vers un texte,
  la ligne s'ajoute comme **nouvelle ligne** → une case redevient une ligne du texte) ;
  Entrée dans le titre → premier élément ;
  Échap → ferme (ou ferme seulement le formulaire « mode tâche » s'il est ouvert).
- Délai d'une tâche à délai modifiable sur place (champ nombre), échéance recalculée.
- Fermeture (Échap, clic hors carte, « Fermer ») → `finalizeNote`.
- Suppression en un clic → bandeau « Annuler » 10 s (`deleteNote` renvoie un instantané,
  `restoreNote` le remet à sa place).
- Archiver / Désarchiver (bouton en bas du modal) → bandeau « Annuler ». Une note archivée
  sort de la grille, du panneau des tâches et des étiquettes actives ; vue « Archives » via
  la barre de filtres (« ← Notes » pour revenir). Champ `archived` (absent = `false`).
- On peut cocher depuis la grille et depuis le panneau, sans ouvrir la carte.
- Clic (ou Entrée) sur une tâche du panneau → `editor.open(noteId, { focusItemId })` :
  carte ouverte, curseur sur la tâche, bref surlignage.
- Couleur : rangée de 7 pastilles en bas du modal (style Keep), appliquée immédiatement.

## Gras / italique (`richtext.js`)
- Le texte d'un élément reste une **chaîne** avec des repères façon Markdown : `**gras**`,
  `*italique*`, `***les deux***`. Compatible avec les anciennes notes, l'export et la recherche
  (`Notes.rich.plain` retire les repères).
- Règle Markdown : un repère n'ouvre que collé au mot suivant, ne ferme que collé au mot
  précédent ; un repère orphelin reste du texte (« 5 * 3 » jamais interprété). À l'écriture,
  `*` et `\` du texte sont échappés, et les espaces en bordure sortent des repères.
- Saisie : chaque ligne du modal est un `<div contenteditable>` (plus de `<textarea>`).
  Ctrl+B / Ctrl+I → `execCommand('bold' | 'italic')` ; Ctrl+U bloqué (non conservé) ;
  collage forcé en texte simple ; dépôt de contenu bloqué. Lecture du DOM : `Notes.rich.domToRuns`.
  Positions de curseur en caractères **visibles** (`getCaret` / `setCaret`) ; découpe et fusion
  de lignes via `Notes.rich.split` / `Notes.rich.concat` (la mise en forme suit le texte).
- Affichage (sticker, liste de droite) : `Notes.view.richEl` → `<strong>` / `<em>` créés en DOM,
  jamais `innerHTML`. Titre, étiquettes et formulaire « mode tâche » restent en texte simple.

## Taille des stickers
- Menu ⋮ → Petit / Moyen / Grand (`--card-w` 240 / 290 / 360 px, `--card-fs` 14,5 / 16 / 18,5 px),
  posé via `body[data-card-size]`. Les dimensions internes des cartes sont en `em` → tout
  suit la taille. `ui.cardWidth()` lit `--card-w` pour le placement (plus de largeur en dur).
- Mémorisé dans `notes-app-v1-taille` (`store.getCardSize/setCardSize`), non inclus dans
  l'export JSON (préférence d'affichage propre au poste).

## Encart date / heure / éphéméride
- En haut de la colonne de droite (`<aside class="panel">` → `#clock` puis `#panel`).
- `ephemeris.js` (pur, testé) : semaine ISO 8601, jour de l'année, fête du jour (366 entrées,
  « ! » = événement), jours particuliers (Pâques, Pentecôte, fêtes des mères/pères avec règle
  de décalage, changements d'heure + annonce la veille), lever/coucher du soleil (NOAA,
  lieu `PLACE` = Toulouse, modifiable), durée du jour et écart avec la veille.
- `clock.js` : rendu, mise à jour pile à chaque minute et au retour sur l'onglet.
  Jour férié affiché une seule fois (pas « Férié : Toussaint » + « Toussaint »), « 1er » le 1er du mois.

## Étiquettes, filtre, recherche
- Étiquettes éditées dans le modal : pastilles avec ×, champ « + Étiquette » (Entrée / virgule,
  Retour arrière sur champ vide retire la dernière, suggestions `<datalist>`, graphie existante
  réutilisée, étiquette en cours de saisie validée à la fermeture).
- Barre de filtres sous la barre du haut (« Toutes » + une puce par étiquette avec compteur),
  filtre unique, re-clic pour enlever. Clic sur une étiquette d'une carte = filtre.
- Recherche (touche « / ») : tous les mots requis, dans titre / éléments / étiquettes,
  casse et accents ignorés (`Notes.filterNotes`). Échap efface.
- Filtre et recherche s'appliquent à la grille ; le panneau des tâches reste global.

## Glisser-déposer
- Cartes (`drag.js`) : suivi du pointeur (pas de DnD HTML5), seuil 5 px. Colonne cible =
  colonne sous le centre de la carte tenue (`Notes.columnAt`) ; position = selon le pointeur,
  comparée aux positions **figées au début du geste** (`drag.base`, `Notes.insertIndex`) →
  pas de point de dépôt qui fuit. Aperçu en direct (`ui.layout(order, draggingId, cols)`) :
  seules les colonnes de départ et d'arrivée bougent. Relâchement →
  `store.placeNote(id, col, carteDessous, carteDessus)` (compatible filtre actif).
  Un clic sans déplacement ouvre toujours la carte ; reposée à sa place → rien ne change.
- Lignes d'une carte (modal) : poignée ⋮⋮ au survol, déplacement DOM en direct, écoute sur
  `document` (pas de `setPointerCapture` : déplacer le nœud ferait perdre la capture).
  Clavier : Alt + ↑ / ↓.

## Robustesse
- Stockage plein / refusé → `onSaveError` → bandeau d'erreur invitant à exporter.
- Deux onglets ouverts → événement `storage` : rechargement des données, modal fermé, bandeau.

## Sauvegarde (export / import)
- Menu **⋮** en haut à droite : « Exporter les notes (JSON) », « Importer une sauvegarde… »,
  et la date de la dernière sauvegarde.
- Export : téléchargement de `notes-sauvegarde-AAAA-MM-JJ.json`
  (`{ app: "notes-app", version, exportedAt, notes }`), date mémorisée.
- Import : **remplace toutes les notes**, après une boîte de confirmation maison (focus sur
  « Annuler »). Validation stricte du fichier avant toute modification (messages précis :
  note, élément, champ). L'état précédent est conservé → bouton « Annuler l'import ».
- Rappel : bandeau discret si notes présentes et jamais exportées, ou dernier export
  ≥ 7 jours calendaires. « Plus tard » le masque jusqu'au lendemain.
- Clés `localStorage` annexes : `notes-app-v1-derniere-sauvegarde`, `notes-app-v1-rappel-reporte`,
  `notes-app-v1-avant-import`.

## Sauvegarde automatique dans un fichier (`filesync.js`)
- Usage sur **un seul PC**. Fichier choisi par l'utilisateur via `showSaveFilePicker` (« Créer ») ou
  `showOpenFilePicker` (« Ouvrir un fichier existant », restauration). Typiquement un dossier
  Google Drive pour ordinateur (G:) → synchronisation avec le compte Google faite par Drive,
  l'appli reste 100 % hors ligne (écriture disque uniquement, CSP inchangée).
- Handle mémorisé dans IndexedDB (base `notes-app`, magasin `fichiers`, clé `sauvegarde`).
- Écriture ~1 s après la dernière modification (`store.onChange`), jamais deux écritures en même
  temps (`writing` / `again`), tentative finale sur `pagehide`. Chaque écriture réussie appelle
  `store.markExported()` → le rappel d'export disparaît.
- États : `off` / `active` / `paused` (autorisation à redonner : bouton « Reprendre », doit venir
  d'un clic) / `error` (bandeau + « Réessayer »). Indicateur `#autosave-status` dans la barre du haut.
- Au démarrage : si l'appli est vide et que le fichier mémorisé contient des notes → rechargement auto.
- « Ouvrir » : `Notes.fileSyncPlan(text, nbNotes)` → `empty` / `invalid` / `load` / `confirm`
  (confirmation + « Annuler le chargement » via `undoImport`).
- Tests : `fileSyncPlan` en unitaire ; parcours complet avec fichiers simulés via
  `window.__notesTestHandleStore` (point d'injection réservé aux tests). Le vrai sélecteur de
  fichiers Windows ne peut pas être piloté par les tests automatisés → valider sur le poste.

## Méthode
Développement **brique par brique**. Une brique n'est validée que lorsque ses tests passent
(`tests/tests.html` affiche vert/rouge, sans outil externe). Ne pas commencer la brique
suivante avant validation.

## Briques
1. **Stockage** — `store.js` : CRUD notes et éléments. + tests.
2. **Grille** — affichage des cartes triées par `order`, bouton « + Nouvelle note ».
3. **Édition de carte** — modal, texte / cases à cocher, édition en place, suppression.
3b. **Tâches à délai** — type `deadline`, jours ouvrés, pastille d'urgence, panneau de droite.
   (Remplace l'ancienne brique « Échéances » : les cases à cocher simples n'ont plus de date.)
4. **Glisser-déposer** — cartes dans la grille + lignes dans une carte.
5. **Couleurs & étiquettes** — couleur, étiquettes, filtre, recherche.
6. **Export / import** — téléchargement d'un `.json`, import avec validation, annulation, rappel.

## API du store (`window.Notes.createStore({ storage, key, now, genId, today, onSaveError })`)
| Fonction | Rôle |
|---|---|
| `load()` | Charge les données. Si corrompues : copie de secours sous `notes-app-v1-corrompu-<date>`, renvoie `{ ok: false, backupKey }` |
| `onChange(fn)` | Appelé après chaque modification ; renvoie une fonction de désabonnement |
| `getNotes()` / `getNote(id)` | Lecture (copies), notes triées par `order` |
| `addNote({title, color, tags, col?})` | Nouvelle note **en tête** (de sa colonne) |
| `placeNote(id, col, beforeId, afterId)` | Glisser-déposer : colonne + position (avant la carte du dessous / après celle du dessus) |
| `setColumns({ id: col })` | Mémorise des colonnes, n'enregistre que les vrais changements |
| `updateNote(id, {title?, color?, tags?})` | Autres champs refusés |
| `deleteNote(id)` → `{ note, index }` / `restoreNote(snapshot)` | Suppression annulable |
| `setArchived(id, bool)` | Archivage (garde sa place dans l'ordre) |
| `moveNote(id, index)` | Déplacement, renumérotation automatique |
| `addItem(noteId, {type, text, days?}, index?)` | `type` = `text`, `task`, `bullet` ou `deadline` (`days` obligatoire et réservé à `deadline`) ; en fin de carte, ou à `index` |
| `updateItem(noteId, itemId, {text?, done?, days?})` | `done` : `task`/`deadline` (renseigne `doneAt`) ; `days` : `deadline` (recalcule `due`) |
| `toggleTask(noteId, itemId)` / `deleteItem(...)` / `moveItem(..., index)` | |
| `finalizeNote(noteId)` | À la fermeture de l'éditeur : retire les éléments vides, supprime la note si vide → `{ deleted }` |
| `getDeadlineTasks()` | `{ active, done }` : toutes les tâches à délai, `active` triées par échéance, `done` par date de fin décroissante. Entrée : `{ noteId, noteTitle, noteColor, item }` |

`Notes.workdays` : `todayISO()`, `frenchHolidays(year)`, `holidayName(iso)`, `holidaysBetween(a, b)`,
`easterSunday(year)`, `addWorkingDays(iso, n)`, `workingDaysBetween(a, b)`,
`urgency(item, today)` → `{ level, label, remaining }` (level : `calm`/`soon`/`urgent`/`late`/`done`), `formatShort`, `formatLong`.

| `getAllTags(archived?)` | `[{ tag, count }]` des notes actives (ou archivées), sans doublon de casse, trié |
| `exportData()` | Objet de sauvegarde (copie) |
| `importData(data)` | Valide puis remplace toutes les notes ; garde l'état précédent. Lève une `Error` si invalide |
| `canUndoImport()` / `undoImport()` | Retour à l'état d'avant le dernier import |
| `markExported()` / `getLastExport()` | Date du dernier export |
| `snoozeReminder()` / `getReminderSnooze()` | Report du rappel au lendemain |

Fonctions statiques : `Notes.filterNotes(notes, { tag, query })`, `Notes.dropIndex(allIds, visibleIds, id)`,
`Notes.slotAt(slots, x, y, cardWidth)`, `Notes.columnLayout(cards, opts)`, `Notes.columnAt(x, geo)`,
`Notes.insertIndex(colSlots, y)` (layout.js), `Notes.validateBackup(data)` → `{ ok, errors, notes, count, exportedAt }` ;
`Notes.backupReminder({ noteCount, lastExport, snoozedOn, today, threshold })` → `{ show, days }`.

Toute erreur (id inconnu, couleur invalide, délai invalide…) lève une `Error` avec un message en français.

## État d'avancement
- [x] Brique 1 — Stockage
- [x] Brique 2 — Grille (maçonnerie JS, cartes 240 px, gap 16 px)
- [x] Brique 3 — Édition de carte (modal)
- [x] Brique 3b — Tâches à délai + panneau de droite (pastilles d'urgence)
- [x] Brique 4 — Glisser-déposer (cartes + lignes)
- [x] Brique 5 — Couleurs, étiquettes, filtre, recherche
- [x] Brique 6 — Export / import
- [x] Robustesse : stockage plein, multi-onglets

**V1 terminée.**

## V2
- [x] Jours fériés français dans les délais
- [x] Suppression en un clic, annulable
- [x] Archivage des notes (vue Archives)
- [x] Clic sur une tâche du panneau → ouvre sa carte
- [x] Hors ligne garanti (CSP) + test automatique réseau coupé : 0 tentative de connexion
- [x] Réglage de taille des stickers (Petit / Moyen / Grand)
- [x] Encart heure / date / semaine / éphéméride
- [x] Sauvegarde automatique dans un fichier (prêt pour Google Drive pour ordinateur)
- [x] Glisser-déposer précis (colonnes mémorisées)
- [x] Gras / italique (Ctrl+B / Ctrl+I), visibles pendant la saisie
- [x] Cases et tâches insérées au milieu d'un texte (au curseur, raccourci `[]`)
- [x] Correctif : longue note, la ligne ajoutée ne chevauche plus le texte
- [x] Liste à puces (bouton, raccourcis `-` `*` `•`, un seul niveau)

Tests : 119 tests unitaires (`tests/tests.html`) + scénarios automatisés (souris/clavier, hors ligne).
