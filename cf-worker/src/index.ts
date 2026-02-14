export default {
	async fetch(request, env, ctx): Promise<Response> {
		const k = new URL(request.url).pathname.slice(1)
		const v = await env.KV.get(k)
		if (v === null) {
			return new Response('Not Found', { status: 404 });
		}
		
		return Response.redirect(`https://${v}`, 301);
	},
} satisfies ExportedHandler<Env>;
