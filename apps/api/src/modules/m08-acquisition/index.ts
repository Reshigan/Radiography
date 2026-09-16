import { defineModule, router } from '../../kernel/index.js';

// M08 Acquisition & Worklist — implemented by the module builder. Keep basePath 'acquisition'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M08', status: 'stub' }));

export default defineModule({ code: 'M08', name: 'Acquisition & Worklist', basePath: 'acquisition', routes: r });
