// Deterministic synthetic corpus generator.
//
// The real index has 7 ports, which is far too small to tell strategies apart.
// This produces records shaped exactly like `arks render --kind index` output
// so every strategy is a drop-in over either source.

const HOSTS = ['github.com', 'gitlab.com', 'go.dev', 'crates.io', 'pypi.org', 'npmjs.com', 'hashicorp.com', 'apache.org', 'sourceforge.net', 'codeberg.org'];

const HEAD = ['open', 'fast', 'micro', 'hyper', 'deep', 'blue', 'red', 'iron', 'cloud', 'edge', 'net', 'data', 'meta', 'proto', 'core', 'nano', 'quantum', 'solar', 'lunar', 'delta'];
const TAIL = ['stack', 'forge', 'lab', 'works', 'kit', 'hub', 'ops', 'shift', 'flow', 'wave', 'gate', 'bridge', 'sync', 'guard', 'scale', 'mesh', 'lens', 'craft', 'grid', 'nest'];
const TOOL = ['ctl', 'cli', 'd', 'fmt', 'lint', 'gen', 'sync', 'agent', 'proxy', 'build', 'test', 'run', 'pack', 'ship', 'watch', 'probe', 'trace', 'tune', 'wrap', 'scan'];

const PLATFORM_SETS = [
	[['linux', 'amd64', ['amd64', 'x86_64']], ['linux', 'arm64', ['aarch64', 'arm64']]],
	[['linux', 'amd64', ['amd64', 'x86_64']], ['linux', 'arm64', ['aarch64', 'arm64']], ['darwin', 'amd64', ['amd64', 'x86_64']], ['darwin', 'arm64', ['aarch64', 'arm64']]],
	[['linux', 'amd64', ['amd64', 'x86_64']], ['linux', 'arm64', ['aarch64', 'arm64']], ['darwin', 'amd64', ['amd64', 'x86_64']], ['darwin', 'arm64', ['aarch64', 'arm64']], ['windows', 'amd64', ['AMD64']], ['windows', 'arm64', ['ARM64']]],
];

/** mulberry32 -- small, fast, seedable. Keeps corpora reproducible across runs. */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

function versionsOf(r) {
	const count = 3 + Math.floor(r() * 25);
	const major = 1 + Math.floor(r() * 40);
	const out = [];
	let minor = count;
	for (let i = 0; i < count; i++, minor--) {
		const v = `${major}.${minor}.${Math.floor(r() * 5)}`;
		out.push(i === 0 ? { v, aliases: [`${major}.${minor}`, 'latest'] } : { v, aliases: [`${major}.${minor}`] });
	}
	return out;
}

/**
 * Generate `n` port records. Always emits distinct ids.
 * Pass the real index's ports as `seedPorts` to keep them in the corpus.
 */
export function generate(n, { seed = 1, seedPorts = [] } = {}) {
	const r = rng(seed);
	const ports = [...seedPorts];
	const taken = new Set(ports.map((p) => p.id));

	while (ports.length < n) {
		const host = pick(r, HOSTS);
		const org = `${pick(r, HEAD)}${pick(r, TAIL)}`;
		const repo = r() < 0.5 ? `${pick(r, HEAD)}-${pick(r, TAIL)}` : pick(r, TAIL);
		const name = r() < 0.6 ? `${pick(r, HEAD)}${pick(r, TOOL)}` : pick(r, TOOL);

		const id = `${org}/${repo}/${name}`;
		if (taken.has(id)) continue;
		taken.add(id);

		const target = `${host}/${org}/${repo}/releases/download/`;
		const versions = versionsOf(r);
		const platforms = pick(r, PLATFORM_SETS).map(([os, arch, accepts]) => ({ os, arch, accepts }));

		ports.push({
			id,
			path: `${org}/${repo}`,
			name,
			target,
			latest: versions[0].v,
			versions,
			platforms,
			haystack: haystackOf(id, name, target),
		});
	}

	return ports.slice(0, n);
}

function haystackOf(id, name, target) {
	const seen = new Set();
	const out = [];
	const add = (s) => {
		s = s.toLowerCase().replace(/^\/+|\/+$/g, '');
		if (s && !seen.has(s)) {
			seen.add(s);
			out.push(s);
		}
	};
	add(id);
	add(name);
	add(target.replace(/\/+$/, ''));
	for (const part of `${id}/${target}`.split(/[/-]/)) add(part);
	return out.join(' ');
}

/**
 * Build a realistic query workload from the corpus itself.
 * Real users type prefixes, so every full term is expanded into its prefixes;
 * that is the workload the search box actually sees.
 */
export function queries(ports, { seed = 7, terms = 40 } = {}) {
	const r = rng(seed);
	const out = [];

	for (let i = 0; i < terms; i++) {
		const port = ports[Math.floor(r() * ports.length)];
		const word = port.name;
		for (let k = 1; k <= Math.min(word.length, 6); k++) out.push(word.slice(0, k));
	}
	// Subsequence queries -- the case a prefix index cannot serve.
	for (let i = 0; i < terms / 2; i++) {
		const port = ports[Math.floor(r() * ports.length)];
		const s = port.id.replace(/[^a-z0-9]/g, '');
		out.push(s[0] + s[Math.floor(s.length / 2)] + s[s.length - 1]);
	}
	// Misses.
	for (const q of ['zzq', 'qqqq', 'xyzzy', 'jjjj']) out.push(q);

	return out;
}
