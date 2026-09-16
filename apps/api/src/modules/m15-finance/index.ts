import { defineModule, router } from '../../kernel/index.js';

// M15 Finance & Consolidation — implemented by the module builder. Keep basePath 'finance'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M15', status: 'stub' }));

export default defineModule({ code: 'M15', name: 'Finance & Consolidation', basePath: 'finance', routes: r });
