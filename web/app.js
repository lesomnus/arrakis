import { normalize, scorePort } from './search.js';

const HOST = 'pkg.opt.td';
const SHELL_ARCH = { linux: '$(uname -m)', darwin: '$(uname -m)', windows: '${env:PROCESSOR_ARCHITECTURE}' };
const STORE_KEY = 'arrakis:platform';

// Inner SVG on a 24x24 grid, filled with currentColor so a logo inherits the
// pressed/hover colour of the chip it sits in. Authored here rather than
// fetched: three logos are cheaper inline than one more request.
const OS_LOGO = {
	linux:
		'<path d="M9.6 18.6c.8.4 1 1.5.4 2.5s-1.7 1.5-2.5 1.1-1-1.5-.4-2.5 1.7-1.5 2.5-1.1z"/>' +
		'<path d="M14.4 18.6c-.8.4-1 1.5-.4 2.5s1.7 1.5 2.5 1.1 1-1.5.4-2.5-1.7-1.5-2.5-1.1z"/>' +
		'<path fill-rule="evenodd" d="M12 1.5c2.2 0 3.9 1.8 3.9 4 0 .7-.1 1.3-.2 1.8-.1.7.3 1.2 1 2.2 1.1 1.7 2 3.6 2 5.6 0 3.4-3 5.4-6.7 5.4S5.3 18.5 5.3 15.1c0-2 .9-3.9 2-5.6.7-1 1.1-1.5 1-2.2-.1-.5-.2-1.1-.2-1.8 0-2.2 1.7-4 3.9-4z' +
		'M10.4 4.7a.9 1.05 0 100 2.1.9 1.05 0 100-2.1zM13.6 4.7a.9 1.05 0 100 2.1.9 1.05 0 100-2.1zM12 6.6l1.5 1.1-1.5 1.1-1.5-1.1z"/>',
	darwin:
		'<path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>',
	windows: '<path d="M2.2 5.4 10.1 4.3v7.3H2.2zM11.1 4.15 21.8 2.7v8.9H11.1zM2.2 12.4h7.9v7.3L2.2 18.6zM11.1 12.4h10.7v8.9l-10.7-1.45z"/>',
};

// Order the pickers by how common the platform is rather than alphabetically.
const OS_ORDER = ['linux', 'darwin', 'windows'];
const ARCH_ORDER = ['amd64', 'arm64', 'x86', 'arm'];

const el = {
	q: document.getElementById('q'),
	results: document.getElementById('results'),
	stat: document.getElementById('stat'),
	empty: document.getElementById('empty'),
	build: document.getElementById('build'),
	os: document.getElementById('os'),
	arch: document.getElementById('arch'),
};

/** @type {{ports: Array}} */
let index = { ports: [] };
/**
 * The chosen platform, global rather than per port. Every port defaults to it,
 * and a port that does not publish it shows nothing selected -- which is the
 * useful answer, not an error.
 */
let platform = { os: 'linux', arch: 'amd64' };
/** Which version each port is pinned to, keyed by port id. */
const picked = new Map();
let openId = null;

init();

