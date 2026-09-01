/**
 * Chapter Planner — SillyTavern Extension
 * Gère la planification automatique de chapitres en roleplay.
 */

import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
    saveMetadataDebounced,
} from '../../../extensions.js';

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    generateQuietPrompt,
    chat_metadata,
    substituteParams,
} from '../../../../script.js';

import { executeSlashCommands } from '../../../slash-commands.js';
import { worldInfoCache } from '../../../world-info.js';

// ═══════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════

const MODULE = 'chapter_planner';

const DEFAULT_SETTINGS = {
    connectionProfile: '',
    lorebookPrefix: 'Chapitre',
    autoSetBook: true,
};

const CHAPTER_PLANNER_PROMPT = `Your task is to design ONE complete narrative chapter for the CURRENT roleplay. This is NOT a script and it is NOT a sequence of predetermined actions. It is a flexible narrative framework describing what {{char}}, NPCs, factions and the world may do while preserving complete agency for {{user}}.

================================================== AVAILABLE CONTEXT ==================================================
Base your planning on ALL relevant information available in the current conversation context, including:
- {{char}}'s definition - {{user}}'s definition - the current scenario - the established roleplay history
- established relationships - unresolved conflicts - established worldbuilding
- consequences of previous events - the current narrative and emotional situation
The actual roleplay is CANON. Do not invent previous events that did not happen.

================================================== ABSOLUTE USER AGENCY ==================================================
NEVER determine anything for {{user}}. You must NEVER predetermine:
- {{user}}'s actions - {{user}}'s dialogue - {{user}}'s thoughts - {{user}}'s emotions
- {{user}}'s intentions - {{user}}'s decisions - {{user}}'s consent - {{user}}'s physical reactions
You may create situations involving {{user}}. You may place {{user}} in danger.
You may have NPCs speak to {{user}}. You may have {{char}} react to {{user}}.
But {{user}} must always be free to decide what they do.

================================================== CHAPTER PHILOSOPHY ==================================================
A chapter is a narrative unit, NOT necessarily a dramatic arc. A chapter may be:
a quiet character moment, a conversation, a relationship development, an investigation,
a journey, exploration, slice of life, comedy, romance, mystery, political development,
escalating conflict, combat, tragedy, a major turning point.
Do NOT assume every chapter needs: combat, an antagonist, a betrayal, a crisis, a dramatic climax.
A quiet chapter is completely valid.

================================================== PACING AND LENGTH ==================================================
Choose the chapter length yourself. The chapter must contain between 3 and 70 BOT RESPONSES.
- 3-7: Very short. Small development, brief interaction, minor event.
- 8-14: Short. Limited but meaningful development.
- 15-25: Medium. Several meaningful developments.
- 26-40: Long. Substantial character, relationship, world or conflict development.
- 41-55: Major. Multiple complications or significant consequences.
- 56-70: Exceptional. Extensive development required.
NEVER add filler. A short chapter that ends naturally is better than a long padded one.

================================================== STRUCTURE ==================================================
Create three broad narrative phases:
BEGINNING: Introduce, establish or develop the chapter's central situation.
MIDDLE: Develop through meaningful interactions, complications, discoveries or consequences.
CONCLUSION: Reach a satisfying natural stopping point.

================================================== EVENT PLANNING ==================================================
Create only the events that genuinely help structure the chapter.
Each event must contain: position, title, purpose, event, characters, constraints.
POSITION = which bot response number triggers this event.
Do NOT create an event for every position. Leave room for free roleplay.

================================================== OUTPUT ==================================================
Return ONLY valid JSON. No markdown. No code blocks. Exactly this structure:
{
  "chapter": {
    "title": "string",
    "length": 12,
    "tone": "string",
    "pacing": { "intensity": "low|medium|high|variable", "rhythm": "slow|moderate|fast|variable", "reason_for_length": "string" },
    "beginning": "string", "middle": "string", "conclusion": "string"
  },
  "events": [
    { "position": 5, "title": "string", "purpose": "string", "event": "string", "characters": ["string"], "constraints": ["string"] }
  ]
}
Rules: length 3-70. position 1 to length. events ordered. events NOT at every position.`;

