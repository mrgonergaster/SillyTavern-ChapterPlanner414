# Chapter Planner — Extension SillyTavern

Planification automatique de chapitres narratifs pour le roleplay.  
Génère un Chat Lorebook par chapitre avec des événements indexés `chat:X`.

---

## Installation

1. Dans SillyTavern, ouvrir le panneau **Extensions**.
2. Cliquer sur **Install extension** (icône GitHub/URL).
3. Entrer l'URL de ce dépôt Git.
4. Redémarrer SillyTavern.

**OU** (installation manuelle) :

1. Copier le dossier `chapter-planner` dans :
   `data/<votre-utilisateur>/extensions/`
2. Redémarrer SillyTavern.

---

## Configuration

Dans le panneau **Extensions > Chapter Planner** :

| Paramètre | Description |
|---|---|
| **Profil de connexion** | Profil à utiliser pour le Chapter Planner (recommandé : un profil avec un modèle puissant, ex. Claude Opus ou GPT-4o). |
| **Préfixe des Lorebooks** | Nom de base des Lorebooks créés. Défaut : `Chapitre`. Produit `Chapitre 1`, `Chapitre 2`, etc. |
| **Lier automatiquement** | Si activé, lie le Lorebook créé au chat actif via `/setchatbook`. |

---

## Utilisation

### Créer un chapitre

1. Être dans un chat actif avec un personnage.
2. Cliquer sur le **bouton flottant** 📖 en bas à droite du chat.
3. Attendre la génération (quelques secondes).
4. Le Lorebook `Chapitre N` est créé et lié au chat.
5. Le roleplay peut reprendre normalement.

### Régénérer le chapitre actuel

Dans le panneau Extensions > Chapter Planner, cliquer sur **Régénérer le chapitre actuel**. Le Lorebook existant est entièrement remplacé.

---

## Architecture du système

```
Bouton flottant
    │
    ▼
generateQuietPrompt()   ← Profil Chapter Planner
    │
    ▼
Plan JSON du chapitre
    │
    ▼
/api/worldinfo/edit     ← Lorebook créé avec entrées chat:X
    │
    ▼
/setchatbook            ← Lorebook lié au chat actif
    │
    ▼
ROLEPLAY NORMAL
    │
    ▼
Bot répond → [chat:4]
    │
    ▼
World Info détecte "chat:4" → Event injecté
```

### Format des clés d'événements

Chaque entrée du Lorebook a pour clé `chat:X` où X est le numéro de réponse bot.  
Le modèle doit terminer chaque réponse par `[chat:X]` pour que World Info détecte la position.

**Exemple de fin de message bot :**
```
*La porte se referma lentement derrière Yonah.*

[chat:7]
```

---

## Ajouter le marqueur [chat:X] au modèle

Pour que le système fonctionne, le modèle doit produire `[chat:X]` à la fin de chaque réponse.  
Ajouter ceci dans le **System Prompt** ou **Author's Note** de votre personnage :

```
Tu dois terminer chaque réponse par un marqueur de position sous la forme exacte :
[chat:X]
où X est le numéro de ta réponse actuelle dans ce chat (commence à 1, augmente de 1 à chaque réponse).
Ce marqueur doit apparaître exactement une fois, à la toute fin de ta réponse, seul sur sa ligne.
Rien ne doit apparaître après lui. Ne l'explique pas dans la narration.

Exemple :
*Yonah regarda silencieusement la fenêtre.*

[chat:12]
```

---

## Fichiers

```
chapter-planner/
├── manifest.json   — Métadonnées de l'extension
├── index.js        — Logique principale
├── style.css       — Styles (intégration native ST)
├── settings.html   — Template du panneau
└── README.md       — Ce fichier
```

---

## Compatibilité

- SillyTavern ≥ 1.12.0
- Fonctionne avec tous les backends supportés par ST (OpenAI, Claude, local, etc.)

---

## Licence

MIT