async function init() {
	el.build.textContent = document.documentElement.dataset.build ?? '';
	try {
		const res = await fetch('./index.json', { cache: 'no-cache' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		index = await res.json();
	} catch (err) {
		el.stat.textContent = `failed to load index: ${err.message}`;
		return;
	}

	for (const port of index.ports) {
		port.name = normalize(port.name);
		port.id = normalize(port.id);
		port.haystack = normalize(port.haystack);
	}

	platform = restorePlatform();
	drawPicker();

	el.q.addEventListener('input', run);
	el.q.value = new URLSearchParams(location.search).get('q') ?? '';
	run();
}

/** Stored choice, else a guess from the user agent, else the first available. */
function restorePlatform() {
	const available = platformsInIndex();
	let stored = null;
	try {
		stored = localStorage.getItem(STORE_KEY);
	} catch {
		// Private mode or blocked storage; the guess below is good enough.
	}

	const candidates = [stored, guessPlatform(), `${available.os[0]}/${available.arch[0]}`];
	for (const c of candidates) {
		const [os, arch] = (c ?? '').split('/');
		if (available.os.includes(os) && available.arch.includes(arch)) return { os, arch };
	}
	return { os: available.os[0], arch: available.arch[0] };
}

function guessPlatform() {
	const ua = navigator.userAgent;
	const os = /Win/i.test(ua) ? 'windows' : /Mac/i.test(ua) ? 'darwin' : 'linux';
	const arch = /arm64|aarch64/i.test(ua) ? 'arm64' : 'amd64';
	return `${os}/${arch}`;
}

/** The union of what the ports actually publish, so the picker never offers a dead end. */
function platformsInIndex() {
	const os = new Set();
	const arch = new Set();
	for (const port of index.ports) {
		for (const p of port.platforms) {
			os.add(p.os);
			arch.add(p.arch);
		}
	}
	const rank = (order) => (a, b) => {
		const ia = order.indexOf(a);
		const ib = order.indexOf(b);
		return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b);
	};
	return { os: [...os].sort(rank(OS_ORDER)), arch: [...arch].sort(rank(ARCH_ORDER)) };
}

function setPlatform(next) {
	platform = next;
	try {
		localStorage.setItem(STORE_KEY, `${next.os}/${next.arch}`);
	} catch {
		// Not being able to remember the choice is not worth failing over.
	}
	drawPicker();
	run();
}

function drawPicker() {
	const available = platformsInIndex();

	el.os.replaceChildren(
		...available.os.map((os) => {
			const b = chip(os, platform.os === os, () => setPlatform({ ...platform, os }));
			b.classList.add('os');
			const mark = logo(os);
			if (mark) b.prepend(mark);
			return b;
		}),
	);

	el.arch.replaceChildren(...available.arch.map((arch) => chip(arch, platform.arch === arch, () => setPlatform({ ...platform, arch }))));
}

function logo(os) {
	const markup = OS_LOGO[os];
	if (!markup) return null;

	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	// Static markup authored in OS_LOGO above, never user input.
	svg.innerHTML = markup;
	return svg;
}

/** The port's entry for the chosen platform, or null when it does not publish it. */
function platformOf(port) {
	return port.platforms.find((p) => p.os === platform.os && p.arch === platform.arch) ?? null;
}

function run() {
	const query = normalize(el.q.value);

	// Timed so the cost of the strategy is visible; see web/bench for the
	// comparison of strategies at larger corpus sizes.
	const t0 = performance.now();
	const hits = search(query);
	const ms = performance.now() - t0;

	el.stat.textContent = `${hits.length} / ${index.ports.length} ports · ${ms.toFixed(3)} ms`;
	el.empty.hidden = hits.length > 0;
	draw(hits);

	const url = new URL(location.href);
	if (query) url.searchParams.set('q', el.q.value);
	else url.searchParams.delete('q');
	history.replaceState(null, '', url);
}

function search(query) {
	if (!query) {
		return index.ports.map((port) => ({ port, positions: [] }));
	}

	const hits = [];
	for (const port of index.ports) {
		const hit = scorePort(query, port);
		if (hit) hits.push({ port, score: hit.score, positions: hit.field === 'id' ? hit.positions : [] });
	}
	hits.sort((a, b) => b.score - a.score);
	return hits;
}

function draw(hits) {
	el.results.replaceChildren(
		...hits.map(({ port, positions }) => {
			const supported = platformOf(port) !== null;

			const li = document.createElement('li');
			li.className = 'port';
			li.setAttribute('aria-current', String(port.id === openId));
			li.dataset.supported = String(supported);

			const head = document.createElement('button');
			head.type = 'button';
			head.setAttribute('aria-expanded', String(port.id === openId));
			head.append(
				span('id', highlight(port.id, positions)),
				port.latest ? span('ver', port.latest) : '',
				span('count', supported ? `${port.versions.length} versions` : `no ${platform.os}/${platform.arch} build`),
			);
			head.addEventListener('click', () => {
				openId = openId === port.id ? null : port.id;
				run();
			});
			li.append(head);

			if (port.id === openId) li.append(detail(port));
			return li;
		}),
	);
}

function detail(port) {
	const state = pickFor(port);

	const box = document.createElement('div');
	box.className = 'detail';

	// Version: aliases as chips, plus a full list for the exact pins.
	const versions = document.createElement('div');
	versions.className = 'row';
	versions.append(label('version'));
	for (const alias of aliasesOf(port)) {
		versions.append(
			chip(alias, state.version === alias, () => {
				state.version = alias;
				run();
			}),
		);
	}
	const select = document.createElement('select');
	select.className = 'chip';
	for (const v of port.versions) {
		const opt = new Option(v.v, v.v, false, state.version === v.v);
		select.append(opt);
	}
	// An alias is selected, so no option in the list is current; show the
	// placeholder. Otherwise the select holds the selection and should read as
	// pressed, the same way the alias chips do.
	const pinned = port.versions.some((v) => v.v === state.version);
	if (!pinned) select.prepend(new Option('pin exact…', '', true, true));
	select.dataset.pinned = String(pinned);
	select.addEventListener('change', () => {
		if (!select.value) return;
		state.version = select.value;
		run();
	});
	versions.append(select);
	box.append(versions);

	// What this port publishes. The chosen one is pressed; picking another sets
	// the global choice rather than a per-port override, so the header always
	// tells the truth about what the commands below say.
	const platforms = document.createElement('div');
	platforms.className = 'row';
	platforms.append(label('platform'));
	for (const p of port.platforms) {
		const pressed = p.os === platform.os && p.arch === platform.arch;
		platforms.append(chip(`${p.os}/${p.arch}`, pressed, () => setPlatform({ os: p.os, arch: p.arch })));
	}
	box.append(platforms);

	box.append(command(port, state));
	return box;
}

function command(port, state) {
	const p = platformOf(port);

	const box = document.createElement('div');
	box.className = 'cmd';

	const code = document.createElement('code');
	const copy = document.createElement('button');
	copy.type = 'button';
	copy.textContent = 'copy';

	if (p === null) {
		// Nothing is selected because nothing resolves. Say which platform is
		// missing rather than silently falling back to one the user did not ask
		// for -- a command that downloads the wrong binary is worse than none.
		box.dataset.unavailable = 'true';
		code.textContent = `no ${platform.os}/${platform.arch} build — pick another platform above`;
		copy.disabled = true;
		box.append(code, copy);
		return box;
	}

	const url = `https://${HOST}/${port.id}@${state.version}/${p.os}/${SHELL_ARCH[p.os] ?? p.arch}`;
	const text = p.os === 'windows' ? `curl -LO "${url}"` : `curl -LO ${url}`;

	code.textContent = text;
	box.append(code);

	copy.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(text);
			copy.textContent = 'copied';
		} catch {
			copy.textContent = 'press ⌘/ctrl+c';
		}
		setTimeout(() => (copy.textContent = 'copy'), 1200);
	});
	box.append(copy);

	// The accepted arch spellings are ground truth from the index; show the
	// ones that are not already in the command so they are discoverable.
	const extra = p.accepts.filter((a) => a !== p.arch);
	if (extra.length > 0) {
		const note = document.createElement('p');
		note.className = 'stat';
		note.style.margin = '0.5rem 0 0';
		note.textContent = `also accepts: ${extra.join(', ')}`;
		const wrap = document.createElement('div');
		wrap.append(box, note);
		return wrap;
	}
	return box;
}

