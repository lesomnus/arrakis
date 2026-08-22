// Pieces both the index and the port page need: the index itself, the platform
// choice, the command built from them, and the logos.

export const HOST = 'pkg.opt.td';
export const REPO = 'https://github.com/lesomnus/arrakis';
/** Where the port files live, relative to the repository root. */
export const PORT_ROOT = 'port';

const SHELL_ARCH = { linux: '$(uname -m)', darwin: '$(uname -m)', windows: '${env:PROCESSOR_ARCHITECTURE}' };
const STORE_KEY = 'arrakis:platform';

// Inner SVG on a 24x24 grid, filled with currentColor so a logo inherits the
// colour of whatever it sits in. Authored here rather than fetched: four logos
// are cheaper inline than one more request.
export const OS_LOGO = {
	linux:
		'<path d="M9.6 18.6c.8.4 1 1.5.4 2.5s-1.7 1.5-2.5 1.1-1-1.5-.4-2.5 1.7-1.5 2.5-1.1z"/>' +
		'<path d="M14.4 18.6c-.8.4-1 1.5-.4 2.5s1.7 1.5 2.5 1.1 1-1.5.4-2.5-1.7-1.5-2.5-1.1z"/>' +
		'<path fill-rule="evenodd" d="M12 1.5c2.2 0 3.9 1.8 3.9 4 0 .7-.1 1.3-.2 1.8-.1.7.3 1.2 1 2.2 1.1 1.7 2 3.6 2 5.6 0 3.4-3 5.4-6.7 5.4S5.3 18.5 5.3 15.1c0-2 .9-3.9 2-5.6.7-1 1.1-1.5 1-2.2-.1-.5-.2-1.1-.2-1.8 0-2.2 1.7-4 3.9-4z' +
		'M10.4 4.7a.9 1.05 0 100 2.1.9 1.05 0 100-2.1zM13.6 4.7a.9 1.05 0 100 2.1.9 1.05 0 100-2.1zM12 6.6l1.5 1.1-1.5 1.1-1.5-1.1z"/>',
	darwin:
		'<path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>',
	windows: '<path d="M2.2 5.4 10.1 4.3v7.3H2.2zM11.1 4.15 21.8 2.7v8.9H11.1zM2.2 12.4h7.9v7.3L2.2 18.6zM11.1 12.4h10.7v8.9l-10.7-1.45z"/>',
};

export const GITHUB_LOGO =
	'<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>';

const OS_ORDER = ['linux', 'darwin', 'windows'];
const ARCH_ORDER = ['amd64', 'arm64', 'x86', 'arm'];

/** @type {{schema: number, ports: Array}} */
export let index = { schema: 0, ports: [] };
/**
 * The chosen platform, global rather than per port and shared between pages.
 * A port that does not publish it shows nothing selected, which is the useful
 * answer rather than an error.
 */
export let platform = { os: 'linux', arch: 'amd64' };

export async function loadIndex() {
	const res = await fetch('./index.json', { cache: 'no-cache' });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	index = await res.json();

	for (const port of index.ports) {
		port.name = port.name.toLowerCase();
		port.id = port.id.toLowerCase();
		port.haystack = port.haystack.toLowerCase();
	}
	platform = restorePlatform();
	return index;
}

export function portById(id) {
	return index.ports.find((p) => p.id === id) ?? null;
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

	const ua = navigator.userAgent;
	const guess = `${/Win/i.test(ua) ? 'windows' : /Mac/i.test(ua) ? 'darwin' : 'linux'}/${/arm64|aarch64/i.test(ua) ? 'arm64' : 'amd64'}`;

	for (const c of [stored, guess, `${available.os[0]}/${available.arch[0]}`]) {
		const [os, arch] = (c ?? '').split('/');
		if (available.os.includes(os) && available.arch.includes(arch)) return { os, arch };
	}
	return { os: available.os[0], arch: available.arch[0] };
}

