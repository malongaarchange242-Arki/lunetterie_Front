const API_URL = 'https://api-lunetterie.universearch.com/api/v1';
const MOVEMENTS_LIMIT = 300;

const ACTION_LABELS = {
    RECEPTION_FOURNISSEUR: 'Réception fournisseur',
    RANGEMENT: 'Rangement',
    EXPEDITION: 'Expédition',
    RECEPTION_STATION: 'Réception station',
    PRESENTOIR: 'Mise en présentoir',
    RETRAIT_PRESENTOIR: 'Retrait présentoir',
    RESERVATION: 'Réservation',
    LABORATOIRE: 'Envoi laboratoire',
    CONTROLE_QUALITE: 'Contrôle qualité',
    LIVRAISON: 'Livraison',
    RETOUR: 'Retour',
    INVENTAIRE: 'Inventaire',
    PERTE: 'Perte',
    CASSE: 'Casse'
};

// Les 4 étapes du parcours d'une monture. La correspondance se fait sur le nom
// de la station de destination du dernier mouvement (pas d'ID de station fixe,
// pour rester valable quel que soit le déploiement/tenant).
const STAGES = [
    { key: 'general', icon: 'ic-warehouse', label: 'Station Générale' },
    { key: 'local', icon: 'ic-inbox', label: 'Stock local' },
    { key: 'presentoir', icon: 'ic-store', label: 'En présentoir' },
    { key: 'laboratoire', icon: 'ic-flask', label: 'Au laboratoire' }
];
const STAGE_BY_KEY = STAGES.reduce(function (acc, s) { acc[s.key] = s; return acc; }, {});

const PERIODS = [
    { key: 'today', icon: 'ic-sun', label: 'Aujourd\'hui' },
    { key: 'week', icon: 'ic-calendar', label: 'Cette semaine' },
    { key: 'month', icon: 'ic-clipboard', label: 'Ce mois-ci' },
    { key: 'older', icon: 'ic-history', label: 'Plus ancien' }
];

const stageGrid = document.getElementById('stageGrid');
const stageOverview = document.getElementById('stageOverview');
const stageDetail = document.getElementById('stageDetail');
const stageDetailTitle = document.getElementById('stageDetailTitle');
const periodGrid = document.getElementById('periodGrid');
const stageActivityList = document.getElementById('stageActivityList');