function pickFor(port) {
	let state = picked.get(port.id);
	if (!state) {
		state = { version: port.latest ? 'latest' : port.versions[0].v };
		picked.set(port.id, state);
	}
	return state;
}

function aliasesOf(port) {
	const out = [];
	for (const v of port.versions) {
		for (const a of v.aliases ?? []) if (!out.includes(a)) out.push(a);
	}
	// "latest" first, then the newest few series aliases.
	out.sort((a, b) => (a === 'latest' ? -1 : b === 'latest' ? 1 : 0));
	return out.slice(0, 6);
}

function highlight(text, positions) {
	if (positions.length === 0) return [text];

	const set = new Set(positions);
	const out = [];
	let buf = '';
	let marked = false;
	for (let i = 0; i < text.length; i++) {
		const hit = set.has(i);
		if (hit !== marked && buf) {
			out.push(marked ? mark(buf) : buf);
			buf = '';
		}
		marked = hit;
		buf += text[i];
	}
	if (buf) out.push(marked ? mark(buf) : buf);
	return out;
}

function mark(text) {
	const m = document.createElement('mark');
	m.textContent = text;
	return m;
}

function span(cls, content) {
	const s = document.createElement('span');
	s.className = cls;
	s.append(...(Array.isArray(content) ? content : [content]));
	return s;
}

function label(text) {
	const l = document.createElement('label');
	l.textContent = text;
	return l;
}

function chip(text, pressed, onClick) {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = 'chip';
	b.textContent = text;
	b.setAttribute('aria-pressed', String(pressed));
	b.addEventListener('click', onClick);
	return b;
}
