const express = require('express');
const matchesController = require('../controllers/matchesContoller.js');

const router = express.Router();

router.get('/', matchesController.getAllMatches);
router.get('/:id', matchesController.getMatchById);
router.post('/', matchesController.addMatch);
router.put('/:id', matchesController.updateMatch);
router.delete('/:id', matchesController.deleteMatch);

module.exports = router;
