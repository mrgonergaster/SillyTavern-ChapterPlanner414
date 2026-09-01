/**
 * Chapter Planner — SillyTavern Extension v1.1
 * Planification automatique de chapitres en roleplay.
 * Utilise l'API getContext() officielle de SillyTavern.
 */

const MODULE = 'chapter_planner';

const DEFAULT_SETTINGS = {
    connectionProfile: '',
    lorebookPrefix: 'Chapitre',
    autoSetBook: true,
};

const CHAPTER_PLANNER_PROMPT = `Your task is to design ONE complete narrative chapter for the CURRENT roleplay. This is NOT a script and it is NOT a sequence of predetermined actions. It is a flexible narrative framework describing what {{char}}, NPCs, factions and the world may do while preserving complete agency for {{user}}.

Base your planning on ALL relevant information available in the current conversation context.
The actual roleplay is CANON. Do not invent previous events that did not happen.

NEVER determine anything for {{user}}: not their actions, dialogue, thoughts, emotions, intentions, decisions, consent, or physical reactions.

A chapter can be: a quiet moment, a conversation, an investigation, a journey, combat, romance, tragedy, or a major turning point. A quiet chapter is completely valid.

Choose the chapter length yourself (3 to 70 BOT RESPONSES):
- 3-7: Very short. Small development.
- 8-14: Short. Limited but meaningful.
- 15-25: Medium. Several developments.
- 26-40: Long. Substantial development.
- 41-55: Major. Multiple complications.
- 56-70: Exceptional. Extensive development.

NEVER add filler. Create only events that genuinely structure the chapter. Do NOT create an event for every position.

Return ONLY valid JSON, no markdown, no code blocks:
{
  "chapter": {
    "title": "string",
    "length": 12,
    "tone": "string",
    "pacing": { "intensity": "low|medium|high|variable", "rhythm": "slow|moderate|fast|variable", "reason_for_length": "string" },
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
}`;

// ═══════════════════════════════════════════════════════
// ÉTAT
// ═══════════════════════════════════════════════════════
let currentChapterPlan = null;

// ═══════════════════════════════════════════════════════
// INIT — attendre que ST soit prêt
// ═══════════════════════════════════════════════════════
jQuery(async () => {
    const ctx = SillyTavern.getContext();

    // Initialiser les settings
    if (!ctx.extensionSettings[MODULE]) {
        ctx.extensionSettings[MODULE] = { ...DEFAULT_SETTINGS };
    }
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (ctx.extensionSettings[MODULE][key] === undefined) {
            ctx.extensionSettings[MODULE][key] = DEFAULT_SETTINGS[key];
        }
    }

    // Injecter le panneau HTML dans les settings d'extensions
    const panelHtml = buildPanelHTML();
    $('#extensions_settings2').append(panelHtml);

    // Bouton flottant
    injectFloatButton();

    // Lier les événements UI
    bindUI();

    // Charger le plan du chat courant
    loadPlanFromMetadata();
    renderPanel();

    // Écouter les changements de chat
    ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
        loadPlanFromMetadata();
        renderPanel();
    });

    console.log(`[${MODULE}] Extension chargée ✓`);
});

// ═══════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════
function getSettings() {
    return SillyTavern.getContext().extensionSettings[MODULE];
}

// ═══════════════════════════════════════════════════════
// PERSISTANCE
// ═══════════════════════════════════════════════════════
function loadPlanFromMetadata() {
    try {
        const { chatMetadata } = SillyTavern.getContext();
        currentChapterPlan = chatMetadata?.[`${MODULE}_plan`] ?? null;
    } catch {
        currentChapterPlan = null;
    }
}

async function savePlanToMetadata(plan) {
    const ctx = SillyTavern.getContext();
    if (ctx.chatMetadata) {
        ctx.chatMetadata[`${MODULE}_plan`] = plan;
        ctx.saveMetadata?.();
    }
}

