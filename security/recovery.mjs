import { checked, completePortalMfa } from './auth.mjs?v=1';

const url = 'https://xanhhfashgkyrvphprts.supabase.co';
const key = 'sb_publishable_JQ9TWOn3GvY2nTth0JLHIQ_AtTgwz8B';
const el = id => document.getElementById(id);
const emailForm = el('recoveryEmailForm');
const passwordForm = el('recoveryNewPasswordForm');
const pastedForm = el('recoveryPastedLinkForm');
const continueButton = el('recoveryContinue');
const fragment = new URLSearchParams(location.hash.slice(1));
const received = {
  type: fragment.get('type'),
  token: fragment.get('token_hash'),
  access: fragment.get('access_token'),
  refresh: fragment.get('refresh_token')
};
// Keep recovery tokens out of the history, referrer and normal portal storage.
history.replaceState(null, '', location.pathname);
const client = window.supabase?.createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'olon-recovery' }
});
let verified = false;

function status(message, type) {
  const node = el('recoveryMessage');
  node.textContent = message;
  node.dataset.status = type;
  node.hidden = !message;
}

async function verifyLink({ type, token, access, refresh }) {
  if (!['recovery', 'invite'].includes(type)) throw new Error('Enlace no válido.');
  const data = token ?
    checked(await client.auth.verifyOtp({ token_hash: token, type })) :
    checked(await client.auth.setSession({ access_token: access, refresh_token: refresh }));
  if (!data.session?.access_token || !data.user?.id) throw new Error('No se verificó el enlace.');
  verified = true;
  continueButton.hidden = emailForm.hidden = el('recoveryFallback').hidden = true;
  passwordForm.hidden = false;
  el('recoveryTitle').textContent = type === 'invite' ? 'Crea tu contraseña' : 'Crea tu nueva contraseña';
  el('recoveryDescription').textContent = 'El enlace fue verificado. Escribe y confirma la contraseña.';
  status('', 'info');
  el('recoveryPassword').focus();
}

function failedLink() {
  continueButton.hidden = true;
  emailForm.hidden = false;
  el('recoveryFallback').hidden = false;
  status('El enlace expiró, ya fue utilizado o no es válido. Solicita un enlace nuevo.', 'error');
}

if (!client) {
  status('No se pudo cargar Supabase. Actualiza la página.', 'error');
} else {
  if (['recovery', 'invite'].includes(received.type) && (received.token || (received.access && received.refresh))) {
    emailForm.hidden = el('recoveryFallback').hidden = true;
    continueButton.hidden = false;
    el('recoveryDescription').textContent = 'Verifica el enlace de tu correo para continuar.';
    continueButton.onclick = async () => {
      continueButton.disabled = true;
      try { await verifyLink(received); } catch { failedLink(); }
      finally {
        received.token = received.access = received.refresh = null;
        continueButton.disabled = false;
      }
    };
  }

  pastedForm.addEventListener('submit', async event => {
    event.preventDefault();
    const input = el('recoveryPastedLink');
    const button = el('recoveryVerifyLinkBtn');
    button.disabled = true;
    try {
      const link = new URL(input.value.trim().replaceAll('&amp;', '&'));
      if (link.origin !== url || link.pathname !== '/auth/v1/verify') throw new Error('Enlace no válido.');
      const token = link.searchParams.get('token') || link.searchParams.get('token_hash');
      if (!token || !/^[a-zA-Z0-9_-]{32,256}$/.test(token)) throw new Error('Código no válido.');
      await verifyLink({ type: link.searchParams.get('type'), token });
    } catch { failedLink(); }
    finally { input.value = ''; button.disabled = false; }
  });

  emailForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = el('recoverySendBtn');
    const email = el('recoveryEmail').value.trim().toLowerCase();
    const redirectTo = new URL('./recuperar.html?mode=update', location.href).href;
    button.disabled = true;
    try {
      checked(await client.auth.resetPasswordForEmail(email, { redirectTo }));
      status('Si el correo está registrado, recibirás un enlace de recuperación.', 'success');
    } catch (error) {
      status(error.status === 429 ? 'Se alcanzó el límite de envíos. Intenta más tarde.' :
        'No se pudo solicitar el enlace. Intenta de nuevo o contacta a la academia.', 'error');
    } finally { button.disabled = false; }
  });

  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!verified) return;
    const password = el('recoveryPassword').value;
    if (Array.from(password).length < 12 || new TextEncoder().encode(password).length > 72 ||
      password !== el('recoveryPasswordConfirm').value) {
      status('Usa al menos 12 caracteres y hasta 72 bytes. Las contraseñas deben coincidir.', 'error');
      return;
    }
    const button = el('recoveryUpdateBtn');
    button.disabled = true;
    try {
      const { user } = checked(await client.auth.getUser());
      if (!await completePortalMfa(client, user, false)) return;
      checked(await client.auth.updateUser({ password }));
      verified = false;
      passwordForm.reset();
      passwordForm.hidden = true;
      el('recoveryTitle').textContent = 'Contraseña guardada';
      el('recoveryDescription').textContent = 'Regresa al portal e inicia sesión con tu contraseña nueva.';
      status('Supabase confirmó el cambio de contraseña.', 'success');
      await client.auth.signOut({ scope: 'global' }).catch(() => {});
    } catch (error) {
      status(error.code === 'insufficient_aal' ? 'Verifica tu autenticador para continuar.' :
        'Supabase no pudo guardar la contraseña. Si el enlace expiró, solicita uno nuevo.', 'error');
    } finally { button.disabled = false; }
  });
}
