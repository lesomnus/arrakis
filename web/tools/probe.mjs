#!/usr/bin/env node
// Behavioural checks that need a real browser, as opposed to a picture of one.
//
//   node web/tools/probe.mjs
//   node web/tools/probe.mjs --url https://lesomnus.github.io/arrakis/
//
// Everything here is something a screenshot cannot show, because it is about
// what happens between two states rather than either of them.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : true]] : [])));

const failures = [];
const check = (name, ok, detail = '') => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
	if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
};

const server = argv.url ? null : await serve(ROOT);
const base = argv.url ?? `http://127.0.0.1:${server.address().port}/`;
console.log(`base: ${base}\n`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
const page = await context.newPage();
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.port');

const commandPort = async () => ((await page.$eval('#cmd-text', (n) => n.textContent)).match(/pkg\.opt\.td\/(.+?)@/) ?? [])[1] ?? null;
const rows = await page.$$eval('.port', (ns) => ns.map((n) => ({ id: n.dataset.id, ...n.getBoundingClientRect().toJSON() })));

// --- the pointer crossing the gaps between rows ------------------------------
//
// Rows are spaced apart, so dragging down the list puts the pointer over the
// page background between every pair. Clearing the hover there made the command
// line snap back to the first result and then forward again, once per gap.
console.log('pointer walking down the list');
{
	const seen = [];
	for (let y = rows[0].y - 4; y <= rows.at(-1).y + rows.at(-1).height + 4; y += 3) {
		await page.mouse.move(500, y);
		const port = await commandPort();
		if (seen.at(-1) !== port) seen.push(port);
	}

	// Empty before entering the list and after leaving it; in between, each row
	// exactly once and in order.
	const order = rows.map((r) => r.id);
	const inside = seen.filter((p) => p !== null);
	check('every row is reported once, in order', inside.join() === order.join(), `saw ${inside.join(' > ')}`);
	check('the line is empty until the pointer reaches the list', seen[0] === null);
	check('the line empties again once the pointer leaves', seen.at(-1) === null);
}

// --- focus beats hover -------------------------------------------------------
console.log('\nfocus and hover');
{
	await page.locator('.port').nth(2).locator('a.id').focus();
	check('focus sets the command line', (await commandPort()) === rows[2].id);

	await page.locator('.port').nth(5).hover();
	check('hover does not override focus', (await commandPort()) === rows[2].id, `showed ${await commandPort()}`);

	// Tab from the name to the version select: still the same row.
	await page.keyboard.press('Tab');
	check('moving between a row\'s own controls keeps it', (await commandPort()) === rows[2].id, `showed ${await commandPort()}`);

	await page.locator('#q').focus();
	check('losing focus while still hovering shows the hovered row', (await commandPort()) === rows[5].id, `showed ${await commandPort()}`);

	// The complaint this replaced: click a row, move the pointer away, click
	// elsewhere, and the line jumped to whatever row you last happened to cross.
	await page.locator('.port').nth(1).locator('select').click();
	await page.keyboard.press('Escape');
	check('clicking a row selects it', (await commandPort()) === rows[1].id, `showed ${await commandPort()}`);

	await page.mouse.move(20, 20);
	check('moving off the list while focused keeps the focused row', (await commandPort()) === rows[1].id, `showed ${await commandPort()}`);

	await page.locator('#q').focus();
	check('losing focus away from the list shows nothing', (await commandPort()) === null, `showed ${await commandPort()}`);
}

// --- the list must not move when you interact with it ------------------------
//
// The whole point of putting the command outside the rows: pointing at ports
// rewrites one line and moves nothing.
console.log('\nstability');
{
	const geometry = () => page.$$eval('.port', (ns) => ns.map((n) => `${n.getBoundingClientRect().y}:${n.getBoundingClientRect().height}`).join('|'));
	await page.locator('.port').nth(0).hover();
	const before = await geometry();

	for (const i of [0, 3, 6, 1]) await page.locator('.port').nth(i).hover();
	await page.locator('.port').nth(4).locator('select').selectOption({ index: 1 });
	check('hovering and picking a version moves no row', (await geometry()) === before);

	const cmdHeight = () => page.$eval('#cmd', (n) => n.getBoundingClientRect().height);
	const heights = new Set();
	for (const i of [0, 2, 6]) {
		await page.locator('.port').nth(i).hover();
		heights.add(await cmdHeight());
	}

	await page.locator('#os .chip', { hasText: 'windows' }).click();
	await page.locator('.port', { hasText: 'arks' }).hover();
	heights.add(await cmdHeight());

	// A long command scrolls sideways; reserving the scrollbar gutter is what
	// keeps that from making the box taller.
	await page.locator('#os .chip', { hasText: 'linux' }).click();
	await page.setViewportSize({ width: 420, height: 1000 });
	await page.locator('.port').nth(0).hover();
	heights.add(await cmdHeight());
	await page.setViewportSize({ width: 900, height: 1000 });

	check('the command box is one height, always', heights.size === 1, `saw ${[...heights].join(', ')}`);
}

// --- the fade marks the edge the command continues past ----------------------
console.log('\noverflow fades');
{
	await page.setViewportSize({ width: 420, height: 1000 });
	await page.locator('.port', { hasText: 'protocolbuffers' }).hover();
	await page.waitForTimeout(60);

	const fade = () => page.$eval('#cmd', (n) => n.dataset.fade ?? '');
	const scrollable = await page.$eval('#cmd-text', (n) => n.scrollWidth - n.clientWidth);
	check('a long command actually overflows at this width', scrollable > 20, `slack ${scrollable}`);
	check('fades right when there is more to the right', (await fade()).includes('right'), `fade="${await fade()}"`);
	check('no left fade at the start', !(await fade()).includes('left'), `fade="${await fade()}"`);

	await page.$eval('#cmd-text', (n) => n.scrollTo({ left: n.scrollWidth }));
	await page.waitForTimeout(60);
	check('fades left once scrolled to the end', (await fade()) === 'left', `fade="${await fade()}"`);

	await page.$eval('#cmd-text', (n) => n.scrollTo({ left: (n.scrollWidth - n.clientWidth) / 2 }));
	await page.waitForTimeout(60);
	check('fades both while in the middle', (await fade()) === 'left right', `fade="${await fade()}"`);

	await page.setViewportSize({ width: 900, height: 1000 });
	await page.waitForTimeout(60);
	check('no fade when the command fits', (await fade()) === '', `fade="${await fade()}"`);
}

await browser.close();
if (server) server.close();

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} failed:\n  ${failures.join('\n  ')}`);
process.exitCode = failures.length ? 1 : 0;

async function serve(root) {
	const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
	const s = createServer(async (req, res) => {
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
