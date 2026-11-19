// Bearer LOBBY_SIM_SERVICE_TOKEN for Worker → sim service routes

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function lobbyServiceBearerAuth(req, res, next) {
    const expected = String(process.env.LOBBY_SIM_SERVICE_TOKEN || '').trim();
    if (!expected) {
        return res.status(503).json({ error: 'service_token_not_configured' });
    }
    const auth = String(req.headers.authorization || '');
    if (auth !== `Bearer ${expected}`) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
}