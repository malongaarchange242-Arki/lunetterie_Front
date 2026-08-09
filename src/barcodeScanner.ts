/* ==========================================================================
   LECTURE DE CODE-BARRES PAR LA CAMÉRA — portage de ../Frontend/barcode-scanner.js.

   Trois obstacles distincts, souvent confondus en un seul « ça ne marche pas » :

   1. Le décodeur. `BarcodeDetector` est une API Chromium (Chrome, Edge, Android).
      Safari — donc tout MacBook, iPhone et iPad — ne l'a pas, Firefox non plus.
      On garde l'API native quand elle existe (rapide, rien à télécharger) et on
      bascule sur ZXing sinon.

   2. La caméra demandée. `facingMode: 'environment'` en contrainte stricte réclame
      une caméra arrière. Un MacBook n'en a pas : la demande échoue au lieu de se
      rabattre sur la webcam frontale. On la passe en `ideal`, et on retente sans
      contrainte si le navigateur refuse quand même.

   3. Le contexte sécurisé. `navigator.mediaDevices` n'existe pas hors https (ou
      localhost). Une page ouverte en http sur une IP de réseau local n'a aucun
      accès caméra, sur n'importe quel navigateur — et l'erreur est muette.

   ZXing reste chargé depuis un CDN plutôt qu'installé : `@zxing/library` ne sert
   qu'aux navigateurs sans BarcodeDetector, l'embarquer alourdirait chaque page.
   ========================================================================== */

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'
const POLL_INTERVAL_MS = 250

// Un seul téléchargement pour toute la page, même si plusieurs scanners démarrent.
let zxingPromise: Promise<any> | null = null

function isLocalHost() {
  const host = String(window.location?.hostname || '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/** Renvoie null quand la caméra est utilisable, sinon la raison exacte — c'est ce
 *  message que l'employé doit voir, pas « erreur caméra ». */
export function cameraUnavailableReason(): string | null {
  if (!window.isSecureContext && !isLocalHost()) {
    return 'La caméra exige une connexion sécurisée : ouvrez cette page en https (ou depuis l’ordinateur du poste). '
      + 'Vous pouvez saisir le code à la main en attendant.'
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'Ce navigateur ne donne pas accès à la caméra. Saisissez le code à la main.'
  }
  return null
}

function loadZXing(): Promise<any> {
  const existing = (window as any).ZXing
  if (existing && existing.BrowserMultiFormatReader) return Promise.resolve(existing)
  if (zxingPromise) return zxingPromise

  zxingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = ZXING_URL
    script.async = true
    script.onload = () => {
      const loaded = (window as any).ZXing
      if (loaded && loaded.BrowserMultiFormatReader) resolve(loaded)
      else reject(new Error('ZXing chargé mais incomplet'))
    }
    script.onerror = () => {
      // Le prochain start() pourra retenter : un échec réseau ponctuel ne doit
      // pas condamner le lecteur pour toute la durée de la session.
      zxingPromise = null
      reject(new Error('Téléchargement du lecteur de code-barres impossible'))
    }
    document.head.appendChild(script)
  })
  return zxingPromise
}

/** La caméra arrière est un souhait, pas une exigence : sur un portable il n'y en a
 *  qu'une, et la refuser reviendrait à refuser de scanner. */
export async function openCamera(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
  } catch (error: any) {
    const name = error?.name
    // NotFoundError/OverconstrainedError : la contrainte de résolution ou de face
    // ne passe pas sur cet appareil. On redemande le strict minimum.
    if (name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'ConstraintNotSatisfiedError') {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    }
    throw error
  }
}

export function humanCameraError(error: any): string {
  const name = error?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Accès à la caméra refusé. Autorisez-la dans les réglages du navigateur, puis réessayez.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Aucune caméra détectée sur cet appareil. Saisissez le code à la main.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'La caméra est déjà utilisée par une autre application. Fermez-la puis réessayez.'
  }
  return 'Impossible d’accéder à la caméra. Saisissez le code à la main.'
}

export interface ScannerOptions {
  video: HTMLVideoElement
  /** true = code accepté, la lecture s'arrête. */
  onDetect: (code: string) => boolean | Promise<boolean>
  onStatus?: (message: string, isError?: boolean) => void
  formats?: string[]
}

export interface Scanner {
  start: () => Promise<boolean>
  stop: () => void
  isRunning: () => boolean
}

export function createScanner(options: ScannerOptions): Scanner {
  const video = options.video
  const onDetect = options.onDetect
  const onStatus = options.onStatus || (() => {})
  const formats = options.formats || ['code_128']

  let stream: MediaStream | null = null
  let timer: number | null = null
  let reader: any = null
  let running = false

  function stop() {
    running = false
    if (timer) { window.clearTimeout(timer); timer = null }
    if (reader) {
      try { reader.reset() } catch { /* déjà arrêté */ }
      reader = null
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      stream = null
    }
    if (video) video.srcObject = null
  }

  // Un code lu ne vaut pas un code valide : onDetect décide s'il faut s'arrêter.
  // Seul un résultat franchement positif coupe la caméra — un callback qui refuse le
  // code (ou qui ne renvoie rien) laisse la lecture continuer, sinon un code-barres
  // voisin mal cadré figerait l'écran sur un refus sans nouvelle tentative.
  async function handle(value: unknown) {
    if (!value) return false
    const accepted = await onDetect(String(value).trim())
    if (accepted) { stop(); return true }
    return false
  }

  async function runNative() {
    const detector = new (window as any).BarcodeDetector({ formats })
    const tick = async () => {
      if (!running) return
      try {
        const codes = await detector.detect(video)
        if (codes && codes.length && await handle(codes[0].rawValue)) return
      } catch {
        // Image floue ou trame incomplète : on laisse la boucle réessayer.
      }
      if (running) timer = window.setTimeout(tick, POLL_INTERVAL_MS)
    }
    void tick()
  }

  async function runZXing() {
    const ZXing = await loadZXing()
    if (!running) return

    const hints = new Map()
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128])
    reader = new ZXing.BrowserMultiFormatReader(hints)

    reader.decodeFromStream(stream, video, (result: any) => {
      if (!running || !result) return
      void handle(result.getText())
    })
  }

  async function start() {
    if (running) return true
    const reason = cameraUnavailableReason()
    if (reason) { onStatus(reason, true); return false }

    running = true
    try {
      stream = await openCamera()
      if (!running) { stop(); return false }
      video.srcObject = stream
      await video.play()
    } catch (error) {
      console.error('Ouverture de la caméra impossible', error)
      running = false
      onStatus(humanCameraError(error), true)
      return false
    }

    const native = 'BarcodeDetector' in window
    onStatus(native ? 'Recherche du code-barres…' : 'Préparation du lecteur…')

    try {
      if (native) await runNative()
      else await runZXing()
    } catch (error) {
      console.error('Démarrage du lecteur de code-barres impossible', error)
      stop()
      onStatus('Lecteur de code-barres indisponible. Saisissez le code à la main.', true)
      return false
    }

    if (!native) onStatus('Recherche du code-barres…')
    return true
  }

  return { start, stop, isRunning: () => running }
}
