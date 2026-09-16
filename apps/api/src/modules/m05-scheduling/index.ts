import { defineModule, router } from '../../kernel/index.js';

// M05 Scheduling & Capacity — implemented by the module builder. Keep basePath 'scheduling'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M05', status: 'stub' }));

export default defineModule({ code: 'M05', name: 'Scheduling & Capacity', basePath: 'scheduling', routes: r });
