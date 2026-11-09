import { checked, freshAdminTotp, totpFactors, verifyTotp } from './auth.mjs?v=1';

const messages = {
  access_changed: 'Cambio de acceso', role_changed: 'Cambio de rol', membership_changed: 'Cambio de membresía',
  password_changed: 'Contraseña actualizada', email_changed: 'Correo actualizado',
  mfa_verified: 'Autenticador verificado', mfa_removed: 'Autenticador retirado',
  other_sessions_revoked: 'Cierre de otras sesiones', sessions_revoked: 'Sesiones revocadas',
  admin_mfa_enforced: 'MFA administrativo obligatorio', recovery_email_requested: 'Recuperación solicitada por administración',
  request_reviewed: 'Solicitud revisada', request_rejected: 'Solicitud rechazada', student_deleted: 'Cuenta eliminada',
  receipt_reviewed: 'Comprobante revisado', insert: 'Creación', update: 'Modificación', delete: 'Eliminación'
};
const resources = {
  profiles: 'Perfiles', users: 'Supabase Auth', mfa_factors: 'Autenticación', sessions: 'Sesiones',
  registration: 'Acceso', configuration: 'Configuración', student_records: 'Operaciones', olon_trade_journals: 'Diario',
  olon_classes: 'Clases', olon_invoices: 'Facturación', olon_rebate_reports: 'Rebates',
  olon_portal_reminders: 'Avisos', olon_vip_receipts: 'Comprobantes', access_requests: 'Solicitudes'
};
const date = value => value ? new Intl.DateTimeFormat('es-PR', {
  timeZone: 'America/Puerto_Rico', dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(value)) : 'Sin datos';
const statusNames = { active: 'Activo', suspended: 'Suspendido', pending: 'Pendiente', approved: 'Aprobado',
  expired: 'Vencido', deleting: 'Eliminación pendiente', student: 'Estudiante', admin: 'Administrador' };

function el(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function addList(parent, items, empty) {
  const list = el('ul');
  list.className = 'olfxList';
  for (const lines of items.length ? items : [[empty]]) {
    const row = el('li');
    lines.filter(Boolean).forEach((line, index) => row.append(el(index ? 'small' : 'strong', line)));
    list.append(row);
  }
  parent.append(list);
}

export async function mountSecurity(root, client, user, adminView) {
  if (!document.querySelector('link[data-olon-security-style]')) {
    const style = el('link');
    style.rel = 'stylesheet';
    style.href = new URL('./security.css', import.meta.url).href;
    style.dataset.olonSecurityStyle = '';
    document.head.append(style);
  }

  const panel = el('div');
  panel.className = 'olfxSecurity';
  panel.innerHTML = `<header class="olfxHead"><div><p>OLON SOCIETY ACADEMY · CONTROL DE ACCESO</p><h2></h2></div>
    <button type="button" data-refresh>Actualizar</button></header><p data-feedback role="status"></p><div data-content></div>`;
  panel.querySelector('h2').textContent = adminView ? 'OLFX SECURITY CENTER' : 'Seguridad de mi cuenta';
  root.replaceChildren(panel);
  const output = panel.querySelector('[data-content]');
  const feedback = panel.querySelector('[data-feedback]');
  const refresh = panel.querySelector('[data-refresh]');
  let pending = false;

  function block(title) {
    const section = el('section');
    section.className = 'olfxCard';
    section.append(el('h3', title));
    output.append(section);
    return section;
  }

  function button(parent, label, onClick) {
    const control = el('button', label);
    control.type = 'button';
    control.onclick = () => void task(onClick);
    parent.append(control);
  }

  async function task(work) {
    if (pending || !panel.isConnected) return;
    pending = true;
    panel.setAttribute('aria-busy', 'true');
    const controls = [...panel.querySelectorAll('button,select,input')].filter(control => !control.disabled);
    controls.forEach(control => { control.disabled = true; });
    feedback.textContent = 'Consultando Supabase…';
    try {
      feedback.textContent = await work() || '';
    } catch (error) {
      feedback.textContent = error.code === 'PGRST202' ? 'El servicio de seguridad todavía no está habilitado en este proyecto.' :
        error.code === '42501' ? 'Supabase rechazó la acción. Vuelve a verificar tu sesión y tu autenticador.' :
        error.message || 'Supabase no confirmó la operación.';
    } finally {
      panel.removeAttribute('aria-busy');
      controls.forEach(control => { control.disabled = false; });
      pending = false;
    }
  }

  const rpc = async (name, args) => checked(await client.rpc('olon_security_' + name, args));
  const eventLines = event => [
    messages[event.action] || 'Actividad de seguridad',
    [date(event.happened_at), resources[event.resource], event.actor && 'Por ' + event.actor,
      event.subject && 'Cuenta ' + event.subject].filter(Boolean).join(' · '),
    event.details?.to && [statusNames[event.details.from], statusNames[event.details.to]].filter(Boolean).join(' → '),
    Number.isInteger(event.details?.count) && 'Sesiones afectadas ' + event.details.count
  ];

  async function load() {
    const data = await rpc(adminView ? 'admin_overview' : 'me');
    if (!panel.isConnected) return;
    output.replaceChildren();
    if (adminView) {
      const summary = block('Estado de seguridad');
      const grid = el('dl');
      grid.className = 'olfxStats';
      for (const [label, value] of [
        ['Usuarios registrados', data.registered], ['Sesiones registradas y vigentes', data.sessions],
        ['Usuarios con TOTP verificado', data.members_with_totp], ['Administradores con respaldo', `${data.admins_with_backup} / ${data.admins}`],
        ['Intentos fallidos', data.failed_sign_ins ?? 'Sin fuente conectada']
      ]) {
        const cell = el('div');
        cell.append(el('dt', label), el('dd', value));
        grid.append(cell);
      }
      summary.append(grid, el('p', 'Las sesiones registradas no indican presencia en línea.'));

      const alerts = block('Alertas');
      if (!data.admin_mfa_enforced) {
        alerts.append(el('p', 'El centro ya exige TOTP. La exigencia para el resto de la administración está pendiente.'));
        if (data.admins === data.admins_with_backup) button(alerts, 'Exigir MFA a todos los administradores', async () => {
          if (!window.confirm('¿Activar MFA obligatorio en toda la administración?')) return;
          if (!await freshAdminTotp(client)) return 'Verificación cancelada.';
          await rpc('admin_action', { p_action: 'enforce_mfa' });
          await load();
          return 'MFA administrativo activado.';
        });
      } else {
        alerts.append(el('p', 'MFA administrativo obligatorio en la base de datos.'));
      }
      if (data.admins > data.admins_with_backup) alerts.append(el('p', 'Registra un segundo autenticador en un dispositivo independiente desde Seguridad de mi cuenta.'));
      alerts.append(el('p', 'Los intentos fallidos requieren una fuente de registros de Auth con acceso autorizado.'));

      const directory = block('Administrar accesos');
      const search = el('input');
      search.placeholder = 'Nombre o correo';
      search.setAttribute('aria-label', 'Buscar cuenta por nombre o correo');
      const results = el('div');
      directory.append(search);
      button(directory, 'Buscar', async () => {
        const term = search.value.trim();
        if (term.length < 2) return 'Escribe al menos dos caracteres.';
        const column = term.includes('@') ? 'email' : 'full_name';
        const accounts = checked(await client.from('profiles').select('id,full_name,email,role,status')
          .ilike(column, '%' + term.replace(/[\\%_]/g, '') + '%').order('full_name').limit(20));
        results.replaceChildren();
        if (!accounts.length) results.append(el('p', 'No se encontraron cuentas.'));
        for (const account of accounts) {
          const entry = el('section');
          entry.className = 'olfxTarget';
          entry.append(el('strong', account.full_name || 'Cuenta'), el('small',
            [account.email, statusNames[account.role], statusNames[account.status]].filter(Boolean).join(' · ')));
          if (account.id !== user.id && account.status !== 'deleting') {
            const actions = el('div');
            actions.className = 'olfxActions';
            const available = [['revoke', 'Revocar sesiones']];
            if (account.status === 'suspended') available.push(['reactivate', 'Reactivar']);
            else available.push(['suspend', 'Suspender']);
            if (account.role === 'admin') available.push(['demote', 'Quitar rol de administrador']);
            else if (['active', 'approved'].includes(account.status)) available.push(['promote', 'Asignar rol de administrador']);
            for (const [action, label] of available) button(actions, label, async () => {
              if (!window.confirm(label + ' · ' + (account.email || account.full_name))) return;
              if (!await freshAdminTotp(client)) return 'Verificación cancelada.';
              const count = await rpc('admin_action', { p_action: action, p_target: account.id });
              await load();
              return action === 'revoke' ? 'Sesiones revocadas: ' + count : 'Cambio confirmado en Supabase.';
            });
            entry.append(actions);
          }
          results.append(entry);
        }
      });
      search.addEventListener('keydown', event => {
        if (event.key === 'Enter') directory.querySelector('button').click();
      });
      directory.append(results);
      addList(block('Actividad reciente y eventos administrativos'), data.events.map(eventLines), 'Todavía no hay eventos registrados.');
    } else {
      const factors = await totpFactors(client);
      if (!panel.isConnected) return;
      const protection = block('Autenticación de dos factores');
      protection.append(el('p', factors.length ? factors.length + ' autenticador(es) verificado(s).' : 'Sin autenticador verificado.'));
      const factorActions = el('div');
      factorActions.className = 'olfxActions';
      if (!factors.length || (user.role === 'admin' && factors.length < 2)) {
        button(factorActions, factors.length ? 'Registrar autenticador de respaldo' : 'Registrar autenticador', async () => {
          if (!await verifyTotp(client, { enroll: true, backup: Boolean(factors.length) })) return 'Registro cancelado.';
          await load();
          return 'Autenticador registrado.';
        });
      }
      if (user.role === 'student' && factors.length) {
        button(factorActions, 'Retirar autenticador', async () => {
          if (!window.confirm('¿Retirar el autenticador registrado de esta cuenta?')) return;
          if (!await verifyTotp(client, { factors: [factors[0]] })) return 'Verificación cancelada.';
          checked(await client.auth.mfa.unenroll({ factorId: factors[0].id }));
          // The removed factor may have been associated with this AAL2 session.
          await client.auth.refreshSession();
          await load();
          return 'Autenticador retirado.';
        });
      }
      button(factorActions, 'Cambiar contraseña', () => document.getElementById('olonChangePasswordBtn').click());
      protection.append(factorActions, el('p', 'Si pierdes el acceso, usa la recuperación por correo. Si también pierdes tu autenticador, contacta a la academia.'));

      const sessions = block('Mis sesiones en Supabase');
      addList(sessions, data.sessions.map(session => [
        session.current_session ? 'Sesión actual' : 'Otra sesión',
        'Inicio ' + date(session.created_at),
        session.refreshed_at && 'Última renovación ' + date(session.refreshed_at),
        session.user_agent && 'Navegador registrado ' + session.user_agent
      ]), 'No hay sesiones registradas para mostrar.');
      button(sessions, 'Cerrar otras sesiones', async () => {
        if (!window.confirm('¿Cerrar todas las sesiones de esta cuenta excepto esta?')) return;
        const count = await rpc('revoke_others');
        await load();
        return 'Otras sesiones cerradas: ' + count;
      });
      addList(block('Avisos y actividad de seguridad'), data.events.map(eventLines), 'Todavía no hay avisos de seguridad.');
    }
  }

  refresh.onclick = () => void task(load);
  await task(load);
}