/** The union of what the ports publish, so the picker never offers a dead end. */
export function platformsInIndex() {
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

export function setPlatform(next) {
	platform = next;
	try {
		localStorage.setItem(STORE_KEY, `${next.os}/${next.arch}`);
	} catch {
		// Not being able to remember the choice is not worth failing over.
	}
}

/** The port's entry for the chosen platform, or null when it does not publish it. */
export function platformOf(port) {
	return port.platforms.find((p) => p.os === platform.os && p.arch === platform.arch) ?? null;
}

/**
 * The download command for a port at a version, or the reason there isn't one.
 * Falling back to another platform would hand the user a command that downloads
 * the wrong binary, which is worse than handing them none.
 */
export function commandFor(port, version) {
	const p = platformOf(port);
	if (p === null) {
		return { ok: false, text: `no ${platform.os}/${platform.arch} build — pick another platform above` };
	}

	const url = `https://${HOST}/${port.id}@${version}/${p.os}/${SHELL_ARCH[p.os] ?? p.arch}`;
	return { ok: true, text: p.os === 'windows' ? `curl -LO "${url}"` : `curl -LO ${url}`, platform: p };
}

/** The alias tags a port offers, "latest" first. */
export function aliasesOf(port, limit = 6) {
	const out = [];
	for (const v of port.versions) {
		for (const a of v.aliases ?? []) if (!out.includes(a)) out.push(a);
	}
	out.sort((a, b) => (a === 'latest' ? -1 : b === 'latest' ? 1 : 0));
	return out.slice(0, limit);
}

/**
 * The version with its last dot-segment removed: "2.97.0" -> "2.97", "35.1" ->
 * "35". Null when there is no dot to remove, which is how a version that is not
 * semver-shaped opts out of grouping.
 *
 * This is the same "series" the alias generator uses, so the grouping the page
 * shows matches the tags the port actually publishes.
 */
export function seriesOf(value) {
	const i = value.lastIndexOf('.');
	return i < 0 ? null : value.slice(0, i);
}

/**
 * Fill a <select> with a port's aliases and then every exact version, ruled off
 * between series. Within a series only the newest patch is undimmed, because
 * that is the one the series alias resolves to and the one you almost always
 * want; the older patches stay selectable for pinning.
 *
 * Only Chromium can style the options inside an open picker, so elsewhere the
 * separators show and the dimming does not. The separators are the part that
 * carries the structure, so that degrades acceptably.
 */
export function fillVersionOptions(select, port, current, { placeholder = false, aliases = true } = {}) {
	const nodes = [];

	if (placeholder) {
		const head = new Option('pin exact…', '');
		head.disabled = true;
		nodes.push(head);
	}

	if (aliases) for (const a of aliasesOf(port, 3)) nodes.push(new Option(a, a));
	if (nodes.length > 0) nodes.push(document.createElement('hr'));

	let series = undefined;
	for (const v of port.versions) {
		const s = seriesOf(v.v);
		const changed = series !== undefined && s !== series;
		if (changed && s !== null) nodes.push(document.createElement('hr'));

		const opt = new Option(v.v, v.v);
		// Newest of its series when the series just changed, or when there is no
		// series to speak of.
		if (s !== null && !changed && series !== undefined) opt.dataset.old = 'true';
		nodes.push(opt);
		series = s;
	}

	select.replaceChildren(...nodes);
	select.value = current;
	// A value that is not in the list leaves the select on its first entry;
	// with a placeholder that is the right thing, without one fall back.
	if (select.value !== current && !placeholder) select.value = defaultVersion(port);
	return select;
}

export function defaultVersion(port) {
	return port.latest ? 'latest' : port.versions[0].v;
}

// ---- small DOM helpers -----------------------------------------------------

export function svg(markup, cls) {
	const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	node.setAttribute('viewBox', '0 0 24 24');
	node.setAttribute('aria-hidden', 'true');
	node.setAttribute('focusable', 'false');
	if (cls) node.setAttribute('class', cls);
	// Static markup authored above, never user input.
	node.innerHTML = markup;
	return node;
}

export function chip(text, pressed, onClick) {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = 'chip';
	b.textContent = text;
	b.setAttribute('aria-pressed', String(pressed));
	b.addEventListener('click', onClick);
	return b;
}

export function label(text) {
	const l = document.createElement('label');
	l.textContent = text;
	return l;
}

/**
 * Wire a button to copy `textOf()`, with feedback that resets itself.
 * The button sits in a fixed-width grid track, so swapping the label cannot
 * move anything even though "copied" is longer than "copy".
 */
export function wireCopy(button, textOf) {
	const idle = button.textContent;
	let reset = 0;

	button.addEventListener('click', async (e) => {
		e.preventDefault();
		e.stopPropagation();
		const text = textOf();
		if (!text) return;

		let ok = true;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			ok = false;
		}
		button.dataset.state = ok ? 'copied' : 'failed';
		button.textContent = ok ? 'copied' : 'failed';

		clearTimeout(reset);
		reset = setTimeout(() => {
			delete button.dataset.state;
			button.textContent = idle;
		}, 1200);
	});
}

/**
 * Footer: the commit this build came from and when it was built. Only the Pages
 * build stamps these in, so serving the files directly simply leaves them out.
 */
export function drawBuild(commit, built) {
	const sha = document.documentElement.dataset.sha;
	if (sha) {
		commit.href = `${REPO}/commit/${sha}`;
		commit.rel = 'noreferrer';
		commit.append(svg(GITHUB_LOGO, 'mark'), Object.assign(document.createElement('code'), { textContent: sha }));
		commit.hidden = false;
	}

	const at = document.documentElement.dataset.built;
	if (at && built) {
		built.textContent = at;
		built.hidden = false;
	}
}
