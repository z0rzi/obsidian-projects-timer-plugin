# Cartes projet composites dans le Kanban

Date : 2026-07-16
Statut : approuvé, prêt pour plan d'implémentation

## Contexte

Aujourd'hui, chaque ligne taguée (`#task`, `#bug`, `#ask`, `#quick`, `#wait`) dans n'importe quel fichier devient une carte kanban indépendante, avec une priorité inline (`pN`) et une colonne dédiée (`doing`, `p1`..`p5`).

Un fichier projet (contenant un bloc `` ```project ``) n'a aujourd'hui aucune existence propre dans le kanban : ses tâches, si elles existent, sont des lignes taguées comme n'importe quelle autre. Il n'y a pas de notion de priorité au niveau du projet, ni d'ordre formel entre ses sous-tâches, ni de source de vérité unique pour "que reste-t-il à faire sur ce projet".

## Objectif

- Un projet a une priorité propre (frontmatter), indépendante des tags.
- Les sous-tâches d'un projet n'ont pas de priorité individuelle : elles héritent de l'ordre de définition et de la priorité du projet.
- Une seule source de vérité par projet : une liste de tâches à cocher, dans le corps du fichier.
- Le projet apparaît dans le kanban sous forme d'une carte unique montrant ses prochaines tâches à faire.
- Les tags existants (`#bug`, `#ask`, `#quick`, `#wait`, `#task`) gardent leur usage actuel, recentré sur la maintenance, les questions de réunion, et les tâches hors-projet — ils ne sont plus le mécanisme de définition des sous-tâches d'un projet.

## Syntaxe markdown

### Frontmatter du fichier projet

```yaml
---
priority: 2
archived: true
---
```

- `priority` : entier, même échelle que les tâches taguées (`0` = colonne `doing`, `1`-`5` = colonnes `p1`..`p5`). Absent ou non numérique → la carte n'apparaît pas dans le kanban.
- `archived` : booléen optionnel. Si `true`, la carte n'apparaît jamais dans le kanban, quelle que soit `priority` ou l'état des tâches.

### Section Tasks

Un heading de niveau H1, H2 ou H3 dont le texte (trim, insensible à la casse) est exactement `Tasks` délimite la section des tâches du projet. La section s'étend jusqu'au prochain heading de niveau égal ou inférieur (sectioning markdown standard), ou la fin du fichier. S'il existe plusieurs headings `Tasks` dans le fichier, seul le premier est pris en compte.

À l'intérieur de cette section, seules les lignes de checkbox **non indentées** (`- [ ] texte` / `- [x] texte`) comptent comme tâches. Tout contenu indenté sous une checkbox (texte libre, checkbox imbriquée) est considéré comme description de cette tâche : jamais affiché dans le kanban, jamais traité comme tâche indépendante.

```markdown
---
priority: 2
---

## Tasks

- [ ] Do something
	Description libre, n'apparaît jamais dans le kanban.

- [ ] Second task
- [x] Already done task

#bug error when trying to create admin account
	-> logique de tags actuelle inchangée, entrée kanban séparée

## Autre heading

- [ ] Simple checkbox ici → ignorée, jamais une tâche (hors section Tasks)
```

Les tags (`#bug`, `#ask`, `#quick`, `#wait`, `#task`) gardent exactement leur comportement actuel, y compris à l'intérieur de la section Tasks.

## Modèle de données

Nouveau type, séparé de `Task` :

```ts
type ProjectCard = {
	id: number;
	file: TFile;
	priority: number;
	items: {
		text: string;
		line: number;
		checked: boolean;
	}[]; // 0 à 3 entrées
};
```

Le flux existant `allTasks: BehaviorSubject<Task[]>` et `findTasksInFile` restent inchangés. Un nouveau flux séparé `allProjectCards: BehaviorSubject<ProjectCard[]>` est ajouté. `TasksKanbanView` fusionne les deux listes uniquement au moment du rendu des colonnes — aucune régression possible sur le système de tags existant.

## Parsing

Pour chaque fichier retourné par `getProjectFiles()` contenant un bloc `` ```project `` :

1. Lire le frontmatter via `this.app.metadataCache.getFileCache(file)?.frontmatter` (valeurs typées par le parseur YAML d'Obsidian — booléen réel, nombre réel), et non `parseFileProperties` qui ne fait qu'un split de chaîne ligne par ligne et renvoie des strings brutes. Même mécanisme que `buildTimeSourceCache` utilise déjà pour lire `status`/`tasks_completed`. Si `frontmatter.archived === true` ou `typeof frontmatter.priority !== "number"` → pas de carte pour ce fichier, arrêt.
2. Chercher le premier heading `Tasks` (H1-H3) et délimiter sa section.
3. Extraire, dans l'ordre du document, les checkbox top-level de la section → `{text, line, checked}[]`.
4. Construire `items` (jusqu'à 3 entrées) :
   - D'abord les tâches non cochées, dans l'ordre, jusqu'à 3.
   - Si moins de 3 non cochées trouvées, compléter avec la queue des tâches cochées (les plus proches de la fin de la liste, dans l'ordre) jusqu'à 3 ou épuisement.
5. Si la section est absente ou vide → carte créée quand même avec `items: []` (la priorité et le fichier existent, la carte reste visible sans contenu de tâche).

## Rendu kanban & interactions

Nouveau template de carte, distinct de `cardHtml()` :

- Titre : `file.basename`.
- Corps : liste des `items` (0 à 3), chacun avec sa propre checkbox interactive et son texte.
- Un seul bouton `play` (démarre le timer sur le projet, comportement de time-tracking inchangé). Pas de bouton `done` global — il n'y a pas de tâche unique à cocher pour toute la carte.
- Style : réutilise l'entrée `project` déjà présente dans `TASKS_TYPES` (bordure épaisse `--card-color`).

Placement dans les colonnes : même mapping priorité → colonne que les tâches (`0` → `doing`, `1`-`5` → `p1`..`p5`). Les cartes projet partagent les mêmes colonnes que les cartes tâches.

Interactions :
- Clic sur le titre / zone hors item → ouvre le fichier projet.
- Clic sur le texte d'un item → ouvre le fichier à la ligne de cette tâche.
- Clic sur la checkbox d'un item → réécrit uniquement cette ligne (`- [ ] ` ↔ `- [x] `) dans le fichier ; pas de navigation ; le flux `allProjectCards` se recalcule et l'item cède sa place au suivant si besoin.
- Drag de la carte vers une autre colonne priorité → réécrit `priority:` dans le frontmatter du fichier (nouvelle fonction `updateProjectPriority`, distincte de `updateTaskTag`).

Techniquement, le click handler délégué de `TasksKanbanView` (aujourd'hui basé sur `data-task-id`) gagne de nouveaux attributs `data-project-id` / `data-line` pour distinguer les clics sur une checkbox d'item des clics sur les boutons de carte existants — même pattern de délégation d'événements déjà en place.

## Hors scope

- Pas de nouveau setting (nombre de slots par carte = constante fixe à 3 dans le code).
- Pas de migration de données : purement additif. Un projet sans `priority` continue de fonctionner exactement comme avant (bloc `project`, activités, time-tracking), simplement sans carte kanban.
- Le tag `#task` reste disponible tel quel pour des tâches véritablement isolées, hors de tout fichier projet.

## Vérification

Pas de framework de test dans ce repo (`tsc -noEmit` + `eslint` uniquement ; aucun fichier `*.test.ts`/`*.spec.ts` hors `node_modules`).

- `npm run build` (type-check + lint) pour la correction statique.
- Test manuel via `npm run dev` dans Obsidian : fichier projet avec `priority` en frontmatter et section `## Tasks`, cocher/décocher une tâche depuis le kanban, drag de la carte entre colonnes, vérifier la réécriture du frontmatter et des lignes checkbox, vérifier que `archived: true` masque bien la carte.