// ═══════════════════════════════════════════════════════════
// ÉTAT
// ═══════════════════════════════════════════════════════════

let currentChapterPlan = null;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

jQuery(async () => {
    // Initialiser les settings
    if (!extension_settings[MODULE]) {
        extension_settings[MODULE] = Object.assign({}, DEFAULT_SETTINGS);
    }
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (extension_settings[MODULE][key] === undefined) {
            extension_settings[MODULE][key] = DEFAULT_SETTINGS[key];
        }
    }

    // Injecter le panneau HTML
    const html = await renderExtensionTemplateAsync(`third-party/${MODULE}`, 'settings');
    $('#extensions_settings2').append(html);

    // Bouton flottant
    injectFloatButton();

    // Lier les événements UI
    bindUI();

    // Remplir la liste des profils
    await populateProfiles();

    // Charger le plan depuis les metadata du chat courant
    loadPlanFromMetadata();

    // Rafraîchir le panneau
    renderPanel();

    // Écouter les changements de chat
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    console.log(`[${MODULE}] Initialisé`);
});

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════

function getSettings() {
    return extension_settings[MODULE];
}

// ═══════════════════════════════════════════════════════════
// PERSISTANCE (chat_metadata)
// ═══════════════════════════════════════════════════════════

function loadPlanFromMetadata() {
    try {
        currentChapterPlan = chat_metadata[`${MODULE}_plan`] ?? null;
    } catch (e) {
        currentChapterPlan = null;
    }
}

async function savePlanToMetadata(plan) {
    chat_metadata[`${MODULE}_plan`] = plan;
    saveMetadataDebounced();
}

async function clearPlanFromMetadata() {
    delete chat_metadata[`${MODULE}_plan`];
    saveMetadataDebounced();
}

// ═══════════════════════════════════════════════════════════
// BOUTON FLOTTANT
// ═══════════════════════════════════════════════════════════

function injectFloatButton() {
    if ($('#cp-float-btn').length) return;
    const btn = $(`
        <button id="cp-float-btn" title="Chapter Planner">
            <i class="fa-solid fa-book-bookmark"></i>
            <span class="cp-float-tooltip">Créer le chapitre suivant</span>
        </button>
    `);
    btn.on('click', () => onCreateChapter(false));
    $('body').append(btn);
}

function setFloatBtnLoading(loading) {
    const btn = $('#cp-float-btn');
    btn.prop('disabled', loading);
    btn.html(loading
        ? '<i class="fa-solid fa-spinner cp-float-spinner"></i><span class="cp-float-tooltip">Génération…</span>'
        : '<i class="fa-solid fa-book-bookmark"></i><span class="cp-float-tooltip">Créer le chapitre suivant</span>'
    );
}

// ═══════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════

function bindUI() {
    $(document).on('click', '#cp-btn-next-chapter', () => onCreateChapter(false));
    $(document).on('click', '#cp-btn-reset-chapter', () => onCreateChapter(true));
    $(document).on('click', '#cp-refresh-profiles', async () => {
        await populateProfiles();
        toastr.info('Profils actualisés');
    });
    $(document).on('change', '#cp-connection-profile', () => {
        getSettings().connectionProfile = $('#cp-connection-profile').val();
        saveSettingsDebounced();
    });
    $(document).on('input', '#cp-lorebook-prefix', () => {
        getSettings().lorebookPrefix = $('#cp-lorebook-prefix').val() || 'Chapitre';
        saveSettingsDebounced();
    });
    $(document).on('change', '#cp-auto-set-book', () => {
        getSettings().autoSetBook = $('#cp-auto-set-book').prop('checked');
        saveSettingsDebounced();
    });
}