// ═══════════════════════════════════════════════════════
// HTML DU PANNEAU (inline pour éviter renderExtensionTemplateAsync)
// ═══════════════════════════════════════════════════════
function buildPanelHTML() {
    return `
<div class="cp-panel">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <span>📖</span>
      <b>Chapter Planner</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">

      <div class="cp-status-block">
        <div class="cp-status-row">
          <span class="cp-label">Chapitre actif</span>
          <span class="cp-chapter-badge" id="cp-chapter-number">—</span>
        </div>
        <div class="cp-status-row">
          <span class="cp-label">Lorebook</span>
          <span class="cp-lorebook-name" id="cp-lorebook-name">Aucun</span>
        </div>
        <div class="cp-status-row">
          <span class="cp-label">Longueur prévue</span>
          <span class="cp-value" id="cp-chapter-length">—</span>
        </div>
        <div class="cp-status-row">
          <span class="cp-label">Événements</span>
          <span class="cp-value" id="cp-event-count">—</span>
        </div>
      </div>

      <div class="cp-section-title">Événements du chapitre</div>
      <div id="cp-events-list" class="cp-events-list">
        <div class="cp-empty-state">Aucun chapitre planifié</div>
      </div>

      <hr class="cp-divider">

      <div class="cp-section-title">Configuration</div>

      <label class="cp-field-label">Profil de connexion (Chapter Planner)</label>
      <div class="cp-select-row">
        <select id="cp-connection-profile" class="cp-select text_pole">
          <option value="">— Sélectionner un profil —</option>
        </select>
        <button id="cp-refresh-profiles" class="menu_button cp-icon-btn" title="Actualiser">
          <i class="fa-solid fa-rotate"></i>
        </button>
      </div>

      <label class="cp-field-label">Préfixe des Lorebooks</label>
      <input id="cp-lorebook-prefix" type="text" class="text_pole cp-input" value="Chapitre" />

      <div class="cp-checkbox-row">
        <input type="checkbox" id="cp-auto-set-book" checked />
        <label for="cp-auto-set-book">Lier automatiquement le Lorebook au chat</label>
      </div>

      <hr class="cp-divider">

      <div class="cp-actions">
        <button id="cp-btn-next-chapter" class="menu_button cp-btn cp-btn-primary">
          <i class="fa-solid fa-book-open"></i> Créer le chapitre suivant
        </button>
        <button id="cp-btn-reset-chapter" class="menu_button cp-btn cp-btn-danger">
          <i class="fa-solid fa-rotate-left"></i> Régénérer le chapitre actuel
        </button>
      </div>

    </div>
  </div>
</div>`;
}

// ═══════════════════════════════════════════════════════
// BOUTON FLOTTANT
// ═══════════════════════════════════════════════════════
function injectFloatButton() {
    if ($('#cp-float-btn').length) return;
    $('body').append(`
        <button id="cp-float-btn" title="Chapter Planner — Créer le chapitre suivant">
            <i class="fa-solid fa-book-bookmark"></i>
        </button>
    `);
    $('#cp-float-btn').on('click', () => onCreateChapter(false));
}

function setFloatBtnLoading(loading) {
    const $btn = $('#cp-float-btn');
    $btn.prop('disabled', loading);
    $btn.html(loading
        ? '<i class="fa-solid fa-spinner cp-float-spinner"></i>'
        : '<i class="fa-solid fa-book-bookmark"></i>'
    );
}

// ═══════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════
function bindUI() {
    $(document).on('click', '#cp-btn-next-chapter', () => onCreateChapter(false));
    $(document).on('click', '#cp-btn-reset-chapter', () => onCreateChapter(true));
    $(document).on('click', '#cp-refresh-profiles', async () => {
        await populateProfiles();
        toastr.info('Profils actualisés');
    });
    $(document).on('change', '#cp-connection-profile', () => {
        getSettings().connectionProfile = $('#cp-connection-profile').val();
        SillyTavern.getContext().saveSettingsDebounced();
    });
    $(document).on('input', '#cp-lorebook-prefix', () => {
        getSettings().lorebookPrefix = $('#cp-lorebook-prefix').val() || 'Chapitre';
        SillyTavern.getContext().saveSettingsDebounced();
    });
    $(document).on('change', '#cp-auto-set-book', () => {
        getSettings().autoSetBook = $('#cp-auto-set-book').prop('checked');
        SillyTavern.getContext().saveSettingsDebounced();
    });

    // Charger les profils une fois le DOM prêt
    populateProfiles();
}

