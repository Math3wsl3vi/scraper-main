const express = require('express');
const logsController = require('../controllers/logsController.js');

const router = express.Router();

router.get('/', logsController.getAllLogs);
router.get('/:id', logsController.getLogById);

module.exports = router;    
