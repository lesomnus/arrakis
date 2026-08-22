// The detail page: everything about one port that the list deliberately omits.

import {
	chip,
	commandFor,
	defaultVersion,
	drawBuild,
	fillVersionOptions,
	label,
	loadIndex,
	OS_LOGO,
	platform,
	platformOf,
	platformsInIndex,
	PORT_ROOT,
	portById,
	REPO,
	setPlatform,
	svg,
	wireCopy,
} from './shared.js';

const el = {
	title: document.getElementById('title'),
	subtitle: document.getElementById('subtitle'),
	detail: document.getElementById('detail'),
	missing: document.getElementById('missing'),
	version: document.getElementById('d-version'),
	platform: document.getElementById('d-platform'),
	cmd: document.getElementById('d-cmd'),
	copy: document.getElementById('d-copy'),
	accepts: document.getElementById('d-accepts'),
	source: document.getElementById('d-source'),
	platforms: document.querySelector('#d-platforms tbody'),
	versions: document.querySelector('#d-versions tbody'),
	commit: document.getElementById('commit'),
	built: document.getElementById('built'),
};

let port = null;
let version = '';

init();

async function init() {
	drawBuild(el.commit, el.built);

	const id = (new URLSearchParams(location.search).get('id') ?? '').toLowerCase();
	try {
		await loadIndex();
	} catch (err) {
		el.title.textContent = 'unavailable';
		el.subtitle.textContent = `failed to load index: ${err.message}`;
		return;
	}

	port = portById(id);
	if (port === null) {
		el.title.textContent = id || 'port';
		el.missing.hidden = false;
		return;
	}

	document.title = `${port.id} — arrakis`;
	el.title.textContent = port.id;
	el.subtitle.append(`redirects to `, code(port.target), '…');
	version = defaultVersion(port);

	wireCopy(el.copy, () => {
		const cmd = commandFor(port, version);
		return cmd.ok ? cmd.text : null;
	});

	drawVersionPicker();
	drawPlatformPicker();
	drawCommand();
	drawSource();
	drawTables();
	el.detail.hidden = false;
}

function drawVersionPicker() {
	const seen = new Set();
	const tags = [];
	for (const v of port.versions) for (const a of v.aliases ?? []) if (!seen.has(a)) (seen.add(a), tags.push(a));
	tags.sort((a, b) => (a === 'latest' ? -1 : b === 'latest' ? 1 : 0));

	const nodes = tags.slice(0, 8).map((t) => chip(t, version === t, () => set(t)));

	// Aliases already have chips beside this, so the select is exact versions
	// only, ruled off between series.
	const select = document.createElement('select');
	select.className = 'chip pick';
	select.setAttribute('aria-label', 'exact version');
	fillVersionOptions(select, port, version, { placeholder: true, aliases: false });
	select.addEventListener('change', () => select.value && set(select.value));
	nodes.push(select);

	el.version.replaceChildren(...nodes);
}

function drawPlatformPicker() {
	const available = platformsInIndex();
	el.platform.replaceChildren(
		...available.os.flatMap((os) =>
			available.arch.map((arch) => {
				const has = port.platforms.some((p) => p.os === os && p.arch === arch);
				const b = chip(`${os}/${arch}`, platform.os === os && platform.arch === arch, () => {
					setPlatform({ os, arch });
					drawPlatformPicker();
					drawCommand();
				});
				b.classList.add('os');
				if (OS_LOGO[os]) b.prepend(svg(OS_LOGO[os]));
				// Shown but marked: which platforms are missing is part of the answer.
				b.dataset.available = String(has);
				if (!has) b.title = `${port.id} publishes no ${os}/${arch} build`;
				return b;
			}),
		),
	);
}

function set(v) {
	version = v;
	drawVersionPicker();
	drawCommand();
}

function drawCommand() {
	const cmd = commandFor(port, version);
	el.cmd.textContent = cmd.text;
	el.cmd.parentElement.dataset.state = cmd.ok ? 'ok' : 'unavailable';
	el.copy.disabled = !cmd.ok;

	const p = platformOf(port);
	const extra = p ? p.accepts.filter((a) => a !== p.arch) : [];
	el.accepts.textContent = extra.length > 0 ? `also accepts: ${extra.join(', ')}` : '';
}

function drawSource() {
	const rows = [];
	const s = port.source;

	if (!s) {
		rows.push(['discovery', text('versions are added by hand; there is no source.yaml')]);
	} else if (s.kind === 'github') {
		rows.push(['discovery', text('GitHub releases')]);
		rows.push(['repository', link(`https://github.com/${s.repo}`, s.repo)]);
	} else {
		rows.push(['discovery', text(`HTTP (${s.kind})`)]);
		rows.push(['endpoint', link(s.url, s.url)]);
	}

	if (s) {
		if (s.match) rows.push(['match', code(s.match)]);
		rows.push(['prereleases', text(s.prerelease ? 'kept' : 'skipped')]);
		rows.push(['considers', text(s.limit > 0 ? `newest ${s.limit} discovered` : 'all discovered')]);
		rows.push(['aliases', text([s.latest && 'latest', s.series && 'series'].filter(Boolean).join(', ') || 'none')]);
	}

	rows.push(['redirects to', code(port.target)]);
	if (port.dir) rows.push(['port files', link(`${REPO}/tree/main/${PORT_ROOT}/${port.dir}`, `${PORT_ROOT}/${port.dir}`)]);

	el.source.replaceChildren(
		...rows.flatMap(([k, v]) => {
			const dt = document.createElement('dt');
			dt.textContent = k;
			const dd = document.createElement('dd');
			dd.append(v);
			return [dt, dd];
		}),
	);
}

function drawTables() {
	el.platforms.replaceChildren(
		...port.platforms.map((p) => {
			const tr = document.createElement('tr');
			tr.append(cell(p.os), cell(p.arch), cell(p.accepts.join(', '), true));
			return tr;
		}),
	);

	el.versions.replaceChildren(
		...port.versions.map((v) => {
			const tr = document.createElement('tr');
			tr.append(cell(v.v, true), cell((v.aliases ?? []).join(', '), true));
			return tr;
		}),
	);
}

function cell(value, mono) {
	const td = document.createElement('td');
	if (mono) td.append(code(value));
	else td.textContent = value;
	return td;
}

function code(value) {
	const c = document.createElement('code');
	c.textContent = value;
	return c;
}

function text(value) {
	return document.createTextNode(value);
}

function link(href, value) {
	const a = document.createElement('a');
	a.href = href;
	a.rel = 'noreferrer';
	a.textContent = value;
	return a;
}
