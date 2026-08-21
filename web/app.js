import { normalize, scorePort } from './search.js';

const HOST = 'pkg.opt.td';
const SHELL_ARCH = { linux: '$(uname -m)', darwin: '$(uname -m)', windows: '${env:PROCESSOR_ARCHITECTURE}' };

const el = {
	q: document.getElementById('q'),
	results: document.getElementById('results'),
	stat: document.getElementById('stat'),
	empty: document.getElementById('empty'),
	build: document.getElementById('build'),
};

/** @type {{ports: Array}} */
let index = { ports: [] };
/** Per-port UI state, keyed by port id. */
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

	el.q.addEventListener('input', run);
	el.q.value = new URLSearchParams(location.search).get('q') ?? '';
	run();
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
			const li = document.createElement('li');
			li.className = 'port';
			li.setAttribute('aria-current', String(port.id === openId));

			const head = document.createElement('button');
			head.type = 'button';
			head.setAttribute('aria-expanded', String(port.id === openId));
			head.append(
				span('id', highlight(port.id, positions)),
				port.latest ? span('ver', port.latest) : '',
				span('count', `${port.versions.length} versions · ${port.platforms.length} platforms`),
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

	// Platform.
	const platforms = document.createElement('div');
	platforms.className = 'row';
	platforms.append(label('platform'));
	for (const p of port.platforms) {
		const key = `${p.os}/${p.arch}`;
		platforms.append(
			chip(key, state.platform === key, () => {
				state.platform = key;
				run();
			}),
		);
	}
	box.append(platforms);

	box.append(command(port, state));
	return box;
}

function command(port, state) {
	const p = port.platforms.find((x) => `${x.os}/${x.arch}` === state.platform) ?? port.platforms[0];
	const url = `https://${HOST}/${port.id}@${state.version}/${p.os}/${SHELL_ARCH[p.os] ?? p.arch}`;
	const text = p.os === 'windows' ? `curl -LO "${url}"` : `curl -LO ${url}`;

	const box = document.createElement('div');
	box.className = 'cmd';

	const code = document.createElement('code');
	code.textContent = text;
	box.append(code);

	const copy = document.createElement('button');
	copy.type = 'button';
	copy.textContent = 'copy';
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
		state = { version: port.latest ? 'latest' : port.versions[0].v, platform: guessPlatform(port) };
		picked.set(port.id, state);
	}
	return state;
}

function guessPlatform(port) {
	const ua = navigator.userAgent;
	const os = /Win/i.test(ua) ? 'windows' : /Mac/i.test(ua) ? 'darwin' : 'linux';
	const arch = /arm64|aarch64/i.test(ua) ? 'arm64' : 'amd64';
	const keys = port.platforms.map((p) => `${p.os}/${p.arch}`);
	return keys.find((k) => k === `${os}/${arch}`) ?? keys.find((k) => k.startsWith(`${os}/`)) ?? keys[0];
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
