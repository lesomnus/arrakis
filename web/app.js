import { normalize, positionsOf, scorePort } from './search.js';
import {
	chip,
	commandFor,
	defaultVersion,
	drawBuild,
	fillVersionOptions,
	index,
	label,
	loadIndex,
	OS_LOGO,
	platform,
	platformOf,
	platformsInIndex,
	setPlatform,
	svg,
	trackOverflow,
	wireCopy,
} from './shared.js';

const el = {
	q: document.getElementById('q'),
	results: document.getElementById('results'),
	stat: document.getElementById('stat'),
	empty: document.getElementById('empty'),
	os: document.getElementById('os'),
	arch: document.getElementById('arch'),
	cmd: document.getElementById('cmd'),
	cmdText: document.getElementById('cmd-text'),
	cmdCopy: document.getElementById('cmd-copy'),
	commit: document.getElementById('commit'),
	built: document.getElementById('built'),
};

/** Which version each port is pinned to, keyed by port id. Survives re-renders. */
const pinned = new Map();
/**
 * The row the command line is describing: the focused one, else the hovered
 * one, else none.
 *
 * Hover is sticky *within* the list and cleared on leaving it. Rows have gaps
 * between them, so clearing per row made the line flick away and back every
 * time the pointer crossed one; but keeping the last hovered row after the
 * pointer has gone elsewhere is what made losing focus jump somewhere
 * unpredictable. The list's own bounds contain the gaps, so it is the right
 * thing to watch.
 *
 * There is no fallback to the first result. A line that describes a row you did
 * not point at is worse than a line that says nothing.
 */
let focusedId = null;
let hoveredId = null;
let shown = [];
/** Refreshes the command box's edge fades; set once the box exists. */
let fade = () => {};

init();

async function init() {
	drawBuild(el.commit, el.built);

	try {
		await loadIndex();
	} catch (err) {
		el.stat.textContent = `failed to load index: ${err.message}`;
		return;
	}

	drawPicker();
	fade = trackOverflow(el.cmd, el.cmdText);
	wireCopy(el.cmdCopy, () => {
		const port = activePort();
		if (!port) return null;
		const cmd = commandFor(port, versionOf(port));
		return cmd.ok ? cmd.text : null;
	});

	// Delegated to the list, not bound per row: rows are rebuilt on every
	// keystroke, and `pointerover` bubbling means moving across a gap simply
	// does not report a new row rather than reporting no row at all.
	el.results.addEventListener('pointerover', (e) => {
		const id = e.target.closest?.('.port')?.dataset.id;
		if (id && id !== hoveredId) {
			hoveredId = id;
			drawCommand();
		}
	});
	el.results.addEventListener('pointerleave', () => {
		hoveredId = null;
		drawCommand();
	});
	el.results.addEventListener('focusin', (e) => {
		const id = e.target.closest?.('.port')?.dataset.id;
		if (id && id !== focusedId) {
			focusedId = id;
			drawCommand();
		}
	});
	el.results.addEventListener('focusout', (e) => {
		// Moving between the controls of one row is not leaving it.
		if (e.relatedTarget?.closest?.('.port')) return;
		focusedId = null;
		drawCommand();
	});

	el.q.addEventListener('input', run);
	el.q.value = new URLSearchParams(location.search).get('q') ?? '';
	run();
}

function run() {
	const query = normalize(el.q.value);

	const t0 = performance.now();
	const hits = search(query);
	const ms = performance.now() - t0;

	el.stat.textContent = query
		? `${hits.length} / ${index.ports.length} ports · ${ms < 0.05 ? '<0.05' : ms.toFixed(2)} ms`
		: plural(index.ports.length, 'port');
	el.empty.hidden = hits.length > 0;

	shown = hits.map((h) => h.port);
	if (!shown.some((p) => p.id === focusedId)) focusedId = null;
	if (!shown.some((p) => p.id === hoveredId)) hoveredId = null;

	draw(query, hits);
	drawCommand();

	const url = new URL(location.href);
	if (query) url.searchParams.set('q', el.q.value);
	else url.searchParams.delete('q');
	history.replaceState(null, '', url);
}

