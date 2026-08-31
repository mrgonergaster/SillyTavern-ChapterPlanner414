/**
 * Chapter Planner — SillyTavern Extension
 *
 * Gère la planification automatique de chapitres en roleplay.
 * Crée un Chat Lorebook par chapitre avec des événements indexés chat:X.
 */

// ═══════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════

const MODULE = 'chapter_planner';

const DEFAULT_SETTINGS = Object.freeze({
    connectionProfile: '',
    lorebookPrefix: 'Chapitre',
    autoSetBook: true,
});

// Prompt envoyé au Chapter Planner (extrait du document de conception)
const CHAPTER_PLANNER_PROMPT = `Your task is to design ONE complete narrative chapter for the CURRENT roleplay. This is NOT a script and it is NOT a sequence of predetermined actions. It is a flexible narrative framework describing what {{char}}, NPCs, factions and the world may do while preserving complete agency for {{user}}.

================================================== AVAILABLE CONTEXT ==================================================
Base your planning on ALL relevant information available in the current conversation context, including:
- {{char}}'s definition
- {{user}}'s definition
- the current scenario
- the established roleplay history
- established relationships
- unresolved conflicts
- established worldbuilding
- currently relevant lorebook information
- consequences of previous events
- the current narrative and emotional situation

The actual roleplay is CANON. Do not invent previous events that did not happen.

================================================== ABSOLUTE USER AGENCY ==================================================
NEVER determine anything for {{user}}. You must NEVER predetermine:
- {{user}}'s actions
- {{user}}'s dialogue
- {{user}}'s thoughts
- {{user}}'s emotions
- {{user}}'s intentions
- {{user}}'s decisions
- {{user}}'s consent
- {{user}}'s physical reactions

You may create situations involving {{user}}. You may place {{user}} in danger. You may have NPCs speak to {{user}}. You may have {{char}} react to {{user}}. But {{user}} must always be free to decide what they do.

================================================== CHAPTER PHILOSOPHY ==================================================
A chapter is a narrative unit, NOT necessarily a dramatic arc. A chapter may be: a quiet character moment, a conversation, a relationship development, an investigation, a journey, exploration, slice of life, comedy, romance, mystery, political development, escalating conflict, combat, tragedy, a major turning point.

Do NOT assume every chapter needs: combat, an antagonist, a betrayal, a crisis, a dramatic climax, a major revelation. A quiet chapter is completely valid.

================================================== PACING AND LENGTH ==================================================
Choose the chapter length yourself. The chapter must contain between 3 and 70 BOT RESPONSES.

General guidance:
- 3–7: Very short chapter. Small development, brief interaction, minor event, simple transition or quiet scene.
- 8–14: Short chapter. Limited but meaningful development.
- 15–25: Medium chapter. Several meaningful developments.
- 26–40: Long chapter. Substantial character, relationship, world or conflict development.
- 41–55: Major chapter. Multiple complications or significant consequences.
- 56–70: Exceptional chapter. Used when the story requires extensive development.

These ranges are GUIDANCE, NOT targets. NEVER add filler to justify the selected length.

================================================== STRUCTURE ==================================================
Create three broad narrative phases:
- BEGINNING: Introduce, establish or develop the chapter's central situation.
- MIDDLE: Develop the situation through meaningful interactions, complications, discoveries or consequences.
- CONCLUSION: Reach a satisfying natural stopping point.

================================================== EVENT PLANNING ==================================================
Create only the events that genuinely help structure the chapter.

Each event must contain:
- position (integer: which bot response triggers this event)
- title
- purpose
- event (description of what happens in the world/with NPCs/with {{char}})
- characters (array of character names involved)
- constraints (array of things the model must NOT do, e.g. "Ne pas contrôler {{user}}")

Do NOT create an event for every position. Leave room for free roleplay.

================================================== OUTPUT ==================================================
Return ONLY valid JSON. Do not use markdown. Do not wrap in code blocks.

Use exactly this structure:
{
  "chapter": {
    "title": "string",
    "length": 12,
    "tone": "string",
    "pacing": {
      "intensity": "low | medium | high | variable",
      "rhythm": "slow | moderate | fast | variable",
      "reason_for_length": "string"
    },
    "beginning": "string",
    "middle": "string",
    "conclusion": "string"
  },
  "events": [
    {
      "position": 5,
      "title": "string",
      "purpose": "string",
      "event": "string",
      "characters": ["string"],
      "constraints": ["string"]
    }
  ]
}

Rules:
- length MUST be an integer from 3 to 70.
- position MUST be an integer between 1 and length.
- events MUST be ordered by position.
- events MUST NOT occur at every position.
- Do NOT use filler.
- Do NOT control {{user}}.`;

