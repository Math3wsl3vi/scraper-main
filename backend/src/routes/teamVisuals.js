const express = require('express');
const teamVisualsController = require('../controllers/teamVisualController');

const router = express.Router();

router.get('/', teamVisualsController.getAllTeamVisuals);
router.post('/', teamVisualsController.addTeamVisual);
router.put('/:id', teamVisualsController.updateTeamVisual);
router.delete('/:id', teamVisualsController.deleteTeamVisual);

module.exports = router;
