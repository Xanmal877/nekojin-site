/* Support page: client-side checks, then POST /api/support. The server is
   the real gate; these checks only save the visitor a round trip. */

(function () {
  const form = document.getElementById('sp-form');
  const done = document.getElementById('sp-done');
  const errorBox = document.getElementById('sp-error');
  const submit = document.getElementById('sp-submit');
  const count = document.getElementById('sp-count');
  const startedAt = Date.now();

  // Pre-select a product when linked as /support?game=xanrean-tides etc.
  const preset = {
    'sakileras-guide': "Sakilera's Guide to Dungeoneering",
    'xanrean-tides': 'Xanrean Tides',
    'echo-world': 'Echo World'
  }[new URLSearchParams(location.search).get('game')];
  if (preset) form.product.value = preset;

  form.message.addEventListener('input', () => {
    count.textContent = `${form.message.value.length} / 5000`;
  });

  function showError(msg, field) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    if (field) { field.classList.add('sp-invalid'); field.focus(); }
  }
  form.addEventListener('input', e => {
    e.target.classList.remove('sp-invalid');
    errorBox.hidden = true;
  });

  function check(data) {
    if (!data.name.trim()) return ['Please tell us your name.', form.name];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) return ['Please enter a valid email so we can reply.', form.email];
    if (!data.category) return ['Please pick what this is about.', form.category];
    if (!data.product) return ['Please pick which game or product.', form.product];
    if (data.subject.trim().length < 4) return ['Please add a short subject.', form.subject];
    if (data.message.trim().length < 15) return ['Please describe the problem in a little more detail.', form.message];
    return null;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.category = form.category.value;
    data.product = form.product.value;
    const problem = check(data);
    if (problem) return showError(problem[0], problem[1]);

    submit.disabled = true;
    submit.classList.add('is-busy');
    submit.querySelector('.sp-submit-label').textContent = 'Sending…';
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, startedAt })
      });
      const reply = await res.json().catch(() => ({}));
      if (!res.ok || !reply.ok) {
        throw new Error(reply.error || 'We could not send your ticket. Please try again in a moment.');
      }
      document.getElementById('sp-ticket').textContent = reply.ticket;
      form.hidden = true;
      done.hidden = false;
      done.focus();
    } catch (err) {
      showError(err.message);
    } finally {
      submit.disabled = false;
      submit.classList.remove('is-busy');
      submit.querySelector('.sp-submit-label').textContent = 'Send ticket';
    }
  });

  document.getElementById('sp-again').addEventListener('click', () => {
    form.reset();
    count.textContent = '0 / 5000';
    done.hidden = true;
    form.hidden = false;
    form.name.focus();
  });
})();

function toggleNav() {
  const btn = document.getElementById('nav-hamburger');
  const drawer = document.getElementById('nav-drawer');
  const open = btn.classList.toggle('open');
  drawer.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
