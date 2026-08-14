import { useState } from 'react'

/* ==========================================================================
   LE TABLEAU DE MONTURES, PARTAGÉ PAR TOUS LES POSTES.

   Quatre écrans listent des montures à pointer : la liste reçue du Magasinier,
   le contenu d'un carton chez le Responsable, le présentoir de la Vendeuse et
   les arrivées du Laboratoire. Ils faisaient chacun leur tableau — colonnes dans
   un ordre différent, bordures d'une autre couleur, prix tantôt formaté tantôt
   brut. Un employé qui change de poste réapprenait à lire.

   Le tronc commun reprend celui du suivi de la Direction (src/App.tsx:2018), qui
   fait référence dans la maison. Il est FIXE et dans cet ordre, partout :

       Photo  Réf  Marque  Genre  Forme  Emplacement  Entrée  Statut

   Chaque écran peut en ajouter, jamais en retirer ni en réordonner : `before`
   glisse ses colonnes juste après la référence — le code-barres là où l'on scanne,
   le client au Laboratoire — et `after` les pose derrière le statut, pour le prix.
   Une colonne propre à un métier reste ainsi visible sans imposer une case vide
   aux trois autres écrans.
   ========================================================================== */

export type GlassTableTone = 'green' | 'slate' | 'amber' | 'blue'

const TONES: Record<GlassTableTone, string> = {
  green: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
}

/** Le formatage vit ici et nulle part ailleurs : chaque écran avait sa copie de
 *  `fmtFCFA`, et il suffisait qu'une seule dérive pour que deux tableaux affichent
 *  le même prix différemment. */
export function fmtPrix(value: unknown) {
  const n = Number(value)
  if (value === null || value === undefined || value === '' || Number.isNaN(n)) return '—'
  return `${n.toLocaleString('fr-FR')} FCFA`
}

/** Sépare l'horodatage en jour et heure, comme le suivi de la Direction : la date
 *  sur la ligne, l'heure en dessous en plus petit. Accepte l'ISO (`2026-08-10T13:22`)
 *  comme le format SQL (`2026-08-10 13:22:41`). */
function splitEntree(value?: string) {
  const raw = String(value || '').trim()
  if (!raw) return { jour: '—', heure: '' }
  const jour = raw.slice(0, 10)
  const reste = raw.includes('T') ? raw.slice(11) : (raw.split(' ')[1] || '')
  return { jour: jour || '—', heure: reste.slice(0, 5) }
}

export interface GlassTableColumn {
  header: string
  align?: 'left' | 'right'
  /** Chasse fixe : pour les codes qu'on lit caractère par caractère. */
  mono?: boolean
}

/** Le tableau exporté en CSV, ouvert directement par Excel.
 *
 *  Point-virgule et BOM UTF-8, comme l'export de la Direction (src/App.tsx:972) : Excel en
 *  locale française attend le point-virgule comme séparateur, et sans le BOM il affiche les
 *  accents en mojibake. Un vrai .xlsx demanderait une bibliothèque pour un gain nul ici. */
