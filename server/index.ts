const server = Bun.serve({
	routes: {
		"/api/status": () => new Response("OK"),
		"/users/:id": (req) => {
			return new Response(`Hello User ${req.params.id}!`);
		},
		"/api/posts": {
			GET: () => new Response("List posts"),
			POST: async (req) => {
				const body = await req.json();
				return Response.json({ created: true, ...(body as object) });
			},
		},
		"/favicon.ico": Bun.file("./favicon.ico"),
	},
});

console.log(`Server running at ${server.url}`);