// ═══════════════════════════════════════════════════════════
// ÉTAT MODULE
// ═══════════════════════════════════════════════════════════

/** @type {Object} Paramètres persistants de l'extension */
let settings = {};

/** @type {Object|null} Plan du chapitre en cours */
let currentChapterPlan = null;

// ═══════════════════════════════════════════════════════════
// EXPORTS (Lifecycle hooks)
// ═══════════════════════════════════════════════════════════

export async function onActivate() {
    console.log(`[${MODULE}] onActivate`);
}

export async function onInstall() {
    console.log(`[${MODULE}] onInstall — première installation`);
}

export async function onClean() {
    const { localforage } = SillyTavern.libs;
    await localforage.removeItem(`${MODULE}_chapter_plan`);
    console.log(`[${MODULE}] Données nettoyées`);
}

// ═══════════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════════

(async function init() {
    const { eventSource, event_types, renderExtensionTemplateAsync } = SillyTavern.getContext();

    // Charger les settings
    loadSettings();

    // Charger le plan sauvegardé si existant
    await loadSavedChapterPlan();

    // Injecter le HTML du panneau
    const html = await renderExtensionTemplateAsync(`third-party/${MODULE}`, 'settings');
    $('#extensions_settings2').append(html);

    // Injecter le bouton flottant
    injectFloatButton();

    // Lier les événements UI
    bindUI();

    // Peupler la liste des profils
    await populateProfiles();

    // Rafraîchir l'affichage
    renderPanel();

    // Écouter les changements de chat
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    console.log(`[${MODULE}] Extension initialisée`);
})();

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════

function loadSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE]) {
        extensionSettings[MODULE] = structuredClone(DEFAULT_SETTINGS);
    }
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(extensionSettings[MODULE], key)) {
            extensionSettings[MODULE][key] = DEFAULT_SETTINGS[key];
        }
    }
    settings = extensionSettings[MODULE];
}

function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
}

// ═══════════════════════════════════════════════════════════
// PERSISTANCE DU PLAN (chatMetadata)
// ═══════════════════════════════════════════════════════════

async function loadSavedChapterPlan() {
    try {
        const { chatMetadata } = SillyTavern.getContext();
        if (chatMetadata && chatMetadata[`${MODULE}_plan`]) {
            currentChapterPlan = chatMetadata[`${MODULE}_plan`];
            console.log(`[${MODULE}] Plan chargé depuis chatMetadata (chapitre ${currentChapterPlan.chapterNumber})`);
        } else {
            currentChapterPlan = null;
        }
    } catch (e) {
        currentChapterPlan = null;
    }
}

async function saveChapterPlan(plan) {
    try {
        const { chatMetadata, saveMetadata } = SillyTavern.getContext();
        if (chatMetadata) {
            chatMetadata[`${MODULE}_plan`] = plan;
            await saveMetadata();
        }
    } catch (e) {
        console.error(`[${MODULE}] Erreur sauvegarde plan:`, e);
    }
}

