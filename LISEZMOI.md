# Notes — guide d'utilisation

Appli de prise de notes façon Google Keep, avec des tâches à délai façon Todoist.

**Fonctionne entièrement sans Internet.** Aucune connexion n'est jamais faite : pas de serveur,
pas de police ou de bibliothèque téléchargée. Le navigateur a même l'ordre de refuser toute
connexion extérieure (règle de sécurité dans `index.html`). Tout reste sur ton PC.

## Démarrer
1. Dézippe le dossier `notes-app` où tu veux (ex. `Documents\notes-app`).
2. Double-clique sur **`index.html`** → l'appli s'ouvre dans Edge.
3. Astuce : ajoute la page à tes favoris.

> ⚠️ Les notes sont enregistrées **dans le navigateur**. Si le profil Edge est réinitialisé,
> elles disparaissent : exporte régulièrement (voir *Sauvegarde*).

## L'écran
- **À gauche** : tes stickers (cartes), un par sujet / projet.
- **À droite, en haut** : l'heure, la date, le numéro de semaine, le jour de l'année et
  l'éphéméride (fête du jour, lever et coucher du soleil à Toulouse, jours qui rallongent ou
  raccourcissent, jours fériés, Pâques, fêtes des mères et des pères, changement d'heure).
  Tout est calculé par l'appli, sans connexion.
- **À droite, en dessous** : la liste de toutes tes tâches à délai, la plus urgente en haut.
- **En haut** : recherche, « + Nouvelle note », menu **⋮** (sauvegarde).

## Taille des stickers
Menu **⋮** → **Taille des stickers** : *Petit*, *Moyen* ou *Grand* (carte et texte agrandis
ensemble). Le choix est mémorisé. Pour agrandir **toute** l'interface (liste des tâches comprise),
utilise aussi le zoom d'Edge : **Ctrl + molette** ou **Ctrl +** / **Ctrl −**.

## Les stickers
| Action | Comment |
|---|---|
| Créer | « + Nouvelle note » |
| Ouvrir / modifier | Clic sur le sticker (ou Tab puis Entrée) |
| Fermer | Échap, clic à côté, ou « Fermer » — tout est enregistré à chaque frappe |
| Changer la couleur | Pastilles en bas de la carte ouverte |
| Déplacer | Cliquer-glisser le sticker dans la grille |
| Archiver | « Archiver » en bas de la carte ouverte (annulable) |
| Supprimer | « Supprimer » en bas de la carte ouverte, puis **Annuler** dans le bandeau si besoin |

Une note laissée vide est supprimée automatiquement à la fermeture.

## Contenu d'un sticker
Trois types de lignes, mélangeables dans n'importe quel ordre :
- **+ Texte** : texte libre (plusieurs lignes).
- **+ Case à cocher** : liste simple. *Entrée* crée la case suivante.
- **+ Tâche à délai** : intitulé + délai en **jours ouvrés** (lundi → vendredi, **hors jours
  fériés français**). L'échéance est affichée avant de valider, avec les jours fériés exclus
  (ex. « → ven. 13 nov. (Armistice 1918 exclu) »). Le délai reste modifiable ensuite.

Raccourcis dans une ligne :
- **Entrée** au milieu d'une case → la coupe en deux.
- **Retour arrière** sur une ligne vide → la supprime ; en début de ligne → la fusionne avec celle du dessus.
- **Alt + ↑ / ↓** → monte / descend la ligne. À la souris : poignée **⋮⋮** à gauche de la ligne.

## Urgence des tâches à délai
| Pastille | Signification |
|---|---|
| gris `J-8` | 5 jours ouvrés ou plus |
| orange `J-3` | 2 à 4 jours ouvrés |
| rouge clair `J-1` / `Aujourd'hui` | urgent |
| rouge plein `Retard 2 j` | échéance dépassée |
| `Fait` | terminée |

On coche une tâche depuis le sticker, la carte ouverte ou la liste de droite.
Un **clic sur une tâche de la liste de droite** ouvre sa carte, curseur sur la tâche.
Les tâches terminées sont rangées dans « Terminées » (repliable) en bas de la liste.

## Étiquettes, filtre et recherche
- Dans la carte ouverte : champ **+ Étiquette** (Entrée ou virgule pour valider,
  suggestions des étiquettes existantes, × pour retirer).
- Sous la barre du haut : un bouton par étiquette pour **filtrer** la grille
  (re-clic ou « Toutes » pour enlever le filtre). Un clic sur une étiquette d'un sticker filtre aussi.
- **Recherche** : touche **/** ou clic dans le champ ; cherche dans les titres, textes et
  étiquettes, sans tenir compte des accents. Échap pour effacer.

## Archives
- Une note archivée quitte la grille **et** la liste des tâches, sans être perdue.
- Bouton **Archives** (à droite de la barre des étiquettes) → vue des notes archivées ;
  « ← Notes » pour revenir. Dans une note archivée, « Désarchiver » la remet dans la grille.

## Sauvegarde automatique dans un fichier (recommandé)
Menu **⋮** → *Sauvegarde automatique dans un fichier* :
- **Créer un fichier de sauvegarde…** : choisis où l'enregistrer (ex. `Documents\Notes\notes.json`,
  ou plus tard `G:\Mon Drive\Notes\notes.json` avec Google Drive pour ordinateur, qui le
  synchronisera alors avec ton compte Google). L'appli y écrit ensuite **toute seule**, environ une seconde
  après chaque modification. L'indicateur en haut à droite affiche « Enregistré 09:42 ».
- **Ouvrir un fichier existant…** : pour **restaurer** tes notes (ex. après une réinitialisation
  d'Edge). L'appli charge le fichier puis continue d'y enregistrer.
- Si Edge redemande l'autorisation (nouvelle session), l'indicateur passe à
  **« Sauvegarde en pause · Reprendre »** : un clic et tout est rattrapé. Pour ne plus avoir à le
  faire, choisis **« Autoriser à chaque visite »** quand Edge pose la question, si cette option est proposée.
- Si les notes du navigateur disparaissent mais qu'Edge se souvient du fichier, elles sont
  rechargées automatiquement au démarrage.
- *Arrêter la sauvegarde automatique* ne supprime pas le fichier.

## Export / import manuel
Menu **⋮** en haut à droite :
- **Exporter les notes (JSON)** → fichier `notes-sauvegarde-AAAA-MM-JJ.json`.
  Range-le hors du navigateur (dossier réseau, OneDrive…).
- **Importer une sauvegarde…** → remplace **toutes** les notes par celles du fichier,
  après confirmation. Un bouton « Annuler l'import » permet de revenir en arrière juste après.
  Un fichier abîmé est refusé sans rien modifier.

Un bandeau te le rappelle si tu n'as jamais exporté ou si la dernière sauvegarde a 7 jours ou plus.

## Bon à savoir
- L'appli peut être ouverte dans deux onglets : chaque onglet se met à jour quand l'autre enregistre.
- Jours fériés pris en compte : 1er janvier, lundi de Pâques, 1er et 8 mai, Ascension,
  lundi de Pentecôte, 14 juillet, 15 août, 1er et 11 novembre, 25 décembre
  (calculés automatiquement chaque année, sans connexion).
- Vérifier que tout fonctionne : ouvrir `tests/tests.html` → bandeau vert.