let allMovements = [];
let knownStations = [];
let currentStage = null;
let currentPeriod = null;
// Le stock local peut regrouper plusieurs stations (villes) : on choisit d'abord
// la ville avant de voir les périodes/activités, uniquement pour cette étape.
let currentLocalStation = null;

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char];
    });
}
function authHeaders(extra) {
    const token = localStorage.getItem('token');
    return Object.assign({}, extra || {}, { 'Authorization': `Bearer ${token}` });
}
function formatDate(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function actionLabel(action) { return ACTION_LABELS[action] || action; }
// Le backend peut conserver des anciens noms de stations. L'interface affiche
// les libellés normalisés demandés sans altérer les données utilisées pour les
// filtres et les comparaisons.
function displayStationName(name) {
    const value = String(name || '');
    const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (normalized.includes('stock principal')) return 'Stock Général';
    if (normalized.includes('reception generale')) return 'Station Générale';
    return value;
}
function actionBadgeClass(action) {
    if (action === 'PERTE' || action === 'CASSE') return 'badge danger';
    if (action === 'RESERVATION' || action === 'RETRAIT_PRESENTOIR') return 'badge warning';
    if (action === 'PRESENTOIR' || action === 'LIVRAISON' || action === 'RECEPTION_FOURNISSEUR' || action === 'RECEPTION_STATION') return 'badge success';
    return 'badge';
}
// photo_monture_url est le champ réel renvoyé par /inventory/movements (models/movement.go
// MovementListItem.PhotoMontureURL) — les autres noms restent en repli pour les payloads qui
// varieraient. photo_branche_url complète quand seule la branche a été photographiée.
function imageUrlOf(m) {
    return m && (m.photo_monture_url || m.photo_branche_url || m.image_url || m.photo_url || m.image || m.monture_image || m.frame_image || (m.monture && (m.monture.image_url || m.monture.photo_url))) || null;
}
// Regroupe des mouvements par monture : un seul élément par monture, le plus récent.
function dedupeByMonture(movements) {
    const byBarcode = new Map();
    movements.forEach(function (m) {
        const existing = byBarcode.get(m.barcode);
        if (!existing || new Date(m.created_at) > new Date(existing.created_at)) {
            byBarcode.set(m.barcode, m);
        }
    });
    return Array.from(byBarcode.values()).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
}

// Étape du parcours d'après la station de destination du mouvement. Les noms
// de station varient selon le déploiement (ex: le stock général peut s'appeler
// "Stock Principal" plutôt que "Stock Général") : on reconnaît les variantes
// usuelles et tout le reste est considéré comme un stock local/magasin.
function stageOf(m) {
    const name = (m.to_station_name || '').toLowerCase();
    if (!name) return null;
    if (name.indexOf('général') !== -1 || name.indexOf('general') !== -1 || name.indexOf('principal') !== -1) return 'general';
    if (name.indexOf('présentoir') !== -1 || name.indexOf('presentoir') !== -1) return 'presentoir';
    if (name.indexOf('laboratoire') !== -1 || name.indexOf('labo') !== -1) return 'laboratoire';
    return 'local';
}

// Période mutuellement exclusive d'après la date du mouvement (la somme des 4
// compteurs correspond donc toujours au total de l'étape).
function periodOf(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'older';
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday.getTime() - 7 * 24 * 3600 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (d >= startOfToday) return 'today';
    if (d >= startOfWeek) return 'week';
    if (d >= startOfMonth) return 'month';
    return 'older';
}

async function loadAllMovements() {
    stageGrid.innerHTML = '<div class="track-loading"><span class="spinner"></span> Chargement du parcours…</div>';
    try {
        const params = new URLSearchParams({ limit: String(MOVEMENTS_LIMIT), offset: '0' });
        const response = await fetch(`${API_URL}/inventory/movements?${params.toString()}`, { headers: authHeaders() });
        const json = await response.json().catch(function () { return {}; });
        allMovements = (response.ok && json.success && Array.isArray(json.data && json.data.movements)) ? json.data.movements : [];
    } catch (error) {
        console.error('Erreur chargement mouvements', error);
        allMovements = [];
        stageGrid.innerHTML = '<div class="track-empty"><p>Erreur de chargement. Réessayez avec « Actualiser ».</p></div>';
        return;
    }
    renderStageOverview();
    if (currentStage) renderStageDetail(currentStage);
}

// Les mouvements récents ne couvrent pas forcément toutes les villes. On charge
// donc aussi le référentiel des stations pour que Pointe-Noire, Brazzaville,
// Lubumbashi, etc. restent accessibles dans le bloc « Stock local ».
async function loadKnownStations() {
    try {
        const response = await fetch(`${API_URL}/auth/stations`, { headers: authHeaders() });
        const json = await response.json().catch(function () { return {}; });
        knownStations = response.ok && json.success && Array.isArray(json.data && json.data.stations)
            ? json.data.stations : [];
    } catch (error) {
        console.error('Erreur chargement stations', error);
        knownStations = [];
    }
}

// ============================
// VUE 1 : ÉTAPES DU PARCOURS
// ============================
function renderStageOverview() {
    const latestByMonture = dedupeByMonture(allMovements);
    const counts = { general: 0, local: 0, presentoir: 0, laboratoire: 0 };
    latestByMonture.forEach(function (m) {
        const stage = stageOf(m);
        if (stage) counts[stage] += 1;
    });

    stageGrid.innerHTML = STAGES.map(function (s) {
        return '<button class="date-block stage-block" type="button" data-stage-key="' + s.key + '">' +
            '<div class="date-block-icon"><svg class="i"><use href="#' + s.icon + '"/></svg></div>' +
            '<div class="date-block-value">' + counts[s.key] + '</div>' +
            '<div class="date-block-label">' + s.label + '</div>' +
            '<div class="date-block-sub">' + (counts[s.key] > 1 ? 'montures' : 'monture') + '</div>' +
            '</button>';
    }).join('');

    stageGrid.querySelectorAll('[data-stage-key]').forEach(function (block) {
        block.addEventListener('click', function () { openStageDetail(block.getAttribute('data-stage-key')); });
    });
}

// ============================
// VUE 2 : DÉTAIL D'UNE ÉTAPE (périodes + activités)
// ============================
function openStageDetail(stageKey) {
    currentStage = stageKey;
    currentPeriod = null;
    currentLocalStation = null;
    stageOverview.style.display = 'none';
    stageDetail.style.display = 'block';
    renderStageDetail(stageKey);
}

// Étape "Stock local" uniquement : retour à la liste des villes plutôt qu'aux
// étapes si une ville est déjà sélectionnée (navigation à 2 niveaux).
function handleStageBack() {
    if (currentStage === 'local' && currentLocalStation) {
        currentLocalStation = null;
        currentPeriod = null;
        renderStageDetail(currentStage);
        return;
    }
    closeStageDetail();
}

function closeStageDetail() {
    currentStage = null;
    currentPeriod = null;
    currentLocalStation = null;
    stageDetail.style.display = 'none';
    stageOverview.style.display = 'block';
    renderStageOverview();
}

function renderStageDetail(stageKey) {
    const stage = STAGE_BY_KEY[stageKey];
    const stageMovements = allMovements.filter(function (m) { return stageOf(m) === stageKey; });
    document.getElementById('stageBackLabel').textContent = currentLocalStation ? stage.label : 'Toutes les étapes';

    if (stageKey === 'local' && !currentLocalStation) {
        stageDetailTitle.innerHTML = '<svg class="i" style="vertical-align:-3px;margin-right:6px;"><use href="#' + stage.icon + '"/></svg>' + stage.label;
        renderLocalStationBlocks(stageMovements);
        return;
    }

    const scopedMovements = stageKey === 'local'
        ? stageMovements.filter(function (m) { return m.to_station_name === currentLocalStation; })
        : stageMovements;

    stageDetailTitle.innerHTML = '<svg class="i" style="vertical-align:-3px;margin-right:6px;"><use href="#' + stage.icon + '"/></svg>' + stage.label +
        (currentLocalStation ? ' <span class="date-detail-sep">›</span> ' + escapeHtml(currentLocalStation) : '');

    const counts = { today: 0, week: 0, month: 0, older: 0 };
    scopedMovements.forEach(function (m) { counts[periodOf(m.created_at)] += 1; });

    periodGrid.style.display = 'grid';
    periodGrid.innerHTML = PERIODS.map(function (p) {
        const active = currentPeriod === p.key;
        return '<button class="date-block period-block' + (active ? ' active' : '') + '" type="button" data-period-key="' + p.key + '">' +
            '<div class="date-block-icon"><svg class="i"><use href="#' + p.icon + '"/></svg></div>' +
            '<div class="date-block-value">' + counts[p.key] + '</div>' +
            '<div class="date-block-label">' + p.label + '</div>' +
            '</button>';
    }).join('');

    periodGrid.querySelectorAll('[data-period-key]').forEach(function (block) {
        block.addEventListener('click', function () {
            const key = block.getAttribute('data-period-key');
            currentPeriod = currentPeriod === key ? null : key;
            renderStageDetail(stageKey);
        });
    });

    const filtered = currentPeriod ? scopedMovements.filter(function (m) { return periodOf(m.created_at) === currentPeriod; }) : scopedMovements;
    renderActivityList(dedupeByMonture(filtered));
}

// Liste des villes/stations regroupées sous "Stock local" — un bloc par nom de
// station distinct, avec le nombre de montures actuellement là-bas.
function renderLocalStationBlocks(stageMovements) {
    const latestByMonture = dedupeByMonture(stageMovements);
    const counts = new Map();
    latestByMonture.forEach(function (m) {
        const name = m.to_station_name || 'Ville inconnue';
        counts.set(name, (counts.get(name) || 0) + 1);
    });
    knownStations.forEach(function (station) {
        const type = String(station.type || '').toUpperCase();
        const name = station.name || '';
        const isLocal = type
            ? !type.includes('GENERAL') && !type.includes('PRESENTOIR') && !type.includes('LABORATOIRE')
            : stageOf({ to_station_name: name }) === 'local';
        if (isLocal && name && !counts.has(name)) counts.set(name, 0);
    });
    const names = Array.from(counts.keys()).sort(function (a, b) {
        return (counts.get(b) - counts.get(a)) || a.localeCompare(b, 'fr');
    });

    periodGrid.style.display = 'none';
    stageActivityList.parentElement.querySelector('.activity-heading').style.display = 'none';

    if (!names.length) {
        stageActivityList.innerHTML = '<div class="track-empty"><p>Aucune monture en stock local pour le moment.</p></div>';
        return;
    }

    stageActivityList.innerHTML = '<div class="date-block-grid stage-grid" id="localStationGrid">' + names.map(function (name) {
        return '<button class="date-block stage-block" type="button" data-local-station="' + escapeHtml(name) + '">' +
            '<div class="date-block-icon"><svg class="i"><use href="#ic-inbox"/></svg></div>' +
            '<div class="date-block-value">' + counts.get(name) + '</div>' +
            '<div class="date-block-label">' + escapeHtml(name) + '</div>' +
            '</button>';
            '<div class="date-block-sub">' + counts.get(name) + ' ' + (counts.get(name) > 1 ? 'montures' : 'monture') + '</div>' +
            '</button>';
            '</button>';
    }).join('') + '</div>';

    stageActivityList.querySelectorAll('[data-local-station]').forEach(function (block) {
        block.addEventListener('click', function () {
            currentLocalStation = block.getAttribute('data-local-station');
            currentPeriod = null;
            renderStageDetail('local');
        });
    });
}

function renderActivityList(montureRows) {
    stageActivityList.parentElement.querySelector('.activity-heading').style.display = 'flex';
    if (!montureRows.length) {
        stageActivityList.innerHTML = '<div class="track-empty"><svg class="i" style="width:28px;height:28px;"><use href="#ic-glasses"/></svg><p>Aucune monture pour cette sélection.</p></div>';
        return;
    }

    stageActivityList.innerHTML = montureRows.map(function (m) {
        const label = ((m.brand || '') + ' ' + (m.reference || '')).trim();
        const imageUrl = imageUrlOf(m);
        const photoCell = '<button class="glass-photo" type="button" data-photo-url="' + escapeHtml(imageUrl || '') + '" data-photo-caption="' + escapeHtml((m.barcode || '') + (label ? ' — ' + label : '')) + '" title="' + (imageUrl ? 'Voir la photo' : 'Aucune photo disponible') + '">' +
            (imageUrl ? '<img src="' + escapeHtml(imageUrl) + '" alt="" loading="lazy" />' : '<svg class="i"><use href="#ic-glasses"/></svg>') +
            '</button>';
        const toCell = [displayStationName(m.to_station_name), m.to_location_code].filter(Boolean).map(escapeHtml).join(' · ');
        return '<div class="activity-row">' +
            photoCell +
            '<div class="activity-main">' +
                '<div class="activity-title"><strong>' + escapeHtml(m.barcode) + '</strong>' + (label ? '<span class="activity-sub">' + escapeHtml(label) + '</span>' : '') + '</div>' +
                '<div class="activity-meta"><span class="' + actionBadgeClass(m.action) + '">' + escapeHtml(actionLabel(m.action)) + '</span>' +
                    (toCell ? '<span class="activity-where">→ ' + toCell + '</span>' : '') +
                    '<span class="activity-date">' + formatDate(m.created_at) + '</span></div>' +
            '</div>' +
            '<button class="btn btn-primary btn-sm track-btn" type="button" data-track-barcode="' + escapeHtml(m.barcode) + '">' +
                '<span class="live-dot" aria-hidden="true"></span><svg class="i"><use href="#ic-radar"/></svg><span>Suivi en direct</span></button>' +
        '</div>';
    }).join('');
}

document.getElementById('refreshBtn').addEventListener('click', loadAllMovements);
document.getElementById('stageBackBtn').addEventListener('click', handleStageBack);

// Recherche rapide : ouvre directement le suivi d'un code-barres sans passer
// par les étapes (utile quand on connaît déjà la référence).
const quickTrackInput = document.getElementById('quickTrackInput');
quickTrackInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && quickTrackInput.value.trim()) {
        openTrack(quickTrackInput.value.trim());
        quickTrackInput.value = '';
        quickTrackInput.blur();
    }
});

