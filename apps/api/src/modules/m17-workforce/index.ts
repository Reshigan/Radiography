import { defineModule, router } from '../../kernel/index.js';

// M17 Workforce — implemented by the module builder. Keep basePath 'workforce'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M17', status: 'stub' }));

export default defineModule({ code: 'M17', name: 'Workforce', basePath: 'workforce', routes: r });