export function downloadCSV(nom: string, entetes: string[], lignes: string[][]) {
  const echappe = (valeur: string) => {
    const texte = String(valeur ?? '').replace(/"/g, '""')
    // Un point-virgule ou un retour ligne dans une valeur casserait les colonnes.
    return /[";\r\n]/.test(texte) ? `"${texte}"` : texte
  }
  const csv = '﻿' + [entetes, ...lignes].map(ligne => ligne.map(echappe).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const lien = document.createElement('a')
  lien.href = url
  lien.download = `${nom}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(lien)
  lien.click()
  document.body.removeChild(lien)
  URL.revokeObjectURL(url)
}

export interface GlassTableRow {
  key: string | number
  photo?: string
  /** Photo de la branche, quand elle est disponible dans les données métier. */
  branchPhoto?: string
  /** Réf : la référence commerciale, à défaut le code-barres. */
  reference?: string
  brand?: string
  gender?: string
  shape?: string
  location?: string
  /** Horodatage d'entrée, ISO ou SQL. Rendu en jour + heure sur deux lignes. */
  entry?: string
  status?: { label: string; tone: GlassTableTone }
  /** Ligne atténuée : la monture est annoncée mais pas encore là. */
  muted?: boolean
  /** Ligne mise en avant : le geste attendu sur elle est fait. */
  done?: boolean
  /** Valeurs des colonnes supplémentaires, en texte brut — c'est ce qui les rend
   *  exportables. Leur mise en forme appartient à la colonne (`mono`), pas à la valeur. */
  before?: (string | number | undefined)[]
  after?: (string | number | undefined)[]
}

const CELL = 'px-1.5 py-2.5 text-[11px] leading-tight break-words'
const HEAD = 'px-1.5 py-2 text-[11px] font-bold text-slate-500 dark:text-slate-400'

/** Répartition de la largeur entre les colonnes.
 *
 *  Le tableau tient dans son conteneur, sans défilement horizontal : `table-fixed` et un
 *  `colgroup` en pourcentages l'y obligent. Les poids disent quelle colonne mérite de la
 *  place — l'emplacement est un code long, le genre tient en un mot — et une colonne
 *  ajoutée par un écran reprend sa part à toutes les autres plutôt que de déborder.
 *
 *  Rien n'est tronqué : le texte revient à la ligne. Une référence coupée à mi-mot serait
 *  pire qu'une ligne un peu plus haute. */
const POIDS = {
  reference: 1.3,
  extra: 1.2,
  brand: 1.1,
  gender: 0.7,
  shape: 1,
  location: 1.7,
  entry: 0.9,
  status: 1.1,
}

function Placeholder() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <circle cx="7" cy="12" r="4" /><circle cx="17" cy="12" r="4" /><path d="M3 12h0M21 12h0M11 12h2" />
    </svg>
  )
}

export function GlassTable({ rows, before = [], after = [], emptyLabel = 'Aucune monture.', title = 'montures' }: {
  rows: GlassTableRow[]
  before?: GlassTableColumn[]
  after?: GlassTableColumn[]
  emptyLabel?: string
  /** Nom du fichier exporté, sans extension ni date. */
  title?: string
}) {
  // Le filtre par date vit dans le tableau, pas chez l'appelant : il porte sur la colonne
  // Entrée, que le tableau est seul à savoir lire.
  const [jour, setJour] = useState('')
  const [selectedPreview, setSelectedPreview] = useState<GlassTableRow | null>(null)

  const visibles = jour
    ? rows.filter(row => String(row.entry || '').slice(0, 10) === jour)
    : rows

  const entetes = [
    'Réf',
    ...before.map(column => column.header),
    'Marque', 'Genre', 'Forme', 'Emplacement', 'Entrée', 'Statut',
    ...after.map(column => column.header),
  ]

  function exporter() {
    const lignes = visibles.map(row => {
      const entree = splitEntree(row.entry)
      return [
        row.reference || '',
        ...(row.before || []).map(valeur => String(valeur ?? '')),
        row.brand || '',
        row.gender || '',
        row.shape || '',
        row.location || '',
        [entree.jour, entree.heure].filter(Boolean).join(' '),
        row.status?.label || '',
        ...(row.after || []).map(valeur => String(valeur ?? '')),
      ]
    })
    downloadCSV(title, entetes, lignes)
  }

  const barre = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-700">
      <div className="flex items-center gap-2">
        {/* Un `input type=date` plutôt qu'un calendrier maison : il ouvre celui du système,
            déjà traduit, accessible au clavier et tactile sur téléphone. `showPicker` fait
            que le clic n'importe où sur le champ l'ouvre, pas seulement sur l'icône. */}
        <input
          type="date"
          value={jour}
          onChange={event => setJour(event.target.value)}
          onClick={event => { (event.currentTarget as any).showPicker?.() }}
          aria-label="Filtrer par date d'entrée"
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        />
        {jour && (
          <button
            type="button"
            onClick={() => setJour('')}
            className="text-xs font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            Tout voir
          </button>
        )}
        <span className="text-xs tabular-nums text-slate-400">
          {visibles.length} monture{visibles.length > 1 ? 's' : ''}
        </span>
      </div>

      <button
        type="button"
        onClick={exporter}
        disabled={visibles.length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
        </svg>
        Télécharger en excel
      </button>
    </div>
  )

  if (visibles.length === 0) {
    return (
      <>
        {barre}
        <p className="p-8 text-center text-sm text-slate-400">
          {jour ? `Aucune monture entrée le ${jour.split('-').reverse().join('/')}.` : emptyLabel}
        </p>
      </>
    )
  }

  // Toutes les colonnes tiennent à l'écran : pas de défilement horizontal. Le `colgroup`
  // répartit la largeur restante au prorata des poids, la photo gardant sa taille fixe.
  const poids = [
    POIDS.reference,
    ...before.map(() => POIDS.extra),
    POIDS.brand, POIDS.gender, POIDS.shape, POIDS.location, POIDS.entry, POIDS.status,
    ...after.map(() => POIDS.extra),
  ]
  const total = poids.reduce((sum, value) => sum + value, 0)
  const largeurs = poids.map(value => `${(value / total) * 100}%`)

  return (
    <div>
      {selectedPreview && (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Aperçu</p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{selectedPreview.reference || 'Monture'}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPreview(null)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Fermer
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
              {selectedPreview.photo ? (
                <img src={selectedPreview.photo} alt={selectedPreview.reference || 'Monture'} className="h-40 w-full object-cover" />
              ) : (
                <div className="flex h-40 items-center justify-center text-xs text-slate-500 dark:text-slate-400">Pas de photo de monture</div>
              )}
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
              {selectedPreview.branchPhoto ? (
                <img src={selectedPreview.branchPhoto} alt="Branche" className="h-40 w-full object-cover" />
              ) : (
                <div className="flex h-40 items-center justify-center text-xs text-slate-500 dark:text-slate-400">Pas de photo de branche</div>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-sm text-slate-700 dark:text-slate-200 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Marque</span><span className="mt-1 block font-semibold">{selectedPreview.brand || '—'}</span></div>
            <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Forme</span><span className="mt-1 block font-semibold">{selectedPreview.shape || '—'}</span></div>
            <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Genre</span><span className="mt-1 block font-semibold">{selectedPreview.gender || '—'}</span></div>
            <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Emplacement</span><span className="mt-1 block font-mono text-xs">{selectedPreview.location || '—'}</span></div>
          </div>
        </div>
      )}

      {barre}
      <table className="w-full table-fixed">
        <colgroup>
          <col style={{ width: 56 }} />
          {largeurs.map((largeur, i) => <col key={i} style={{ width: largeur }} />)}
        </colgroup>
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className={`${HEAD} text-left`}>Photo</th>
            <th className={`${HEAD} text-left`}>Réf</th>
            {before.map(column => (
              <th key={`b-${column.header}`} className={`${HEAD} ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                {column.header}
              </th>
            ))}
            <th className={`${HEAD} text-left`}>Marque</th>
            <th className={`${HEAD} text-left`}>Genre</th>
            <th className={`${HEAD} text-left`}>Forme</th>
            <th className={`${HEAD} text-left`}>Emplacement</th>
            <th className={`${HEAD} text-left`}>Entrée</th>
            <th className={`${HEAD} text-right`}>Statut</th>
            {after.map(column => (
              <th key={`a-${column.header}`} className={`${HEAD} ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {visibles.map(row => {
            const entree = splitEntree(row.entry)
            return (
              <tr
                key={row.key}
                onClick={() => setSelectedPreview(row)}
                className={`${row.done ? 'bg-green-50/60 dark:bg-green-500/5' : ''} ${row.muted ? 'bg-slate-50/60 opacity-60 dark:bg-slate-900/40' : ''} cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/70`}
              >
                <td className="px-1.5 py-2.5">
                  <div className="h-9 w-11 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-700">
                    {row.photo
                      ? <img src={row.photo} alt="" loading="lazy" className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center text-slate-300 dark:text-slate-600"><Placeholder /></span>}
                  </div>
                </td>
                <td className={`${CELL} font-bold text-slate-900 dark:text-white`}>{row.reference || '—'}</td>
                {(row.before || []).map((value, i) => (
                  <td key={`b-${i}`} className={`${CELL} text-slate-600 dark:text-slate-300 ${before[i]?.align === 'right' ? 'text-right' : ''} ${before[i]?.mono ? 'font-mono text-[10px]' : ''}`}>
                    {value ?? '—'}
                  </td>
                ))}
                <td className={`${CELL} text-slate-600 dark:text-slate-400`}>{row.brand || '—'}</td>
                <td className={`${CELL} text-slate-500 dark:text-slate-400`}>{row.gender || '—'}</td>
                <td className={`${CELL} text-slate-500 dark:text-slate-400`}>{row.shape || '—'}</td>
                {/* Le code se replie sur ses tirets, point de coupure naturel : il reste
                    lisible en entier même dans une colonne étroite. */}
                <td className={`${CELL} font-mono text-[10px] text-slate-500 dark:text-slate-400`}>
                  {row.location || '—'}
                </td>
                <td className={`${CELL} text-slate-500 dark:text-slate-400`}>
                  <div>{entree.jour}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">{entree.heure || '—'}</div>
                </td>
                <td className="px-1.5 py-2.5 text-right">
                  {row.status
                    ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold leading-tight ${TONES[row.status.tone]}`}>
                        {row.status.label}
                      </span>
                    )
                    : '—'}
                </td>
                {(row.after || []).map((value, i) => (
                  <td key={`a-${i}`} className={`${CELL} text-slate-600 dark:text-slate-300 ${after[i]?.align === 'right' ? 'text-right' : ''} ${after[i]?.mono ? 'font-mono text-[10px]' : ''}`}>
                    {value ?? '—'}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
