const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.DEMO_PORT || 4173);
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png'};

http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    // The original desktop plugin uses Jellyfin image endpoints directly, whereas
    // the TV panel uses ApiClient.getImageUrl. Both must resolve in the offline demo.
    const assetPath = /^\/Items\/episode-[1-4]\/Images\/Primary$/.test(pathname)
        ? '/demo/artwork.svg' : pathname;
    const filename = path.resolve(root, '.' + (assetPath === '/' ? '/demo/index.html' : assetPath.endsWith('/') ? assetPath + 'index.html' : assetPath));
    if (!filename.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
    }
    fs.readFile(filename, (error, contents) => {
        if (error) { response.writeHead(404).end('Not found'); return; }
        response.writeHead(200, {'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
        response.end(contents);
    });
}).listen(port, '127.0.0.1', () => {
    console.log(`Episode preview demo: http://127.0.0.1:${port}/demo/`);
});