// ============================
// SUIVI D'UNE MONTURE — panneau temps réel
// ============================
const ACTION_ICONS = {
    RECEPTION_FOURNISSEUR: 'ic-inbox',
    RECEPTION_STATION: 'ic-inbox',
    RANGEMENT: 'ic-box',
    EXPEDITION: 'ic-send',
    LIVRAISON: 'ic-send',
    PRESENTOIR: 'ic-store',
    RETRAIT_PRESENTOIR: 'ic-store',
    RESERVATION: 'ic-bookmark',
    LABORATOIRE: 'ic-flask',
    CONTROLE_QUALITE: 'ic-check-circle',
    RETOUR: 'ic-corner-up-left',
    INVENTAIRE: 'ic-clipboard',
    PERTE: 'ic-alert-triangle',
    CASSE: 'ic-alert-triangle'
};
function actionIcon(action) { return ACTION_ICONS[action] || 'ic-glasses'; }
function actionSeverity(action) {
    if (action === 'PERTE' || action === 'CASSE') return 'danger';
    if (action === 'RESERVATION' || action === 'RETRAIT_PRESENTOIR') return 'warning';
    if (action === 'PRESENTOIR' || action === 'LIVRAISON' || action === 'RECEPTION_FOURNISSEUR' || action === 'RECEPTION_STATION') return 'success';
    return '';
}
function relativeTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const diffSec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (diffSec < 5) return 'à l’instant';
    if (diffSec < 60) return 'il y a ' + diffSec + ' s';
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return 'il y a ' + diffMin + ' min';
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return 'il y a ' + diffH + ' h';
    const diffD = Math.round(diffH / 24);
    return 'il y a ' + diffD + ' j';
}

