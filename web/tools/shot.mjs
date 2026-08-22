#!/usr/bin/env node
// Screenshot the page in the states that are worth looking at.
//
//   node web/tools/shot.mjs                 # local files
//   node web/tools/shot.mjs --url https://lesomnus.github.io/arrakis/
//   node web/tools/shot.mjs --only dropdown
//   node web/tools/shot.mjs --keep          # leave the server up for poking at
//
// Writes PNGs to web/tools/shots/. Requires `npx playwright install chromium`.
//
// The scenes are chosen for what static review cannot answer: whether the
// theme actually flips, whether the native-vs-styled select popup renders,
// whether an unsupported platform reads as deliberate rather than broken, and
// whether the layout survives a phone.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir, rm } from 'node:fs/promises';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'shots');

const argv = parseArgs(process.argv.slice(2));
const DESKTOP = { width: 900, height: 1000 };
const PHONE = { width: 390, height: 844 };

const SCENES = [
	{ name: 'home-light', theme: 'light', viewport: DESKTOP, full: true },
	{ name: 'home-dark', theme: 'dark', viewport: DESKTOP, full: true },
	{
		// Searching: the highlight must land on the characters a reader expects.
		name: 'search',
		theme: 'light',
		viewport: DESKTOP,
		full: true,
		async act(page) {
			await search(page, 'gh');
		},
	},
	{
		// The command line follows focus first, hover second. Tab to a row and
		// check it tracks the keyboard rather than wherever the pointer rests.
		name: 'focused',
		theme: 'light',
		viewport: DESKTOP,
		full: true,
		async act(page) {
			await page.locator('.port').nth(3).locator('a.id').focus();
		},
	},
	{
		name: 'hovered',
		theme: 'dark',
		viewport: DESKTOP,
		full: true,
		async act(page) {
			await page.locator('.port').nth(2).hover();
		},
	},
	{
		// A row whose port has no build for the chosen platform: no version
		// badge fill, dimmed name, copy disabled, and the reason on the line.
		name: 'unsupported',
		theme: 'light',
		viewport: DESKTOP,
		full: true,
		async act(page) {
			await page.locator('#os .chip', { hasText: 'windows' }).click();
			await page.locator('.port', { hasText: 'arks' }).hover();
		},
	},
	{
		// The version select opened. Chromium supports `appearance: base-select`,
		// so this is the only way to see whether the styled popup is right.
		name: 'dropdown',
		theme: 'light',
		viewport: DESKTOP,
		async act(page) {
			await page.locator('.port', { hasText: 'github.com/gh' }).locator('select').click();
			await page.waitForTimeout(250);
		},
	},
	{
		name: 'dropdown-dark',
		theme: 'dark',
		viewport: DESKTOP,
		async act(page) {
			await page.locator('.port', { hasText: 'github.com/gh' }).locator('select').click();
			await page.waitForTimeout(250);
		},
	},
	{ name: 'detail-light', theme: 'light', viewport: DESKTOP, full: true, path: 'port.html?id=github.com%2Fgh' },
	{ name: 'detail-dark', theme: 'dark', viewport: DESKTOP, full: true, path: 'port.html?id=golang%2Fgo' },
	{
		// A port with no source.yaml: the page must say so rather than show gaps.
		name: 'detail-handwritten',
		theme: 'light',
		viewport: DESKTOP,
		full: true,
		path: 'port.html?id=claude.ai%2Fcode',
	},
	{ name: 'detail-phone', theme: 'light', viewport: PHONE, full: true, path: 'port.html?id=protocolbuffers%2Fprotobuf%2Fprotoc' },
	{
		// The footer is drawn from attributes only the Pages build stamps in, so
		// nothing local would otherwise exercise it. Fake the stamp.
		name: 'footer',
		theme: 'light',
		viewport: DESKTOP,
		stamp: { sha: 'abc1234', built: '2026-08-22 06:14 UTC' },
		async act(page) {
			await page.locator('footer').scrollIntoViewIfNeeded();
		},
	},
	{
		// A command too long for the box: the fade marks the edge it continues
		// past. Scrolled to the middle so both edges show at once.
		name: 'overflow',
		theme: 'light',
		viewport: { width: 460, height: 700 },
		async act(page) {
			await page.locator('.port', { hasText: 'protocolbuffers' }).hover();
			await page.$eval('#cmd-text', (n) => n.scrollTo({ left: (n.scrollWidth - n.clientWidth) / 2 }));
			await page.waitForTimeout(200);
		},
	},
	{
		name: 'phone',
		theme: 'light',
		viewport: PHONE,
		full: true,
		async act(page) {
			await search(page, 'go');
		},
	},
];

