const WebSocket = require('ws');
const http = require('http');
const os = require('os');
const url = require('url');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Expose to the local network

// Create a WebSocket server (without attaching it directly via server property)
const wss = new WebSocket.Server({ noServer: true });

// Create an HTTP server
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (req.method === 'GET' && parsedUrl.pathname === '/api/incoming-order') {
        const driverId = parsedUrl.query.driver_id;
        const orderId = parsedUrl.query.order_id;

        if (!driverId || !orderId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing driver_id or order_id parameter' }));
        }

        let sent = false;
        wss.clients.forEach(function each(client) {
            if (client.readyState === WebSocket.OPEN && client.topic === `/${driverId}`) {
                client.send(JSON.stringify({
                    type: 'incoming_order',
                    order_id: orderId,
                    message: `New incoming order: ${orderId}`
                }));
                sent = true;
            }
        });

        if (sent) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: `incoming_order sent to ${driverId} for order ${orderId}` }));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `Driver ${driverId} not connected` }));
        }
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket Logger Server is running.\nConnect via ws://<ip>:<port>/driver_123\nAPI: GET /api/incoming-order?driver_id=driver_123&order_id=ord_456\n');
});


// Handle the HTTP upgrade (this is where the "handshake" occurs)
server.on('upgrade', function upgrade(request, socket, head) {
    const { pathname } = url.parse(request.url);

    // Verify the handshake topic (using the URL path as the topic)
    if (pathname && pathname.startsWith('/driver_')) {
        wss.handleUpgrade(request, socket, head, function done(ws) {
            ws.topic = pathname;
            wss.emit('connection', ws, request);
        });
    } else {
        // Reject connections with an incorrect topic
        console.log(`[REJECTED] Setup attempted with invalid topic: ${pathname}`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
    }
});

// Handle WebSocket connections
wss.on('connection', function connection(ws, request) {
    const ip = request.socket.remoteAddress;
    const topic = ws.topic || 'unknown';
    console.log(`[CONNECTED] Client joined topic "${topic}" from IP: ${ip}`);

    // Send a welcome message
    ws.send(JSON.stringify({
        type: 'system',
        message: `Welcome to the ${topic} log stream`
    }));

    // Listen for incoming messages
    ws.on('message', function incoming(message) {
        try {
            // Assume the message is a string or buffer, parsing it
            const logData = message.toString();

            // Log raw incoming message
            console.log(`[${topic} LOG]: ${logData}`);

            // Try parsing as JSON to check for specific events
            try {
                const parsedData = JSON.parse(logData);

                // Track acceptOrRejectOrder event
                if (parsedData.type === 'acceptOrRejectOrder') {
                    console.log(`[${topic} EVENT acceptOrRejectOrder] Data received:`, JSON.stringify(parsedData, null, 2));
                }
            } catch (parseErr) {
                // Ignore if it's not a JSON string
            }

            // Optional: Broadcast the log to all connected clients on this topic
            /*
            wss.clients.forEach(function each(client) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(logData);
                }
            });
            */
        } catch (e) {
            console.error('Error handling message:', e);
        }
    });

    ws.on('close', () => {
        console.log(`[DISCONNECTED] Client left topic "${topic}" from IP: ${ip}`);
    });
});

// Export the server for Vercel
module.exports = server;

// Only start the server if this file is run directly (not as a module on Vercel)
if (require.main === module) {
    server.listen(PORT, HOST, () => {
        console.log(`\n========================================`);
        console.log(`  WebSocket Server Listening on port ${PORT}`);
        console.log(`========================================\n`);

        // Get loopback interfaces to show local network IPs
        const networkInterfaces = os.networkInterfaces();
        console.log(`To connect from devices on the same network, use one of these addresses:`);

        for (const interfaceName in networkInterfaces) {
            const interfaces = networkInterfaces[interfaceName];
            for (const iface of interfaces) {
                // Find non-internal IPv4 addresses (Local Network IP)
                if (iface.family === 'IPv4' && !iface.internal) {
                    console.log(`  -> ws://${iface.address}:${PORT}/driver_123`);
                }
            }
        }
        console.log(`\nWaiting for connections...`);
    });
}