const trackBackdrop = document.getElementById('trackBackdrop');
const trackPanel = document.getElementById('trackPanel');
const trackTitle = document.getElementById('trackTitle');
const trackSubtitle = document.getElementById('trackSubtitle');
const trackStatus = document.getElementById('trackStatus');
const trackStatusText = document.getElementById('trackStatusText');
const trackBody = document.getElementById('trackBody');
const closeTrackPanel = document.getElementById('closeTrackPanel');

let trackedBarcode = null;
let trackPollTimer = null;
let trackTickTimer = null;
let trackKnownIds = new Set();
let trackIsFirstLoad = true;

function renderTimeline(movements, isPoll) {
    if (!movements.length) {
        trackBody.innerHTML = '<div class="track-empty"><svg class="i" style="width:28px;height:28px;"><use href="#ic-glasses"/></svg><p>Aucun mouvement enregistré pour cette monture.</p></div>';
        return;
    }
    // Plus récent en premier ; le tout premier est la position actuelle.
    const sorted = movements.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    const label = ((sorted[0].brand || '') + ' ' + (sorted[0].reference || '')).trim();
    trackTitle.textContent = sorted[0].barcode || trackedBarcode;
    trackSubtitle.textContent = label || 'Trajectoire de la monture';

    const photoUrl = imageUrlOf(sorted[0]) || sorted.map(imageUrlOf).find(Boolean);
    if (photoUrl) {
        trackPhotoImg.src = photoUrl;
        trackPhotoImg.hidden = false;
        trackPhotoFallback.hidden = true;
        trackPhotoBtn.setAttribute('data-photo-url', photoUrl);
        trackPhotoBtn.disabled = false;
    } else {
        trackPhotoImg.hidden = true;
        trackPhotoFallback.hidden = false;
        trackPhotoBtn.removeAttribute('data-photo-url');
        trackPhotoBtn.disabled = true;
    }

    trackBody.innerHTML = '<div class="timeline">' + sorted.map(function (m, index) {
        const isNew = isPoll && !trackKnownIds.has(m.id);
        const fromCell = [displayStationName(m.from_station_name), m.from_location_code].filter(Boolean).map(escapeHtml).join(' · ');
        const toCell = [displayStationName(m.to_station_name), m.to_location_code].filter(Boolean).map(escapeHtml).join(' · ');
        const route = (fromCell || toCell)
            ? '<div class="step-route">' + (fromCell || '—') + (toCell ? ' <span class="arrow">→</span> ' + toCell : '') + '</div>'
            : '';
        const userName = (m.user_first_name || m.user_last_name) ? ((m.user_first_name || '') + ' ' + (m.user_last_name || '')).trim() : '';
        return '<div class="timeline-step' + (index === 0 ? ' current' : '') + ' action-' + actionSeverity(m.action) + (isNew ? ' is-new' : '') + '" data-created-at="' + escapeHtml(m.created_at) + '">' +
            '<div class="step-dot-wrap"><span class="step-dot"><svg class="i"><use href="#' + actionIcon(m.action) + '"/></svg></span></div>' +
            '<div class="step-card">' +
                '<div class="step-card-head">' +
                    '<span class="step-action">' + escapeHtml(actionLabel(m.action)) + (index === 0 ? '<span class="current-tag">Position actuelle</span>' : '') + '</span>' +
                    '<span class="step-time" data-relative>' + relativeTime(m.created_at) + '</span>' +
                '</div>' +
                route +
                (userName ? '<div class="step-user">Par ' + escapeHtml(userName) + '</div>' : '') +
            '</div>' +
        '</div>';
    }).join('') + '</div>';

    trackKnownIds = new Set(sorted.map(function (m) { return m.id; }));
}