async function search(page, text) {
	await page.fill('#q', text);
	await page.waitForTimeout(80);
}

const server = argv.url ? null : await serve(ROOT);
const base = argv.url ?? `http://127.0.0.1:${server.address().port}/`;
console.log(`base: ${base}`);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const failures = [];
const wanted = SCENES.filter((s) => !argv.only || s.name.includes(argv.only));
if (wanted.length === 0) throw new Error(`no scene matches ${argv.only}`);

for (const scene of wanted) {
	const context = await browser.newContext({ viewport: scene.viewport, colorScheme: scene.theme, deviceScaleFactor: 2 });
	const page = await context.newPage();

	const problems = [];
	page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
	page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
	page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));

	if (scene.stamp) {
		// Rewrite the html tag the same way the Pages workflow does, rather than
		// patching the DOM afterwards -- that way this exercises the real path.
		await page.route('**/*.html', async (route) => {
			const res = await route.fetch();
			const body = (await res.text()).replace('<html lang="en">', `<html lang="en" data-built="${scene.stamp.built}" data-sha="${scene.stamp.sha}">`);
			await route.fulfill({ response: res, body });
		});
		await page.route(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), async (route) => {
			const res = await route.fetch();
			const body = (await res.text()).replace('<html lang="en">', `<html lang="en" data-built="${scene.stamp.built}" data-sha="${scene.stamp.sha}">`);
			await route.fulfill({ response: res, body });
		});
	}

	await page.goto(new URL(scene.path ?? '', base).href, { waitUntil: 'networkidle' });
	await page.waitForSelector(scene.path ? 'main:not([hidden])' : '.port', { timeout: 5000 });
	if (scene.act) await scene.act(page);

	// Horizontal overflow is invisible in a full-page screenshot but very
	// visible on a phone, so assert it rather than trusting the eye.
	const overflow = await page.evaluate(() => {
		const d = document.documentElement;
		return d.scrollWidth > d.clientWidth ? `${d.scrollWidth} > ${d.clientWidth}` : null;
	});
	if (overflow) problems.push(`horizontal overflow: ${overflow}`);

	const file = join(OUT, `${scene.name}.png`);
	await page.screenshot({ path: file, fullPage: scene.full ?? false });
	console.log(`  ${scene.name.padEnd(16)} ${file}${problems.length ? `\n    ! ${problems.join('\n    ! ')}` : ''}`);

	if (problems.length > 0) failures.push(`${scene.name}: ${problems.join('; ')}`);
	await context.close();
}

await browser.close();
if (server && !argv.keep) server.close();
if (argv.keep) console.log(`\nserver still up at ${base} (ctrl-c to stop)`);

if (failures.length > 0) {
	console.error(`\n${failures.length} scene(s) reported problems:\n  ${failures.join('\n  ')}`);
	process.exitCode = 1;
}

/** Minimal static server; the page is plain files, so nothing more is needed. */
async function serve(root) {
	const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
	const s = createServer(async (req, res) => {
		// Strip the query and refuse anything that climbs out of the root.
		const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
		if (path.includes('..')) {
			res.writeHead(403).end('forbidden');
			return;
		}
		const file = join(root, path === '/' ? 'index.html' : path);
		try {
			const body = await readFile(file);
			res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
		} catch {
			res.writeHead(404).end('not found');
		}
	});
	await new Promise((r) => s.listen(0, '127.0.0.1', r));
	return s;
}

function parseArgs(args) {
	const out = {};
	for (let i = 0; i < args.length; i++) {
		if (!args[i].startsWith('--')) continue;
		const key = args[i].slice(2);
		out[key] = args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[++i];
	}
	return out;
}