async function populateProfiles() {
    try {
        const response = await fetch('/api/settings/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        if (!response.ok) throw new Error('Échec');
        const data = await response.json();
        const profiles = data?.connectionProfiles ?? [];
        const $select = $('#cp-connection-profile');
        const current = getSettings().connectionProfile;
        $select.empty().append('<option value="">— Sélectionner un profil —</option>');
        for (const p of profiles) {
            const name = typeof p === 'string' ? p : p.name;
            $select.append(`<option value="${name}">${name}</option>`);
        }
        if (current) $select.val(current);
    } catch (e) {
        console.warn(`[${MODULE}] Impossible de charger les profils:`, e);
    }
}

function renderPanel() {
    const s = getSettings();
    $('#cp-connection-profile').val(s.connectionProfile);
    $('#cp-lorebook-prefix').val(s.lorebookPrefix);
    $('#cp-auto-set-book').prop('checked', s.autoSetBook);

    if (!currentChapterPlan) {
        $('#cp-chapter-number').text('—');
        $('#cp-lorebook-name').text('Aucun');
        $('#cp-chapter-length').text('—');
        $('#cp-event-count').text('—');
        $('#cp-events-list').html('<div class="cp-empty-state">Aucun chapitre planifié</div>');
        return;
    }

    const plan = currentChapterPlan;
    const lorebookName = `${s.lorebookPrefix} ${plan.chapterNumber}`;
    $('#cp-chapter-number').text(plan.chapterNumber);
    $('#cp-lorebook-name').text(lorebookName);
    $('#cp-chapter-length').text(`${plan.chapter.length} réponses bot`);
    $('#cp-event-count').text(`${plan.events.length} événement${plan.events.length > 1 ? 's' : ''}`);
    renderEventsList(plan.events);
}

function renderEventsList(events) {
    const $list = $('#cp-events-list');
    $list.empty();
    if (!events?.length) {
        $list.html('<div class="cp-empty-state">Aucun événement planifié</div>');
        return;
    }
    for (const ev of events) {
        $list.append(`
            <div class="cp-event-card" title="${esc(ev.purpose)}">
                <div class="cp-event-header">
                    <span class="cp-event-position">chat:${ev.position}</span>
                    <span class="cp-event-title">${esc(ev.title)}</span>
                </div>
                <div class="cp-event-purpose">${esc(ev.purpose)}</div>
            </div>
        `);
    }
}

function esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════════
// ÉVÉNEMENTS
// ═══════════════════════════════════════════════════════════

function onChatChanged() {
    loadPlanFromMetadata();
    renderPanel();
}

// ═══════════════════════════════════════════════════════════
// CRÉATION DE CHAPITRE
// ═══════════════════════════════════════════════════════════

async function onCreateChapter(regenerate = false) {
    const s = getSettings();

    if (!s.connectionProfile) {
        toastr.warning('Sélectionnez un profil de connexion dans les paramètres de l\'extension.');
        return;
    }

    const ctx = getContext();
    if (!ctx.chat?.length) {
        toastr.warning('Aucun chat actif.');
        return;
    }

    if (regenerate && currentChapterPlan) {
        const confirmed = await callPopup(
            `Régénérer le chapitre ${currentChapterPlan.chapterNumber} ? Son Lorebook sera entièrement recréé.`,
            'confirm'
        );
        if (!confirmed) return;
    }

    const chapterNumber = (regenerate && currentChapterPlan)
        ? currentChapterPlan.chapterNumber
        : (currentChapterPlan ? currentChapterPlan.chapterNumber + 1 : 1);

    setFloatBtnLoading(true);
    $('#cp-btn-next-chapter, #cp-btn-reset-chapter').prop('disabled', true);

    toastr.info(`Planification du chapitre ${chapterNumber}…`, '', { timeOut: 0, tapToDismiss: false });

    try {
        // 1. Changer de profil
        await executeSlashCommands(`/profile ${s.connectionProfile}`);

        // 2. Générer le plan
        const contextHint = currentChapterPlan
            ? `Tu dois planifier le CHAPITRE ${chapterNumber}. Le chapitre précédent était : "${currentChapterPlan.chapter.title}" (${currentChapterPlan.chapter.tone}). Conclusion précédente : ${currentChapterPlan.chapter.conclusion}.`
            : `Tu dois planifier le CHAPITRE ${chapterNumber} (premier chapitre du roleplay).`;

        const fullPrompt = substituteParams(`${contextHint}\n\n${CHAPTER_PLANNER_PROMPT}`);
        const rawResult = await generateQuietPrompt(fullPrompt, false, false);

        if (!rawResult?.trim()) throw new Error('Le modèle n\'a retourné aucune réponse.');

        // 3. Parser le JSON
        const plan = parseJSON(rawResult);
        validatePlan(plan);

        toastr.clear();
        toastr.info('Création du Lorebook…', '', { timeOut: 0, tapToDismiss: false });

        // 4. Créer le Lorebook
        const lorebookName = `${s.lorebookPrefix} ${chapterNumber}`;
        await createLorebook(lorebookName, plan.events);

        // 5. Lier au chat
        if (s.autoSetBook) {
            await executeSlashCommands(`/setchatbook ${lorebookName}`);
        }

        // 6. Sauvegarder
        currentChapterPlan = { chapterNumber, ...plan };
        await savePlanToMetadata(currentChapterPlan);
        renderPanel();

        toastr.clear();
        toastr.success(`Chapitre ${chapterNumber} prêt — ${plan.events.length} événement(s) dans "${lorebookName}".`);

    } catch (err) {
        toastr.clear();
        console.error(`[${MODULE}]`, err);
        toastr.error(`Erreur : ${err.message}`);
    } finally {
        setFloatBtnLoading(false);
        $('#cp-btn-next-chapter, #cp-btn-reset-chapter').prop('disabled', false);
    }
}

// ═══════════════════════════════════════════════════════════
// JSON
// ═══════════════════════════════════════════════════════════

function parseJSON(raw) {
    let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try { return JSON.parse(s); } catch (_) {}
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a !== -1 && b !== -1) {
        try { return JSON.parse(s.slice(a, b + 1)); } catch (_) {}
    }
    throw new Error('Impossible de parser le JSON retourné par le modèle.');
}