async function clearChapterPlan() {
    try {
        const { chatMetadata, saveMetadata } = SillyTavern.getContext();
        if (chatMetadata) {
            delete chatMetadata[`${MODULE}_plan`];
            await saveMetadata();
        }
    } catch (e) {
        console.error(`[${MODULE}] Erreur suppression plan:`, e);
    }
}

// ═══════════════════════════════════════════════════════════
// BOUTON FLOTTANT
// ═══════════════════════════════════════════════════════════

function injectFloatButton() {
    if (document.getElementById('cp-float-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'cp-float-btn';
    btn.title = '';
    btn.innerHTML = `
        <i class="fa-solid fa-book-bookmark"></i>
        <span class="cp-float-tooltip">Créer le chapitre suivant</span>
    `;
    btn.addEventListener('click', () => onCreateChapter(false));
    document.body.appendChild(btn);
}

function setFloatBtnLoading(loading) {
    const btn = document.getElementById('cp-float-btn');
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
        ? `<i class="fa-solid fa-spinner cp-float-spinner"></i><span class="cp-float-tooltip">Génération en cours…</span>`
        : `<i class="fa-solid fa-book-bookmark"></i><span class="cp-float-tooltip">Créer le chapitre suivant</span>`;
}

// ═══════════════════════════════════════════════════════════
// LIAISON UI
// ═══════════════════════════════════════════════════════════

function bindUI() {
    // Bouton "Chapitre suivant" dans le panneau
    $(document).on('click', '#cp-btn-next-chapter', () => onCreateChapter(false));

    // Bouton "Régénérer"
    $(document).on('click', '#cp-btn-reset-chapter', () => onCreateChapter(true));

    // Bouton rafraîchir profils
    $(document).on('click', '#cp-refresh-profiles', async () => {
        await populateProfiles();
        toastr.info('Profils actualisés');
    });

    // Changement de profil
    $(document).on('change', '#cp-connection-profile', () => {
        settings.connectionProfile = $('#cp-connection-profile').val();
        saveSettings();
    });

    // Changement préfixe
    $(document).on('input', '#cp-lorebook-prefix', () => {
        settings.lorebookPrefix = $('#cp-lorebook-prefix').val() || 'Chapitre';
        saveSettings();
    });

    // Checkbox auto-set
    $(document).on('change', '#cp-auto-set-book', () => {
        settings.autoSetBook = $('#cp-auto-set-book').prop('checked');
        saveSettings();
    });
}

// ═══════════════════════════════════════════════════════════
// PROFILS DE CONNEXION
// ═══════════════════════════════════════════════════════════

async function populateProfiles() {
    try {
        const response = await fetch('/api/settings/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        if (!response.ok) throw new Error('Impossible de récupérer les settings');

        const data = await response.json();
        const profiles = data?.connectionProfiles ?? [];

        const $select = $('#cp-connection-profile');
        const currentVal = settings.connectionProfile;
        $select.empty();
        $select.append('<option value="">— Sélectionner un profil —</option>');

        for (const profile of profiles) {
            const name = profile.name ?? profile;
            $select.append(`<option value="${name}">${name}</option>`);
        }

        if (currentVal) $select.val(currentVal);

    } catch (e) {
        console.warn(`[${MODULE}] Impossible de charger les profils:`, e);
        // Fallback : champ libre
        const $select = $('#cp-connection-profile');
        if ($select.find('option').length <= 1) {
            $select.after('<small style="color:var(--SmartThemeBodyColor,#aaa);opacity:0.6;display:block;margin-top:3px;">Impossible de charger les profils automatiquement.</small>');
        }
    }
}

// ═══════════════════════════════════════════════════════════
// RENDER PANNEAU
// ═══════════════════════════════════════════════════════════

function renderPanel() {
    // Appliquer les settings dans les champs
    if (settings.connectionProfile) {
        $('#cp-connection-profile').val(settings.connectionProfile);
    }
    $('#cp-lorebook-prefix').val(settings.lorebookPrefix);
    $('#cp-auto-set-book').prop('checked', settings.autoSetBook);

    if (!currentChapterPlan) {
        $('#cp-chapter-number').text('—');
        $('#cp-lorebook-name').text('Aucun');
        $('#cp-chapter-length').text('—');
        $('#cp-event-count').text('—');
        $('#cp-events-list').html('<div class="cp-empty-state">Aucun chapitre planifié</div>');
        return;
    }

    const plan = currentChapterPlan;
    const lorebookName = `${settings.lorebookPrefix} ${plan.chapterNumber}`;

    $('#cp-chapter-number').text(plan.chapterNumber);
    $('#cp-lorebook-name').text(lorebookName);
    $('#cp-chapter-length').text(`${plan.chapter.length} réponses bot`);
    $('#cp-event-count').text(`${plan.events.length} événement${plan.events.length > 1 ? 's' : ''}`);

    renderEventsList(plan.events);
}

function renderEventsList(events) {
    const $list = $('#cp-events-list');
    $list.empty();

    if (!events || events.length === 0) {
        $list.html('<div class="cp-empty-state">Aucun événement planifié</div>');
        return;
    }

    for (const ev of events) {
        const card = `
            <div class="cp-event-card" title="${escapeHtml(ev.purpose)}">
                <div class="cp-event-header">
                    <span class="cp-event-position">chat:${ev.position}</span>
                    <span class="cp-event-title">${escapeHtml(ev.title)}</span>
                </div>
                <div class="cp-event-purpose">${escapeHtml(ev.purpose)}</div>
            </div>
        `;
        $list.append(card);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════
// ÉVÉNEMENTS CHAT
// ═══════════════════════════════════════════════════════════

async function onChatChanged() {
    await loadSavedChapterPlan();
    renderPanel();
}

// ═══════════════════════════════════════════════════════════
// CRÉATION DE CHAPITRE — FLUX PRINCIPAL
// ═══════════════════════════════════════════════════════════

/**
 * Déclenche la création d'un chapitre.
 * @param {boolean} regenerate - Si true, régénère le chapitre actuel. Sinon, passe au suivant.
 */
async function onCreateChapter(regenerate = false) {
    // Vérifications préalables
    if (!settings.connectionProfile) {
        toastr.warning('Veuillez sélectionner un profil de connexion dans les paramètres de l\'extension.');
        return;
    }

    const { chat } = SillyTavern.getContext();
    if (!chat || chat.length === 0) {
        toastr.warning('Aucun chat actif. Commencez un roleplay avant de planifier un chapitre.');
        return;
    }

    // Confirmation pour régénération
    if (regenerate && currentChapterPlan) {
        const { Popup } = SillyTavern.getContext();
        const confirmed = await Popup.show.confirm(
            'Régénérer le chapitre ?',
            `Le chapitre ${currentChapterPlan.chapterNumber} et son Lorebook seront entièrement recréés. Continuer ?`
        );
        if (!confirmed) return;
    }

    // Déterminer le numéro du chapitre
    const chapterNumber = regenerate && currentChapterPlan
        ? currentChapterPlan.chapterNumber
        : (currentChapterPlan ? currentChapterPlan.chapterNumber + 1 : 1);

    // Désactiver les boutons
    setFloatBtnLoading(true);
    $('#cp-btn-next-chapter, #cp-btn-reset-chapter').prop('disabled', true);

    try {
        toastr.info(`Planification du chapitre ${chapterNumber}…`, '', { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false });

        // 1. Générer le plan narratif
        const plan = await generateChapterPlan(chapterNumber);

        toastr.clear();
        toastr.info(`Plan généré — création du Lorebook…`, '', { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false });

        // 2. Créer / réinitialiser le Lorebook
        const lorebookName = `${settings.lorebookPrefix} ${chapterNumber}`;
        await createOrResetLorebook(lorebookName, plan.events);

        // 3. Lier le Lorebook au chat si option activée
        if (settings.autoSetBook) {
            await linkLorebookToChat(lorebookName);
        }

        // 4. Sauvegarder le plan dans chatMetadata
        currentChapterPlan = { chapterNumber, ...plan };
        await saveChapterPlan(currentChapterPlan);

        // 5. Rafraîchir l'affichage
        renderPanel();

        toastr.clear();
        toastr.success(`Chapitre ${chapterNumber} planifié — ${plan.events.length} événement${plan.events.length > 1 ? 's' : ''} créé${plan.events.length > 1 ? 's' : ''} dans le Lorebook "${lorebookName}".`);

    } catch (err) {
        toastr.clear();
        console.error(`[${MODULE}] Erreur création chapitre:`, err);
        toastr.error(`Erreur : ${err.message}`);
    } finally {
        setFloatBtnLoading(false);
        $('#cp-btn-next-chapter, #cp-btn-reset-chapter').prop('disabled', false);
    }
}

// ═══════════════════════════════════════════════════════════
// GÉNÉRATION DU PLAN NARRATIF
// ═══════════════════════════════════════════════════════════

async function generateChapterPlan(chapterNumber) {
    const { generateQuietPrompt, getPresetManager } = SillyTavern.getContext();

    // Activer temporairement le profil Chapter Planner
    const previousProfile = await activateProfile(settings.connectionProfile);

    try {
        const contextPrompt = buildChapterContextPrompt(chapterNumber);
        const fullPrompt = `${contextPrompt}\n\n${CHAPTER_PLANNER_PROMPT}`;

        const rawResult = await generateQuietPrompt({
            quietPrompt: fullPrompt,
        });

        if (!rawResult || rawResult.trim() === '') {
            throw new Error('Le modèle n\'a retourné aucune réponse.');
        }

        // Parser le JSON
        const plan = parseChapterJSON(rawResult);
        validatePlan(plan);

        return plan;

    } finally {
        // Restaurer le profil précédent
        if (previousProfile) {
            await activateProfile(previousProfile);
        }
    }
}

function buildChapterContextPrompt(chapterNumber) {
    const lines = [
        `## Contexte de planification`,
        ``,
        `Tu dois planifier le CHAPITRE ${chapterNumber} du roleplay en cours.`,
        ``,
    ];

    if (currentChapterPlan && chapterNumber > 1) {
        lines.push(`Le chapitre précédent (Chapitre ${currentChapterPlan.chapterNumber}) était : "${currentChapterPlan.chapter.title}"`);
        lines.push(`Tonalité précédente : ${currentChapterPlan.chapter.tone}`);
        lines.push(`Conclusion du chapitre précédent : ${currentChapterPlan.chapter.conclusion}`);
        lines.push('');
    }

    lines.push(`Génère maintenant le plan complet du Chapitre ${chapterNumber}.`);

    return lines.join('\n');
}

function parseChapterJSON(raw) {
    // Nettoyer les backticks markdown si présents
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    cleaned = cleaned.trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Tentative de récupération : trouver le premier { et dernier }
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            try {
                return JSON.parse(cleaned.slice(start, end + 1));
            } catch (_) { /* ignore */ }
        }
        throw new Error(`Impossible de parser le JSON retourné par le modèle : ${e.message}`);
    }
}

function validatePlan(plan) {
    if (!plan.chapter) throw new Error('Le plan ne contient pas de champ "chapter".');
    if (typeof plan.chapter.length !== 'number') throw new Error('Le plan ne contient pas de "length" valide.');
    if (!Array.isArray(plan.events)) throw new Error('Le plan ne contient pas de tableau "events".');

    const len = plan.chapter.length;
    if (len < 3 || len > 70) throw new Error(`Longueur de chapitre invalide : ${len}. Doit être entre 3 et 70.`);

    for (const ev of plan.events) {
        if (typeof ev.position !== 'number' || ev.position < 1 || ev.position > len) {
            throw new Error(`Événement avec position invalide : ${ev.position} (longueur du chapitre : ${len}).`);
        }
    }
}

// ═══════════════════════════════════════════════════════════
// GESTION DU PROFIL DE CONNEXION
// ═══════════════════════════════════════════════════════════

async function activateProfile(profileName) {
    if (!profileName) return null;

    try {
        // Récupérer le profil actif actuellement
        const currentResponse = await fetch('/api/settings/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const currentData = await currentResponse.json();
        const previousProfile = currentData?.activeConnectionProfile ?? null;

        // Activer le profil demandé via STscript
        const { executeSlashCommandsWithOptions } = SillyTavern.getContext();
        if (executeSlashCommandsWithOptions) {
            await executeSlashCommandsWithOptions(`/profile ${profileName}`);
        }

        return previousProfile;
    } catch (e) {
        console.warn(`[${MODULE}] Impossible de changer de profil:`, e);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════
// GESTION DU LOREBOOK
// ═══════════════════════════════════════════════════════════

/**
 * Construit le JSON d'un Lorebook à partir d'un tableau d'événements.
 */
function buildLorebookData(lorebookName, events) {
    const entries = {};

    events.forEach((ev, index) => {
        const uid = index + 1;
        const key = `chat:${ev.position}`;

        // Construire le contenu de l'entrée
        const contentLines = [
            `[Événement narratif — ${ev.title}]`,
            `Objectif : ${ev.purpose}`,
            ``,
            ev.event,
        ];

        if (ev.characters && ev.characters.length > 0) {
            contentLines.push(``, `Personnages impliqués : ${ev.characters.join(', ')}`);
        }

        if (ev.constraints && ev.constraints.length > 0) {
            contentLines.push(``, `Contraintes :`, ...ev.constraints.map(c => `- ${c}`));
        }

        entries[String(uid)] = {
            uid,
            key: [key],
            keysecondary: [],
            comment: ev.title,
            content: contentLines.join('\n'),
            constant: false,
            vectorized: false,
            selective: false,
            selectiveLogic: 0,
            addMemo: true,
            order: 100,
            position: 0,
            disable: false,
            excludeRecursion: false,
            preventRecursion: false,
            delayUntilRecursion: false,
            probability: 100,
            useProbability: false,
            depth: 4,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            automationId: '',
            role: null,
            sticky: 1,
            cooldown: 0,
            delay: 0,
            displayIndex: index,
        };
    });

    return {
        name: lorebookName,
        entries,
        originalData: {
            entries: Object.values(entries),
        },
    };
}

/**
 * Crée ou réinitialise le Lorebook du chapitre via l'API backend.
 */
async function createOrResetLorebook(lorebookName, events) {
    const lorebookData = buildLorebookData(lorebookName, events);

    const response = await fetch('/api/worldinfo/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: lorebookName,
            data: lorebookData,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Erreur lors de la création du Lorebook : ${response.status} — ${text}`);
    }

    // Notifier SillyTavern que le World Info a changé
    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.emit(event_types.WORLDINFO_UPDATED);

    console.log(`[${MODULE}] Lorebook "${lorebookName}" créé avec ${events.length} entrées`);
}

/**
 * Lie le Lorebook au chat actif via la commande /setchatbook.
 */
async function linkLorebookToChat(lorebookName) {
    try {
        const { executeSlashCommandsWithOptions } = SillyTavern.getContext();
        if (executeSlashCommandsWithOptions) {
            await executeSlashCommandsWithOptions(`/setchatbook ${lorebookName}`);
            console.log(`[${MODULE}] Lorebook "${lorebookName}" lié au chat`);
        }
    } catch (e) {
        console.warn(`[${MODULE}] Impossible de lier le Lorebook au chat:`, e);
        toastr.warning(`Le Lorebook a été créé mais n'a pas pu être lié automatiquement au chat. Faites-le manuellement via /setchatbook ${lorebookName}`);
    }
}
