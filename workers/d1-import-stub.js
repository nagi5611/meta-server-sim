// Placeholder Worker entry so wrangler.toml validates (D1 execute only).
export default {
    async fetch() {
        return new Response('metasim D1 import stub', { status: 404 });
    },
};