function validatePlan(plan) {
    if (!plan?.chapter) throw new Error('Champ "chapter" manquant.');
    if (typeof plan.chapter.length !== 'number') throw new Error('Longueur de chapitre invalide.');
    if (!Array.isArray(plan.events)) throw new Error('Champ "events" manquant.');
    const len = plan.chapter.length;
    if (len < 3 || len > 70) throw new Error(`Longueur invalide : ${len}`);
    for (const ev of plan.events) {
        if (ev.position < 1 || ev.position > len) throw new Error(`Position invalide : ${ev.position}`);
    }
}

// ═══════════════════════════════════════════════════════════
// LOREBOOK
// ═══════════════════════════════════════════════════════════

async function createLorebook(name, events) {
    const entries = {};
    events.forEach((ev, i) => {
        const uid = i + 1;
        const lines = [
            `[Événement narratif — ${ev.title}]`,
            `Objectif : ${ev.purpose}`,
            '',
            ev.event,
        ];
        if (ev.characters?.length) lines.push('', `Personnages : ${ev.characters.join(', ')}`);
        if (ev.constraints?.length) lines.push('', 'Contraintes :', ...ev.constraints.map(c => `- ${c}`));

        entries[String(uid)] = {
            uid, key: [`chat:${ev.position}`], keysecondary: [],
            comment: ev.title, content: lines.join('\n'),
            constant: false, vectorized: false, selective: false,
            selectiveLogic: 0, addMemo: true, order: 100, position: 0,
            disable: false, excludeRecursion: false, preventRecursion: false,
            delayUntilRecursion: false, probability: 100, useProbability: false,
            depth: 4, group: '', groupOverride: false, groupWeight: 100,
            scanDepth: null, caseSensitive: null, matchWholeWords: null,
            useGroupScoring: null, automationId: '', role: null,
            sticky: 1, cooldown: 0, delay: 0, displayIndex: i,
        };
    });

    const response = await fetch('/api/worldinfo/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data: { name, entries } }),
    });

    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Erreur Lorebook (${response.status}): ${txt}`);
    }

    console.log(`[${MODULE}] Lorebook "${name}" créé avec ${events.length} entrées`);
}
