/* Base de données partagée entre les quatre postes.
   Persistée dans localStorage, synchronisée entre onglets. */
(function () {
  var KEY = 'lunetterie:v1';
  var DEMO_CLEANUP_KEY = 'lunetterie:demo-cleared:v1';

  // Supprime une seule fois les anciennes données de démonstration, sans
  // déconnecter l'utilisateur (token et profil sont conservés).
  try {
    if (!localStorage.getItem(DEMO_CLEANUP_KEY)) {
      localStorage.removeItem(KEY);
      localStorage.setItem(DEMO_CLEANUP_KEY, '1');
    }
  } catch (e) {}

  function seed() {
    return {
      // Admin -> Pré-enregistrement
      bons: [],
      // Pré-enregistrement -> Stock général
      arrivees: [],
      // Montures créées au stock général, avec leur localisation
      montures: [],
      // Magasin -> Admin -> Stock général
      demandes: [],
      // Stock général -> Responsable magasin
      cartonsBoutique: [],
      // Magasin -> Stock général
      retours: [],
      // Journal consulté par l'admin
      mouvements: [],
      // Besoins de réassort signalés par le stock général à l'administrateur
      approvisionnements: [],
      seq: { bon: 419, demande: 1042, retour: 0, transfert: 87, appro: 0 },
      // Thème de l'interface, partagé par les quatre postes
      theme: 'light',
      // Règle de santé du stock : minimum à détenir, par axe.
      // Base = un magasin : 1,5 mois de couverture sur 400 ventes/mois (fourchette 300-500).
      // Le stock général détient coefGeneral fois cette base.
      seuils: {
        ventesMoisBoutique: 400,
        boutiques: 5,
        coefGeneral: 6.5,
        genre: { Femme: 240, Homme: 210, Mixte: 90, Enfant: 60 },
        type: { Vue: 330, Solaire: 180, Lecture: 60, 'Sécurité': 30 },
        gamme: { 'Moyenne gamme': 270, Classique: 210, Luxe: 72, Enfant: 48 },
        formesMini: 10
      }
    };
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return v && typeof v === 'object' ? v : null;
    } catch (e) { return null; }
  }

  var state = read();
  if (!state) state = seed();
  // migration : compléter les clés absentes des versions antérieures
  var base = seed();
  Object.keys(base).forEach(function (k) { if (state[k] == null) state[k] = base[k]; });
  if (!state.seuils || !state.seuils.genre || state.seuils.ventesMoisBoutique == null) state.seuils = base.seuils;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}

  var version = 0;
  var subs = [];
  function notify() { subs.slice().forEach(function (f) { try { f(state); } catch (e) {} }); }
  function persist() { version++; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  window.addEventListener('storage', function (e) {
    if (e.key !== KEY || !e.newValue) return;
    try { state = JSON.parse(e.newValue); version++; notify(); } catch (err) {}
  });

  window.LStore = {
    get: function () { return state; },
    version: function () { return version; },
    set: function (patch) {
      Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
      persist(); notify();
    },
    update: function (fn) {
      var patch = fn(state) || {};
      this.set(patch);
    },
    nextSeq: function (name) {
      state.seq = state.seq || {};
      state.seq[name] = (state.seq[name] || 0) + 1;
      persist();
      return state.seq[name];
    },
    subscribe: function (cb) {
      subs.push(cb);
      return function () { subs = subs.filter(function (f) { return f !== cb; }); };
    },
    reset: function () { state = seed(); persist(); notify(); },
    dateFr: function () {
      var d = new Date();
      function p(n) { return String(n).padStart(2, '0'); }
      return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
    },
    seuils: function () { return state.seuils || {}; },
    seuil: function (axe, valeur, site) {
      var S = state.seuils || {};
      var base = (S[axe] || {})[valeur];
      if (base == null) return null;
      var coef = (site && site !== 'Stock général') ? 1 : (S.coefGeneral || 1);
      return Math.round(base * coef);
    },
    // Catalogue partagé : les listes de référence du produit
    catalogue: function () {
      return {
        genres: ['Homme', 'Femme', 'Enfant', 'Mixte'],
        gammes: ['Moyenne gamme', 'Classique', 'Luxe', 'Enfant'],
        types: ['Vue', 'Solaire', 'Lecture', 'Sécurité', 'Offerte'],
        formes: ['Ovale', 'Papillon', 'Browline', 'Percé', 'Œil de chat', 'Polygone', 'Rectangulaire', 'Aviator', 'Ronde', 'Carré'],
        marques: ['Okulo', 'MY Mojo', 'Louis Carter', 'Taylor', 'Jane Austen', 'Meaido', 'Koesw', 'Milano', 'Chic&Creative', 'Newest', 'Danish Heritage', 'Coline', 'Lapo', 'Level', 'William Morris', 'Pacino', 'Tbbroun', 'Gabiano', 'Charlie Duke'],
        couleurs: ['Noir', 'Écaille', 'Rose transparent', 'Cristal', 'Guépard', 'Bleu nuit', 'Doré', 'Argenté', 'Havane', 'Bicolore noir-doré', 'Tricolore', 'Transparent fumé'],
        matieres: ['Acétate', 'Métal', 'Titane', 'Acier inoxydable', 'TR90', 'Bois', 'Corne', 'Alliage', 'Acétate + métal']
      };
    },
    theme: function () { return state.theme || 'light'; },
    setTheme: function (t) {
      state.theme = (t === 'dark') ? 'dark' : 'light';
      persist(); notify();
    },
    setSeuils: function (patch) {
      state.seuils = Object.assign({}, state.seuils, patch);
      persist(); notify();
    },
    mouvement: function (m) {
      state.mouvements = [Object.assign({ id: 'm' + Date.now() + Math.random().toString(36).slice(2, 5), date: this.dateFr() }, m)].concat(state.mouvements || []);
      persist(); notify();
    }
  };
})();