function tickRelativeTimes() {
    trackBody.querySelectorAll('.timeline-step[data-created-at]').forEach(function (step) {
        const el = step.querySelector('[data-relative]');
        if (el) el.textContent = relativeTime(step.getAttribute('data-created-at'));
    });
}

async function fetchTrack(isPoll) {
    if (!trackedBarcode) return;
    try {
        const params = new URLSearchParams({ barcode: trackedBarcode, limit: '50', offset: '0' });
        const response = await fetch(`${API_URL}/inventory/movements?${params.toString()}`, { headers: authHeaders() });
        const json = await response.json().catch(function () { return {}; });
        const movements = (response.ok && json.success && Array.isArray(json.data && json.data.movements)) ? json.data.movements : [];
        renderTimeline(movements, isPoll && !trackIsFirstLoad);
        trackStatus.className = 'track-status';
        trackStatusText.textContent = 'Suivi en direct · actualisé automatiquement';
        trackIsFirstLoad = false;
    } catch (error) {
        console.error('Erreur suivi monture', error);
        trackStatus.className = 'track-status error';
        trackStatusText.textContent = 'Suivi interrompu — nouvel essai sous peu…';
    }
}

function openTrack(barcode) {
    trackedBarcode = barcode;
    trackIsFirstLoad = true;
    trackKnownIds = new Set();
    trackTitle.textContent = barcode;
    trackSubtitle.textContent = 'Trajectoire de la monture';
    trackStatus.className = 'track-status';
    trackStatusText.textContent = 'Connexion au suivi…';
    trackBody.innerHTML = '<div class="track-loading"><span class="spinner"></span> Chargement de la trajectoire…</div>';
    trackPhotoImg.hidden = true;
    trackPhotoFallback.hidden = false;
    trackPhotoBtn.disabled = true;
    trackBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';

    fetchTrack(false);
    clearInterval(trackPollTimer);
    trackPollTimer = setInterval(function () { fetchTrack(true); }, 12000);
    clearInterval(trackTickTimer);
    trackTickTimer = setInterval(tickRelativeTimes, 1000);
}

