import { defineModule, router } from '../../kernel/index.js';

// M09 Image Management — implemented by the module builder. Keep basePath 'imaging'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M09', status: 'stub' }));

export default defineModule({ code: 'M09', name: 'Image Management', basePath: 'imaging', routes: r });
