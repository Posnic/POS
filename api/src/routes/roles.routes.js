const express = require('express');

const router = express.Router();
const rolesController = require('../controllers/roles.controller');
const { protect } = require('../middleware/auth');

const bind = (handler) => (req, res, next) => handler.call(rolesController, req, res, next);

router.use(protect);

// Static routes before the /:id param route.
router.get('/', bind(rolesController.list));
router.post('/seed', bind(rolesController.seed));

router.get('/:id', bind(rolesController.getById));
router.post('/', bind(rolesController.create));
router.put('/:id', bind(rolesController.update));
router.patch('/:id', bind(rolesController.update));
router.delete('/:id', bind(rolesController.remove));

module.exports = router;