function closeTrack() {
    trackBackdrop.classList.remove('open');
    document.body.style.overflow = '';
    clearInterval(trackPollTimer);
    clearInterval(trackTickTimer);
    trackedBarcode = null;
}

stageActivityList.addEventListener('click', function (event) {
    const trackBtn = event.target.closest('.track-btn');
    if (trackBtn) { openTrack(trackBtn.getAttribute('data-track-barcode')); return; }
    const photoBtn = event.target.closest('.glass-photo');
    if (photoBtn) {
        const url = photoBtn.getAttribute('data-photo-url');
        if (url) openLightbox(url, photoBtn.getAttribute('data-photo-caption') || '');
    }
});
closeTrackPanel.addEventListener('click', closeTrack);
trackBackdrop.addEventListener('click', function (event) {
    if (event.target === trackBackdrop) closeTrack();
});
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        if (lightboxBackdrop.classList.contains('open')) { closeLightbox(); return; }
        if (trackBackdrop.classList.contains('open')) closeTrack();
    }
});

// ============================
// VISIONNEUSE PHOTO (lightbox)
// ============================
const lightboxBackdrop = document.getElementById('lightboxBackdrop');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxCaption = document.getElementById('lightboxCaption');
const closeLightboxBtn = document.getElementById('closeLightbox');
const trackPhotoBtn = document.getElementById('trackPhotoBtn');
const trackPhotoImg = document.getElementById('trackPhotoImg');
const trackPhotoFallback = document.getElementById('trackPhotoFallback');

