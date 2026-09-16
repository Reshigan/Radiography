import { defineModule, router } from '../../kernel/index.js';

// M07 Registration & Safety — implemented by the module builder. Keep basePath 'registration'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M07', status: 'stub' }));

export default defineModule({ code: 'M07', name: 'Registration & Safety', basePath: 'registration', routes: r });
