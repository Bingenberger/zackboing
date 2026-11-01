/* Adminbereich: Lehrerkonten verwalten + allgemeine Einstellungen. */
(() => {
  const $ = (id) => document.getElementById(id);
  let me = null;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler.');
    return data;
  }

  function flashError(msg) {
    const el = $('admin-error');
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------- Einstellungen ----------------
  async function loadSettings() {
    const { settings } = await api('/api/admin/settings');
    $('set-registration').checked = settings.registration_open === '1';
    $('set-gallery').value = settings.gallery_url;
    $('set-subjects').value = settings.subjects;
  }

  $('btn-save-settings').addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: {
          registration_open: $('set-registration').checked ? '1' : '0',
          gallery_url: $('set-gallery').value,
          subjects: $('set-subjects').value,
        },
      });
      const saved = $('settings-saved');
      saved.style.display = '';
      setTimeout(() => { saved.style.display = 'none'; }, 2500);
    } catch (e) { flashError(e.message); }
  });

  // ---------------- Konten ----------------
  async function loadUsers() {
    const { users } = await api('/api/admin/users');
    const tbody = $('user-table').querySelector('tbody');
    tbody.innerHTML = '';
    for (const user of users) {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.textContent = user.name;
      const tdMail = document.createElement('td');
      tdMail.textContent = user.email;
      const tdRole = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `role-pill ${user.role}`;
      pill.textContent = user.role === 'admin' ? 'Admin' : 'Lehrkraft';
      tdRole.appendChild(pill);
      const tdQuiz = document.createElement('td');
      tdQuiz.textContent = user.quiz_count;
      const tdSince = document.createElement('td');
      tdSince.textContent = new Date(user.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE');

      const tdActions = document.createElement('td');
      const mkBtn = (cls, text, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = text;
        b.addEventListener('click', fn);
        return b;
      };

      tdActions.appendChild(mkBtn('btn tiny', user.role === 'admin' ? '→ Lehrkraft' : '→ Admin', async () => {
        try {
          await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { role: user.role === 'admin' ? 'teacher' : 'admin' } });
          loadUsers();
        } catch (e) { flashError(e.message); }
      }));

      tdActions.appendChild(mkBtn('btn tiny', '🔑 Passwort', async () => {
        const password = prompt(`Neues Passwort für ${user.name} (mind. 8 Zeichen):`);
        if (!password) return;
        try {
          await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { password } });
          alert('Passwort geändert. Die Person muss sich neu anmelden.');
        } catch (e) { flashError(e.message); }
      }));

      if (user.id !== me.id) {
        tdActions.appendChild(mkBtn('btn tiny danger', '🗑️', async () => {
          if (!confirm(`Konto „${user.name}“ (${user.email}) wirklich löschen?\nAlle Quizze dieser Person werden mitgelöscht!`)) return;
          try {
            await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
            loadUsers();
          } catch (e) { flashError(e.message); }
        }));
      }

      tr.append(tdName, tdMail, tdRole, tdQuiz, tdSince, tdActions);
      tbody.appendChild(tr);
    }
  }

  $('btn-create-user').addEventListener('click', async () => {
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: {
          name: $('new-name').value,
          email: $('new-email').value,
          password: $('new-password').value,
          role: $('new-role').value,
        },
      });
      $('new-name').value = $('new-email').value = $('new-password').value = '';
      loadUsers();
    } catch (e) { flashError(e.message); }
  });

  // ---------------- Start ----------------
  (async () => {
    const { user } = await api('/api/me');
    if (!user || user.role !== 'admin') {
      location.href = '/teacher.html';
      return;
    }
    me = user;
    await Promise.all([loadSettings(), loadUsers()]);
  })();
})();
