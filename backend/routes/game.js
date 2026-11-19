const express = require('express');
const game = require('../services/gameEngine');
const config = require('../config');
const { requireSession } = require('../middleware/session');
const { requireText } = require('../middleware/validation');
const { createLimiter } = require('../middleware/rateLimit');
const { createAiService, QUESTIONS } = require('../services/aiService');
const { run, readFileName } = require('../services/virtualLinux');
function createGameRouter(ai = createAiService(config)) {
  const router = express.Router();
  router.get('/health', (req, res) => res.json({ ok: true }));
  router.post('/start', createLimiter(30, 60000), (req, res) => {
    if (req.body?.mode !== undefined && !['event', 'practice'].includes(req.body.mode)) return res.status(400).json({ error: 'Choose event or practice mode.' });
    try {
      const sessionId = game.createSession({ mode: req.body?.mode });
      res.json({ sessionId, state: game.publicState(game.getSession(sessionId)) });
    } catch { res.status(503).json({ error: 'Mission capacity reached. Try again shortly.' }); }
  });
  router.use(requireSession);
  router.get('/state', (req, res) => res.json(game.publicState(req.game)));
  router.post('/hint', (req, res) => res.json(game.hint(req.game)));
  router.post('/answer', requireText, (req, res) => {
    const stage = Number(req.body.stage);
    if (![1, 2, 3].includes(stage)) return res.status(400).json({ error: 'Invalid answer stage.' });
    res.json(game.answer(req.game, stage, req.body.value, req.body.evidence));
  });
  router.post('/evidence', (req, res) => {
    if (!['record', 'pin', 'unpin'].includes(req.body?.action) || typeof req.body?.id !== 'string' || req.body.id.length > 100) return res.status(400).json({ error: 'Choose a valid evidence action and item.' });
    res.json(game.evidence(req.game, req.body.action, req.body.id));
  });
  router.post('/recovery', (req, res) => {
    if (!['quarantine', 'restore', 'verify'].includes(req.body?.action) || typeof req.body?.target !== 'string' || req.body.target.length > 100) return res.status(400).json({ error: 'Choose a recovery action and target.' });
    res.json(game.recover(req.game, req.body.action, req.body.target));
  });
  router.post('/terminal', requireText, (req, res) => {
    if (!game.valid(req.game) || req.game.stage !== 2) return res.status(403).json({ error: 'Terminal is locked or session ended.', state: game.publicState(req.game) });
    const output = run(req.body.command);
    const file = readFileName(req.body.command);
    if (file && !req.game.readFiles.includes(file)) req.game.readFiles.push(file);
    req.game.terminalHistory.push({ command: req.body.command, output });
    req.game.terminalHistory = req.game.terminalHistory.slice(-50);
    req.game.revision++;
    res.json({ output, state: game.publicState(req.game) });
  });
  router.post('/ai', (req, res, next) => {
    if (!game.valid(req.game) || req.game.stage !== 2) return res.status(403).json({ error: 'AI channel is available only during an active Stage 2.', state: game.publicState(req.game) });
    const question = QUESTIONS.find(item => item.id === req.body?.questionId);
    const message = question?.text ?? req.body?.message;
    if ((req.body?.questionId !== undefined && !question) ||
        typeof message !== 'string' || !message.trim() || message.length > 300) {
      return res.status(400).json({ error: 'Send a valid questionId or a message of 1-300 characters.' });
    }
    req.aiMessage = message.trim();
    req.aiQuestionId = question?.id;
    if (req.game.aiPending) return res.status(409).json({ error: 'The controller is already responding.' });
    if (req.game.aiRequests >= config.sessionLimit) return res.status(429).json({ error: 'AI question limit reached. Continue using terminal evidence and hints.' });
    if (req.game.aiLastAt && Date.now() - req.game.aiLastAt < 3000) {
      res.set('Retry-After', '3');
      return res.status(429).json({ error: 'Wait a moment before asking another question.', retryAfter: 3 });
    }
    next();
  }, createLimiter(config.minuteLimit, 60000, () => 'all-teams'),
     createLimiter(config.dayLimit, 86400000, () => 'all-teams'), async (req, res) => {
    const session = req.game;
    session.aiPending = true;
    session.aiRequests++;
    session.aiLastAt = Date.now();
    session.revision++;
    try {
      const response = await ai.respond(req.aiMessage, session.aiHistory, req.aiQuestionId);
      session.aiPending = false;
      session.revision++;
      if (!game.valid(session) || session.stage !== 2) {
        return res.status(403).json({ error: 'AI response discarded because the stage or mission ended.', state: game.publicState(session) });
      }
      session.aiHistory.push({ question: req.aiMessage, ...response });
      res.json({ ...response, state: game.publicState(session) });
    } catch {
      session.aiPending = false;
      session.revision++;
      res.status(503).json({ error: 'AI channel unavailable. Continue using terminal evidence and hints.' });
    } finally { session.aiPending = false; }
  });
  router.use((req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  return router;
}
module.exports = createGameRouter();
module.exports.createGameRouter = createGameRouter;