function search(query) {
	if (!query) return index.ports.map((port) => ({ port, onId: false }));

	const hits = [];
	for (const port of index.ports) {
		const hit = scorePort(query, port);
		if (hit) hits.push({ port, score: hit.score, onId: hit.onId });
	}
	hits.sort((a, b) => b.score - a.score);
	return hits;
}

function draw(query, hits) {
	el.results.replaceChildren(
		...hits.map(({ port, onId }) => {
			// Backtracking the alignment is only worth it for what is on screen.
			const positions = onId ? positionsOf(query, port.id) : [];
			return row(port, positions);
		}),
	);
}

function row(port, positions) {
	const supported = platformOf(port) !== null;

	const li = document.createElement('li');
	li.className = 'port';
	li.dataset.id = port.id;
	li.dataset.supported = String(supported);
	// Latest first, then the name, so both columns line up down the list.
	const ver = document.createElement('span');
	ver.className = 'ver';
	ver.textContent = port.latest ?? '';
	ver.title = port.latest ? `latest is ${port.latest}` : '';

	const name = document.createElement('a');
	name.className = 'id';
	name.href = `./port.html?id=${encodeURIComponent(port.id)}`;
	name.append(...highlight(port.id, positions));

	li.append(ver, name, versionSelect(port), rowCopy(port));
	return li;
}

function versionSelect(port) {
	const select = document.createElement('select');
	select.className = 'chip pick';
	select.setAttribute('aria-label', `version of ${port.id}`);

	// The list is for picking something to run now; the port page holds the
	// complete set.
	fillVersionOptions(select, port, versionOf(port), { recent: true });

	select.addEventListener('change', () => {
		pinned.set(port.id, select.value);
		drawCommand();
	});
	return select;
}

function rowCopy(port) {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = 'copy';
	b.textContent = 'copy';

	const cmd = commandFor(port, versionOf(port));
	b.disabled = !cmd.ok;
	if (!cmd.ok) b.title = cmd.text;
	// Read at click time: the platform or the pinned version may have changed.
	wireCopy(b, () => {
		const c = commandFor(port, versionOf(port));
		return c.ok ? c.text : null;
	});
	return b;
}

function versionOf(port) {
	return pinned.get(port.id) ?? defaultVersion(port);
}

function activePort() {
	const id = focusedId ?? hoveredId;
	return id ? (shown.find((p) => p.id === id) ?? null) : null;
}

function drawCommand() {
	const port = activePort();
	if (!port) {
		el.cmd.dataset.state = 'empty';
		el.cmdText.textContent = shown.length > 0 ? 'point at a port for its command' : 'nothing to show';
		el.cmdCopy.disabled = true;
		el.cmdText.scrollLeft = 0;
		fade();
		return;
	}

	const cmd = commandFor(port, versionOf(port));
	el.cmd.dataset.state = cmd.ok ? 'ok' : 'unavailable';
	el.cmdText.textContent = cmd.text;
	el.cmdCopy.disabled = !cmd.ok;

	for (const li of el.results.children) li.dataset.active = String(li.dataset.id === port.id);
	fade();
}

function drawPicker() {
	const available = platformsInIndex();

	el.os.replaceChildren(
		...available.os.map((os) => {
			const b = chip(os, platform.os === os, () => pick({ ...platform, os }));
			b.classList.add('os');
			if (OS_LOGO[os]) b.prepend(svg(OS_LOGO[os]));
			return b;
		}),
	);
	el.arch.replaceChildren(...available.arch.map((arch) => chip(arch, platform.arch === arch, () => pick({ ...platform, arch }))));
}

function pick(next) {
	setPlatform(next);
	drawPicker();
	run();
}

function plural(n, word) {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
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
