document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // 1. CONNEXION BIOMÉTRIQUE RÉELLE (WebAuthn)
    // ==========================================
    // FORCER L'UTILISATION DE L'API DE PRODUCTION
    const API_URL = 'https://api-lunetterie.universearch.com/api/v1';
    const RP_ID = 'api-lunetterie.universearch.com';
    
    const scannerBox = document.getElementById('scannerBox');
    const statusMessage = document.getElementById('statusMessage');
    const scannerIcon = document.getElementById('scannerIcon');
    const emailLoginForm = document.getElementById('emailLoginForm');
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const loginPasswordLabel = document.getElementById('loginPasswordLabel');
    const confirmPasswordWrap = document.getElementById('confirmPasswordWrap');
    const confirmPassword = document.getElementById('confirmPassword');
    const passwordStep = document.getElementById('passwordStep');
    const emailFeedback = document.getElementById('emailFeedback');
    const emailLoginBtnText = document.getElementById('emailLoginBtnText');

    // Afficher/masquer le mot de passe saisi.
    function wireTogglePassword(input, button) {
        if (!input || !button) return;
        const icon = button.querySelector('i');
        button.addEventListener('click', () => {
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            icon.classList.toggle('fa-eye', showing);
            icon.classList.toggle('fa-eye-slash', !showing);
            button.setAttribute('aria-label', showing ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
            input.focus();
        });
    }
    wireTogglePassword(loginPassword, document.getElementById('toggleLoginPassword'));
    wireTogglePassword(confirmPassword, document.getElementById('toggleConfirmPassword'));

    let emailLookupTimer;
    let verifiedEmail = '';
    let needsPasswordSetup = false;

    // Message affiché quand auth-guard.js a redirigé ici (session expirée par
    // inactivité, ou accès à une page sans être connecté).
    const LOGOUT_REASON_MESSAGES = {
        inactivite: 'Vous avez été déconnecté après une longue période d\'inactivité. Reconnectez-vous pour continuer.'
    };
    const logoutReason = new URLSearchParams(window.location.search).get('reason');
    if (logoutReason && LOGOUT_REASON_MESSAGES[logoutReason]) {
        setEmailFeedback(LOGOUT_REASON_MESSAGES[logoutReason]);
    }

    // ==========================================
    // REDIRECTION APRÈS CONNEXION SELON LE RÔLE
    // ==========================================
    const ROLE_REDIRECTS = {
        SUPER_ADMIN: 'direction.html',
        ADMIN: 'admin.html',
        MAGASINIER: 'scan.html',
        VENDEUR: 'presentoir.html',
        LABORATOIRE: 'presentoir.html',
        RESPONSABLE_STATION: 'presentoir.html'
    };

    const ROLE_ID_TO_NAME = {
        1: 'SUPER_ADMIN',
        2: 'ADMIN',
        3: 'MAGASINIER',
        4: 'VENDEUR',
        5: 'LABORATOIRE',
        6: 'RESPONSABLE_STATION',
        7: 'DIRECTION',
        8: 'SUPER_DIRECTEUR'
    };

    // "Direction" et "Super directeur" ne sont pas des postes distincts dans
    // l'équipe : ce sont les mêmes personnes qu'"Administrateur" et "Super
    // administrateur". On les ramène à ces deux seuls rôles dès la lecture,
    // pour qu'aucune autre partie du code n'ait à connaître ces alias.
    const ROLE_ALIASES = { DIRECTION: 'ADMIN', SUPER_DIRECTEUR: 'SUPER_ADMIN' };

    function normalizeRoleName(value) {
        if (!value) return null;
        const name = String(value).trim().toUpperCase().replace(/\s+/g, '_');
        return ROLE_ALIASES[name] || name;
    }

    function getRoleName(user) {
        return normalizeRoleName(user?.role_name || user?.role || ROLE_ID_TO_NAME[user?.role_id]);
    }

    function redirectAfterLogin(user) {
        const roleName = getRoleName(user);
        if (roleName === 'MAGASINIER' && user?.station_name === 'Station Pointe-Noire') {
            window.location.href = 'presentoir.html';
            return;
        }
        window.location.href = ROLE_REDIRECTS[roleName] || 'admin.html';
    }

    function setEmailFeedback(message, type = '') {
        emailFeedback.textContent = message;
        emailFeedback.className = 'email-feedback' + (type ? ' ' + type : '');
    }

    function hidePasswordStep() {
        verifiedEmail = '';
        needsPasswordSetup = false;
        loginPassword.value = '';
        confirmPassword.value = '';
        confirmPasswordWrap.hidden = true;
        passwordStep.hidden = true;
    }

    function showPasswordStep(hasPassword) {
        needsPasswordSetup = !hasPassword;
        confirmPasswordWrap.hidden = hasPassword;
        confirmPassword.required = !hasPassword;
        loginPassword.autocomplete = 'one-time-code';
        loginPassword.placeholder = hasPassword ? 'Saisissez votre code' : 'Choisissez 4 ou 6 chiffres';
        loginPasswordLabel.textContent = hasPassword ? 'Code' : 'Nouveau code';
        emailLoginBtnText.textContent = hasPassword ? 'Se connecter' : 'Définir mon code';
        passwordStep.hidden = false;
    }

    async function checkEmailExists() {
        const name = loginEmail.value.trim();
        // Un nom complet, donc au moins deux mots : sans ça on interroge le serveur à
        // chaque lettre tapée, pour rien.
        if (name.split(/\s+/).filter(Boolean).length < 2) {
            hidePasswordStep();
            setEmailFeedback(name ? 'Saisissez votre nom complet.' : '');
            return;
        }

        setEmailFeedback('Vérification du nom…');
        try {
            // GET /auth/users exige un rôle admin (il expose tout le dossier employés) :
            // cette étape utilise un point d'entrée public et minimal, qui n'expose que
            // l'existence du compte.
            const response = await fetch(`${API_URL}/auth/check-user`, {
                method: 'POST',
                mode: 'cors',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name })
            });
            const result = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(result?.message || result?.error || 'Impossible de vérifier ce nom.');

            const data = result?.data || {};

            // Ne met pas à jour l'interface si l'utilisateur a changé le nom pendant
            // la requête réseau.
            if (loginEmail.value.trim() !== name) return;

            if (!data.exists) {
                hidePasswordStep();
                setEmailFeedback('Aucun employé ne correspond à ce nom.', 'error');
                return;
            }

            verifiedEmail = name;
            showPasswordStep(!!data.has_password);
            setEmailFeedback(
                data.has_password
                    ? 'Nom reconnu. Saisissez votre code.'
                    : 'Première connexion : choisissez votre code.',
                'success'
            );
            loginPassword.focus();
        } catch (error) {
            console.error('Erreur de vérification du nom', error);
            hidePasswordStep();
            setEmailFeedback(error.message || 'Vérification indisponible.', 'error');
        }
    }

    loginEmail.addEventListener('input', () => {
        hidePasswordStep();
        window.clearTimeout(emailLookupTimer);
        const email = loginEmail.value.trim();
        if (!email) {
            setEmailFeedback('');
            return;
        }
        emailLookupTimer = window.setTimeout(checkEmailExists, 450);
    });
    loginEmail.addEventListener('blur', checkEmailExists);

    // Les deux champs de code n'acceptent que des chiffres : maxlength borne la frappe,
    // ce filtre couvre le collage et les pavés qui laissent passer autre chose.
    [loginPassword, confirmPassword].forEach(function (field) {
        if (!field) return;
        field.addEventListener('input', function () {
            const digits = field.value.replace(/\D/g, '').slice(0, 6);
            if (field.value !== digits) field.value = digits;
        });
    });

    emailLoginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (verifiedEmail !== loginEmail.value.trim() || !loginPassword.value) {
            setEmailFeedback('Vérifiez votre nom puis saisissez votre code.', 'error');
            return;
        }

        // Même règle que IsValidPIN côté Go : exactement 4 ou 6 chiffres.
        if (!/^(\d{4}|\d{6})$/.test(loginPassword.value)) {
            setEmailFeedback('Le code doit contenir exactement 4 ou 6 chiffres.', 'error');
            return;
        }

        if (needsPasswordSetup && loginPassword.value !== confirmPassword.value) {
            setEmailFeedback('Les deux codes ne correspondent pas.', 'error');
            return;
        }

        try {
            setEmailFeedback(needsPasswordSetup ? 'Enregistrement du code...' : 'Connexion en cours...', '');

            const endpoint = needsPasswordSetup ? 'auth/set-password' : 'auth/login';
            const response = await fetch(`${API_URL}/${endpoint}`, {
                method: 'POST',
                mode: 'cors',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: verifiedEmail,
                    password: loginPassword.value
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData?.message || 'Identifiants incorrects');
            }

            const result = await response.json();
            
            // Stocker le token et les données utilisateur
            localStorage.setItem('token', result.data.token);
            localStorage.setItem('user', JSON.stringify(result.data.user));
            
            setEmailFeedback('Connexion réussie ! Redirection...', 'success');

            setTimeout(() => {
                redirectAfterLogin(result.data.user);
            }, 1000);
            
        } catch (error) {
            console.error('Erreur de connexion', error);
            setEmailFeedback(error.message || 'Échec de la connexion', 'error');
        }
    });

    let isScanning = false;

    function bufferToBase64URL(buffer) {
        const bytes = new Uint8Array(buffer);
        let str = '';
        bytes.forEach(b => str += String.fromCharCode(b));
        return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }

    function base64URLToBuffer(base64url) {
        const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        const binary = atob(base64 + padding);
        const buffer = new ArrayBuffer(binary.length);
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return buffer;
    }

    function resetScanner(delay = 2500) {
        setTimeout(() => {
            scannerBox.classList.remove('scanning', 'success');
            scannerIcon.classList.remove('fa-check-circle');
            scannerIcon.classList.add('fa-fingerprint');
            statusMessage.textContent = "En attente du lecteur d'empreinte...";
            statusMessage.className = 'status-message';
        }, delay);
    }

    async function biometricLogin() {
        if (isScanning) return;

        if (!window.PublicKeyCredential) {
            statusMessage.textContent = "Ce navigateur ne supporte pas l'authentification biométrique (WebAuthn).";
            statusMessage.className = 'status-message error';
            return;
        }

        isScanning = true;
        scannerBox.classList.add('scanning');
        statusMessage.textContent = 'Analyse biométrique en cours...';
        statusMessage.className = 'status-message';

        try {
            const challengeResponse = await fetch(`${API_URL}/auth/webauthn/discoverable-login-challenge`, {
                method: 'POST',
                mode: 'cors',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            if (!challengeResponse.ok) {
                throw new Error('Impossible de contacter le serveur');
            }
            const challengeBody = await challengeResponse.json();
            const challenge = challengeBody.data.challenge;

            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: base64URLToBuffer(challenge),
                    rpId: RP_ID,
                    userVerification: 'required',
                    timeout: 60000
                }
            });

            const payload = {
                id: assertion.id,
                rawId: bufferToBase64URL(assertion.rawId),
                type: assertion.type,
                response: {
                    clientDataJSON: bufferToBase64URL(assertion.response.clientDataJSON),
                    authenticatorData: bufferToBase64URL(assertion.response.authenticatorData),
                    signature: bufferToBase64URL(assertion.response.signature),
                    userHandle: assertion.response.userHandle ? bufferToBase64URL(assertion.response.userHandle) : null
                }
            };

            const verifyResponse = await fetch(`${API_URL}/auth/webauthn/discoverable-login-verify`, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!verifyResponse.ok) {
                const body = await verifyResponse.json().catch(() => ({}));
                throw new Error(body?.message || 'Empreinte non reconnue');
            }

            const result = await verifyResponse.json();
            localStorage.setItem('token', result.data.token);
            localStorage.setItem('user', JSON.stringify(result.data.user));

            scannerBox.classList.remove('scanning');
            scannerBox.classList.add('success');
            scannerIcon.classList.remove('fa-fingerprint');
            scannerIcon.classList.add('fa-check-circle');

            const firstName = result.data.user?.first_name || '';
            statusMessage.textContent = `Identité confirmée${firstName ? ' : ' + firstName : ''}. Redirection...`;
            statusMessage.className = 'status-message success';

            setTimeout(() => {
                redirectAfterLogin(result.data.user);
            }, 1000);
        } catch (error) {
            console.error('Erreur connexion biométrique', error);
            scannerBox.classList.remove('scanning');
            const message = error?.name === 'NotAllowedError'
                ? 'Scan annulé ou empreinte non reconnue'
                : (error.message || "Échec de l'authentification");
            statusMessage.textContent = message;
            statusMessage.className = 'status-message error';
            resetScanner();
        } finally {
            isScanning = false;
        }
    }

    scannerBox.addEventListener('click', biometricLogin);
});