async function populateProfiles() {
    try {
        const r = await fetch('/api/settings/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        if (!r.ok) throw new Error();
        const data = await r.json();
        const profiles = data?.connectionProfiles ?? [];
        const $sel = $('#cp-connection-profile');
        const current = getSettings().connectionProfile;
        $sel.empty().append('<option value="">— Sélectionner un profil —</option>');
        for (const p of profiles) {
            const name = typeof p === 'string' ? p : p.name;
            $sel.append(`<option value="${name}">${name}</option>`);
        }
        if (current) $sel.val(current);
    } catch {
        console.warn(`[${MODULE}] Impossible de charger les profils`);
    }
}

function renderPanel() {
    const s = getSettings();
    if (s.connectionProfile) $('#cp-connection-profile').val(s.connectionProfile);
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

    const { chapterNumber, chapter, events } = currentChapterPlan;
    const lbName = `${s.lorebookPrefix} ${chapterNumber}`;
    $('#cp-chapter-number').text(chapterNumber);
    $('#cp-lorebook-name').text(lbName);
    $('#cp-chapter-length').text(`${chapter.length} réponses bot`);
    $('#cp-event-count').text(`${events.length} événement${events.length > 1 ? 's' : ''}`);

    const $list = $('#cp-events-list').empty();
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

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════
// CRÉATION DE CHAPITRE
// ═══════════════════════════════════════════════════════
async function onCreateChapter(regenerate = false) {
    const s = getSettings();
    const ctx = SillyTavern.getContext();

    if (!s.connectionProfile) {
        toastr.warning('Sélectionnez un profil de connexion dans les paramètres Chapter Planner.');
        return;
    }
    if (!ctx.chat?.length) {
        toastr.warning('Aucun chat actif.');
        return;
    }

    if (regenerate && currentChapterPlan) {
        const ok = await ctx.Popup?.show?.confirm(
            'Régénérer le chapitre ?',
            `Le chapitre ${currentChapterPlan.chapterNumber} sera entièrement recréé.`
        );
        if (!ok) return;
    }

    const chapterNumber = (regenerate && currentChapterPlan)
        ? currentChapterPlan.chapterNumber
        : (currentChapterPlan ? currentChapterPlan.chapterNumber + 1 : 1);

    setFloatBtnLoading(true);
    $('#cp-btn-next-chapter, #cp-btn-reset-chapter').prop('disabled', true);
    toastr.info(`Planification du chapitre ${chapterNumber}…`, '', { timeOut: 0, tapToDismiss: false });

    try {
        // 1. Changer de profil
        await ctx.executeSlashCommandsWithOptions?.(`/profile ${s.connectionProfile}`);

        // 2. Construire le prompt contextuel
        let contextHint = `Tu dois planifier le CHAPITRE ${chapterNumber}`;
        if (currentChapterPlan && chapterNumber > 1) {
            contextHint += `. Chapitre précédent : "${currentChapterPlan.chapter.title}" (${currentChapterPlan.chapter.tone}). Conclusion : ${currentChapterPlan.chapter.conclusion}`;
        }
        const fullPrompt = `${contextHint}.\n\n${CHAPTER_PLANNER_PROMPT}`;

        // 3. Générer le plan
        const raw = await ctx.generateQuietPrompt(fullPrompt, false, false);
        if (!raw?.trim()) throw new Error('Le modèle n\'a rien retourné.');

        const plan = parseJSON(raw);
        validatePlan(plan);

        toastr.clear();
        toastr.info('Création du Lorebook…', '', { timeOut: 0, tapToDismiss: false });

        // 4. Créer le Lorebook
        const lbName = `${s.lorebookPrefix} ${chapterNumber}`;
        await createLorebook(lbName, plan.events);

        // 5. Lier au chat
        if (s.autoSetBook) {
            await ctx.executeSlashCommandsWithOptions?.(`/setchatbook ${lbName}`);
        }

        // 6. Sauvegarder et afficher
        currentChapterPlan = { chapterNumber, ...plan };
        await savePlanToMetadata(currentChapterPlan);
        renderPanel();

        toastr.clear();
        toastr.success(`Chapitre ${chapterNumber} prêt — ${plan.events.length} événement(s) dans "${lbName}".`);

    } catch (err) {
        toastr.clear();
        console.error(`[${MODULE}]`, err);
        toastr.error(`Erreur : ${err.message}`);
    } finally {
        setFloatBtnLoading(false);
        $('#cp-btn-next-chapter, #cp-btn-reset-chapter').prop('disabled', false);
    }
}

// ═══════════════════════════════════════════════════════
// JSON
// ═══════════════════════════════════════════════════════
function parseJSON(raw) {
    let s = raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();
    try { return JSON.parse(s); } catch {}
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a !== -1 && b !== -1) try { return JSON.parse(s.slice(a, b+1)); } catch {}
    throw new Error('JSON invalide retourné par le modèle.');
}

function validatePlan(plan) {
    if (!plan?.chapter) throw new Error('Champ "chapter" manquant.');
    if (typeof plan.chapter.length !== 'number') throw new Error('"length" invalide.');
    if (!Array.isArray(plan.events)) throw new Error('"events" manquant.');
    const len = plan.chapter.length;
    if (len < 3 || len > 70) throw new Error(`Longueur invalide : ${len}`);
    for (const ev of plan.events)
        if (ev.position < 1 || ev.position > len) throw new Error(`Position invalide : ${ev.position}`);
}

// ═══════════════════════════════════════════════════════
// LOREBOOK
// ═══════════════════════════════════════════════════════
async function createLorebook(name, events) {
    const entries = {};
    events.forEach((ev, i) => {
        const uid = i + 1;
        const lines = [`[Événement — ${ev.title}]`, `Objectif : ${ev.purpose}`, '', ev.event];
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

    const r = await fetch('/api/worldinfo/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data: { name, entries } }),
    });

    if (!r.ok) throw new Error(`Erreur Lorebook (${r.status}): ${await r.text()}`);
    console.log(`[${MODULE}] Lorebook "${name}" créé avec ${events.length} entrées`);
}
