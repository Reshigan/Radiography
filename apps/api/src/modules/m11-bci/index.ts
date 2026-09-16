import { defineModule, router } from '../../kernel/index.js';

// M11 Clinical Intelligence — implemented by the module builder. Keep basePath 'bci'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M11', status: 'stub' }));

export default defineModule({ code: 'M11', name: 'Clinical Intelligence', basePath: 'bci', routes: r });