function openLightbox(url, caption) {
    lightboxImg.src = url;
    lightboxCaption.textContent = caption;
    lightboxBackdrop.classList.add('open');
}
function closeLightbox() {
    lightboxBackdrop.classList.remove('open');
    lightboxImg.src = '';
}
closeLightboxBtn.addEventListener('click', closeLightbox);
lightboxBackdrop.addEventListener('click', function (event) {
    if (event.target === lightboxBackdrop) closeLightbox();
});
trackPhotoBtn.addEventListener('click', function () {
    const url = trackPhotoBtn.getAttribute('data-photo-url');
    if (url) openLightbox(url, trackTitle.textContent + (trackSubtitle.textContent ? ' — ' + trackSubtitle.textContent : ''));
});

// ============================
// THÈME CLAIR / SOMBRE
// ============================
const THEME_KEY = 'lunetterie-theme';
function applyTheme(theme) {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    const isDark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const icon = document.getElementById('themeIcon');
    if (icon) icon.innerHTML = '<use href="#ic-' + (isDark ? 'moon' : 'sun') + '"/>';
}
document.getElementById('themeToggle').addEventListener('click', function () {
    const current = document.documentElement.getAttribute('data-theme')
        || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
});

// ============================
// INITIALISATION
// ============================
(async function init() {
    const token = localStorage.getItem('token');
    if (!token) {
        alert('Vous devez être connecté pour accéder à cette page.');
        window.location.href = 'index.html';
        return;
    }
    applyTheme(localStorage.getItem(THEME_KEY));
    await Promise.all([loadKnownStations(), loadAllMovements()]);
})();
