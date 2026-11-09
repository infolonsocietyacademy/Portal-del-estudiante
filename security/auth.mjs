const loadStyle = () => {
  if (document.querySelector('link[data-olon-security-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./security.css', import.meta.url).href;
  link.dataset.olonSecurityStyle = '';
  document.head.append(link);
};

export function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function totpFactors(client) {
  const factors = checked(await client.auth.mfa.listFactors());
  return factors.totp.filter(factor => factor.status === 'verified');
}

function makeDialog(title, instructions) {
  loadStyle();
  const dialog = document.createElement('dialog');
  dialog.className = 'olfxSecurity olfxSecurityDialog';
  dialog.innerHTML = `<form><h2></h2><p data-help></p><div data-fields></div>
    <p data-status role="status"></p><div class="olfxActions">
    <button type="button" data-cancel>Cancelar</button><button type="submit">Verificar</button></div></form>`;
  dialog.querySelector('h2').textContent = title;
  dialog.setAttribute('aria-label', title);
  dialog.querySelector('[data-help]').textContent = instructions;
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  return dialog;
}

export async function verifyTotp(client, { enroll = false, factors, backup = false } = {}) {
  if (!enroll) factors ||= await totpFactors(client);
  if (!enroll && !factors.length) throw new Error('Esta cuenta no tiene un autenticador TOTP disponible.');
  let enrollment;
  if (enroll) {
    enrollment = checked(await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: backup ? 'OLFX Respaldo' : 'OLFX Principal',
      issuer: 'OLON Society Academy'
    }));
  }

  const dialog = makeDialog(enroll ? 'Registrar autenticador' : 'Confirma tu identidad',
    enroll ? 'Escanea el QR con tu app autenticadora o ingresa la clave manualmente. Escribe el código que muestra la app.' :
      'Escribe el código de seis dígitos de tu aplicación autenticadora.');
  const form = dialog.querySelector('form');
  const fields = dialog.querySelector('[data-fields]');
  if (enroll) {
    const qr = document.createElement('img');
    qr.className = 'olfxQr';
    qr.alt = 'Código QR para registrar el autenticador';
    if (enrollment.totp.qr_code.startsWith('data:image/svg+xml;utf-8,')) qr.src = enrollment.totp.qr_code;
    const manual = document.createElement('label');
    manual.textContent = 'Clave manual';
    const key = document.createElement('input');
    key.value = enrollment.totp.secret;
    key.readOnly = true;
    key.autocomplete = 'off';
    manual.append(key);
    fields.append(qr, manual);
  } else if (factors.length > 1) {
    const label = document.createElement('label');
    label.textContent = 'Autenticador';
    const select = document.createElement('select');
    select.name = 'factor';
    factors.forEach((factor, i) => select.add(new Option(factor.friendly_name || 'Autenticador ' + (i + 1), factor.id)));
    label.append(select);
    fields.append(label);
  }
  const label = document.createElement('label');
  label.textContent = 'Código';
  const input = document.createElement('input');
  input.name = 'code';
  input.inputMode = 'numeric';
  input.autocomplete = 'one-time-code';
  input.pattern = '[0-9]{6}';
  input.maxLength = 6;
  input.required = true;
  label.append(input);
  fields.append(label);
  const status = dialog.querySelector('[data-status]');
  let verified = false;
  let busy = false;
  return new Promise(resolve => {
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', async () => {
      if (!verified && enrollment) {
        // Best effort cleanup of an unverified factor. It grants no access.
        await client.auth.mfa.unenroll({ factorId: enrollment.id }).catch(() => {});
      }
      resolve(verified);
    }, { once: true });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
      status.textContent = 'Verificando…';
      try {
        const factorId = enrollment?.id || form.elements.factor?.value || factors[0].id;
        checked(await client.auth.mfa.challengeAndVerify({ factorId, code: input.value }));
        verified = true;
        dialog.close();
      } catch {
        status.textContent = 'No se verificó el código. Espera el siguiente código y vuelve a intentarlo.';
        input.select();
      } finally {
        busy = false;
        dialog.querySelectorAll('button').forEach(button => { button.disabled = false; });
      }
    });
    dialog.showModal();
    input.focus();
  });
}

export async function completePortalMfa(client, user, admin) {
  const verified = (user.factors || []).some(factor => factor.status === 'verified');
  if (!admin && !verified) return true;
  const level = checked(await client.auth.mfa.getAuthenticatorAssuranceLevel());
  if (level.currentLevel === 'aal2') return true;
  const factors = await totpFactors(client);
  if (factors.length) return verifyTotp(client, { factors });
  if (admin && !verified) return verifyTotp(client, { enroll: true });
  throw new Error('La cuenta tiene un método MFA que este portal no puede verificar. Contacta a soporte.');
}

export async function changeOwnPassword(client, createClient, url, key, current, next) {
  const user = checked(await client.auth.getUser()).user;
  if (!user?.email) throw new Error('Tu sesión expiró.');
  const session = checked(await client.auth.getSession()).session;
  if (!session) throw new Error('Tu sesión expiró.');

  // Verify the current password without replacing or downgrading the user's live AAL2 session.
  const verifier = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      storageKey: 'olon-password-verification' }
  });
  try {
    const checkedUser = checked(await verifier.auth.signInWithPassword({ email: user.email, password: current })).user;
    if (checkedUser?.id !== user.id) throw new Error('La identidad de la cuenta no coincide.');
    // GoTrue verifies current_password server-side when the project setting is enabled.
    const response = await fetch(url + '/auth/v1/user', {
      method: 'PUT', cache: 'no-store',
      headers: { apikey: key, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: next, current_password: current })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (error.code === 'reauthentication_needed') throw new Error('Por seguridad, usa el enlace de recuperación por correo para confirmar el cambio.');
      throw new Error('Supabase no aceptó la contraseña nueva. Comprueba los requisitos o usa la recuperación por correo.');
    }
  } finally {
    await verifier.auth.signOut({ scope: 'local' }).catch(() => {});
  }
}

export async function freshAdminTotp(client) {
  const level = checked(await client.auth.mfa.getAuthenticatorAssuranceLevel());
  if (level.currentLevel === 'aal2' && level.currentAuthenticationMethods.some(method =>
    method.method === 'totp' && Date.now() / 1000 - method.timestamp < 270)) return true;
  return verifyTotp(client);
}
