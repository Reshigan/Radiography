import { defineModule, router } from '../../kernel/index.js';

// M12 Reporting — implemented by the module builder. Keep basePath 'reporting'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M12', status: 'stub' }));

export default defineModule({ code: 'M12', name: 'Reporting', basePath: 'reporting', routes: r });
